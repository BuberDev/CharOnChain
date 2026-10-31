/**
 * Testy integracyjne migracji 0002_chain_projection (COC-021) na PRAWDZIWYM Postgresie.
 * Pokrywają: AC-13 (idempotencja zdarzeń), AC-14 (reorg: stany + historia), ADR-112 (końcówka celu),
 * zgodność xp/tier z regułami PRD (SQL ↔ TypeScript), brak zapisów z ról klienckich (RLS).
 */
import { MAX_UINT256, TIERS, tierFromRaw, USDC_UNIT, xpFromRaw } from "@charonchain/shared";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadMigrations } from "./migrations.js";
import { findTablesWithoutRls, migrateUp } from "./runner.js";
import { createTempDatabase, ensureRole, type TempDatabase } from "./testing/db.js";

const MIGRATIONS_DIR = new URL("../migrations", import.meta.url).pathname;

let temp: TempDatabase;
let client: Client;

const hash = (n: number): string => `0x${n.toString(16).padStart(64, "0")}`;
const addr = (n: number): string => `0x${n.toString(16).padStart(40, "0")}`;

function pgCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    return typeof error.code === "string" ? error.code : undefined;
  }
  return undefined;
}

/** Oczekuje błędu Postgresa o danym kodzie SQLSTATE. */
async function expectPgError(run: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await run();
  } catch (error) {
    expect(pgCode(error), error instanceof Error ? error.message : String(error)).toBe(code);
    return;
  }
  throw new Error(`Oczekiwano błędu SQLSTATE ${code}, ale zapytanie przeszło`);
}

interface EventOverrides {
  chain_id?: number;
  contract_lower?: string;
  event_name?: string;
  tx_hash?: string;
  log_index?: number;
  block_number?: number;
  block_hash?: string;
  tx_index?: number;
  args?: string;
  canonical?: boolean;
  confirmation_state?: string;
  confirmed_at?: string | null;
}

let txCounter = 1_000;

async function insertEvent(overrides: EventOverrides = {}): Promise<string> {
  const row = {
    chain_id: 421614,
    contract_lower: addr(0xa1),
    event_name: "DonationReceived",
    tx_hash: hash(txCounter++),
    log_index: 0,
    block_number: 100,
    block_hash: hash(0xb1),
    tx_index: 0,
    args: '{"amountRaw":"1000000"}',
    canonical: true,
    confirmation_state: "OBSERVED",
    confirmed_at: null as string | null,
    ...overrides,
  };
  const result = await client.query<{ id: string }>(
    `insert into public.chain_events
       (chain_id, contract_lower, event_name, tx_hash, log_index, block_number, block_hash,
        tx_index, args, canonical, confirmation_state, confirmed_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::app.confirmation_state, $12)
     returning id`,
    [
      row.chain_id,
      row.contract_lower,
      row.event_name,
      row.tx_hash,
      row.log_index,
      row.block_number,
      row.block_hash,
      row.tx_index,
      row.args,
      row.canonical,
      row.confirmation_state,
      row.confirmed_at,
    ],
  );
  return result.rows[0]?.id ?? "";
}

async function insertDonation(eventId: string, amountRaw: string, chainId = 421614): Promise<void> {
  await client.query(
    `insert into public.donations
       (chain_event_id, chain_id, onchain_campaign_id, donor_wallet_lower, beneficiary_lower,
        token_address_lower, amount_raw, block_time, status)
     values ($1, $2, 1, $3, $4, $5, $6::numeric, now(), 'PENDING')`,
    [eventId, chainId, addr(0xd1), addr(0xe1), addr(0xc1), amountRaw],
  );
}

beforeAll(async () => {
  temp = await createTempDatabase();
  client = new Client({ connectionString: temp.url });
  await client.connect();
  // Role klienckie Supabase muszą istnieć PRZED migracją, żeby odebranie uprawnień zadziałało.
  await ensureRole(client, "anon");
  await ensureRole(client, "authenticated");
  await migrateUp(client, loadMigrations(MIGRATIONS_DIR));
});

afterAll(async () => {
  await client.end();
  await temp.drop();
});

describe("chain_events — idempotencja i walidacja (AC-13)", () => {
  it("duplikat (chain_id, tx_hash, log_index) jest odrzucony przez unikalność", async () => {
    const tx = hash(0x1111);
    await insertEvent({ tx_hash: tx, log_index: 3 });
    await expectPgError(() => insertEvent({ tx_hash: tx, log_index: 3 }), "23505");
  });

  it("ta sama transakcja z innym log_index lub inny chain_id to inne zdarzenie", async () => {
    const tx = hash(0x2222);
    await insertEvent({ tx_hash: tx, log_index: 0 });
    await insertEvent({ tx_hash: tx, log_index: 1 });
    await insertEvent({ tx_hash: tx, log_index: 0, chain_id: 42161 });
  });

  it("idempotentny zapis `on conflict do nothing` nie dubluje wiersza", async () => {
    const tx = hash(0x3333);
    const sql = `insert into public.chain_events
        (chain_id, contract_lower, event_name, tx_hash, log_index, block_number, block_hash, tx_index, args)
      values (421614, $1, 'DonationReceived', $2, 0, 5, $3, 0, '{}'::jsonb)
      on conflict (chain_id, tx_hash, log_index) do nothing`;
    for (let i = 0; i < 5; i++) await client.query(sql, [addr(0xa1), tx, hash(0xb2)]);
    const count = await client.query<{ n: number }>(
      "select count(*)::int as n from public.chain_events where tx_hash = $1",
      [tx],
    );
    expect(count.rows[0]?.n).toBe(1);
  });

  it.each<[string, EventOverrides]>([
    ["nieobsługiwany chain_id", { chain_id: 1 }],
    ["tx_hash wielkimi literami", { tx_hash: `0x${"AB".repeat(32)}` }],
    ["tx_hash o złej długości", { tx_hash: "0x12" }],
    ["adres wielkimi literami", { contract_lower: `0x${"AB".repeat(20)}` }],
    ["ujemny block_number", { block_number: -1 }],
    ["ujemny log_index", { log_index: -1 }],
    ["nazwa zdarzenia ze spacją", { event_name: "Donation Received" }],
  ])("odrzuca: %s", async (_label, overrides) => {
    try {
      await insertEvent({ tx_hash: hash(txCounter++), ...overrides });
    } catch (error) {
      expect(["23514", "22001"]).toContain(pgCode(error));
      return;
    }
    throw new Error("Zapytanie nie powinno przejść");
  });

  it("args jest wymagane (NOT NULL)", async () => {
    await expectPgError(
      () =>
        client.query(
          `insert into public.chain_events
             (chain_id, contract_lower, event_name, tx_hash, log_index, block_number, block_hash, tx_index, args)
           values (421614, $1, 'X', $2, 0, 1, $3, 0, null)`,
          [addr(1), hash(txCounter++), hash(9)],
        ),
      "23502",
    );
  });
});

describe("chain_events — maszyna stanów, reorg i historia (AC-14)", () => {
  it("ORPHANED wymaga canonical=false, CONFIRMED wymaga confirmed_at, OBSERVED nie ma confirmed_at", async () => {
    await expectPgError(
      () => insertEvent({ confirmation_state: "ORPHANED", canonical: true }),
      "23514",
    );
    await expectPgError(
      () => insertEvent({ confirmation_state: "OBSERVED", canonical: false }),
      "23514",
    );
    await expectPgError(
      () => insertEvent({ confirmation_state: "CONFIRMED", confirmed_at: null }),
      "23514",
    );
    await expectPgError(
      () => insertEvent({ confirmation_state: "OBSERVED", confirmed_at: new Date().toISOString() }),
      "23514",
    );
  });

  it("pełny cykl: OBSERVED → CONFIRMED → ORPHANED → OBSERVED (inny blok) zapisuje historię", async () => {
    const id = await insertEvent({ block_number: 500, block_hash: hash(0xaa) });

    await client.query(
      "update public.chain_events set confirmation_state = 'CONFIRMED', confirmed_at = now() where id = $1",
      [id],
    );
    await client.query(
      "update public.chain_events set confirmation_state = 'ORPHANED', canonical = false where id = $1",
      [id],
    );
    // Zdarzenie wraca w innym bloku (reorg) — zmienia się miejsce w łańcuchu, nie tożsamość.
    await client.query(
      `update public.chain_events
          set confirmation_state = 'OBSERVED', canonical = true, confirmed_at = null,
              block_number = 502, block_hash = $2
        where id = $1`,
      [id, hash(0xbb)],
    );

    const history = await client.query<{
      old_state: string;
      new_state: string;
      old_block_number: string;
      new_block_number: string;
      old_block_hash: string;
      new_block_hash: string;
    }>(
      `select old_state, new_state, old_block_number, new_block_number, old_block_hash, new_block_hash
         from public.chain_event_history where chain_event_id = $1 order by id`,
      [id],
    );
    expect(history.rows.map((r) => `${r.old_state}>${r.new_state}`)).toEqual([
      "OBSERVED>CONFIRMED",
      "CONFIRMED>ORPHANED",
      "ORPHANED>OBSERVED",
    ]);
    const last = history.rows[2];
    expect(last).toMatchObject({
      old_block_number: "500",
      new_block_number: "502",
      old_block_hash: hash(0xaa),
      new_block_hash: hash(0xbb),
    });
  });

  it("aktualizacja bez zmiany stanu/bloku nie tworzy wpisu historii", async () => {
    const id = await insertEvent();
    await client.query("update public.chain_events set tx_index = 7 where id = $1", [id]);
    const count = await client.query<{ n: number }>(
      "select count(*)::int as n from public.chain_event_history where chain_event_id = $1",
      [id],
    );
    expect(count.rows[0]?.n).toBe(0);
  });

  it("tożsamość i treść zdarzenia są niezmienne", async () => {
    const id = await insertEvent();
    for (const set of [
      "tx_hash = '0x" + "9".repeat(64) + "'",
      "log_index = 99",
      "chain_id = 42161",
      "event_name = 'Other'",
      `contract_lower = '${addr(0xff)}'`,
      `args = '{"amountRaw":"1"}'::jsonb`,
    ]) {
      await expectPgError(
        () => client.query(`update public.chain_events set ${set} where id = $1`, [id]),
        "23001",
      );
    }
  });

  it("DELETE zdarzenia jest zabroniony (ORPHANED zamiast usuwania)", async () => {
    const id = await insertEvent();
    await expectPgError(
      () => client.query("delete from public.chain_events where id = $1", [id]),
      "23001",
    );
  });

  it("historia jest append-only", async () => {
    const id = await insertEvent();
    await client.query(
      "update public.chain_events set confirmation_state = 'CONFIRMED', confirmed_at = now() where id = $1",
      [id],
    );
    await expectPgError(
      () => client.query("update public.chain_event_history set new_canonical = false"),
      "23001",
    );
    await expectPgError(() => client.query("delete from public.chain_event_history"), "23001");
  });
});

describe("donations — projekcja i ADR-112", () => {
  it("końcówka celu poniżej 1 USDC (np. 1 raw) jest akceptowana (ADR-112 / AC-04)", async () => {
    const eventId = await insertEvent();
    await insertDonation(eventId, "1");
  });

  it("przyjmuje maksimum uint256, odrzuca 0, wartości ujemne i powyżej uint256", async () => {
    const ok = await insertEvent();
    await insertDonation(ok, MAX_UINT256.toString());

    for (const bad of ["0", "-1", (MAX_UINT256 + 1n).toString()]) {
      const eventId = await insertEvent();
      try {
        await insertDonation(eventId, bad);
      } catch (error) {
        expect(["23514", "22003"]).toContain(pgCode(error));
        continue;
      }
      throw new Error(`Kwota ${bad} nie powinna zostać przyjęta`);
    }
  });

  it("jedna darowizna na zdarzenie źródłowe", async () => {
    const eventId = await insertEvent();
    await insertDonation(eventId, "1000000");
    await expectPgError(() => insertDonation(eventId, "1000000"), "23505");
  });

  it("chain_id darowizny musi zgadzać się z chain_id zdarzenia (złożony FK)", async () => {
    const eventId = await insertEvent({ chain_id: 421614 });
    await expectPgError(() => insertDonation(eventId, "1000000", 42161), "23503");
  });

  it("nie można dodać darowizny do nieistniejącego zdarzenia", async () => {
    await expectPgError(
      () => insertDonation("00000000-0000-0000-0000-000000000000", "1000000"),
      "23503",
    );
  });
});

describe("donor_stats — spójność z regułami PRD (SQL ↔ TypeScript)", () => {
  async function insertStats(wallet: number, total: string, xp: string, tier: number) {
    await client.query(
      `insert into public.donor_stats (chain_id, wallet_lower, total_donated_raw, xp, tier, source_block_number)
       values (421614, $1, $2::numeric, $3::numeric, $4, 1)`,
      [addr(wallet), total, xp, tier],
    );
  }

  it("przyjmuje wiersz zgodny z regułami; klucz główny (chain, wallet)", async () => {
    const total = 550n * USDC_UNIT;
    await insertStats(0x501, total.toString(), xpFromRaw(total).toString(), tierFromRaw(total));
    await expectPgError(
      () => insertStats(0x501, total.toString(), xpFromRaw(total).toString(), tierFromRaw(total)),
      "23505",
    );
  });

  it("odrzuca xp lub tier niezgodne z sumą (cache nie może kłamać)", async () => {
    const total = 550n * USDC_UNIT;
    await expectPgError(() => insertStats(0x502, total.toString(), "1", 2), "23514");
    await expectPgError(
      () => insertStats(0x503, total.toString(), xpFromRaw(total).toString(), 5),
      "23514",
    );
  });

  it("app.tier_from_raw / app.xp_from_raw zgodne z @charonchain/shared dla granic i losowych", async () => {
    const values: bigint[] = [0n, 1n, USDC_UNIT - 1n, MAX_UINT256];
    for (const tier of TIERS) {
      values.push(tier.thresholdRaw - 1n, tier.thresholdRaw, tier.thresholdRaw + 1n);
    }
    let seed = 0x9e37_79b9_7f4an;
    for (let i = 0; i < 300; i++) {
      seed = (seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
      values.push(seed % (150_000n * USDC_UNIT));
    }
    for (const raw of values) {
      const result = await client.query<{ tier: number; xp: string }>(
        "select app.tier_from_raw($1::numeric)::int as tier, app.xp_from_raw($1::numeric)::text as xp",
        [raw.toString()],
      );
      expect(result.rows[0], raw.toString()).toEqual({
        tier: tierFromRaw(raw),
        xp: xpFromRaw(raw).toString(),
      });
    }
  });
});

describe("indexer_cursors", () => {
  it("klucz (chain, kontrakt), potwierdzony blok nie wyprzedza skanowanego, enum statusu", async () => {
    await client.query(
      `insert into public.indexer_cursors (chain_id, contract_lower, last_scanned_block, last_confirmed_block)
       values (421614, $1, 100, 90)`,
      [addr(0xc0)],
    );
    await expectPgError(
      () =>
        client.query(
          `insert into public.indexer_cursors (chain_id, contract_lower, last_scanned_block, last_confirmed_block)
           values (421614, $1, 100, 90)`,
          [addr(0xc0)],
        ),
      "23505",
    );
    await expectPgError(
      () =>
        client.query(
          `insert into public.indexer_cursors (chain_id, contract_lower, last_scanned_block, last_confirmed_block)
           values (421614, $1, 10, 11)`,
          [addr(0xc1)],
        ),
      "23514",
    );
    await expectPgError(
      () =>
        client.query(
          `insert into public.indexer_cursors (chain_id, contract_lower, status) values (421614, $1, 'BROKEN')`,
          [addr(0xc2)],
        ),
      "22P02",
    );
  });

  it("updated_at jest odświeżane wyzwalaczem", async () => {
    await client.query(
      `insert into public.indexer_cursors (chain_id, contract_lower, updated_at)
       values (421614, $1, '2000-01-01T00:00:00Z')`,
      [addr(0xc3)],
    );
    await client.query(
      "update public.indexer_cursors set last_scanned_block = 5 where contract_lower = $1",
      [addr(0xc3)],
    );
    const result = await client.query<{ fresh: boolean }>(
      "select updated_at > now() - interval '1 minute' as fresh from public.indexer_cursors where contract_lower = $1",
      [addr(0xc3)],
    );
    expect(result.rows[0]?.fresh).toBe(true);
  });
});

describe("brak zapisów publicznych — RLS deny-by-default (docs/03 §3)", () => {
  const TABLES = [
    "chain_events",
    "chain_event_history",
    "donations",
    "donor_stats",
    "indexer_cursors",
  ];

  it("wszystkie nowe tabele mają włączone RLS", async () => {
    expect(await findTablesWithoutRls(client, ["public", "app", "private"])).toEqual([]);
  });

  it.each(["anon", "authenticated"])(
    "%s nie ma uprawnień do tabel projekcji (migracja odebrała je)",
    async (role) => {
      for (const table of TABLES) {
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
          const result = await client.query<{ allowed: boolean }>(
            "select has_table_privilege($1, $2, $3) as allowed",
            [role, `public.${table}`, privilege],
          );
          expect(result.rows[0]?.allowed, `${role} ${privilege} ${table}`).toBe(false);
        }
      }
    },
  );

  it.each(["anon", "authenticated"])(
    "nawet po ponownym nadaniu uprawnień %s nie czyta ani nie zapisuje — blokuje RLS",
    async (role) => {
      const eventId = await insertEvent();
      await insertDonation(eventId, "5000000");
      await client.query("begin");
      try {
        await client.query(
          `grant select, insert, update, delete on public.donations, public.chain_events to ${role}`,
        );
        await client.query(`set local role ${role}`);

        const visible = await client.query<{ n: number }>(
          "select count(*)::int as n from public.donations",
        );
        expect(visible.rows[0]?.n).toBe(0);

        const updated = await client.query("update public.donations set amount_raw = 1");
        expect(updated.rowCount).toBe(0);
        const deleted = await client.query("delete from public.donations");
        expect(deleted.rowCount).toBe(0);

        await client.query("savepoint s1");
        await expectPgError(() => insertDonation(eventId, "1"), "42501");
        await client.query("rollback to savepoint s1");
        await expectPgError(
          () => client.query("insert into public.chain_events (chain_id) values (421614)"),
          "42501",
        );
      } finally {
        await client.query("rollback");
      }
      // Dane właściciela nietknięte.
      const owner = await client.query<{ n: number }>(
        "select count(*)::int as n from public.donations where amount_raw = 5000000",
      );
      expect(owner.rows[0]?.n).toBeGreaterThanOrEqual(1);
    },
  );
});
