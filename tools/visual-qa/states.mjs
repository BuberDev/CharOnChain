/* global document, process, console */
/**
 * Zrzuty STANÓW INTERAKTYWNYCH z rzeczywistej przeglądarki (docs/09 §2): błąd walidacji kwoty z podpowiedzią,
 * menu mobilne, odznaka po odbiorze, widoczny fokus klawiatury. Użycie: QA_BASE_URL=... node tools/visual-qa/states.mjs
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright";

const base = process.env.QA_BASE_URL ?? "http://localhost:3100";
const out = process.env.QA_OUT ?? "design-evidence/COC-003A/screenshots-states";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});
const shot = async (page, name, { selector, fullPage = false } = {}) => {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running"),
  );
  const path = join(out, `${name}.jpg`);
  if (selector)
    await page.locator(selector).first().screenshot({ path, type: "jpeg", quality: 82 });
  else await page.screenshot({ path, type: "jpeg", quality: 82, fullPage });
  console.log(`saved ${path}`);
};

try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: width < 768 ? 844 : 900 },
      locale: "pl-PL",
    });
    const page = await context.newPage();

    // 1) Panel: kwota poniżej minimum → komunikat + podpowiedź (nie cały limit).
    await page.goto(`${base}/pl/campaigns/cieple-posilki`, { waitUntil: "load" });
    const panel = page.getByRole("complementary");
    await panel.scrollIntoViewIfNeeded();
    await panel.getByLabel("Inna kwota w USDC").fill("0,5");
    await page.waitForTimeout(250);
    await shot(page, `panel-below-minimum-${width}`, { selector: "aside" });

    // 2) Panel: kwota ponad limit.
    await panel.getByLabel("Inna kwota w USDC").fill("7000");
    await page.waitForTimeout(250);
    await shot(page, `panel-over-cap-${width}`, { selector: "aside" });

    // 3) Widoczny fokus klawiatury: na polu kwoty, potem na przycisku akcji (jeden Tab dalej).
    await panel.getByLabel("Inna kwota w USDC").fill("25");
    await panel.getByLabel("Inna kwota w USDC").focus();
    await shot(page, `focus-input-${width}`, { selector: "aside" });
    await page.keyboard.press("Tab");
    await shot(page, `focus-action-${width}`, { selector: "aside" });

    // 4) Menu mobilne otwarte (tylko telefon).
    if (width < 768) {
      await page.goto(`${base}/pl`, { waitUntil: "load" });
      await page.getByRole("button", { name: "Menu" }).click();
      await page.waitForTimeout(250);
      await shot(page, `menu-open-${width}`);
    }

    // 5) Odznaka: przed i po odbiorze.
    await page.goto(`${base}/pl/profile`, { waitUntil: "load" });
    await page.getByRole("button", { name: /odbierz/i }).scrollIntoViewIfNeeded();
    await shot(page, `badge-before-${width}`);
    await page.getByRole("button", { name: /odbierz/i }).click();
    await page.waitForTimeout(300);
    await shot(page, `badge-after-${width}`);
    await context.close();
  }
} finally {
  await browser.close();
}
