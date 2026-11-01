/**
 * Proces indexera (COC-031/035). Uruchamiany przez właściciela na jego infrastrukturze; NIE był uruchomiony
 * na prawdziwym węźle RPC w tej sesji. Wymaga: DATABASE_URL (rola `app_indexer`), RPC_URL_<chainId>,
 * INDEXER_MANIFEST (plik manifestu wdrożenia), INDEXER_CONFIRMATIONS, INDEXER_START_BLOCK.
 * Alarmy trafiają na stdout jako JSON (jedna linia = jeden alarm) — dalsze przekazanie to decyzja operacyjna.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

import { Client } from "pg";
import { createPublicClient, http } from "viem";

import { ConfigError, loadProcessConfig } from "./config.js";
import {
  renderMetrics,
  type Alert,
  type HealthSnapshot,
  type WorkerCounters,
} from "./monitoring.js";
import { createViemRpc } from "./rpc.js";
import { runWorker } from "./worker.js";

async function main(): Promise<void> {
  const manifestPath = process.env["INDEXER_MANIFEST"];
  if (manifestPath === undefined || manifestPath === "")
    throw new ConfigError("Brak zmiennej INDEXER_MANIFEST");
  const config = loadProcessConfig(process.env, JSON.parse(readFileSync(manifestPath, "utf8")));

  const db = new Client({ connectionString: config.databaseUrl });
  await db.connect();
  const publicClient = createPublicClient({ transport: http(config.rpcUrl) });
  const nodeChainId = await publicClient.getChainId();
  if (nodeChainId !== config.indexer.chainId) {
    throw new ConfigError(
      `RPC zwraca inny łańcuch (${String(nodeChainId)}) niż manifest (${String(config.indexer.chainId)})`,
    );
  }

  const controller = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      controller.abort();
    });

  let latest: { snapshot: HealthSnapshot; counters: WorkerCounters } | null = null;
  const server =
    config.metricsPort === null
      ? null
      : createServer((request, response) => {
          if (request.url === "/healthz") {
            response.writeHead(latest === null ? 503 : 200).end();
          } else if (request.url === "/metrics" && latest !== null) {
            response.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
            response.end(renderMetrics(latest.snapshot, latest.counters));
          } else {
            response.writeHead(404).end();
          }
        }).listen(config.metricsPort, "127.0.0.1"); // tylko loopback: ekspozycja na zewnątrz to decyzja operatora

  const sink = {
    send(alert: Alert): Promise<void> {
      process.stdout.write(`${JSON.stringify({ level: alert.severity, ...alert })}\n`);
      return Promise.resolve();
    },
  };

  try {
    await runWorker(db, createViemRpc(publicClient), config.indexer, {
      sink,
      intervalMs: config.intervalMs,
      reconcileEveryCycles: config.reconcileEveryCycles,
      signal: controller.signal,
      onCycle: (info) => {
        latest = { snapshot: info.snapshot, counters: info.counters };
      },
    });
  } finally {
    server?.close();
    await db.end();
  }
}

main().catch((error: unknown) => {
  // Tylko nazwa i komunikat błędu konfiguracji; błędy sieci/bazy mogą zawierać adresy z kluczami.
  console.error(
    error instanceof ConfigError ? error.message : "Indexer zakończył się błędem krytycznym",
  );
  process.exitCode = 1;
});
