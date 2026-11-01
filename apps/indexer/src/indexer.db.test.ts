/**
 * Testy indexera na PRAWDZIWYM Postgresie z symulowanym łańcuchem (COC-030/031): AC-13 (duplikaty/restart),
 * AC-14 (reorg), AC-33 (uzgadnianie), projekcje (darowizny, statystyki, kampanie, raporty), anomalie.
 */
import { randomBytes } from "node:crypto";

import { loadMigrations, migrateUp } from "@charonchain/database";
import {
  createOrganization,
  createDraftCampaign,
  approveCampaign,
  hexAddr,
  hexHash,
  nextId,
} from "@charonchain/database/testing/fixtures";
import { Client } from "pg";
import type { Address, Hex } from "viem";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ReorgDuringScanError, reconcile, runCycle, type IndexerConfig } from "./indexer.js";
import { FakeChain, impactAbi, registryAbi, routerAbi } from "./testing/fake-chain.js";

const MIGRATIONS_DIR = new URL("../../../packages/database/migrations", import.meta.url).pathname;
const adminUrl = (): string => {
  const url = process.env.TEST_DATABASE_URL;
  if (url === undefined || url === "") throw new Error("TEST_DATABASE_URL nie jest ustawione");
  return url;
};
const withDb = (name: string): string => {
  const u = new URL(adminUrl());
  u.pathname = `/${name}`;
  return u.toString();
};

const ADDR = {
  registry: hexAddr(0xa1) as Address,
  router: hexAddr(0xa2) as Address,
  reputation: hexAddr(0xa3) as Address,
  impact: hexAddr(0xa4) as Address,
};
const USDC = hexAddr(0xc1) as Address;
const DONOR = hexAddr(0xd001) as Address;
const DONOR2 = hexAddr(0xd002) as Address;
const CONFIG: IndexerConfig = {
  chainId: 421614,
  contracts: ADDR,
  usdc: USDC,
  confirmations: 12n,
  overlap: 50n,
  maxRange: 20n,
  startBlock: 1n,
};

let templateName: string;
let dbName: string;
let client: Client;
let chain: FakeChain;

async function admin(sql: string): Promise<void> {
  const a = new Client({ connectionString: adminUrl() });
  await a.connect();
  try {
    await a.query(sql);
  } finally {
    await a.end();
  }
}

// Baza-szablon z migracjami tworzona raz; każdy test dostaje świeżą kopię (journal jest append-only,
// więc nie czyścimy tabel, tylko tworzymy bazę od nowa — szybko, bez uprawnień superużytkownika).
beforeAll(async () => {
  templateName = `cc_idx_tpl_${randomBytes(5).toString("hex")}`;
  await admin(`create database ${templateName}`);
  const c = new Client({ connectionString: withDb(templateName) });
  await c.connect();
  await migrateUp(c, loadMigrations(MIGRATIONS_DIR));
  await c.end();
});

afterAll(async () => {
  await admin(`drop database if exists ${templateName} with (force)`);
});

beforeEach(async () => {
  dbName = `cc_idx_${randomBytes(5).toString("hex")}`;
  await admin(`create database ${dbName} template ${templateName}`);
  client = new Client({ connectionString: withDb(dbName) });
  await client.connect();
  chain = new FakeChain(ADDR, 1n);
});

afterEach(async () => {
  await client.end();
  await admin(`drop database if exists ${dbName} with (force)`);
});

/** Kampania gotowa do publikacji (PUBLISHING) i jej odpowiednik „na łańcuchu”. */
async function stagedCampaign(onchainId: number, overrides: { cap?: string } = {}) {
  const org = await createOrganization(client);
  const draft = await createDraftCampaign(
    client,
    org,
    overrides.cap === undefined ? {} : { capRaw: overrides.cap },
  );
  await approveCampaign(client, draft);
  await client.query("update public.campaigns set status = 'PUBLISHING' where id = $1", [draft.id]);
  const row = await client.query<{ metadata_hash: string; start: string; end: string }>(
    `select metadata_hash, extract(epoch from start_at)::bigint::text as start, extract(epoch from end_at)::bigint::text as "end"
       from public.campaigns where id = $1`,
    [draft.id],
  );
  const r = row.rows[0];
  if (r === undefined) throw new Error("brak kampanii");
  chain.setCampaign(BigInt(onchainId), {
    beneficiary: org.safe as Address,
    capRaw: BigInt(draft.capRaw),
    startAt: BigInt(r.start),
    endAt: BigInt(r.end),
    orgHash: hexHash(1) as Hex,
    metadataHash: r.metadata_hash as Hex,
    status: 1,
  });
  return { ...draft, onchainId, safe: org.safe as Address, orgId: org.id };
}

function emitCreated(block: bigint, c: { onchainId: number; safe: Address; capRaw: string }): Hex {
  return chain.emit(block, ADDR.registry, registryAbi, "CampaignCreated", {
    campaignId: BigInt(c.onchainId),
    beneficiary: c.safe,
    orgHash: hexHash(1),
    capRaw: BigInt(c.capRaw),
  });
}

function emitDonation(
  block: bigint,
  c: { onchainId: number; safe: Address },
  donor: Address,
  amount: bigint,
): Hex {
  return chain.emit(block, ADDR.router, routerAbi, "DonationReceived", {
    campaignId: BigInt(c.onchainId),
    donor,
    beneficiary: c.safe,
    amountRaw: amount,
  });
}

const one = async <T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> => (await client.query<T>(sql, params)).rows[0];

describe("publikacja kampanii i darowizny (ścieżka podstawowa)", () => {
  it("zdarzenia stają się CONFIRMED po buforze, kampania PUBLISHED, darowizna i statystyki zgodne z łańcuchem", async () => {
    const c = await stagedCampaign(1);
    emitCreated(10n, c);
    emitDonation(20n, c, DONOR, 25_000_000n);
    chain.mineUntil(25n);

    // head 25: potwierdzone do 13 => kampania PUBLISHED, darowizna (blok 20) jeszcze PENDING.
    const first = await runCycle(client, chain, CONFIG);
    expect(first.confirmedHead).toBe(13n);
    expect(
      (
        await one<{ status: string; onchain_campaign_id: string }>(
          "select status, onchain_campaign_id::text from public.campaigns where id = $1",
          [c.id],
        )
      )?.status,
    ).toBe("PUBLISHED");
    expect((await one<{ status: string }>("select status from public.donations"))?.status).toBe(
      "PENDING",
    );
    // Niepotwierdzona darowizna nie liczy się do XP: wiersz statystyk istnieje, ale suma = 0.
    expect(
      (await one<{ t: string }>("select total_donated_raw::text as t from public.donor_stats"))?.t,
    ).toBe("0");
  });

  it("po osiągnięciu głębokości darowizna jest CONFIRMED, a donor_stats = suma potwierdzonych (xp/tier z reguł PRD)", async () => {
    const c = await stagedCampaign(1);
    emitCreated(10n, c);
    emitDonation(20n, c, DONOR, 25_000_000n);
    emitDonation(21n, c, DONOR, 80_000_000n);
    chain.mineUntil(40n);
    await runCycle(client, chain, CONFIG);

    expect(
      (await client.query("select 1 from public.donations where status = 'CONFIRMED'")).rowCount,
    ).toBe(2);
    const stats = await one<{ total: string; xp: string; tier: number }>(
      "select total_donated_raw::text as total, xp::text, tier from public.donor_stats where wallet_lower = $1",
      [DONOR],
    );
    expect(stats).toEqual({ total: "105000000", xp: "1050", tier: 2 }); // 105 USDC => Bronze
    expect(await reconcile(client, chain, CONFIG)).toEqual([]);
  });

  it("blok czasu darowizny pochodzi z bloku łańcucha", async () => {
    const c = await stagedCampaign(1);
    emitCreated(5n, c);
    emitDonation(7n, c, DONOR, 1_000_000n);
    chain.mineUntil(30n);
    await runCycle(client, chain, CONFIG);
    const row = await one<{ t: string }>(
      "select extract(epoch from block_time)::bigint::text as t from public.donations",
    );
    expect(row?.t).toBe((1_800_000_000n + 7n * 2n).toString());
  });
});

describe("idempotencja i restart (AC-13)", () => {
  it("wielokrotne przetworzenie tych samych bloków nie dubluje zdarzeń, darowizn ani statystyk", async () => {
    const c = await stagedCampaign(1);
    emitCreated(10n, c);
    emitDonation(20n, c, DONOR, 25_000_000n);
    chain.mineUntil(40n);
    for (let i = 0; i < 3; i += 1) await runCycle(client, chain, CONFIG);
    // „awaria”: kursor cofnięty do zera => pełny rescan
    await client.query(
      "update public.indexer_cursors set last_scanned_block = 0, last_confirmed_block = 0",
    );
    await runCycle(client, chain, CONFIG);

    expect(
      (await one<{ c: string }>("select count(*)::text as c from public.chain_events"))?.c,
    ).toBe("2");
    expect((await one<{ c: string }>("select count(*)::text as c from public.donations"))?.c).toBe(
      "1",
    );
    expect(
      (await one<{ t: string }>("select total_donated_raw::text as t from public.donor_stats"))?.t,
    ).toBe("25000000");
    expect(
      (await one<{ c: string }>("select count(*)::text as c from public.chain_event_history"))?.c,
    ).toBe("2"); // tylko OBSERVED->CONFIRMED
  });

  it("zakres większy niż maxRange jest skanowany w porcjach bez utraty zdarzeń", async () => {
    const c = await stagedCampaign(1);
    emitCreated(2n, c);
    for (let i = 0; i < 10; i += 1) emitDonation(BigInt(5 + i * 9), c, DONOR, 1_000_000n);
    chain.mineUntil(150n);
    await runCycle(client, chain, CONFIG);
    expect(
      (
        await one<{ c: string }>(
          "select count(*)::text as c from public.donations where status = 'CONFIRMED'",
        )
      )?.c,
    ).toBe("10");
    expect(await reconcile(client, chain, CONFIG)).toEqual([]);
  });
});

describe("reorg (AC-14)", () => {
  it("niepotwierdzona darowizna znika w reorgu: ORPHANED, statystyki bez zmian; potem wraca w innym bloku", async () => {
    const c = await stagedCampaign(1);
    emitCreated(5n, c);
    const tx = emitDonation(25n, c, DONOR, 10_000_000n);
    chain.mineUntil(30n);
    await runCycle(client, chain, CONFIG);
    expect(
      (
        await one<{ s: string }>(
          "select confirmation_state::text as s from public.chain_events where tx_hash = $1",
          [tx],
        )
      )?.s,
    ).toBe("OBSERVED");

    chain.reorg(24n, 8); // blok 24+ zastąpiony, transakcji nie ma
    chain.mineUntil(40n);
    const afterReorg = await runCycle(client, chain, CONFIG);
    expect(afterReorg.eventsOrphaned).toBe(1);
    expect(
      await one<{ s: string; c: boolean }>(
        "select confirmation_state::text as s, canonical as c from public.chain_events where tx_hash = $1",
        [tx],
      ),
    ).toEqual({ s: "ORPHANED", c: false });
    expect((await one<{ s: string }>("select status::text as s from public.donations"))?.s).toBe(
      "ORPHANED",
    );
    expect(
      (await one<{ t: string }>("select total_donated_raw::text as t from public.donor_stats"))?.t,
    ).toBe("0");

    // ta sama transakcja wraca w innym bloku (ten sam tx hash i logIndex)
    const block = chain.blocks[27];
    if (block === undefined) throw new Error("brak bloku");
    block.logs.push({
      address: ADDR.router,
      transactionHash: tx,
      transactionIndex: 0,
      logIndex: 0,
      topics: chain.blocks[0] === undefined ? [] : await captureTopics(tx),
      data: dataFor(10_000_000n),
    });
    chain.mineUntil(50n);
    await runCycle(client, chain, CONFIG);
    const revived = await one<{ s: string; bn: string }>(
      "select confirmation_state::text as s, block_number::text as bn from public.chain_events where tx_hash = $1",
      [tx],
    );
    expect(revived).toEqual({ s: "CONFIRMED", bn: "27" });
    expect(
      (await one<{ t: string }>("select total_donated_raw::text as t from public.donor_stats"))?.t,
    ).toBe("10000000");
    // historia: OBSERVED -> ORPHANED -> OBSERVED(inny blok) -> CONFIRMED
    expect(
      (
        await one<{ c: string }>(
          "select count(*)::text as c from public.chain_event_history h join public.chain_events e on e.id = h.chain_event_id where e.tx_hash = $1",
          [tx],
        )
      )?.c,
    ).toBe("3");
  });

  it("reorg POTWIERDZONEGO zdarzenia w oknie nakładki: darowizna ORPHANED, stats wracają do zera, uzgadnianie czyste", async () => {
    const c = await stagedCampaign(1);
    emitCreated(5n, c);
    emitDonation(20n, c, DONOR, 40_000_000n);
    chain.mineUntil(40n);
    await runCycle(client, chain, CONFIG);
    expect((await one<{ s: string }>("select status::text as s from public.donations"))?.s).toBe(
      "CONFIRMED",
    );
    expect(
      (await one<{ t: string }>("select total_donated_raw::text as t from public.donor_stats"))?.t,
    ).toBe("40000000");

    chain.reorg(19n, 25); // głęboki reorg (21 bloków) mieści się w nakładce 50
    await runCycle(client, chain, CONFIG);
    expect((await one<{ s: string }>("select status::text as s from public.donations"))?.s).toBe(
      "ORPHANED",
    );
    expect(
      (await one<{ t: string }>("select total_donated_raw::text as t from public.donor_stats"))?.t,
    ).toBe("0");
    expect(await reconcile(client, chain, CONFIG)).toEqual([]);
  });

  it("hash bloku zmieniony w trakcie skanu przerywa cykl bez częściowych zapisów", async () => {
    const c = await stagedCampaign(1);
    emitCreated(5n, c);
    chain.mineUntil(30n);
    let calls = 0;
    chain.onGetBlock = (n) => {
      calls += 1;
      if (calls === 2) chain.reorg(n, 3); // reorg między pierwszym a drugim odczytem hasha bloku końcowego
    };
    await expect(runCycle(client, chain, CONFIG)).rejects.toBeInstanceOf(ReorgDuringScanError);
    expect(
      (await one<{ c: string }>("select count(*)::text as c from public.chain_events"))?.c,
    ).toBe("0");
  });
});

describe("stany zdarzeń: granica potwierdzeń i powrót w tym samym bloku", () => {
  it("blok równy confirmedHead jest CONFIRMED, blok o jeden głębiej (confirmedHead + 1) nadal OBSERVED", async () => {
    const c = await stagedCampaign(1);
    emitCreated(2n, c);
    const atEdge = emitDonation(18n, c, DONOR, 1_000_000n); // head 30, confirmations 12 => confirmedHead 18
    const beyond = emitDonation(19n, c, DONOR, 1_000_000n);
    chain.mineUntil(30n);
    await runCycle(client, chain, CONFIG);
    const state = async (tx: Hex) =>
      (
        await one<{ s: string }>(
          "select confirmation_state::text as s from public.chain_events where tx_hash = $1",
          [tx],
        )
      )?.s;
    expect(await state(atEdge)).toBe("CONFIRMED");
    expect(await state(beyond)).toBe("OBSERVED");
  });

  it("zdarzenie, które zniknęło i wróciło w TYM SAMYM bloku (ten sam hash), wraca do OBSERVED, a potem CONFIRMED", async () => {
    const c = await stagedCampaign(1);
    emitCreated(2n, c);
    const tx = emitDonation(25n, c, DONOR, 3_000_000n);
    chain.mineUntil(30n);
    await runCycle(client, chain, CONFIG);

    const block = chain.blocks[25];
    if (block === undefined) throw new Error("brak bloku");
    const removed = block.logs.splice(0, block.logs.length); // chwilowo znika (np. niespójność dostawcy RPC)
    await runCycle(client, chain, CONFIG);
    expect(
      (
        await one<{ s: string }>(
          "select confirmation_state::text as s from public.chain_events where tx_hash = $1",
          [tx],
        )
      )?.s,
    ).toBe("ORPHANED");

    block.logs.push(...removed); // wraca w tym samym bloku
    await runCycle(client, chain, CONFIG);
    expect(
      await one<{ s: string; c: boolean }>(
        "select confirmation_state::text as s, canonical as c from public.chain_events where tx_hash = $1",
        [tx],
      ),
    ).toEqual({ s: "OBSERVED", c: true });
    chain.mineUntil(45n);
    await runCycle(client, chain, CONFIG);
    expect(
      (
        await one<{ s: string }>(
          "select confirmation_state::text as s from public.chain_events where tx_hash = $1",
          [tx],
        )
      )?.s,
    ).toBe("CONFIRMED");
  });
});

describe("kampanie: publikacja i statusy", () => {
  it("najnowsze potwierdzone CampaignStatusChanged wygrywa (pauza, wznowienie, zamknięcie)", async () => {
    const c = await stagedCampaign(1);
    emitCreated(5n, c);
    const status = (b: bigint, o: number, n: number) =>
      chain.emit(b, ADDR.registry, registryAbi, "CampaignStatusChanged", {
        campaignId: 1n,
        oldStatus: o,
        newStatus: n,
      });
    status(10n, 1, 2);
    chain.mineUntil(30n);
    await runCycle(client, chain, CONFIG);
    expect(
      (
        await one<{ s: string }>("select status::text as s from public.campaigns where id = $1", [
          c.id,
        ])
      )?.s,
    ).toBe("PAUSED");
    status(31n, 2, 1);
    chain.mineUntil(50n);
    await runCycle(client, chain, CONFIG);
    expect(
      (
        await one<{ s: string }>("select status::text as s from public.campaigns where id = $1", [
          c.id,
        ])
      )?.s,
    ).toBe("PUBLISHED");
    status(51n, 1, 3);
    chain.mineUntil(70n);
    await runCycle(client, chain, CONFIG);
    expect(
      (
        await one<{ s: string }>("select status::text as s from public.campaigns where id = $1", [
          c.id,
        ])
      )?.s,
    ).toBe("CLOSED");
  });

  it("niejednoznaczne dopasowanie (dwie kampanie PUBLISHING o tych samych parametrach) NIE jest zgadywane: anomalia", async () => {
    const a = await stagedCampaign(1);
    // druga kampania z identycznymi parametrami (ten sam beneficjent, limit, okno i metadata_hash)
    await client.query(
      `insert into public.campaigns (organization_id, chain_id, slug, title, cap_raw, start_at, end_at, beneficiary_lower, created_by_wallet_lower)
       select organization_id, chain_id, 'kopia-' || $2, title, cap_raw, start_at, end_at, beneficiary_lower, created_by_wallet_lower from public.campaigns where id = $1`,
      [a.id, String(nextId())],
    );
    const copy = await one<{ id: string }>(
      "select id from public.campaigns where slug like 'kopia-%'",
    );
    await client.query("update public.campaigns set status = 'SUBMITTED' where id = $1", [
      copy?.id,
    ]);
    await client.query("update public.campaigns set status = 'UNDER_REVIEW' where id = $1", [
      copy?.id,
    ]);
    await client.query(
      "update public.campaigns set status = 'APPROVED', approved_by_wallet_lower = $2, metadata_hash = (select metadata_hash from public.campaigns where id = $3) where id = $1",
      [copy?.id, a.approver, a.id],
    );
    await client.query("update public.campaigns set status = 'PUBLISHING' where id = $1", [
      copy?.id,
    ]);

    emitCreated(5n, a);
    chain.mineUntil(30n);
    const result = await runCycle(client, chain, CONFIG);
    expect(result.anomalies.map((x) => x.kind)).toContain("CAMPAIGN_AMBIGUOUS");
    expect(
      (
        await one<{ c: string }>(
          "select count(*)::text as c from public.campaigns where status = 'PUBLISHED'",
        )
      )?.c,
    ).toBe("0");
  });

  it("zdarzenie bez odpowiadającej kampanii w PUBLISHING: anomalia CAMPAIGN_NO_MATCH, brak publikacji", async () => {
    const c = await stagedCampaign(1);
    chain.setCampaign(1n, { ...(await chain.getCampaign(ADDR.registry, 1n)), capRaw: 999n }); // na łańcuchu inny limit
    emitCreated(5n, c);
    chain.mineUntil(30n);
    const result = await runCycle(client, chain, CONFIG);
    expect(result.anomalies.map((x) => x.kind)).toContain("CAMPAIGN_NO_MATCH");
  });

  it("darowizna do kampanii, której jeszcze nie znamy, trafia do anomalii i jest projektowana później (bez utraty)", async () => {
    const c = await stagedCampaign(1);
    emitDonation(6n, c, DONOR, 5_000_000n); // darowizna przed publikacją w bazie (CampaignCreated jeszcze nie przetworzone)
    chain.mineUntil(30n);
    const first = await runCycle(client, chain, CONFIG);
    expect(first.anomalies.map((x) => x.kind)).toContain("UNKNOWN_CAMPAIGN_FOR_DONATION");
    expect((await one<{ c: string }>("select count(*)::text as c from public.donations"))?.c).toBe(
      "0",
    );

    emitCreated(4n, c); // dopiero teraz zdarzenie publikacji (starszy blok; w oknie nakładki)
    chain.mineUntil(45n);
    await runCycle(client, chain, CONFIG);
    expect(
      (
        await one<{ c: string }>(
          "select count(*)::text as c from public.donations where status = 'CONFIRMED'",
        )
      )?.c,
    ).toBe("1");
  });

  it("publikacja na zdarzeniu, które później zniknęło, jest zgłaszana (nie cofana po cichu)", async () => {
    const c = await stagedCampaign(1);
    emitCreated(5n, c);
    chain.mineUntil(30n);
    await runCycle(client, chain, CONFIG);
    chain.reorg(4n, 40);
    const result = await runCycle(client, chain, CONFIG);
    expect(result.anomalies.map((x) => x.kind)).toContain("PUBLISHED_ON_ORPHANED_EVENT");
    expect(
      (
        await one<{ s: string }>("select status::text as s from public.campaigns where id = $1", [
          c.id,
        ])
      )?.s,
    ).toBe("PUBLISHED");
  });
});

describe("raporty wpływu", () => {
  it("ReportPublished i ReportReviewed przeprowadzają raport REDACTING -> PUBLISHED -> VERIFIED", async () => {
    const c = await stagedCampaign(1);
    emitCreated(5n, c);
    chain.mineUntil(30n);
    await runCycle(client, chain, CONFIG);
    const report = await client.query<{ id: string }>(
      `insert into public.impact_reports (campaign_id, version, period_start, period_end, created_by)
       values ($1, 1, '2026-11-01', '2027-01-01', $2) returning id`,
      [c.id, hexAddr(0x7e57)],
    );
    const reportId = report.rows[0]?.id ?? "";
    await client.query("update public.impact_reports set status = 'SUBMITTED' where id = $1", [
      reportId,
    ]);
    await client.query("update public.impact_reports set status = 'REDACTING' where id = $1", [
      reportId,
    ]);

    const sha = hexHash(0xabc) as Hex;
    chain.emit(31n, ADDR.impact, impactAbi, "ReportPublished", {
      reportId: 1n,
      campaignId: 1n,
      contentSha256: sha,
      publicUri: "ipfs://x",
      version: 1,
    });
    chain.emit(35n, ADDR.impact, impactAbi, "ReportReviewed", {
      reportId: 1n,
      decision: 1,
      reasonHash: hexHash(0),
    });
    chain.mineUntil(60n);
    await runCycle(client, chain, CONFIG);
    const row = await one<{
      status: string;
      onchain_report_id: string;
      public_uri: string;
      content_sha256: string;
    }>(
      "select status::text, onchain_report_id::text, public_uri, content_sha256 from public.impact_reports where id = $1",
      [reportId],
    );
    expect(row).toEqual({
      status: "VERIFIED",
      onchain_report_id: "1",
      public_uri: "ipfs://x",
      content_sha256: sha,
    });
  });

  it("ReportPublished bez pasującego raportu w redakcji: anomalia REPORT_NO_MATCH", async () => {
    const c = await stagedCampaign(1);
    emitCreated(5n, c);
    chain.emit(10n, ADDR.impact, impactAbi, "ReportPublished", {
      reportId: 1n,
      campaignId: 1n,
      contentSha256: hexHash(1),
      publicUri: "ipfs://x",
      version: 1,
    });
    chain.mineUntil(40n);
    const result = await runCycle(client, chain, CONFIG);
    expect(result.anomalies.map((x) => x.kind)).toContain("REPORT_NO_MATCH");
  });
});

describe("uzgadnianie z kontraktem (AC-33)", () => {
  it("niezgodność sum w bazie i na łańcuchu jest wykrywana, a kursor oznaczony ERROR (baza nie jest naprawiana po cichu)", async () => {
    const c = await stagedCampaign(1);
    emitCreated(5n, c);
    emitDonation(10n, c, DONOR, 7_000_000n);
    emitDonation(11n, c, DONOR2, 3_000_000n);
    chain.mineUntil(40n);
    await runCycle(client, chain, CONFIG);
    expect(await reconcile(client, chain, CONFIG)).toEqual([]);

    // Ręczne uszkodzenie projekcji (symulacja błędu): statystyki i suma kampanii rozjeżdżają się z kontraktem.
    await client.query(
      "update public.donations set status = 'ORPHANED' where donor_wallet_lower = $1",
      [DONOR],
    );
    await client.query(
      "update public.donor_stats set total_donated_raw = 0, xp = 0, tier = 0 where wallet_lower = $1",
      [DONOR],
    );
    const mismatches = await reconcile(client, chain, CONFIG);
    expect(mismatches.map((m) => m.subject).sort()).toEqual(
      [`campaign #1`, `donor ${DONOR}`].sort(),
    );
    expect(mismatches.find((m) => m.subject.startsWith("donor"))).toMatchObject({
      db: 0n,
      chain: 7_000_000n,
    });
    expect(
      (await one<{ s: string }>("select status::text as s from public.indexer_cursors limit 1"))?.s,
    ).toBe("ERROR");
    // dane nie zostały zmienione przez uzgadnianie
    expect(
      (
        await one<{ t: string }>(
          "select total_donated_raw::text as t from public.donor_stats where wallet_lower = $1",
          [DONOR],
        )
      )?.t,
    ).toBe("0");
  });
});

describe("kontrakty i logi spoza zakresu", () => {
  it("logi z obcych adresów i nieznane zdarzenia są ignorowane", async () => {
    const c = await stagedCampaign(1);
    emitCreated(5n, c);
    // log z innego adresu o sygnaturze DonationReceived — nie jest skanowany (adres spoza konfiguracji)
    chain.emit(6n, hexAddr(0xbad) as Address, routerAbi, "DonationReceived", {
      campaignId: 1n,
      donor: DONOR,
      beneficiary: c.safe,
      amountRaw: 1n,
    });
    // nieznane zdarzenie z adresu routera
    const block = chain.blocks[7];
    block?.logs.push({
      address: ADDR.router,
      transactionHash: hexHash(77) as Hex,
      transactionIndex: 0,
      logIndex: 0,
      topics: [hexHash(999) as Hex],
      data: "0x",
    });
    chain.mineUntil(30n);
    await runCycle(client, chain, CONFIG);
    expect(
      (
        await one<{ c: string }>(
          "select count(*)::text as c from public.chain_events where event_name = 'DonationReceived'",
        )
      )?.c,
    ).toBe("0");
  });

  it("konfiguracja: overlap musi być większy od confirmations; adresy unikalne", async () => {
    await expect(runCycle(client, chain, { ...CONFIG, overlap: 12n })).rejects.toThrow(RangeError);
    await expect(
      runCycle(client, chain, { ...CONFIG, contracts: { ...ADDR, impact: ADDR.registry } }),
    ).rejects.toThrow(RangeError);
  });
});

// --- pomocnicze do testu „zdarzenie wraca w innym bloku”
async function captureTopics(tx: Hex): Promise<Hex[]> {
  const row = await one<{ args: Record<string, string> }>(
    "select args from public.chain_events where tx_hash = $1",
    [tx],
  );
  const { encodeEventTopics } = await import("viem");
  const event = routerAbi[0];
  return encodeEventTopics({
    abi: [event],
    eventName: "DonationReceived",
    args: {
      campaignId: BigInt(row?.args.campaignId ?? "0"),
      donor: row?.args.donor as Address,
      beneficiary: row?.args.beneficiary as Address,
    },
  }) as Hex[];
}
function dataFor(amount: bigint): Hex {
  return `0x${amount.toString(16).padStart(64, "0")}`;
}
