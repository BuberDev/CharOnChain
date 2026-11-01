/**
 * Kanonizacja JSON wg RFC 8785 (JCS) i SHA-256 treści raportu (COC-034; docs/02 §2, docs/03 §2; AC-22, AC-24).
 * `contentSha256 = SHA-256(bajty UTF-8 kanonicznego JSON)` — ten sam wynik w TS i w teście Solidity
 * (`ImpactRegistry.t.sol`, fixture z niezależnym obliczeniem). Solidity NIE parsuje dokumentu.
 *
 * Dane wejściowe są ściśle ograniczone do tego, co JSON potrafi wyrazić jednoznacznie. Wartości, które
 * zmieniłyby treść po cichu (undefined, funkcje, NaN/Infinity, BigInt, Date, klasy, niesparowane surogaty),
 * są ODRZUCANE, a nie „naprawiane": kwoty USDC w raportach muszą być zapisane jako ciągi (CLAUDE.md pkt 7).
 */
import { sha256, stringToBytes, type Hex } from "viem";

export class CanonicalJsonError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "CanonicalJsonError";
  }
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/** Niesparowany surogat UTF-16 nie ma poprawnej reprezentacji UTF-8 (RFC 8785 §3.2.2.2). */
function assertWellFormedString(value: string, path: string): void {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i += 1;
        continue;
      }
      throw new CanonicalJsonError(path, "niesparowany surogat w napisie");
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      throw new CanonicalJsonError(path, "niesparowany surogat w napisie");
    }
  }
}

function serialize(value: unknown, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      assertWellFormedString(value, path);
      // JSON.stringify spełnia JCS dla napisów: tylko wymagane ucieczki, małe litery hex dla \u00XX.
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value))
        throw new CanonicalJsonError(path, "NaN i Infinity są niedozwolone");
      // ECMAScript Number::toString jest wymaganą serializacją JCS; -0 daje "0".
      return JSON.stringify(value);
    case "bigint":
      throw new CanonicalJsonError(
        path,
        "BigInt jest niedozwolony — zapisz kwotę jako ciąg dziesiętny",
      );
    case "undefined":
    case "function":
    case "symbol":
      throw new CanonicalJsonError(path, `typ ${typeof value} nie jest wartością JSON`);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item, index) => serialize(item, `${path}[${String(index)}]`)).join(",")}]`;
      }
      if (!isPlainObject(value)) {
        throw new CanonicalJsonError(
          path,
          "dozwolone są tylko zwykłe obiekty (nie Date, Map, klasy)",
        );
      }
      const record = value as Record<string, unknown>;
      // Klucze sortowane według jednostek kodu UTF-16 (domyślne porównanie napisów w JS) — RFC 8785 §3.2.3.
      const keys = Object.keys(record).sort();
      const members = keys.map((key) => {
        assertWellFormedString(key, `${path}.${key}`);
        return `${JSON.stringify(key)}:${serialize(record[key], `${path}.${key}`)}`;
      });
      return `{${members.join(",")}}`;
    }
    default:
      throw new CanonicalJsonError(path, "nieznany typ wartości");
  }
}

/** Kanoniczny zapis JSON (RFC 8785) jako napis. */
export function canonicalize(value: unknown): string {
  return serialize(value, "$");
}

/** Kanoniczne bajty UTF-8 — to je hashujemy i publikujemy. */
export function canonicalBytes(value: unknown): Uint8Array {
  return stringToBytes(canonicalize(value));
}

/** `contentSha256`: SHA-256 kanonicznych bajtów, jako 0x + 64 znaki hex (małe litery). */
export function contentSha256(value: unknown): Hex {
  return sha256(canonicalBytes(value));
}
