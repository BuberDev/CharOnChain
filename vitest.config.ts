import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    // Brak testów to błąd: nie wolno oznaczać zadania jako DONE bez uruchomionych testów.
    passWithNoTests: false,
  },
});
