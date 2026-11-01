import { defineConfig } from "vitest/config";

// Testy integracyjne bazy (wymagają TEST_DATABASE_URL). Uruchamiane osobno: `pnpm test:db`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/*/src/**/*.db.test.ts", "apps/*/src/**/*.db.test.ts"],
    passWithNoTests: false,
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
