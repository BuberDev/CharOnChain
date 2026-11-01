import { describe, expect, it } from "vitest";

import { en } from "./en";
import { format, getDictionary, isLocale, locales } from "./index";
import { pl } from "./pl";
import { mapStrings, polishTypography } from "./typography";

/** Spłaszcza słownik do par „ścieżka → napis”; tablice indeksowane. */
function flatten(input: unknown, path = ""): [string, string][] {
  if (typeof input === "string") return [[path, input]];
  if (Array.isArray(input)) {
    return input.flatMap((item: unknown, index) => flatten(item, `${path}[${String(index)}]`));
  }
  if (typeof input === "object" && input !== null) {
    return Object.entries(input).flatMap(([key, value]) =>
      flatten(value, path === "" ? key : `${path}.${key}`),
    );
  }
  throw new Error(`Nieobsługiwany typ pod ${path}`);
}

const plFlat = new Map(flatten(pl));
const enFlat = new Map(flatten(en));

describe("słowniki PL/EN — kompletność", () => {
  it("mają dokładnie te same klucze (brak nieprzetłumaczonych i osieroconych)", () => {
    const onlyPl = [...plFlat.keys()].filter((key) => !enFlat.has(key));
    const onlyEn = [...enFlat.keys()].filter((key) => !plFlat.has(key));
    expect({ onlyPl, onlyEn }).toEqual({ onlyPl: [], onlyEn: [] });
  });

  it("nie zawierają pustych napisów ani tekstów zastępczych (placeholderów, TODO)", () => {
    for (const [name, map] of [
      ["pl", plFlat],
      ["en", enFlat],
    ] as const) {
      for (const [path, value] of map) {
        expect(value.trim(), `${name}:${path} jest pusty`).not.toBe("");
        expect(value, `${name}:${path}`).not.toMatch(/lorem|ipsum|TODO|FIXME|XXX/i);
      }
    }
  });

  it("zachowują te same symbole zastępcze {klucz} w obu językach", () => {
    const placeholders = (text: string): string[] =>
      [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();
    for (const [path, plValue] of plFlat) {
      expect(placeholders(enFlat.get(path) ?? ""), path).toEqual(placeholders(plValue));
    }
  });

  it("zawierają komunikat dla każdego kodu błędu kwoty (parsowanie i reguły kontraktu)", () => {
    const codes = [
      "EMPTY",
      "FORMAT",
      "TOO_MANY_DECIMALS",
      "OVERFLOW",
      "INVALID_AMOUNT",
      "BELOW_MINIMUM",
      "CAP_EXCEEDED",
      "CAP_REACHED",
    ];
    for (const dictionary of [pl, en]) {
      for (const code of codes) expect(dictionary.panel.errors[code], code).toBeTruthy();
    }
  });

  it("opisują każdy stan przepływu płatności (docs/11 §7) oraz każdy krok", () => {
    const states = [
      "review",
      "authorizing",
      "submitted",
      "confirmed",
      "rejected",
      "sponsorship",
      "reverted",
    ] as const;
    for (const dictionary of [pl, en]) {
      for (const state of states) {
        expect(dictionary.checkout.status[state].title, state).toBeTruthy();
        expect(dictionary.checkout.status[state].text, state).toBeTruthy();
        expect(dictionary.checkout.stateLinks[state], state).toBeTruthy();
      }
    }
  });
});

describe("słowniki — uczciwość komunikatów (CLAUDE.md pkt 12, 13)", () => {
  const banned: [RegExp, string][] = [
    [/\bgas\b/i, "żargon „gas” na ścieżce użytkownika"],
    [/\bseed\b/i, "żargon „seed”"],
    [/100\s?%\s*(zweryfik|verified|bezpiecz|safe)/i, "„100% zweryfikowane”"],
    [
      /tylko dzi[śs]|ostatnia szansa|last chance|hurry|pospiesz|odliczanie|countdown/i,
      "fałszywe poczucie pilności",
    ],
    [/gwarantujemy|we guarantee/i, "obietnica gwarancji"],
  ];

  it.each(banned)("żaden napis nie pasuje do %s (%s)", (pattern) => {
    for (const [name, map] of [
      ["pl", plFlat],
      ["en", enFlat],
    ] as const) {
      for (const [path, value] of map) expect(value, `${name}:${path}`).not.toMatch(pattern);
    }
  });

  it("polski interfejs nie używa angielskiego „approve” (zamiast „zatwierdź”)", () => {
    for (const [path, value] of plFlat) expect(value, path).not.toMatch(/\bapprove\b/i);
  });

  it("polski interfejs Beginner nie używa słowa „sieć” poza szczegółami technicznymi (docs/04, zasada językowa)", () => {
    // Dozwolone wyłącznie etykiety szczegółów technicznych: dane portfela Safe organizacji i akordeon „Szczegóły techniczne”.
    const technicalDetails = new Set(["campaign.walletNetwork", "checkout.detailsNetwork"]);
    const offenders = [...plFlat]
      .filter(([path, value]) => !technicalDetails.has(path) && /\bsie[ćc]|sieciow/i.test(value))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("organizacja zweryfikowana jest odróżniona od zweryfikowanego rezultatu", () => {
    expect(pl.proofs.note).toMatch(/nie oznacza/i);
    expect(en.proofs.note).toMatch(/does not mean/i);
  });

  it("każdy stan porażki mówi, że środki są bez zmian", () => {
    for (const state of ["rejected", "sponsorship", "reverted"] as const) {
      expect(pl.checkout.status[state].text, `pl:${state}`).toMatch(/bez zmian|nie zosta[łl]/i);
      expect(en.checkout.status[state].text, `en:${state}`).toMatch(
        /unchanged|nothing was sent|no funds/i,
      );
    }
  });
});

describe("polishTypography", () => {
  const NBSP = " ";

  it.each([
    ["Idę w góry", `Idę w${NBSP}góry`],
    ["a potem i tak", `a${NBSP}potem i${NBSP}tak`],
    ["Kupił o tej porze", `Kupił o${NBSP}tej porze`],
    ["z nim", `z${NBSP}nim`],
    ["Z nim", `Z${NBSP}nim`],
    ["(w domu)", `(w${NBSP}domu)`],
    ["„i potem”", `„i${NBSP}potem”`],
  ])("%j → spacja niełamliwa po jednoliterowym wyrazie", (input, expected) => {
    expect(polishTypography(input)).toBe(expected);
  });

  it.each(["ważne", "dla niej", "kwota 25 USDC", "iPhone", "a", "oazą", "uwaga", "zima"])(
    "nie zmienia %j (brak jednoliterowego wyrazu otoczonego spacjami)",
    (input) => {
      expect(polishTypography(input)).toBe(input);
    },
  );

  it("w słowniku PL po jednoliterowych wyrazach nie ma zwykłej spacji (sierotki)", () => {
    const orphan = /(?:^|[\s(„"])[AaIiOoUuWwZz] (?=\S)/;
    const typeset = getDictionary("pl");
    for (const [path, value] of flatten(typeset)) expect(value, path).not.toMatch(orphan);
  });

  it("słownik EN nie jest przetwarzany polską typografią", () => {
    for (const [path, value] of flatten(getDictionary("en"))) {
      expect(value, path).toBe(enFlat.get(path));
    }
  });

  it("mapStrings zachowuje kształt: obiekty, tablice i wartości niebędące napisami", () => {
    const input = { a: "w x", b: ["i y", { c: "z q" }], n: 5, f: true, nothing: null };
    expect(mapStrings(input, polishTypography)).toEqual({
      a: `w${NBSP}x`,
      b: [`i${NBSP}y`, { c: `z${NBSP}q` }],
      n: 5,
      f: true,
      nothing: null,
    });
  });
});

describe("format i isLocale", () => {
  it("podstawia symbole zastępcze, a brakujące zostawia widoczne", () => {
    expect(format("Wpłacasz {amount} do {org}", { amount: "25,00 USDC", org: "Fundacja" })).toBe(
      "Wpłacasz 25,00 USDC do Fundacja",
    );
    expect(format("{a} i {b}", { a: "x" })).toBe("x i {b}");
  });

  it("rozpoznaje tylko obsługiwane języki", () => {
    expect(locales).toEqual(["pl", "en"]);
    expect(isLocale("pl")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(isLocale("PL")).toBe(false);
    expect(isLocale("")).toBe(false);
  });
});
