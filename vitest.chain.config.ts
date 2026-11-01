import { defineConfig } from "vitest/config";

// Testy wymagające prawdziwego EVM: łańcuch w procesie (EDR z Hardhat 3) — skrypt wdrożenia, weryfikator podpisów
// kont kontraktowych. Wymagają zbudowanych artefaktów: `pnpm --filter @charonchain/contracts run build`.
// Uruchamiane osobno: `pnpm test:chain`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/contracts/deploy/**/*.chain.test.ts", "packages/*/src/**/*.chain.test.ts"],
    passWithNoTests: false,
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
