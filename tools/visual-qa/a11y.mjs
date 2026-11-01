/* global document, window, process, console, requestAnimationFrame, NodeFilter, setTimeout */
/**
 * Automatyczny test dostępności (axe-core, tagi WCAG 2.0/2.1/2.2 A i AA) w RZECZYWISTEJ przeglądarce.
 * Użycie: QA_BASE_URL=http://localhost:3100 node tools/visual-qa/a11y.mjs [plik-wynikowy.json]
 *
 * Co robi:
 *  1. Dla każdej strony i szerokości (390, 1440) uruchamia axe (po przewinięciu strony, żeby elementy `reveal`
 *     były widoczne, oraz osobno przy `prefers-reduced-motion: reduce`).
 *  2. Dla stanów interaktywnych (menu mobilne, błąd walidacji kwoty, rozwinięte szczegóły) uruchamia axe ponownie.
 *  3. Sprawdza (poza axe) rzeczy, które axe nie łapie: cel dotykowy ≥ 24×24 px (WCAG 2.5.8), widoczny fokus
 *     (2.4.7/2.4.11), kolejność tabulatora, `lang`, pojedyncze `h1`, brak skoku poziomów nagłówków.
 * Kod wyjścia ≠ 0, jeśli jest jakiekolwiek naruszenie axe lub własnej kontroli.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const base = process.env.QA_BASE_URL ?? "http://localhost:3100";
const outFile = process.argv[2] ?? "design-evidence/COC-003A/a11y-results.json";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const widths = [390, 1440];

const pages = [
  ["home-pl", "/pl"],
  ["home-en", "/en"],
  ["campaign-pl", "/pl/campaigns/cieple-posilki"],
  ["campaign-en", "/en/campaigns/cieple-posilki"],
  ["campaign-edge-pl", "/pl/campaigns/szkolne-pracownie"],
  ["campaign-empty-pl", "/pl/campaigns/sprzet-ratownikow"],
  ["checkout-review-pl", "/pl/campaigns/cieple-posilki/donate?amount=25"],
  ["checkout-review-en", "/en/campaigns/cieple-posilki/donate?amount=25"],
  ["checkout-authorizing-pl", "/pl/campaigns/cieple-posilki/donate?amount=25&state=authorizing"],
  ["checkout-submitted-pl", "/pl/campaigns/cieple-posilki/donate?amount=25&state=submitted"],
  ["checkout-confirmed-pl", "/pl/campaigns/cieple-posilki/donate?amount=25&state=confirmed"],
  ["checkout-rejected-pl", "/pl/campaigns/cieple-posilki/donate?amount=25&state=rejected"],
  ["checkout-sponsorship-pl", "/pl/campaigns/cieple-posilki/donate?amount=25&state=sponsorship"],
  ["checkout-reverted-pl", "/pl/campaigns/cieple-posilki/donate?amount=25&state=reverted"],
  ["checkout-invalid-pl", "/pl/campaigns/cieple-posilki/donate?amount=0.5"],
  ["profile-pl", "/pl/profile"],
  ["profile-en", "/en/profile"],
];

/** @type {{ name: string, width: number, mode: string, violations: unknown[], extra: string[] }[]} */
const results = [];
let failures = 0;

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo({ top: y, behavior: "instant" });
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    window.scrollTo({ top: 0, behavior: "instant" });
    await new Promise((resolve) => setTimeout(resolve, 700));
  });
}

async function runAxe(page) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes
      .slice(0, 5)
      .map((n) => ({ target: n.target.join(" "), summary: n.failureSummary })),
    count: v.nodes.length,
  }));
}

/** Kontrole spoza axe. Zwraca listę opisów problemów. */
async function ownChecks(page) {
  return page.evaluate(() => {
    const problems = [];
    const lang = document.documentElement.lang;
    if (!/^(pl|en)/.test(lang)) problems.push(`html[lang]="${lang}"`);
    const h1 = document.querySelectorAll("h1");
    if (h1.length !== 1) problems.push(`h1 count=${h1.length}`);
    let previous = 0;
    for (const heading of document.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
      const level = Number(heading.tagName.slice(1));
      if (previous !== 0 && level > previous + 1) {
        problems.push(
          `heading jump h${previous}→h${level}: ${heading.textContent?.trim().slice(0, 40)}`,
        );
      }
      previous = level;
    }
    // WCAG 2.5.8 (AA): cel ≥ 24×24 CSS px, z wyjątkiem linków w treści zdania i elementów wyłączonych.
    for (const el of document.querySelectorAll("a[href],button,summary,input,select,textarea")) {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const inline =
        el.tagName === "A" && style.display === "inline" && el.closest("p,li,dd,dt,small");
      if (inline) continue;
      if (el.matches(":disabled")) continue;
      if (r.width < 24 || r.height < 24) {
        problems.push(
          `target ${Math.round(r.width)}×${Math.round(r.height)}: ${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 30)}"`,
        );
      }
    }
    // Obrazy bez alternatywy (axe łapie <img>, tu dodatkowo role=img bez nazwy).
    for (const el of document.querySelectorAll('[role="img"]')) {
      if (!el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby")) {
        problems.push("role=img without name");
      }
    }
    return problems;
  });
}

/** Tabulator przechodzi przez interaktywne elementy; każdy musi mieć widoczny fokus (kontur lub zmiana tła). */
async function focusCheck(page, limit = 40) {
  const problems = [];
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    document.body.focus();
  });
  const seen = new Set();
  for (let i = 0; i < limit; i += 1) {
    await page.keyboard.press("Tab");
    // Fokus uruchamia płynne przewijanie (scroll-behavior: smooth): mierzymy dopiero po zatrzymaniu strony,
    // inaczej element jest jeszcze poza ekranem i test „zasłonięcia” daje fałszywy alarm.
    await page.evaluate(async () => {
      let last = -1;
      let stable = 0;
      while (stable < 3) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        stable = window.scrollY === last ? stable + 1 : 0;
        last = window.scrollY;
      }
    });
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (el === null || el === document.body) return null;
      const style = window.getComputedStyle(el);
      const outlineVisible =
        style.outlineStyle !== "none" &&
        parseFloat(style.outlineWidth) >= 2 &&
        style.outlineColor !== "rgba(0, 0, 0, 0)";
      const r = el.getBoundingClientRect();
      // Fokus nie może być całkowicie przesłonięty (2.4.11): środek elementu musi trafiać w element lub potomka.
      const cx = Math.min(Math.max(r.left + r.width / 2, 0), window.innerWidth - 1);
      const cy = Math.min(Math.max(r.top + r.height / 2, 0), window.innerHeight - 1);
      const top = document.elementFromPoint(cx, cy);
      const covered = top !== null && !el.contains(top) && !top.contains(el);
      return {
        key: `${el.tagName}|${el.textContent?.trim().slice(0, 24)}|${el.getAttribute("href") ?? ""}`,
        label: `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 28)}"`,
        outlineVisible,
        covered,
      };
    });
    if (info === null) break;
    if (seen.has(info.key)) break;
    seen.add(info.key);
    if (!info.outlineVisible) problems.push(`focus not visible: ${info.label}`);
    if (info.covered) problems.push(`focus covered: ${info.label}`);
  }
  return problems;
}

function record(name, width, mode, violations, extra) {
  results.push({ name, width, mode, violations, extra });
  const bad = violations.length + extra.length;
  failures += bad;
  console.log(
    `${bad === 0 ? "PASS" : "FAIL"} ${name} @${width} [${mode}] axe=${violations.length} own=${extra.length}`,
  );
  for (const v of violations) console.log(`   axe ${v.id} (${v.impact}) x${v.count}: ${v.help}`);
  for (const e of extra) console.log(`   own ${e}`);
}

/** WCAG 1.4.10 (reflow, 320 px) i 1.4.12 (nadpisane odstępy tekstu): brak poziomego przewijania i brak ucięcia tekstu. */
async function reflowAndSpacing(browser) {
  const context = await browser.newContext({
    viewport: { width: 320, height: 640 },
    locale: "pl-PL",
  });
  const page = await context.newPage();
  for (const [name, path] of pages) {
    await page.goto(`${base}${path}`, { waitUntil: "load" });
    await settle(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    record(name, 320, "reflow", [], overflow > 0 ? [`horizontal overflow ${overflow}px`] : []);

    await page.addStyleTag({
      content:
        "*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}",
    });
    await page.waitForTimeout(150);
    const clipped = await page.evaluate(() => {
      const found = [];
      for (const el of document.querySelectorAll("body *")) {
        const style = window.getComputedStyle(el);
        if (style.display === "none" || el.classList.contains("sr-only")) continue;
        const clips =
          /(hidden|clip)/.test(style.overflowY) || /(hidden|clip)/.test(style.overflowX);
        if (!clips) continue;
        // Liczy się utrata TEKSTU: sprawdzamy, czy jakikolwiek tekst wychodzi poza ramkę przycinania.
        // Przycięty z zamierzenia dolny margines dekoracyjnych kart („karta przycięta”) nie jest utratą treści.
        const box = el.getBoundingClientRect();
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let lost = false;
        for (let node = walker.nextNode(); node !== null && !lost; node = walker.nextNode()) {
          if ((node.textContent ?? "").trim() === "") continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const rect of range.getClientRects()) {
            if (rect.width === 0) continue;
            if (rect.bottom > box.bottom + 1 || rect.right > box.right + 1) lost = true;
          }
        }
        if (lost)
          found.push(
            `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")}`,
          );
      }
      return found.slice(0, 5);
    });
    const overflow2 = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    const extra = clipped.map((c) => `clipped text under spacing override: ${c}`);
    if (overflow2 > 0) extra.push(`horizontal overflow under spacing override ${overflow2}px`);
    record(name, 320, "text-spacing", [], extra);
  }
  await context.close();
}

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});
try {
  for (const width of widths) {
    const height = width < 768 ? 844 : 900;
    for (const reduced of [false, true]) {
      const context = await browser.newContext({
        viewport: { width, height },
        reducedMotion: reduced ? "reduce" : "no-preference",
        locale: "pl-PL",
      });
      const page = await context.newPage();
      for (const [name, path] of pages) {
        // Tryb reduced-motion: tylko kilka reprezentatywnych stron (cały zestaw jest sprawdzony bez redukcji).
        if (
          reduced &&
          !["home-pl", "campaign-pl", "checkout-review-pl", "profile-pl"].includes(name)
        )
          continue;
        await page.goto(`${base}${path}`, { waitUntil: "load" });
        await settle(page);
        const violations = await runAxe(page);
        const extra = await ownChecks(page);
        if (!reduced) extra.push(...(await focusCheck(page)));
        record(name, width, reduced ? "reduced-motion" : "default", violations, extra);
      }

      if (!reduced) {
        // Stany interaktywne.
        if (width < 768) {
          await page.goto(`${base}/pl`, { waitUntil: "load" });
          await settle(page);
          const toggle = page.getByRole("button", { name: /menu/i }).first();
          await toggle.click();
          await page.waitForTimeout(300);
          record("home-pl-menu-open", width, "state", await runAxe(page), await ownChecks(page));
          await page.keyboard.press("Escape");
        }

        await page.goto(`${base}/pl/campaigns/cieple-posilki`, { waitUntil: "load" });
        await settle(page);
        const input = page.getByLabel(/inna kwota|własna kwota|kwota/i).first();
        await input.fill("0.5");
        await page.waitForTimeout(200);
        record(
          "campaign-pl-amount-error",
          width,
          "state",
          await runAxe(page),
          await ownChecks(page),
        );
        await input.fill("1,234567");
        await page.waitForTimeout(200);
        record(
          "campaign-pl-amount-decimals",
          width,
          "state",
          await runAxe(page),
          await ownChecks(page),
        );

        await page.goto(`${base}/pl/campaigns/cieple-posilki/donate?amount=25`, {
          waitUntil: "load",
        });
        await settle(page);
        await page.locator("summary").first().click();
        await page.waitForTimeout(200);
        record(
          "checkout-review-pl-details-open",
          width,
          "state",
          await runAxe(page),
          await ownChecks(page),
        );
      }
      await context.close();
    }
  }
  await reflowAndSpacing(browser);
} finally {
  await browser.close();
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(
  outFile,
  `${JSON.stringify({ tags: TAGS, base, generatedAt: new Date().toISOString(), failures, results }, null, 2)}\n`,
);
console.log(`\n${results.length} kontroli, ${failures} naruszeń. Wynik: ${outFile}`);
process.exit(failures === 0 ? 0 : 1);
