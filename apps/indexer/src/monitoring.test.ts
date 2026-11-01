import { readFileSync } from "node:fs";

import { toEventSelector, type AbiEvent } from "viem";
import { describe, expect, it } from "vitest";

import { ACCESS_CONTROL_EVENTS, PAUSABLE_EVENTS } from "./abi.js";
import {
  DEFAULT_THRESHOLDS,
  evaluateAlerts,
  renderMetrics,
  securityEventAlert,
  securityEventSeverity,
  type CursorHealth,
  type HealthSnapshot,
  type SecurityEventRow,
} from "./monitoring.js";

describe("ABI zdarzeń bezpieczeństwa == źródła OpenZeppelin 5.x", () => {
  const base = new URL(
    "../../../packages/contracts/node_modules/@openzeppelin/contracts/",
    import.meta.url,
  );
  const files = [
    "access/IAccessControl.sol",
    "access/extensions/IAccessControlDefaultAdminRules.sol",
    "utils/Pausable.sol",
  ];
  const declared = files.flatMap((f) => {
    const source = readFileSync(new URL(f, base), "utf8");
    return [...source.matchAll(/^\s*event\s+(\w+)\s*\(([^)]*)\)\s*;/gm)].map((m) => {
      const types = (m[2] ?? "")
        .split(",")
        .map((p) => p.trim().split(/\s+/)[0] ?? "")
        .filter((t) => t !== "");
      return { name: m[1] ?? "", signature: `${m[1] ?? ""}(${types.join(",")})` };
    });
  });
  const ours = [...ACCESS_CONTROL_EVENTS, ...PAUSABLE_EVENTS] as readonly AbiEvent[];

  it("pokrywa wszystkie zdarzenia z wybranych interfejsów", () => {
    expect(declared.map((d) => d.name).sort()).toEqual(ours.map((e) => e.name).sort());
    expect(declared.length).toBe(9);
  });

  it.each(declared)("selektor $name zgadza się ze źródłem OZ", ({ name, signature }) => {
    const event = ours.find((e) => e.name === name);
    expect(event).toBeDefined();
    if (event === undefined) return;
    expect(toEventSelector(event)).toBe(toEventSelector(`event ${signature}`));
  });
});

const cursor = (over: Partial<CursorHealth> = {}): CursorHealth => ({
  contract: "0x01",
  kind: "router",
  lastScannedBlock: 1000n,
  lastConfirmedBlock: 988n,
  lagBlocks: 0n,
  ageSeconds: 5,
  status: "IDLE",
  ...over,
});
const snapshot = (cursors: CursorHealth[], over: Partial<HealthSnapshot> = {}): HealthSnapshot => ({
  chainId: 421614,
  head: 1000n,
  cursors,
  missingCursors: [],
  ...over,
});
const codes = (alerts: { code: string }[]): string[] => alerts.map((a) => a.code);

describe("evaluateAlerts (czysta ocena)", () => {
  it("zdrowy indexer nie wywołuje alarmów", () => {
    expect(evaluateAlerts({ snapshot: snapshot([cursor()]) })).toEqual([]);
  });

  it("opóźnienie: granica ostrzeżenia i krytyczna są włączne", () => {
    const t = DEFAULT_THRESHOLDS;
    const at = (lag: bigint) =>
      evaluateAlerts({ snapshot: snapshot([cursor({ lagBlocks: lag })]) });
    expect(at(t.lagWarnBlocks - 1n)).toEqual([]);
    expect(at(t.lagWarnBlocks)[0]).toMatchObject({ code: "INDEXER_LAG", severity: "warning" });
    expect(at(t.lagCriticalBlocks - 1n)[0]?.severity).toBe("warning");
    expect(at(t.lagCriticalBlocks)[0]).toMatchObject({ code: "INDEXER_LAG", severity: "critical" });
  });

  it("kursor, który stoi, ma status ERROR lub nie istnieje → alarm krytyczny", () => {
    const stale = evaluateAlerts({
      snapshot: snapshot([cursor({ ageSeconds: DEFAULT_THRESHOLDS.maxCursorAgeSeconds + 1 })]),
    });
    expect(codes(stale)).toEqual(["INDEXER_STALE"]);
    const exactly = evaluateAlerts({
      snapshot: snapshot([cursor({ ageSeconds: DEFAULT_THRESHOLDS.maxCursorAgeSeconds })]),
    });
    expect(exactly).toEqual([]);
    expect(codes(evaluateAlerts({ snapshot: snapshot([cursor({ status: "ERROR" })]) }))).toEqual([
      "INDEXER_ERROR_STATUS",
    ]);
    const missing = evaluateAlerts({ snapshot: snapshot([], { missingCursors: ["impact"] }) });
    expect(missing[0]).toMatchObject({ code: "INDEXER_STALE", severity: "critical" });
  });

  it("niezgodność z getterami, niedostępny RPC, reorg i anomalie", () => {
    const alerts = evaluateAlerts({
      snapshot: snapshot([cursor()]),
      mismatches: [{ subject: "campaign #1", db: 5n, chain: 7n }],
      consecutiveFailures: DEFAULT_THRESHOLDS.failuresBeforeCritical,
      cycle: {
        eventsOrphaned: 2,
        anomalies: [
          { kind: "CAMPAIGN_AMBIGUOUS", detail: "x" },
          { kind: "PUBLISHED_ON_ORPHANED_EVENT", detail: "y" },
        ],
      },
    });
    expect(codes(alerts)).toEqual([
      "RECONCILE_MISMATCH",
      "RPC_FAILURE",
      "REORG_DETECTED",
      "PROJECTION_ANOMALY",
      "PROJECTION_ANOMALY",
    ]);
    expect(alerts.filter((a) => a.code === "PROJECTION_ANOMALY").map((a) => a.severity)).toEqual([
      "warning",
      "critical",
    ]);
    expect(
      evaluateAlerts({
        snapshot: snapshot([cursor()]),
        consecutiveFailures: DEFAULT_THRESHOLDS.failuresBeforeCritical - 1,
      }),
    ).toEqual([]);
  });

  it("klucze deduplikacji są stabilne i odróżniają incydenty", () => {
    const a = evaluateAlerts({ snapshot: snapshot([cursor({ status: "ERROR" })]) });
    const b = evaluateAlerts({ snapshot: snapshot([cursor({ status: "ERROR" })]) });
    expect(a[0]?.dedupKey).toBe(b[0]?.dedupKey);
    const c = evaluateAlerts({
      snapshot: snapshot([cursor()]),
      mismatches: [
        { subject: "campaign #1", db: 1n, chain: 2n },
        { subject: "campaign #2", db: 1n, chain: 2n },
      ],
    });
    expect(new Set(c.map((x) => x.dedupKey)).size).toBe(2);
  });
});

const event = (over: Partial<SecurityEventRow>): SecurityEventRow => ({
  eventName: "RoleGranted",
  contract: "0x01",
  kind: "router",
  txHash: `0x${"a".repeat(64)}`,
  logIndex: 0,
  blockNumber: 10n,
  confirmed: true,
  args: { role: `0x${"1".repeat(64)}` },
  ...over,
});

describe("zdarzenia bezpieczeństwa", () => {
  it("ważność: pauza i transfer admina są krytyczne; rola admina krytyczna, inna ostrzeżenie", () => {
    expect(securityEventSeverity(event({ eventName: "Paused" }))).toBe("critical");
    expect(securityEventSeverity(event({ eventName: "DefaultAdminTransferScheduled" }))).toBe(
      "critical",
    );
    expect(securityEventSeverity(event({ eventName: "Unpaused" }))).toBe("warning");
    expect(securityEventSeverity(event({}))).toBe("warning");
    expect(securityEventSeverity(event({ args: { role: `0x${"0".repeat(64)}` } }))).toBe(
      "critical",
    );
    expect(
      securityEventSeverity(
        event({ eventName: "RoleRevoked", args: { role: `0x${"0".repeat(64)}` } }),
      ),
    ).toBe("critical");
  });

  it("alarm oznacza zdarzenie niepotwierdzone i ma klucz tx+logIndex (potwierdzenie nie dubluje)", () => {
    const observed = securityEventAlert(event({ confirmed: false }));
    const confirmed = securityEventAlert(event({ confirmed: true }));
    expect(observed.message).toContain("niepotwierdzone");
    expect(confirmed.message).not.toContain("niepotwierdzone");
    expect(observed.dedupKey).toBe(confirmed.dedupKey);
    expect(securityEventAlert(event({ logIndex: 1 })).dedupKey).not.toBe(confirmed.dedupKey);
  });
});

describe("renderMetrics (format Prometheus)", () => {
  const counters = { cycles: 3, failures: 1, eventsInserted: 9, eventsOrphaned: 2, alertsSent: 4 };
  it("zawiera HELP/TYPE, wartości kursorów i liczniki", () => {
    const text = renderMetrics(
      snapshot([cursor({ lagBlocks: 7n, status: "ERROR", ageSeconds: 12.4 })], {
        missingCursors: ["impact"],
      }),
      counters,
    );
    expect(text).toContain("# TYPE charonchain_indexer_lag_blocks gauge");
    expect(text).toContain('charonchain_indexer_lag_blocks{chain_id="421614",contract="router"} 7');
    expect(text).toContain(
      'charonchain_indexer_error_status{chain_id="421614",contract="router"} 1',
    );
    expect(text).toContain(
      'charonchain_indexer_cursor_age_seconds{chain_id="421614",contract="router"} 12',
    );
    expect(text).toContain('charonchain_indexer_missing_cursors{chain_id="421614"} 1');
    expect(text).toContain("charonchain_indexer_events_orphaned_total 2");
    expect(text.endsWith("\n")).toBe(true);
    for (const line of text.split("\n").filter((l) => l !== "" && !l.startsWith("#"))) {
      expect(line).toMatch(/^[a-z_]+(\{[^}]*\})? -?\d+(\.\d+)?$/);
    }
  });
});
