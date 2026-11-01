import { expect, test } from "@playwright/test";

const CAMPAIGN = "/pl/campaigns/cieple-posilki";
// Next.js dokłada własny element role=alert (route announcer) — wybieramy tylko alerty aplikacji.
const APP_ALERT = '[role="alert"]:not(#__next-route-announcer__)';

test.describe("panel „Wystaw kwit” — walidacja zgodna z regułami kontraktu", () => {
  test("domyślna kwota daje kwit z kwotą, odbiorcą, prowizją 0% i XP", async ({ page }) => {
    await page.goto(CAMPAIGN);
    const panel = page.getByRole("complementary");
    await expect(panel.getByLabel("Inna kwota w USDC")).toHaveValue("25");
    await expect(panel.getByText("25,00 USDC").first()).toBeVisible();
    await expect(panel.getByText("0%")).toBeVisible();
    await expect(panel.getByText("+250")).toBeVisible();
    await expect(panel.getByRole("link", { name: "Wesprzyj zbiórkę" })).toBeEnabled();
  });

  test("kwota poniżej minimum: komunikat, podpowiedź to 1 USDC (nie cały limit), przycisk nieaktywny", async ({
    page,
  }) => {
    await page.goto(CAMPAIGN);
    const panel = page.getByRole("complementary");
    await panel.getByLabel("Inna kwota w USDC").fill("0,5");
    await expect(panel.getByRole("alert")).toContainText("Minimalna darowizna to 1 USDC");
    await expect(panel.getByRole("button", { name: "Wpisz poprawną kwotę" })).toBeDisabled();
    await expect(panel.getByRole("link", { name: "Wesprzyj zbiórkę" })).toHaveCount(0);

    const suggestion = panel.getByRole("button", { name: /^Wpisz 1,00 USDC/ });
    await expect(suggestion).toBeVisible();
    await suggestion.click();
    await expect(panel.getByLabel("Inna kwota w USDC")).toHaveValue("1");
    await expect(panel.getByRole("link", { name: "Wesprzyj zbiórkę" })).toBeVisible();
  });

  test("kwota ponad limit: podpowiedź równa pozostałemu limitowi", async ({ page }) => {
    await page.goto(CAMPAIGN);
    const panel = page.getByRole("complementary");
    await panel.getByLabel("Inna kwota w USDC").fill("7000");
    await expect(panel.getByRole("alert")).toContainText("przekracza pozostały limit");
    await panel.getByRole("button", { name: /^Wpisz 6\s579,50 USDC/ }).click();
    await expect(panel.getByLabel("Inna kwota w USDC")).toHaveValue("6579.5");
  });

  test("siedem miejsc po przecinku jest odrzucone, nie zaokrąglone", async ({ page }) => {
    await page.goto(CAMPAIGN);
    const panel = page.getByRole("complementary");
    await panel.getByLabel("Inna kwota w USDC").fill("1,2345678");
    await expect(panel.getByRole("alert")).toContainText("Maksymalnie sześć miejsc");
    await expect(panel.getByLabel("Inna kwota w USDC")).toHaveAttribute("aria-invalid", "true");
  });

  test("końcówka celu: 0,50 USDC jest dozwolone tylko, gdy dokładnie domyka limit", async ({
    page,
  }) => {
    await page.goto("/pl/campaigns/szkolne-pracownie");
    const panel = page.getByRole("complementary");
    await expect(panel.getByLabel("Inna kwota w USDC")).toHaveValue("0.5");
    await expect(panel.getByRole("link", { name: "Wesprzyj zbiórkę" })).toBeVisible();
    await panel.getByLabel("Inna kwota w USDC").fill("0.4");
    await expect(panel.getByRole("alert")).toContainText("Minimalna darowizna");
  });

  test("ścieżka do przeglądu zachowuje kwotę i niczego nie wysyła", async ({ page }) => {
    await page.goto(CAMPAIGN);
    const panel = page.getByRole("complementary");
    await panel.getByLabel("Inna kwota w USDC").fill("12,5");
    await panel.getByRole("link", { name: "Wesprzyj zbiórkę" }).click();
    await expect(page).toHaveURL(/\/donate\?amount=12\.5$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Sprawdź i zatwierdź");
    await expect(page.getByText("12,50 USDC").first()).toBeVisible();
    // Stan „do zatwierdzenia”: nic nie jest wysłane, nie ma komunikatu sukcesu.
    await expect(
      page.getByText("Nic nie zostanie wysłane, dopóki go nie zatwierdzisz."),
    ).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Gotowe do zatwierdzenia");
    await expect(page.locator(".text-success-on-navy")).toHaveCount(0);
  });
});

test.describe("przegląd i stany płatności — prawda o transakcji", () => {
  const url = (state: string): string => `${CAMPAIGN}/donate?amount=25&state=${state}`;

  test("sukces pokazuje się wyłącznie po potwierdzeniu, nigdy po samym wysłaniu", async ({
    page,
  }) => {
    for (const state of ["review", "authorizing", "submitted"]) {
      await page.goto(url(state));
      await expect(page.locator(".text-success-on-navy"), state).toHaveCount(0);
      await expect(
        page.getByRole("status").getByRole("link", { name: "Mój profil" }),
        state,
      ).toHaveCount(0);
    }
    await page.goto(url("confirmed"));
    await expect(page.locator(".text-success-on-navy")).toHaveCount(1);
    await expect(page.getByRole("status")).toContainText(/potwierdzon/i);
    await expect(page.getByRole("status").getByRole("link", { name: "Mój profil" })).toBeVisible();
  });

  for (const state of ["rejected", "sponsorship", "reverted"]) {
    test(`porażka „${state}”: alert, środki bez zmian, można spróbować ponownie`, async ({
      page,
    }) => {
      await page.goto(url(state));
      const alert = page.locator(APP_ALERT);
      await expect(alert).toBeVisible();
      await expect(alert).toContainText(/bez zmian|nie została wysłana|nic nie zostało/i);
      await expect(alert.getByRole("link", { name: /ponów|spróbuj/i })).toBeVisible();
    });
  }

  test("nieprawidłowa kwota w adresie: ekran błędu zamiast przycisku zatwierdzenia", async ({
    page,
  }) => {
    await page.goto(`${CAMPAIGN}/donate?amount=0.5`);
    await expect(page.getByRole("link", { name: "Zatwierdź darowiznę" })).toHaveCount(0);
    await expect(page.locator(APP_ALERT)).toBeVisible();
  });

  test("kwit ujawnia odbiorcę, prowizję 0% i koszt przesłania przed zatwierdzeniem", async ({
    page,
  }) => {
    await page.goto(url("review"));
    await expect(page.getByText("Fundacja Przykładowa").first()).toBeVisible();
    await expect(page.getByText("0%").first()).toBeVisible();
    await expect(page.getByText("Koszt przesłania").first()).toBeVisible();
    await expect(page.getByText(/nie można cofnąć|nieodwracaln/i).first()).toBeVisible();
  });
});
