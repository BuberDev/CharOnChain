import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    // Testy bazy (*.db.test.ts) wymagają Postgresa — osobna konfiguracja: vitest.db.config.ts.
    exclude: [...configDefaults.exclude, "**/*.db.test.ts"],
    // Brak testów to błąd: nie wolno oznaczać zadania jako DONE bez uruchomionych testów.
    passWithNoTests: false,
  },
});
