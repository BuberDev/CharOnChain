/**
 * Arytmetyka kwot USDC (COC-002). Wszystkie kwoty to `bigint` w jednostkach najmniejszych
 * (6 miejsc po przecinku). Nigdy `number` ani float (CLAUDE.md pkt 7).
 *
 * Ten moduł służy walidacji po stronie UX i backendu. Źródłem prawdy o regułach darowizny
 * jest kontrakt `DonationRouter` (docs/02 §2); poniższe funkcje tylko je odzwierciedlają.
 */

export const USDC_DECIMALS = 6;
export const USDC_UNIT = 1_000_000n;
export const MAX_UINT256 = (1n << 256n) - 1n;
/** Minimalna darowizna: 1 USDC (wyjątek: dokładna końcówka celu — patrz checkDonationAmount). */
export const MIN_DONATION_RAW = USDC_UNIT;

export type UsdcParseErrorCode = "EMPTY" | "FORMAT" | "TOO_MANY_DECIMALS" | "OVERFLOW";

export type UsdcParseResult =
  | { readonly ok: true; readonly raw: bigint }
  | { readonly ok: false; readonly code: UsdcParseErrorCode };

// Kanoniczny zapis dziesiętny: bez znaku, spacji, notacji naukowej, przecinka i zer wiodących.
const DECIMAL = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;

/**
 * Parsuje kwotę wpisaną przez użytkownika ("5", "0.5", "5.123456") do jednostek najmniejszych.
 * ŚCIŚLE: nadmiarowe miejsca dziesiętne są odrzucane, nie zaokrąglane — zaokrąglanie pieniędzy
 * po cichu jest niedopuszczalne. Normalizacja ("5,5" → "5.5") należy do warstwy UI.
 */
export function parseUsdc(input: string): UsdcParseResult {
  if (input === "") return { ok: false, code: "EMPTY" };
  const match = DECIMAL.exec(input);
  if (!match) return { ok: false, code: "FORMAT" };
  const whole = match[1] ?? "";
  const fraction = match[2] ?? "";
  if (fraction.length > USDC_DECIMALS) return { ok: false, code: "TOO_MANY_DECIMALS" };
  const raw = BigInt(whole) * USDC_UNIT + BigInt(fraction.padEnd(USDC_DECIMALS, "0"));
  if (raw > MAX_UINT256) return { ok: false, code: "OVERFLOW" };
  return { ok: true, raw };
}

export interface FormatUsdcOptions {
  /** Minimalna liczba cyfr po separatorze (0–6). Domyślnie 2. Reszta jest zawsze zachowana. */
  readonly minFractionDigits?: number;
  /** Separator tysięcy (domyślnie brak). */
  readonly groupSeparator?: string;
  /** Separator dziesiętny (domyślnie "."). */
  readonly decimalSeparator?: string;
}

/**
 * Formatuje kwotę dokładnie, bez utraty precyzji: `5123456n` → "5.123456", `5000000n` → "5.00".
 * Cyfry znaczące po przecinku nigdy nie są obcinane (docs/04 §1).
 */
export function formatUsdc(raw: bigint, options: FormatUsdcOptions = {}): string {
  if (raw < 0n || raw > MAX_UINT256) throw new RangeError("Kwota poza zakresem uint256");
  const min = options.minFractionDigits ?? 2;
  if (!Number.isInteger(min) || min < 0 || min > USDC_DECIMALS) {
    throw new RangeError("minFractionDigits musi być liczbą całkowitą 0–6");
  }
  const group = options.groupSeparator ?? "";
  const decimal = options.decimalSeparator ?? ".";

  const whole = (raw / USDC_UNIT).toString();
  let fraction = (raw % USDC_UNIT).toString().padStart(USDC_DECIMALS, "0");
  while (fraction.length > min && fraction.endsWith("0")) fraction = fraction.slice(0, -1);

  const grouped = group === "" ? whole : whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return fraction === "" ? grouped : `${grouped}${decimal}${fraction}`;
}

/** Serializacja do JSON: kwoty zawsze jako string (docs/03 §1). */
export function rawToJson(raw: bigint): string {
  if (raw < 0n || raw > MAX_UINT256) throw new RangeError("Kwota poza zakresem uint256");
  return raw.toString();
}

/** Odczyt kwoty z JSON (string całkowity, bez zer wiodących). Zwraca null dla niepoprawnej wartości. */
export function rawFromJson(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const raw = BigInt(value);
  return raw <= MAX_UINT256 ? raw : null;
}

export type DonationCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: "INVALID_AMOUNT" | "CAP_REACHED" | "CAP_EXCEEDED" | "BELOW_MINIMUM";
      /** Największa dopuszczalna kwota (pozostały limit) — UI może zaproponować ją użytkownikowi. */
      readonly maxAllowedRaw: bigint;
    };

/**
 * Odzwierciedla reguły `DonationRouter.donate` (docs/02 §2, AC-04):
 *  - kwota > 0 i `raised + amount <= cap` (czyli `amount <= remaining`),
 *  - minimum 1 USDC, **wyjątek:** 0 < kwota < 1 USDC dozwolona wyłącznie, gdy dokładnie domyka limit.
 * To tylko sprawdzenie wstępne dla UX; ostateczną decyzję podejmuje kontrakt.
 */
export function checkDonationAmount(amountRaw: bigint, remainingRaw: bigint): DonationCheck {
  if (remainingRaw <= 0n) return { ok: false, code: "CAP_REACHED", maxAllowedRaw: 0n };
  if (amountRaw <= 0n || amountRaw > MAX_UINT256) {
    return { ok: false, code: "INVALID_AMOUNT", maxAllowedRaw: remainingRaw };
  }
  if (amountRaw > remainingRaw) {
    return { ok: false, code: "CAP_EXCEEDED", maxAllowedRaw: remainingRaw };
  }
  if (amountRaw < MIN_DONATION_RAW && amountRaw !== remainingRaw) {
    return { ok: false, code: "BELOW_MINIMUM", maxAllowedRaw: remainingRaw };
  }
  return { ok: true };
}
