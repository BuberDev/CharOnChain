/**
 * Pętla robocza indexera (COC-035): cykl → (okresowo) uzgadnianie → ocena alarmów → wysyłka. Odporna na awarie:
 * błąd cyklu nie kończy procesu; kolejne próby z wykładniczym opóźnieniem (z limitem). Surowe komunikaty błędów
 * NIE trafiają do alarmów ani logów (mogą zawierać adres RPC z kluczem API) — tylko nazwa typu błędu.
 */
import type { ClientBase } from "pg";

import {
  DEFAULT_THRESHOLDS,
  evaluateAlerts,
  readHealth,
  readSecurityEvents,
  securityEventAlert,
  type Alert,
  type AlertSink,
  type HealthSnapshot,
  type Thresholds,
  type WorkerCounters,
} from "./monitoring.js";
import {
  ReorgDuringScanError,
  reconcile,
  runCycle,
  type IndexerConfig,
  type Mismatch,
} from "./indexer.js";
import type { ChainRpc } from "./rpc.js";

export interface WorkerOptions {
  readonly sink: AlertSink;
  readonly thresholds?: Thresholds;
  /** Co ile cykli uzgadniać sumy z getterami kontraktów (0 = nigdy). */
  readonly reconcileEveryCycles?: number;
  readonly intervalMs?: number;
  readonly maxBackoffMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly signal?: AbortSignal;
  /** Limit cykli (testy); w produkcji brak. */
  readonly maxCycles?: number;
  readonly onCycle?: (info: {
    counters: Readonly<WorkerCounters>;
    snapshot: HealthSnapshot;
  }) => void;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const safeErrorName = (error: unknown): string =>
  error instanceof Error && /^[A-Za-z0-9_]+$/.test(error.name) ? error.name : "Error";

export async function runWorker(
  db: ClientBase,
  rpc: ChainRpc,
  config: IndexerConfig,
  options: WorkerOptions,
): Promise<WorkerCounters> {
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const sleep = options.sleep ?? defaultSleep;
  const interval = options.intervalMs ?? 5_000;
  const maxBackoff = options.maxBackoffMs ?? 60_000;
  const reconcileEvery = options.reconcileEveryCycles ?? 10;
  const counters: WorkerCounters = {
    cycles: 0,
    failures: 0,
    eventsInserted: 0,
    eventsOrphaned: 0,
    alertsSent: 0,
  };
  const sent = new Map<string, bigint>(); // dedupKey -> blok (do przycinania)
  let consecutiveFailures = 0;
  let head = 0n;
  let iterations = 0;

  const emit = async (alert: Alert, block: bigint): Promise<void> => {
    if (sent.has(alert.dedupKey)) return;
    sent.set(alert.dedupKey, block);
    try {
      await options.sink.send(alert);
      counters.alertsSent += 1;
    } catch {
      sent.delete(alert.dedupKey); // ujście niedostępne: spróbujemy przy następnym cyklu
    }
  };

  const done = (): boolean =>
    options.signal?.aborted === true ||
    (options.maxCycles !== undefined && iterations >= options.maxCycles);

  while (!done()) {
    iterations += 1;
    let cycle: Awaited<ReturnType<typeof runCycle>> | undefined;
    let mismatches: Mismatch[] | undefined;
    try {
      cycle = await runCycle(db, rpc, config);
      head = cycle.head;
      counters.cycles += 1;
      counters.eventsInserted += cycle.eventsInserted;
      counters.eventsOrphaned += cycle.eventsOrphaned;
      consecutiveFailures = 0;
      if (reconcileEvery > 0 && counters.cycles % reconcileEvery === 0) {
        mismatches = await reconcile(db, rpc, config);
      }
    } catch (error) {
      counters.failures += 1;
      consecutiveFailures += 1;
      if (error instanceof ReorgDuringScanError) {
        await emit(
          {
            code: "REORG_DURING_SCAN",
            severity: "info",
            message: "Reorg w trakcie skanu: cykl powtórzony.",
            dedupKey: `scanreorg:${String(config.chainId)}:${String(iterations)}`,
            labels: {},
          },
          head,
        );
      } else if (consecutiveFailures === 1 || consecutiveFailures % 5 === 0) {
        await emit(
          {
            code: "WORKER_FAILURE",
            severity:
              consecutiveFailures >= thresholds.failuresBeforeCritical ? "critical" : "warning",
            message: `Cykl indexera zakończył się błędem (${safeErrorName(error)}).`,
            dedupKey: `fail:${String(config.chainId)}:${String(consecutiveFailures)}`,
            labels: { error: safeErrorName(error) },
          },
          head,
        );
      }
    }

    try {
      const snapshot = await readHealth(db, config, head);
      const alerts = evaluateAlerts({
        snapshot,
        thresholds,
        cycle,
        mismatches,
        consecutiveFailures,
      });
      const from = head > config.overlap ? head - config.overlap : 0n;
      const security = (await readSecurityEvents(db, config, from)).map(securityEventAlert);
      for (const alert of [...alerts, ...security]) await emit(alert, head);
      for (const [key, block] of sent) if (block + config.overlap * 4n < head) sent.delete(key);
      options.onCycle?.({ counters: { ...counters }, snapshot });
    } catch {
      counters.failures += 1; // baza niedostępna w trakcie oceny: kolejna iteracja spróbuje ponownie
    }

    if (done()) break;
    const backoff =
      consecutiveFailures === 0
        ? interval
        : Math.min(maxBackoff, interval * 2 ** Math.min(consecutiveFailures, 10));
    await sleep(backoff);
  }
  return counters;
}
