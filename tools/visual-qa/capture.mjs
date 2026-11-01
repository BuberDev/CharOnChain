/* global document, window, process, console, setTimeout */
/**
 * Zrzuty ekranu z RZECZYWISTEJ przeglądarki (Chromium) dla Visual QA (docs/09 §2).
 * Użycie: QA_BASE_URL=http://localhost:3100 node tools/visual-qa/capture.mjs <nazwa=ścieżka> ...
 * Zmienne: QA_OUT (katalog), QA_WIDTHS (np. "360,390,768,1280,1440"), QA_REDUCED=1 (reduced motion).
 * Dla każdej szerokości zapisuje: <nazwa>-<szer>-fold.jpg (pierwszy ekran) i <nazwa>-<szer>-full.jpg.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright";

const base = process.env.QA_BASE_URL ?? "http://localhost:3100";
const out = process.env.QA_OUT ?? "design-evidence/COC-003A/screenshots";
const widths = (process.env.QA_WIDTHS ?? "360,390,768,1280,1440").split(",").map(Number);
const reduced = process.env.QA_REDUCED === "1";
const targets = process.argv.slice(2).map((arg) => {
  const [name, ...rest] = arg.split("=");
  return { name, path: rest.join("=") };
});
if (targets.length === 0) {
  console.error("Podaj cele: nazwa=ścieżka");
  process.exit(2);
}
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});
try {
  for (const width of widths) {
    const height = width < 768 ? 844 : 900;
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      reducedMotion: reduced ? "reduce" : "no-preference",
      locale: "pl-PL",
    });
    const page = await context.newPage();
    for (const { name, path } of targets) {
      await page.goto(`${base}${path}`, { waitUntil: "load" });
      await page.evaluate(async () => {
        await document.fonts.ready;
        const step = Math.max(280, window.innerHeight / 2);
        for (let y = 0; y < document.body.scrollHeight; y += step) {
          window.scrollTo({ top: y, behavior: "instant" });
          await new Promise((resolve) => setTimeout(resolve, 140));
        }
        window.scrollTo({ top: 0, behavior: "instant" });
        await new Promise((resolve) => setTimeout(resolve, 1000));
      });
      await page.screenshot({
        path: join(out, `${name}-${width}-fold.jpg`),
        type: "jpeg",
        quality: 80,
      });
      await page.screenshot({
        path: join(out, `${name}-${width}-full.jpg`),
        type: "jpeg",
        quality: 80,
        fullPage: true,
      });
      const report = await page.evaluate(() => {
        const overflow = document.documentElement.scrollWidth - window.innerWidth;
        const offenders = [];
        if (overflow > 0) {
          for (const el of document.querySelectorAll("body *")) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.right > window.innerWidth + 1) {
              offenders.push(
                `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")} right=${Math.round(r.right)}`,
              );
            }
          }
        }
        return { overflow, offenders: offenders.slice(0, 6) };
      });
      console.log(
        `${name} @${width}: overflowX=${report.overflow}px${report.offenders.length ? " :: " + report.offenders.join(" | ") : ""}`,
      );
    }
    await context.close();
  }
} finally {
  await browser.close();
}
