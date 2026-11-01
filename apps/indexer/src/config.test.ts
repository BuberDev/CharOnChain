import { describe, expect, it } from "vitest";

import { ConfigError, loadProcessConfig } from "./config.js";

const addr = (n: number): string => `0x${n.toString(16).padStart(40, "0")}`;
const manifest = (chainId = 421614) => ({
  chainId,
  gitCommitSha: "a".repeat(40),
  solcVersion: "0.8.28",
  sourcesHash: `0x${"b".repeat(64)}`,
  usdc: chainId === 42161 ? "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" : addr(0xc1),
  contracts: {
    registry: addr(0xa1),
    router: addr(0xa2),
    reputation: addr(0xa3),
    impact: addr(0xa4),
  },
  roles: {
    adminSafe: addr(0x10),
    guardian: addr(0x11),
    registrar: addr(0x12),
    reputationGovernor: addr(0x13),
    reportPublisher: addr(0x14),
    reviewer: addr(0x15),
  },
});
const env = (
  over: Record<string, string | undefined> = {},
): Record<string, string | undefined> => ({
  DATABASE_URL: "postgres://app_indexer:x@localhost/db",
  RPC_URL_421614: "https://rpc.example/key",
  INDEXER_CONFIRMATIONS: "12",
  INDEXER_START_BLOCK: "1000",
  ...over,
});

describe("loadProcessConfig", () => {
  it("buduje konfigurację z bezpiecznymi domyślnymi dla nakładania, zakresu i interwału", () => {
    const c = loadProcessConfig(env(), manifest());
    expect(c.indexer).toMatchObject({
      chainId: 421614,
      confirmations: 12n,
      overlap: 44n, // 2 * 12 + 20 > 12
      maxRange: 1000n,
      startBlock: 1000n,
    });
    expect(c.indexer.overlap > c.indexer.confirmations).toBe(true);
    expect(c.metricsPort).toBeNull();
    expect(c.intervalMs).toBe(5000);
  });

  it("liczba potwierdzeń i blok startowy NIE mają wartości domyślnych (ADR-109)", () => {
    expect(() => loadProcessConfig(env({ INDEXER_CONFIRMATIONS: undefined }), manifest())).toThrow(
      /INDEXER_CONFIRMATIONS/,
    );
    expect(() => loadProcessConfig(env({ INDEXER_START_BLOCK: undefined }), manifest())).toThrow(
      /INDEXER_START_BLOCK/,
    );
    expect(() => loadProcessConfig(env({ INDEXER_CONFIRMATIONS: "0" }), manifest())).toThrow(
      /minimum/,
    );
  });

  it("overlap musi być większy od liczby potwierdzeń", () => {
    expect(() => loadProcessConfig(env({ INDEXER_OVERLAP: "12" }), manifest())).toThrow(
      /INDEXER_OVERLAP/,
    );
    expect(loadProcessConfig(env({ INDEXER_OVERLAP: "13" }), manifest()).indexer.overlap).toBe(13n);
  });

  it("mainnet jest wyłączony bez jawnej flagi", () => {
    const mainnetEnv = env({ RPC_URL_42161: "https://rpc.example/main" });
    expect(() => loadProcessConfig(mainnetEnv, manifest(42161))).toThrow(/Arbitrum One/);
    expect(
      loadProcessConfig({ ...mainnetEnv, INDEXER_ALLOW_MAINNET: "yes" }, manifest(42161)).indexer
        .chainId,
    ).toBe(42161);
  });

  it("odrzuca niepoprawny manifest i niepoprawne liczby; komunikaty nie zawierają sekretów", () => {
    expect(() => loadProcessConfig(env(), { chainId: 1 })).toThrow(/manifest/i);
    expect(() => loadProcessConfig(env({ INDEXER_CONFIRMATIONS: "12abc" }), manifest())).toThrow(
      ConfigError,
    );
    expect(() =>
      loadProcessConfig(env({ RPC_URL_421614: "ftp://secret-host/key" }), manifest()),
    ).toThrow(/http/);
    for (const bad of [
      env({ RPC_URL_421614: "ftp://secret-host/KEYVALUE" }),
      env({ DATABASE_URL: "" }),
    ]) {
      try {
        loadProcessConfig(bad, manifest());
      } catch (error) {
        expect((error as Error).message).not.toMatch(/KEYVALUE|secret-host|app_indexer/);
      }
    }
  });

  it("port metryk: opcjonalny, w zakresie 1..65535", () => {
    expect(loadProcessConfig(env({ INDEXER_METRICS_PORT: "9100" }), manifest()).metricsPort).toBe(
      9100,
    );
    expect(() => loadProcessConfig(env({ INDEXER_METRICS_PORT: "70000" }), manifest())).toThrow(
      /zakresem/,
    );
    expect(() => loadProcessConfig(env({ INDEXER_METRICS_PORT: "0" }), manifest())).toThrow(
      /minimum/,
    );
  });
});
