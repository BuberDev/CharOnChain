"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import type { Locale } from "../i18n/index";

/**
 * Przełącznik języka PL/EN: ten sam adres w drugim języku. Aktualny język oznaczony `aria-current`.
 * Nazwa dostępna zaczyna się od widocznego tekstu („PL, Polski”) — WCAG 2.5.3 Label in Name.
 */
export function LocaleSwitch({
  locale,
  label,
  names,
}: {
  readonly locale: Locale;
  readonly label: string;
  readonly names: Readonly<Record<Locale, string>>;
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const rest = pathname.replace(/^\/(pl|en)(?=\/|$)/, "");
  const target = (next: Locale): string => `/${next}${rest}${search === "" ? "" : `?${search}`}`;

  return (
    <nav
      aria-label={label}
      className="flex items-center gap-1 text-small font-display font-semibold"
    >
      {(["pl", "en"] as const).map((code) => (
        <Link
          key={code}
          href={target(code)}
          hrefLang={code}
          lang={code}
          aria-current={code === locale ? "true" : undefined}
          aria-label={`${code.toUpperCase()}, ${names[code]}`}
          className={
            code === locale
              ? "inline-flex min-h-11 min-w-11 items-center justify-center bg-paper px-2 text-ink"
              : "link-plain inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-mist hover:text-paper"
          }
        >
          {code.toUpperCase()}
        </Link>
      ))}
    </nav>
  );
}
