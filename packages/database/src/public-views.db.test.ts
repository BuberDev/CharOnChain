/**
 * Migracja 0006 (COC-032, AC-33): widoki publiczne z dowodem transakcji i statusem projekcji — whitelist kolumn,
 * uprawnienia ról, brak wycieku niepotwierdzonych wpłat oraz dokładny rollback.
 */
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadMigrations } from "./migrations.js";
import { migrateDown, migrateUp } from "./runner.js";
import {
  catalogSnapshot,
  createTempDatabase,
  ensureRole,
  type TempDatabase,
} from "./testing/db.js";
import { createPublishedCampaign, hexAddr, hexHash } from "./testing/fixtures.js";

const MIGRATIONS_DIR = new URL("../migrations", import.meta.url).pathname;

let temp: TempDatabase;
let client: Client;

beforeAll(async () => {
  temp = await createTempDatabase();
  client = new Client({ connectionString: temp.url });
  await client.connect();
  await ensureRole(client, "anon");
  await ensureRole(client, "authenticated");
  await migrateUp(client, loadMigrations(MIGRATIONS_DIR));
});

afterAll(async () => {
  await client.end();
  await temp.drop();
});

const columnsOf = async (view: string): Promise<string[]> =>
  (
    await client.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = $1 order by ordinal_position`,
      [view],
    )
  ).rows.map((r) => r.column_name);

describe("public_donations", () => {
  it("whitelist kolumn: dowód transakcji jest, danych prywatnych nie ma", async () => {
    expect(await columnsOf("public_donations")).toEqual([
      "id",
      "campaign_id",
      "chain_id",
      "onchain_campaign_id",
      "donor_wallet_lower",
      "amount_raw",
      "block_time",
      "tx_hash",
      "log_index",
      "block_number",
    ]);
  });

  it("zawiera tylko potwierdzone wpłaty i dokładnie zdarzenie źródłowe", async () => {
    const campaign = await createPublishedCampaign(client, { onchainCampaignId: 1 });
    const insert = async (state: "CONFIRMED" | "OBSERVED", n: number): Promise<string> => {
      const tx = hexHash(0x900 + n);
      const event = await client.query<{ id: string }>(
        `insert into public.chain_events
           (chain_id, contract_lower, event_name, tx_hash, log_index, block_number, block_hash, tx_index, args,
            canonical, confirmation_state, confirmed_at)
         values (421614, $1, 'DonationReceived', $2, 3, 4242, $3, 0, '{"amountRaw":"1000000"}'::jsonb, true,
                 $4::app.confirmation_state, $5) returning id`,
        [
          hexAddr(0xa1),
          tx,
          hexHash(0xb0),
          state,
          state === "CONFIRMED" ? new Date().toISOString() : null,
        ],
      );
      await client.query(
        `insert into public.donations
           (chain_event_id, campaign_id, chain_id, onchain_campaign_id, donor_wallet_lower, beneficiary_lower,
            token_address_lower, amount_raw, block_time, status)
         values ($1, $2, 421614, 1, $3, $4, $5, 1000000, now(), $6::app.donation_status)`,
        [
          event.rows[0]?.id,
          campaign.id,
          hexAddr(0xd1),
          hexAddr(0xbe),
          hexAddr(0xc1),
          state === "CONFIRMED" ? "CONFIRMED" : "PENDING",
        ],
      );
      return tx;
    };
    const confirmedTx = await insert("CONFIRMED", 1);
    await insert("OBSERVED", 2);
    const rows = await client.query<{ tx_hash: string; log_index: number; block_number: string }>(
      "select tx_hash, log_index, block_number::text as block_number from public.public_donations",
    );
    expect(rows.rows).toEqual([{ tx_hash: confirmedTx, log_index: 3, block_number: "4242" }]);
  });
});

describe("public_indexer_status", () => {
  it("agreguje najsłabszy kursor sieci i wykrywa ERROR; bez kursorów brak wiersza", async () => {
    expect((await client.query("select * from public.public_indexer_status")).rowCount).toBe(0);
    await client.query(
      `insert into public.indexer_cursors (chain_id, contract_lower, last_scanned_block, last_confirmed_block, status)
       values (421614, $1, 500, 480, 'IDLE'), (421614, $2, 450, 400, 'ERROR'), (42161, $3, 9, 9, 'IDLE')`,
      [hexAddr(1), hexAddr(2), hexAddr(3)],
    );
    const rows = await client.query<{
      chain_id: number;
      cursors: number;
      scanned_block: string;
      confirmed_block: string;
      has_error: boolean;
    }>(
      `select chain_id, cursors, scanned_block::text, confirmed_block::text, has_error
         from public.public_indexer_status order by chain_id`,
    );
    expect(rows.rows).toEqual(
      [
        {
          chain_id: 421614,
          cursors: 2,
          scanned_block: "450",
          confirmed_block: "400",
          has_error: true,
        },
        { chain_id: 42161, cursors: 1, scanned_block: "9", confirmed_block: "9", has_error: false },
      ].sort((a, b) => a.chain_id - b.chain_id),
    );
    expect(await columnsOf("public_indexer_status")).toEqual([
      "chain_id",
      "cursors",
      "scanned_block",
      "confirmed_block",
      "has_error",
      "age_seconds",
    ]);
  });

  it.each(["app_api", "anon", "authenticated"])(
    "rola %s czyta oba widoki, ale nie tabelę kursorów",
    async (role) => {
      await client.query("begin");
      try {
        await client.query(`set local role ${role}`);
        expect((await client.query("select 1 from public.public_donations limit 1")).command).toBe(
          "SELECT",
        );
        expect(
          (await client.query("select 1 from public.public_indexer_status limit 1")).command,
        ).toBe("SELECT");
        await client.query("savepoint s");
        await expect(client.query("select 1 from public.indexer_cursors limit 1")).rejects.toThrow(
          /permission denied/,
        );
      } finally {
        await client.query("rollback");
      }
    },
  );
});

describe("rollback migracji 0006", () => {
  it("down przywraca dokładnie stan po 0005 (widok bez dowodu transakcji); ponowne up działa", async () => {
    const migrations = loadMigrations(MIGRATIONS_DIR);
    expect(migrations).toHaveLength(6);
    const second = await createTempDatabase();
    const probe = new Client({ connectionString: second.url });
    await probe.connect();
    try {
      await ensureRole(probe, "anon");
      await ensureRole(probe, "authenticated");
      await migrateUp(probe, migrations.slice(0, 5));
      const afterFifth = await catalogSnapshot(probe);
      await migrateUp(probe, migrations);
      const afterSixth = await catalogSnapshot(probe);
      expect(afterSixth).not.toEqual(afterFifth);
      await migrateDown(probe, migrations, 1);
      expect(await catalogSnapshot(probe)).toEqual(afterFifth);
      const cols = await probe.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_name = 'public_donations' order by ordinal_position",
      );
      expect(cols.rows.map((r) => r.column_name)).not.toContain("tx_hash");
      // Po cofnięciu uprawnienia do widoku nadal działają dla roli API.
      await probe.query("begin");
      await probe.query("set local role app_api");
      await probe.query("select 1 from public.public_donations limit 1");
      await probe.query("rollback");
      await migrateUp(probe, migrations);
      expect(await catalogSnapshot(probe)).toEqual(afterSixth);
    } finally {
      await probe.end();
      await second.drop();
    }
  });
});
