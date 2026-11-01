/**
 * Monitoring i alarmy indexera (COC-035; AC-33; docs/03 §6, §8): opóźnienie, zły RPC, reorg, anomalie
 * projekcji, niezgodność z getterami kontraktów oraz zdarzenia bezpieczeństwa (role, transfer admina, pauza).
 *
 * Zasady: logika oceny jest CZYSTA (testowalna bez bazy i sieci); komunikaty alarmów nie zawierają surowych
 * treści błędów (adresy RPC z kluczami API, SQL) — tylko kody i nazwy; ujście alarmów (`AlertSink`) jest
 * wstrzykiwane (webhook/on-call to decyzja operacyjna właściciela, tu brak zależności od dostawcy).
 */
import type { ClientBase } from "pg";

import { SECURITY_EVENT_NAMES, type ContractKind } from "./abi.js";
import type { IndexerConfig, Mismatch, CycleResult } from "./indexer.js";
import type { Anomaly } from "./projections.js";

export type Severity = "info" | "warning" | "critical";

export type AlertCode =
  | "INDEXER_LAG"
  | "INDEXER_STALE"
  | "INDEXER_ERROR_STATUS"
  | "RECONCILE_MISMATCH"
  | "RPC_FAILURE"
  | "REORG_DETECTED"
  | "REORG_DURING_SCAN"
  | "PROJECTION_ANOMALY"
  | "SECURITY_EVENT"
  | "WORKER_FAILURE";

export interface Alert {
  readonly code: AlertCode;
  readonly severity: Severity;
  readonly message: string;
  /** Ten sam klucz = ten sam incydent (ujście może deduplikować). */
  readonly dedupKey: string;
  readonly labels: Readonly<Record<string, string>>;
}

export interface AlertSink {
  send(alert: Alert): Promise<void>;
}

/** Ujście w pamięci (testy, diagnostyka lokalna). */
export function memorySink(): AlertSink & { readonly alerts: Alert[] } {
  const alerts: Alert[] = [];
  return {
    alerts,
    send(alert) {
      alerts.push(alert);
      return Promise.resolve();
    },
  };
}

export interface Thresholds {
  /** Opóźnienie skanu względem głowy łańcucha, od którego jest ostrzeżenie. */
  readonly lagWarnBlocks: bigint;
  /** Opóźnienie krytyczne. */
  readonly lagCriticalBlocks: bigint;
  /** Maksymalny wiek ostatniej aktualizacji kursora (indexer „stoi”). */
  readonly maxCursorAgeSeconds: number;
  /** Ile kolejnych nieudanych cykli (RPC/baza) wywołuje alarm krytyczny. */
  readonly failuresBeforeCritical: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  lagWarnBlocks: 50n,
  lagCriticalBlocks: 500n,
  maxCursorAgeSeconds: 300,
  failuresBeforeCritical: 3,
};

export interface CursorHealth {
  readonly contract: string;
  readonly kind: ContractKind | "unknown";
  readonly lastScannedBlock: bigint;
  readonly lastConfirmedBlock: bigint;
  readonly lagBlocks: bigint;
  readonly ageSeconds: number;
  readonly status: "IDLE" | "SYNCING" | "RECONCILING" | "ERROR";
}

export interface HealthSnapshot {
  readonly chainId: number;
  readonly head: bigint;
  readonly cursors: readonly CursorHealth[];
  /** Kontrakty z konfiguracji, dla których nie ma jeszcze kursora (nigdy nie skanowane). */
  readonly missingCursors: readonly ContractKind[];
}

export async function readHealth(
  db: Pick<ClientBase, "query">,
  config: IndexerConfig,
  head: bigint,
): Promise<HealthSnapshot> {
  const result = await db.query<{
    contract_lower: string;
    last_scanned_block: string;
    last_confirmed_block: string;
    age: number;
    status: CursorHealth["status"];
  }>(
    `select contract_lower, last_scanned_block::text, last_confirmed_block::text,
            extract(epoch from (now() - updated_at))::float8 as age, status
       from public.indexer_cursors where chain_id = $1 order by contract_lower`,
    [config.chainId],
  );
  const byAddress = new Map<string, ContractKind>(
    (Object.entries(config.contracts) as [ContractKind, string][]).map(([kind, a]) => [
      a.toLowerCase(),
      kind,
    ]),
  );
  const cursors = result.rows.map((row): CursorHealth => {
    const scanned = BigInt(row.last_scanned_block);
    return {
      contract: row.contract_lower,
      kind: byAddress.get(row.contract_lower) ?? "unknown",
      lastScannedBlock: scanned,
      lastConfirmedBlock: BigInt(row.last_confirmed_block),
      lagBlocks: head > scanned ? head - scanned : 0n,
      ageSeconds: row.age,
      status: row.status,
    };
  });
  const present = new Set(cursors.map((c) => c.kind));
  const missingCursors = (Object.keys(config.contracts) as ContractKind[]).filter(
    (kind) => !present.has(kind),
  );
  return { chainId: config.chainId, head, cursors, missingCursors };
}

export interface SecurityEventRow {
  readonly eventName: string;
  readonly contract: string;
  readonly kind: ContractKind | "unknown";
  readonly txHash: string;
  readonly logIndex: number;
  readonly blockNumber: bigint;
  readonly confirmed: boolean;
  readonly args: Readonly<Record<string, string>>;
}

/** Zdarzenia bezpieczeństwa (kanoniczne, obserwowane lub potwierdzone) od bloku `fromBlock`. */
export async function readSecurityEvents(
  db: Pick<ClientBase, "query">,
  config: IndexerConfig,
  fromBlock: bigint,
): Promise<SecurityEventRow[]> {
  const result = await db.query<{
    event_name: string;
    contract_lower: string;
    tx_hash: string;
    log_index: number;
    block_number: string;
    confirmation_state: string;
    args: Record<string, string>;
  }>(
    `select event_name, contract_lower, tx_hash, log_index, block_number::text, confirmation_state::text, args
       from public.chain_events
      where chain_id = $1 and canonical and confirmation_state <> 'ORPHANED'
        and block_number >= $2::bigint and event_name = any($3::text[])
      order by block_number, log_index`,
    [config.chainId, fromBlock.toString(), [...SECURITY_EVENT_NAMES]],
  );
  const byAddress = new Map<string, ContractKind>(
    (Object.entries(config.contracts) as [ContractKind, string][]).map(([kind, a]) => [
      a.toLowerCase(),
      kind,
    ]),
  );
  return result.rows.map((row) => ({
    eventName: row.event_name,
    contract: row.contract_lower,
    kind: byAddress.get(row.contract_lower) ?? "unknown",
    txHash: row.tx_hash,
    logIndex: row.log_index,
    blockNumber: BigInt(row.block_number),
    confirmed: row.confirmation_state === "CONFIRMED",
    args: row.args,
  }));
}

const DEFAULT_ADMIN_ROLE = `0x${"0".repeat(64)}`;

export function securityEventSeverity(
  event: Pick<SecurityEventRow, "eventName" | "args">,
): Severity {
  switch (event.eventName) {
    case "Paused":
    case "DefaultAdminTransferScheduled":
      return "critical";
    case "RoleGranted":
    case "RoleRevoked":
      return event.args["role"] === DEFAULT_ADMIN_ROLE ? "critical" : "warning";
    default:
      return "warning";
  }
}

export function securityEventAlert(event: SecurityEventRow): Alert {
  return {
    code: "SECURITY_EVENT",
    severity: securityEventSeverity(event),
    message: `${event.eventName} w kontrakcie ${event.kind} (blok ${event.blockNumber.toString()}${event.confirmed ? "" : ", jeszcze niepotwierdzone"})`,
    dedupKey: `sec:${event.txHash}:${String(event.logIndex)}`,
    labels: { event: event.eventName, contract: event.kind, tx: event.txHash },
  };
}

export interface EvaluationInput {
  readonly snapshot: HealthSnapshot;
  readonly thresholds?: Thresholds;
  readonly cycle?: Pick<CycleResult, "eventsOrphaned" | "anomalies"> | undefined;
  readonly mismatches?: readonly Mismatch[] | undefined;
  readonly consecutiveFailures?: number | undefined;
}

/** Czysta ocena stanu → lista alarmów. */
export function evaluateAlerts(input: EvaluationInput): Alert[] {
  const t = input.thresholds ?? DEFAULT_THRESHOLDS;
  const alerts: Alert[] = [];
  const chain = String(input.snapshot.chainId);

  for (const kind of input.snapshot.missingCursors) {
    alerts.push({
      code: "INDEXER_STALE",
      severity: "critical",
      message: `Brak kursora dla ${kind}: kontrakt nigdy nie był skanowany.`,
      dedupKey: `missing:${chain}:${kind}`,
      labels: { contract: kind },
    });
  }
  for (const c of input.snapshot.cursors) {
    if (c.lagBlocks >= t.lagCriticalBlocks || c.lagBlocks >= t.lagWarnBlocks) {
      alerts.push({
        code: "INDEXER_LAG",
        severity: c.lagBlocks >= t.lagCriticalBlocks ? "critical" : "warning",
        message: `Opóźnienie indexera dla ${c.kind}: ${c.lagBlocks.toString()} bloków.`,
        dedupKey: `lag:${chain}:${c.contract}`,
        labels: { contract: c.kind, lagBlocks: c.lagBlocks.toString() },
      });
    }
    if (c.ageSeconds > t.maxCursorAgeSeconds) {
      alerts.push({
        code: "INDEXER_STALE",
        severity: "critical",
        message: `Kursor ${c.kind} nie był aktualizowany od ${String(Math.round(c.ageSeconds))} s.`,
        dedupKey: `stale:${chain}:${c.contract}`,
        labels: { contract: c.kind },
      });
    }
    if (c.status === "ERROR") {
      alerts.push({
        code: "INDEXER_ERROR_STATUS",
        severity: "critical",
        message: `Kursor ${c.kind} ma status ERROR — sumy nie mogą być prezentowane jako finalne.`,
        dedupKey: `err:${chain}:${c.contract}`,
        labels: { contract: c.kind },
      });
    }
  }
  for (const m of input.mismatches ?? []) {
    alerts.push({
      code: "RECONCILE_MISMATCH",
      severity: "critical",
      message: `Niezgodność z kontraktem: ${m.subject} (baza ${m.db.toString()}, łańcuch ${m.chain.toString()}).`,
      dedupKey: `mismatch:${chain}:${m.subject}`,
      labels: { subject: m.subject },
    });
  }
  const failures = input.consecutiveFailures ?? 0;
  if (failures >= t.failuresBeforeCritical) {
    alerts.push({
      code: "RPC_FAILURE",
      severity: "critical",
      message: `${String(failures)} kolejnych nieudanych cykli indexera (RPC lub baza niedostępne).`,
      dedupKey: `rpc:${chain}`,
      labels: { failures: String(failures) },
    });
  }
  if (input.cycle !== undefined && input.cycle.eventsOrphaned > 0) {
    alerts.push({
      code: "REORG_DETECTED",
      severity: "warning",
      message: `Reorg: ${String(input.cycle.eventsOrphaned)} zdarzeń oznaczono jako osierocone.`,
      dedupKey: `reorg:${chain}:${String(input.snapshot.head)}`,
      labels: { orphaned: String(input.cycle.eventsOrphaned) },
    });
  }
  for (const a of input.cycle?.anomalies ?? []) alerts.push(anomalyAlert(chain, a));
  return alerts;
}

function anomalyAlert(chain: string, anomaly: Anomaly): Alert {
  return {
    code: "PROJECTION_ANOMALY",
    severity: anomaly.kind === "PUBLISHED_ON_ORPHANED_EVENT" ? "critical" : "warning",
    message: `Anomalia projekcji ${anomaly.kind}: wymaga decyzji operatora (indexer niczego nie zgaduje).`,
    dedupKey: `anomaly:${chain}:${anomaly.kind}:${anomaly.detail}`,
    labels: { kind: anomaly.kind },
  };
}

export interface WorkerCounters {
  cycles: number;
  failures: number;
  eventsInserted: number;
  eventsOrphaned: number;
  alertsSent: number;
}

const escapeLabel = (v: string): string =>
  v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

/** Metryki w formacie tekstowym Prometheusa (bez danych wrażliwych: tylko liczby i nazwy kontraktów). */
export function renderMetrics(snapshot: HealthSnapshot, counters: WorkerCounters): string {
  const lines: string[] = [];
  const gauge = (name: string, help: string): void => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`);
  };
  const counter = (name: string, help: string, value: number): void => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} counter`, `${name} ${String(value)}`);
  };
  const chain = String(snapshot.chainId);
  gauge("charonchain_chain_head_block", "Numer ostatniego bloku zgłoszonego przez RPC.");
  lines.push(`charonchain_chain_head_block{chain_id="${chain}"} ${snapshot.head.toString()}`);
  gauge("charonchain_indexer_lag_blocks", "Opóźnienie skanu względem głowy łańcucha, w blokach.");
  for (const c of snapshot.cursors)
    lines.push(
      `charonchain_indexer_lag_blocks{chain_id="${chain}",contract="${escapeLabel(c.kind)}"} ${c.lagBlocks.toString()}`,
    );
  gauge("charonchain_indexer_cursor_age_seconds", "Czas od ostatniej aktualizacji kursora.");
  for (const c of snapshot.cursors)
    lines.push(
      `charonchain_indexer_cursor_age_seconds{chain_id="${chain}",contract="${escapeLabel(c.kind)}"} ${c.ageSeconds.toFixed(0)}`,
    );
  gauge(
    "charonchain_indexer_error_status",
    "1, jeśli kursor ma status ERROR (np. niezgodność z kontraktem).",
  );
  for (const c of snapshot.cursors)
    lines.push(
      `charonchain_indexer_error_status{chain_id="${chain}",contract="${escapeLabel(c.kind)}"} ${c.status === "ERROR" ? "1" : "0"}`,
    );
  gauge(
    "charonchain_indexer_missing_cursors",
    "Liczba kontraktów bez kursora (nigdy nie skanowanych).",
  );
  lines.push(
    `charonchain_indexer_missing_cursors{chain_id="${chain}"} ${String(snapshot.missingCursors.length)}`,
  );
  counter(
    "charonchain_indexer_cycles_total",
    "Liczba zakończonych cykli indexera.",
    counters.cycles,
  );
  counter(
    "charonchain_indexer_failures_total",
    "Liczba nieudanych cykli indexera.",
    counters.failures,
  );
  counter(
    "charonchain_indexer_events_inserted_total",
    "Liczba nowych zdarzeń w journalu.",
    counters.eventsInserted,
  );
  counter(
    "charonchain_indexer_events_orphaned_total",
    "Liczba zdarzeń osieroconych przez reorg.",
    counters.eventsOrphaned,
  );
  counter("charonchain_alerts_sent_total", "Liczba wysłanych alarmów.", counters.alertsSent);
  return `${lines.join("\n")}\n`;
}
