import { en } from "./en";
import { pl, type Dictionary } from "./pl";
import { mapStrings, polishTypography } from "./typography";

export const locales = ["pl", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "pl";

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

const dictionaries: Readonly<Record<Locale, Dictionary>> = {
  pl: mapStrings(pl, polishTypography),
  en,
};

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

/** Podstawia {klucz} w tekście; brakujący klucz zostawia bez zmian (widoczny błąd w QA). */
export function format(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

export type { Dictionary };
