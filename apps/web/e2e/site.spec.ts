import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("/ przekierowuje na język domyślny PL", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/pl$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "pl");
});

test("wersja podglądowa jest oznaczona na każdej stronie i nie jest indeksowana", async ({
  page,
}) => {
  for (const path of ["/pl", "/en", "/pl/campaigns/cieple-posilki", "/pl/profile"]) {
    await page.goto(path);
    await expect(
      page.getByText(/nie przyjmujemy darowizn|do not accept donations/i).first(),
    ).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  }
});

test("przełącznik języka zachowuje ścieżkę i parametry", async ({ page }) => {
  await page.goto("/pl/campaigns/cieple-posilki/donate?amount=25&state=confirmed");
  await page.getByRole("link", { name: /^EN, English/ }).click();
  await expect(page).toHaveURL(
    /\/en\/campaigns\/cieple-posilki\/donate\?amount=25&state=confirmed$/,
  );
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/review and approve/i);
});

test("nieistniejąca zbiórka i nieobsługiwany język dają 404", async ({ page }) => {
  expect((await page.goto("/pl/campaigns/nie-ma-takiej"))?.status()).toBe(404);
  expect((await page.goto("/de"))?.status()).toBe(404);
});

test("pusta zbiórka mówi prawdę: brak wpłat i raportów, bez zmyślonych liczb", async ({ page }) => {
  await page.goto("/pl/campaigns/sprzet-ratownikow");
  await expect(page.getByText("Nie ma jeszcze potwierdzonych wpłat.")).toBeVisible();
  await expect(page.getByText(/raport/i).first()).toBeVisible();
});

test("odznaka: odbiór jest osobnym gestem i zostaje ogłoszony czytnikom ekranu", async ({
  page,
}) => {
  await page.goto("/pl/profile");
  await expect(page.getByRole("status")).toHaveText("");
  await page.getByRole("button", { name: /odbierz/i }).click();
  await expect(page.getByRole("status")).not.toHaveText("");
  await expect(page.getByRole("button", { name: /odbierz/i })).toHaveCount(0);
});

test("menu mobilne: przycisk steruje listą linków, Esc zamyka i oddaje fokus", async ({ page }) => {
  test.skip(
    (page.viewportSize()?.width ?? 0) >= 1024,
    "menu hamburgerowe tylko poniżej breakpointu lg",
  );
  await page.goto("/pl");
  const toggle = page.getByRole("button", { name: "Menu" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("navigation", { name: "Menu główne" })).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("navigation", { name: "Menu główne" }).getByRole("link")).toHaveCount(
    4,
  );
  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();
});

test.describe("ruch zredukowany", () => {
  test.use({ reducedMotion: "reduce" });

  test("treść poniżej pierwszego ekranu jest widoczna bez animacji wejścia", async ({ page }) => {
    await page.goto("/pl");
    await page.evaluate(() => {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" });
    });
    const hidden = await page.evaluate(
      () =>
        [...document.querySelectorAll("[data-reveal]")].filter(
          (el) => Number(getComputedStyle(el).opacity) < 1,
        ).length,
    );
    expect(hidden).toBe(0);
  });
});

test.describe("dostępność (axe, WCAG 2.2 AA) ekranów krytycznych", () => {
  const screens = [
    "/pl",
    "/en",
    "/pl/campaigns/cieple-posilki",
    "/pl/campaigns/cieple-posilki/donate?amount=25",
    "/pl/campaigns/cieple-posilki/donate?amount=25&state=rejected",
    "/pl/profile",
  ];
  for (const path of screens) {
    test(`bez naruszeń axe: ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 500) {
          window.scrollTo({ top: y, behavior: "instant" });
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        window.scrollTo({ top: 0, behavior: "instant" });
      });
      // axe mierzy kolor w danej chwili: czekamy, aż skończą się animacje wejścia (inaczej fałszywe „contrast”).
      await page.waitForFunction(() =>
        document.getAnimations().every((a) => a.playState !== "running"),
      );
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(
        violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
      ).toEqual([]);
    });
  }
});

test.describe("układ (to, czego nie widzi axe)", () => {
  const screens = [
    "/pl",
    "/en",
    "/pl/campaigns/cieple-posilki",
    "/pl/campaigns/szkolne-pracownie",
    "/pl/campaigns/sprzet-ratownikow",
    "/pl/campaigns/cieple-posilki/donate?amount=25",
    "/pl/campaigns/cieple-posilki/donate?amount=25&state=sponsorship",
    "/en/campaigns/cieple-posilki/donate?amount=25&state=confirmed",
    "/pl/profile",
    "/en/profile",
  ];

  for (const path of screens) {
    test(`brak poziomego przewijania strony (WCAG 1.4.10): ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test("kwoty KPI na profilu: w jednej linii i bez zachodzenia na sąsiednią kolumnę", async ({
    page,
  }) => {
    await page.goto("/pl/profile");
    await page.evaluate(() => document.fonts.ready);
    const result = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll("dl dd")].slice(0, 3).map((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        // Linie liczymy po różnych pozycjach pionowych prostokątów (jeden wiersz tekstu = jedna pozycja `top`).
        const tops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
        return { lines: tops.size, rect: range.getBoundingClientRect() };
      });
      let collisions = 0;
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i]?.rect;
          const b = boxes[j]?.rect;
          if (a === undefined || b === undefined) continue;
          const overlapX = a.left < b.right - 0.5 && b.left < a.right - 0.5;
          const overlapY = a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
          if (overlapX && overlapY) collisions += 1;
        }
      }
      return { firstLines: boxes[0]?.lines ?? 0, collisions };
    });
    expect(result.firstLines).toBe(1);
    expect(result.collisions).toBe(0);
  });
});
