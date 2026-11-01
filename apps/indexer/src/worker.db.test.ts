/**
 * Testy monitoringu i pętli roboczej na PRAWDZIWYM Postgresie z symulowanym łańcuchem (COC-035, AC-33):
 * symulacja błędów wywołuje alarm; zdarzenia bezpieczeństwa trafiają do journala i alarmów; niezgodność z
 * kontraktem ustawia status ERROR; sekrety z komunikatów błędów nie wyciekają do alarmów.
 */
import { randomBytes } from "node:crypto";

import { loadMigrations, migrateUp } from "@charonchain/database";
import {
  approveCampaign,
  createDraftCampaign,
  createOrganization,
  hexAddr,
  hexHash,
} from "@charonchain/database/testing/fixtures";
import { Client } from "pg";
import type { Address, Hex } from "viem";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ACCESS_CONTROL_EVENTS, PAUSABLE_EVENTS } from "./abi.js";
import { runCycle, type IndexerConfig } from "./indexer.js";
import {
  memorySink,
  readHealth,
  readSecurityEvents,
  type Alert,
  type AlertSink,
} from "./monitoring.js";
import type { ChainRpc } from "./rpc.js";
import { FakeChain, registryAbi, routerAbi } from "./testing/fake-chain.js";
import { runWorker } from "./worker.js";

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
const CONFIG: IndexerConfig = {
  chainId: 421614,
  contracts: ADDR,
  usdc: hexAddr(0xc1) as Address,
  confirmations: 12n,
  overlap: 50n,
  maxRange: 20n,
  startBlock: 1n,
};
const DONOR = hexAddr(0xd001) as Address;
/** Delegacja do symulowanego łańcucha z podmianą wybranych metod (bez rozpylania instancji klasy). */
function rpcOver(base: FakeChain, over: Partial<ChainRpc>): ChainRpc {
  return {
    getBlockNumber: base.getBlockNumber.bind(base),
    getBlock: base.getBlock.bind(base),
    getLogs: base.getLogs.bind(base),
    getCampaign: base.getCampaign.bind(base),
    totalDonatedRaw: base.totalDonatedRaw.bind(base),
    raisedRaw: base.raisedRaw.bind(base),
    ...over,
  };
}

const noSleep = (): Promise<void> => Promise.resolve();

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

beforeAll(async () => {
  templateName = `cc_mon_tpl_${randomBytes(5).toString("hex")}`;
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
  dbName = `cc_mon_${randomBytes(5).toString("hex")}`;
  await admin(`create database ${dbName} template ${templateName}`);
  client = new Client({ connectionString: withDb(dbName) });
  await client.connect();
  chain = new FakeChain(ADDR, 1n);
});
afterEach(async () => {
  await client.end();
  await admin(`drop database if exists ${dbName} with (force)`);
});

async function stagedCampaign(onchainId: number) {
  const org = await createOrganization(client);
  const draft = await createDraftCampaign(client, org);
  await approveCampaign(client, draft);
  await client.query("update public.campaigns set status = 'PUBLISHING' where id = $1", [draft.id]);
  const row = (
    await client.query<{ metadata_hash: string; start: string; end: string }>(
      `select metadata_hash, extract(epoch from start_at)::bigint::text as start,
              extract(epoch from end_at)::bigint::text as "end" from public.campaigns where id = $1`,
      [draft.id],
    )
  ).rows[0];
  if (row === undefined) throw new Error("brak kampanii");
  chain.setCampaign(BigInt(onchainId), {
    beneficiary: org.safe as Address,
    capRaw: BigInt(draft.capRaw),
    startAt: BigInt(row.start),
    endAt: BigInt(row.end),
    orgHash: hexHash(1) as Hex,
    metadataHash: row.metadata_hash as Hex,
    status: 1,
  });
  return { ...draft, onchainId, safe: org.safe as Address };
}

const donation = (block: bigint, c: { onchainId: number; safe: Address }, amount: bigint): Hex =>
  chain.emit(block, ADDR.router, routerAbi, "DonationReceived", {
    campaignId: BigInt(c.onchainId),
    donor: DONOR,
    beneficiary: c.safe,
    amountRaw: amount,
  });

const created = (block: bigint, c: { onchainId: number; safe: Address; capRaw: string }): Hex =>
  chain.emit(block, ADDR.registry, registryAbi, "CampaignCreated", {
    campaignId: BigInt(c.onchainId),
    beneficiary: c.safe,
    orgHash: hexHash(1),
    capRaw: BigInt(c.capRaw),
  });

const ROLE = hexHash(0xabc);
const ADMIN_ROLE = `0x${"0".repeat(64)}`;

describe("zdarzenia bezpieczeństwa w journalu", () => {
  it("role, transfer admina i pauza są zapisywane (obserwowane → potwierdzone) i osierocane przy reorgu", async () => {
    chain.emit(5n, ADDR.router, ACCESS_CONTROL_EVENTS, "RoleGranted", {
      role: ROLE,
      account: DONOR,
      sender: hexAddr(0xad),
    });
    chain.emit(6n, ADDR.router, PAUSABLE_EVENTS, "Paused", { account: hexAddr(0xe1) });
    chain.emit(7n, ADDR.registry, ACCESS_CONTROL_EVENTS, "DefaultAdminTransferScheduled", {
      newAdmin: hexAddr(0x5afe),
      acceptSchedule: 1_900_000_000,
    });
    chain.mineUntil(10n);
    await runCycle(client, chain, CONFIG); // niepotwierdzone (głębokość < 12)
    let events = await readSecurityEvents(client, CONFIG, 0n);
    expect(events.map((e) => e.eventName)).toEqual([
      "RoleGranted",
      "Paused",
      "DefaultAdminTransferScheduled",
    ]);
    expect(events.every((e) => !e.confirmed)).toBe(true);
    expect(events.map((e) => e.kind)).toEqual(["router", "router", "registry"]);
    expect(events[0]?.args).toMatchObject({ role: ROLE, account: DONOR.toLowerCase() });

    chain.mineUntil(40n);
    await runCycle(client, chain, CONFIG);
    events = await readSecurityEvents(client, CONFIG, 0n);
    expect(events.every((e) => e.confirmed)).toBe(true);

    // Reorg usuwa blok z pauzą i dodaje pustą ścieżkę: zdarzenie znika z widoku alarmów (osierocone).
    chain.reorg(6n, 45);
    await runCycle(client, chain, CONFIG);
    events = await readSecurityEvents(client, CONFIG, 0n);
    expect(events.map((e) => e.eventName)).toEqual(["RoleGranted"]);
  });

  it("zdarzenie Paused z obcego adresu lub z kontraktu, który go nie emituje, jest ignorowane", async () => {
    chain.emit(5n, hexAddr(0xbad) as Address, PAUSABLE_EVENTS, "Paused", { account: DONOR });
    chain.emit(6n, ADDR.registry, PAUSABLE_EVENTS, "Paused", { account: DONOR }); // rejestr nie jest Pausable
    chain.mineUntil(20n);
    await runCycle(client, chain, CONFIG);
    expect(await readSecurityEvents(client, CONFIG, 0n)).toEqual([]);
  });
});

describe("readHealth", () => {
  it("przed pierwszym skanem brakuje kursorów; po skanie opóźnienie = głowa − ostatni zeskanowany blok", async () => {
    const before = await readHealth(client, CONFIG, 1n);
    expect(before.cursors).toEqual([]);
    expect([...before.missingCursors].sort()).toEqual([
      "impact",
      "registry",
      "reputation",
      "router",
    ]);

    chain.mineUntil(30n);
    await runCycle(client, chain, CONFIG);
    const after = await readHealth(client, CONFIG, 30n);
    expect(after.missingCursors).toEqual([]);
    expect(after.cursors).toHaveLength(4);
    expect(after.cursors.every((c) => c.lagBlocks === 0n && c.lastScannedBlock === 30n)).toBe(true);
    expect(after.cursors.every((c) => c.lastConfirmedBlock === 18n)).toBe(true);
    const lagging = await readHealth(client, CONFIG, 130n);
    expect(lagging.cursors.every((c) => c.lagBlocks === 100n)).toBe(true);
  });
});

describe("pętla robocza: alarmy (AC-33)", () => {
  it("symulacja awarii RPC wywołuje alarmy krytyczne i nie wycieka sekretów z komunikatu błędu", async () => {
    const secret = "https://rpc.example/v2/SUPER-SECRET-KEY";
    const broken = rpcOver(chain, {
      getBlockNumber: () => Promise.reject(new Error(`fetch failed: ${secret}`)),
    });
    const sink = memorySink();
    const counters = await runWorker(client, broken, CONFIG, {
      sink,
      maxCycles: 4,
      sleep: noSleep,
    });
    expect(counters.failures).toBeGreaterThanOrEqual(4);
    expect(counters.cycles).toBe(0);
    const codes = sink.alerts.map((a) => a.code);
    expect(codes).toContain("WORKER_FAILURE");
    expect(codes).toContain("RPC_FAILURE");
    expect(sink.alerts.some((a) => a.severity === "critical")).toBe(true);
    expect(JSON.stringify(sink.alerts)).not.toMatch(/SUPER-SECRET|rpc\.example/);
  });

  it("wykładniczy backoff rośnie przy kolejnych awariach i wraca do interwału po sukcesie", async () => {
    let failing = true;
    const flaky = rpcOver(chain, {
      getBlockNumber: () => (failing ? Promise.reject(new Error("x")) : chain.getBlockNumber()),
    });
    const waits: number[] = [];
    let n = 0;
    await runWorker(client, flaky, CONFIG, {
      sink: memorySink(),
      maxCycles: 5,
      intervalMs: 100,
      maxBackoffMs: 1_000,
      sleep: (ms) => {
        waits.push(ms);
        n += 1;
        if (n === 3) failing = false;
        return Promise.resolve();
      },
    });
    expect(waits).toEqual([200, 400, 800, 100]);
  });

  it("zdarzenie Paused daje jeden alarm krytyczny (deduplikacja między cyklami)", async () => {
    chain.emit(5n, ADDR.router, PAUSABLE_EVENTS, "Paused", { account: hexAddr(0xe1) });
    chain.mineUntil(30n);
    const sink = memorySink();
    await runWorker(client, chain, CONFIG, { sink, maxCycles: 3, sleep: noSleep });
    const pauses = sink.alerts.filter(
      (a) => a.code === "SECURITY_EVENT" && a.labels["event"] === "Paused",
    );
    expect(pauses).toHaveLength(1);
    expect(pauses[0]?.severity).toBe("critical");
  });

  it("DEFAULT_ADMIN_ROLE nadane/odebrane = alarm krytyczny, inna rola = ostrzeżenie", async () => {
    chain.emit(5n, ADDR.impact, ACCESS_CONTROL_EVENTS, "RoleGranted", {
      role: ADMIN_ROLE,
      account: DONOR,
      sender: DONOR,
    });
    chain.emit(6n, ADDR.impact, ACCESS_CONTROL_EVENTS, "RoleGranted", {
      role: ROLE,
      account: DONOR,
      sender: DONOR,
    });
    chain.mineUntil(30n);
    const sink = memorySink();
    await runWorker(client, chain, CONFIG, { sink, maxCycles: 1, sleep: noSleep });
    const sec = sink.alerts.filter((a) => a.code === "SECURITY_EVENT").map((a) => a.severity);
    expect(sec.sort()).toEqual(["critical", "warning"]);
  });

  it("niezgodność z kontraktem: alarm RECONCILE_MISMATCH, status ERROR kursorów i alarm o statusie", async () => {
    const c = await stagedCampaign(1);
    created(5n, c);
    donation(7n, c, 25_000_000n);
    chain.mineUntil(40n);
    // Łańcuch „kłamie” w getterze: raisedRaw różni się od projekcji w bazie (np. błąd indexera).
    const tampered = rpcOver(chain, {
      raisedRaw: () => Promise.resolve(1n),
    });
    const sink = memorySink();
    await runWorker(client, tampered, CONFIG, {
      sink,
      maxCycles: 2,
      reconcileEveryCycles: 1,
      sleep: noSleep,
    });
    const codes = sink.alerts.map((a) => a.code);
    expect(codes).toContain("RECONCILE_MISMATCH");
    const statuses = await client.query<{ status: string }>(
      "select distinct status::text from public.indexer_cursors",
    );
    expect(statuses.rows.map((r) => r.status)).toEqual(["ERROR"]);
    // Drugi cykl widzi status ERROR → alarm o statusie (sumy nie mogą być uznane za finalne).
    expect(codes).toContain("INDEXER_ERROR_STATUS");
  });

  it("reorg po potwierdzeniu strat generuje alarm REORG_DETECTED", async () => {
    const c = await stagedCampaign(1);
    created(5n, c);
    donation(30n, c, 5_000_000n);
    chain.mineUntil(35n);
    const sink = memorySink();
    await runWorker(client, chain, CONFIG, { sink, maxCycles: 1, sleep: noSleep });
    chain.reorg(30n, 10); // donacja znika, łańcuch dłuższy
    await runWorker(client, chain, CONFIG, { sink, maxCycles: 1, sleep: noSleep });
    expect(sink.alerts.map((a) => a.code)).toContain("REORG_DETECTED");
  });

  it("ujście niedostępne nie gubi alarmu: ponowna próba w następnym cyklu", async () => {
    chain.emit(5n, ADDR.router, PAUSABLE_EVENTS, "Paused", { account: hexAddr(0xe1) });
    chain.mineUntil(30n);
    const delivered: Alert[] = [];
    let calls = 0;
    const flaky: AlertSink = {
      send(alert) {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error("webhook 503"));
        delivered.push(alert);
        return Promise.resolve();
      },
    };
    await runWorker(client, chain, CONFIG, { sink: flaky, maxCycles: 2, sleep: noSleep });
    expect(delivered.filter((a) => a.labels["event"] === "Paused")).toHaveLength(1);
  });

  it("sygnał przerwania kończy pętlę bez kolejnego cyklu", async () => {
    const controller = new AbortController();
    const sink = memorySink();
    const counters = await runWorker(client, chain, CONFIG, {
      sink,
      signal: controller.signal,
      sleep: () => {
        controller.abort();
        return Promise.resolve();
      },
    });
    expect(counters.cycles).toBe(1);
  });
});
