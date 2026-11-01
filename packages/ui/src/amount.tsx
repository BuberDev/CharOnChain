import { formatUsdc } from "@charonchain/shared";

import { cx } from "./cx";

export type NumberLocale = "pl" | "en";

/**
 * Formatuje kwotę USDC dokładnie (bez utraty precyzji, docs/04 §1) według lokalnych zasad zapisu:
 * PL — separator dziesiętny „,” i spacja niełamliwa jako separator tysięcy; EN — „.” i „,”.
 */
export function formatUsdcLocale(raw: bigint, locale: NumberLocale, minFractionDigits = 2): string {
  return locale === "pl"
    ? formatUsdc(raw, { minFractionDigits, decimalSeparator: ",", groupSeparator: " " })
    : formatUsdc(raw, { minFractionDigits, decimalSeparator: ".", groupSeparator: "," });
}

/** Liczba całkowita z separatorem tysięcy (PL: spacja niełamliwa, EN: przecinek) — np. punkty XP. */
export function formatInteger(value: bigint, locale: NumberLocale): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, locale === "pl" ? "\u00a0" : ",");
}

export interface UsdcAmountProps {
  readonly raw: bigint;
  readonly locale: NumberLocale;
  readonly minFractionDigits?: number;
  readonly className?: string;
}

/** Kwota z jednostką „USDC” (nigdy samo „$” — docs/04 §1). */
export function UsdcAmount({ raw, locale, minFractionDigits = 2, className }: UsdcAmountProps) {
  return (
    <span className={cx("tabular", className)}>
      {formatUsdcLocale(raw, locale, minFractionDigits)}
      {" "}USDC
    </span>
  );
}

/** Skrócony adres EVM (0x1234…abcd); pełny adres w atrybucie `title` i dla czytników ekranu. */
export function ShortAddress({
  address,
  label,
  className,
}: {
  readonly address: string;
  /** Opis dla czytników ekranu, np. „adres portfela Safe organizacji”. */
  readonly label: string;
  readonly className?: string;
}) {
  const short = address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
  return (
    <span className={cx("tabular [overflow-wrap:anywhere]", className)} title={address}>
      <span aria-hidden="true">{short}</span>
      <span className="sr-only">
        {label}: {address}
      </span>
    </span>
  );
}
