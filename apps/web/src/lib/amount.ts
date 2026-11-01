import {
  MIN_DONATION_RAW,
  checkDonationAmount,
  formatUsdc,
  parseUsdc,
  type DonationCheck,
  type UsdcParseErrorCode,
} from "@charonchain/shared";

export type AmountValidation =
  | { readonly state: "ok"; readonly raw: bigint }
  | { readonly state: "error"; readonly code: string; readonly suggestRaw: bigint | null };

/**
 * Waliduje kwotę wpisaną przez użytkownika względem pozostałego limitu zbiórki. Używa tych samych funkcji
 * co backend (`@charonchain/shared`), czyli reguł kontraktu: minimum 1 USDC z wyjątkiem końcówki celu,
 * limit twardy, brak zaokrągleń. Przecinek dziesiętny jest normalizowany do kropki (warstwa UI).
 */
export function validateAmount(input: string, remainingRaw: bigint): AmountValidation {
  const parsed = parseUsdc(input.trim().replace(",", "."));
  if (!parsed.ok) {
    const code: UsdcParseErrorCode = parsed.code;
    return { state: "error", code, suggestRaw: null };
  }
  const check: DonationCheck = checkDonationAmount(parsed.raw, remainingRaw);
  if (check.ok) return { state: "ok", raw: parsed.raw };
  return { state: "error", code: check.code, suggestRaw: suggestion(check) };
}

/**
 * Podpowiedź jest zawsze kwotą, którą kontrakt przyjmie, i zawsze najbliższą tego, co wpisał użytkownik:
 *  - ponad limit → pozostały limit (największa dopuszczalna kwota),
 *  - poniżej minimum → minimum 1 USDC (albo dokładne domknięcie, gdy limit jest mniejszy niż minimum),
 *  - zero/limit osiągnięty → brak podpowiedzi (nie sugerujemy „wpłać całość”).
 */
function suggestion(check: Extract<DonationCheck, { ok: false }>): bigint | null {
  switch (check.code) {
    case "CAP_EXCEEDED":
      return check.maxAllowedRaw;
    case "BELOW_MINIMUM":
      return check.maxAllowedRaw < MIN_DONATION_RAW ? check.maxAllowedRaw : MIN_DONATION_RAW;
    case "INVALID_AMOUNT":
    case "CAP_REACHED":
      return null;
  }
}

/**
 * Kwota → tekst do WPISANIA w polu (kanoniczny zapis dziesiętny: kropka, bez separatora tysięcy, bez
 * zbędnych zer). Musi przechodzić przez `validateAmount` bez zmian — dlatego nie używamy formatowania
 * wyświetlanego użytkownikowi (`formatUsdcLocale`), które grupuje tysiące i zmienia separator.
 */
export function amountToInput(raw: bigint): string {
  return formatUsdc(raw, { minFractionDigits: 0 });
}
