/**
 * Konfiguracja procesu indexera ze zmiennych środowiskowych (COC-031/035). Czysta funkcja (testowalna):
 * nic nie czyta z dysku ani sieci. Zasady: brak wartości domyślnych dla parametrów bezpieczeństwa
 * (liczba potwierdzeń = decyzja ADR-109, blok startowy = blok wdrożenia), mainnet tylko za jawną flagą,
 * sekrety (DATABASE_URL, RPC_URL_*) wyłącznie ze środowiska i nigdy w komunikatach błędów.
 */
import { parseManifest, type Manifest } from "@charonchain/shared";

import type { IndexerConfig } from "./indexer.js";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface ProcessConfig {
  readonly indexer: IndexerConfig;
  readonly databaseUrl: string;
  readonly rpcUrl: string;
  readonly metricsPort: number | null;
  readonly intervalMs: number;
  readonly reconcileEveryCycles: number;
}

type Env = Readonly<Record<string, string | undefined>>;

function required(env: Env, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") throw new ConfigError(`Brak zmiennej ${name}`);
  return value.trim();
}

function integer(env: Env, name: string, options: { min: bigint; fallback?: bigint }): bigint {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === "") {
    if (options.fallback !== undefined) return options.fallback;
    throw new ConfigError(`Brak zmiennej ${name}`);
  }
  if (!/^\d{1,15}$/.test(raw))
    throw new ConfigError(`${name}: oczekiwano nieujemnej liczby całkowitej`);
  const value = BigInt(raw);
  if (value < options.min) throw new ConfigError(`${name}: minimum to ${options.min.toString()}`);
  return value;
}

/** `manifestJson` to treść pliku manifestu wdrożenia (walidowana `parseManifest`). */
export function loadProcessConfig(env: Env, manifestJson: unknown): ProcessConfig {
  const manifest: Manifest = parseManifest(manifestJson);
  const chainId = manifest.chainId;
  if (chainId === 42161 && env["INDEXER_ALLOW_MAINNET"] !== "yes") {
    throw new ConfigError(
      "Arbitrum One jest wyłączone: wymaga jawnej decyzji właściciela (INDEXER_ALLOW_MAINNET=yes).",
    );
  }
  const confirmations = integer(env, "INDEXER_CONFIRMATIONS", { min: 1n });
  const overlap = integer(env, "INDEXER_OVERLAP", {
    min: confirmations + 1n,
    fallback: confirmations * 2n + 20n,
  });
  const maxRange = integer(env, "INDEXER_MAX_RANGE", { min: 1n, fallback: 1000n });
  const startBlock = integer(env, "INDEXER_START_BLOCK", { min: 0n });
  const rpcUrl = required(env, `RPC_URL_${String(chainId)}`);
  if (!/^https?:\/\//.test(rpcUrl))
    throw new ConfigError(`RPC_URL_${String(chainId)}: oczekiwano adresu http(s)`);
  const metrics = env["INDEXER_METRICS_PORT"]?.trim();
  const port =
    metrics === undefined || metrics === ""
      ? null
      : Number(integer(env, "INDEXER_METRICS_PORT", { min: 1n }));
  if (port !== null && port > 65_535) throw new ConfigError("INDEXER_METRICS_PORT: poza zakresem");

  return {
    indexer: {
      chainId,
      contracts: manifest.contracts,
      usdc: manifest.usdc,
      confirmations,
      overlap,
      maxRange,
      startBlock,
    },
    databaseUrl: required(env, "DATABASE_URL"),
    rpcUrl,
    metricsPort: port,
    intervalMs: Number(integer(env, "INDEXER_INTERVAL_MS", { min: 250n, fallback: 5000n })),
    reconcileEveryCycles: Number(
      integer(env, "INDEXER_RECONCILE_EVERY", { min: 0n, fallback: 10n }),
    ),
  };
}
