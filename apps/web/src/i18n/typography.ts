/**
 * Polska typografia: jednoliterowe wyrazy (a, i, o, u, w, z) nie zostają na końcu wiersza — po nich
 * wstawiamy twardą spację. Stosowane raz, na poziomie słownika PL (nie w komponentach).
 */
const ORPHAN = /(?<=(?:^|[\s(„"])[AaIiOoUuWwZz])\s+/g;

export function polishTypography(value: string): string {
  return value.replace(ORPHAN, " ");
}

/** Głębokie mapowanie wszystkich napisów w strukturze (obiekty, tablice), z zachowaniem kształtu. */
export function mapStrings<T>(input: T, fn: (value: string) => string): T {
  if (typeof input === "string") return fn(input) as unknown as T;
  if (Array.isArray(input)) {
    return input.map((item: unknown) => mapStrings(item, fn)) as unknown as T;
  }
  if (typeof input === "object" && input !== null) {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) output[key] = mapStrings(value, fn);
    return output as T;
  }
  return input;
}
