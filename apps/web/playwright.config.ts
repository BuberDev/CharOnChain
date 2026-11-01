import { defineConfig } from "@playwright/test";

/**
 * E2E ścieżek krytycznych frontendu (CLAUDE.md pkt 11). Testuje zbudowaną aplikację (`next start`),
 * czyli to, co trafia do użytkownika. Przed uruchomieniem: `pnpm --filter @charonchain/web build`.
 * W CI przeglądarkę instaluje `playwright install --with-deps chromium`; lokalnie można wskazać własną
 * przez `PLAYWRIGHT_CHROME_PATH` (np. wrapper z `--no-sandbox` w kontenerze działającym jako root).
 */
const port = String(Number(process.env.E2E_PORT ?? 3101));
const chromePath = process.env.PLAYWRIGHT_CHROME_PATH;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: [["list"]],
  outputDir: "./e2e/.results",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    launchOptions: chromePath === undefined ? {} : { executablePath: chromePath },
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, hasTouch: true } },
  ],
  webServer: {
    command: `pnpm exec next start -p ${port}`,
    url: `http://localhost:${port}/pl`,
    reuseExistingServer: process.env.CI === undefined,
    timeout: 60_000,
  },
});
