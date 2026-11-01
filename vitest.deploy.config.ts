import { defineConfig } from "vitest/config";

// Testy skryptu wdrożenia na łańcuchu w procesie (EDR z Hardhat 3). Wymagają zbudowanych artefaktów:
// `pnpm --filter @charonchain/contracts run build`. Uruchamiane osobno: `pnpm test:deploy`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/contracts/deploy/**/*.chain.test.ts"],
    passWithNoTests: false,
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
