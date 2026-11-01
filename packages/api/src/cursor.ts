/**
 * Kursory stronicowania keyset (stabilne przy równoległych wpisach, bez OFFSET). Kursor jest nieprzejrzystym
 * base64url JSON `{t, i}`: znacznik czasu w mikrosekundach (tekst z bazy — bez utraty precyzji JS Date) i UUID.
 * Zmanipulowany kursor → 400, nigdy błąd SQL.
 */
import { ApiError } from "./http.js";

const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface Cursor {
  readonly t: string;
  readonly i: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.t, i: cursor.i }), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): Cursor {
  const invalid = new ApiError(400, "INVALID_CURSOR", "Nieprawidłowy kursor stronicowania.");
  if (raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw invalid;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw invalid;
  }
  if (typeof parsed !== "object" || parsed === null) throw invalid;
  const { t, i } = parsed as Record<string, unknown>;
  if (typeof t !== "string" || typeof i !== "string" || !TS.test(t) || !UUID.test(i)) throw invalid;
  return { t, i };
}
