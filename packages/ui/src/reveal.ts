import type { CSSProperties } from "react";

/**
 * Atrybuty odsłaniania części sekcji: kolejność `index` daje przesunięcie 70 ms (tytuł, tekst, obraz).
 * Działa tylko z `RevealInit`; bez JS albo przy `prefers-reduced-motion` treść jest od razu widoczna.
 */
export function reveal(index = 0): { "data-reveal": ""; style: CSSProperties } {
  return { "data-reveal": "", style: { "--i": index } as CSSProperties };
}
