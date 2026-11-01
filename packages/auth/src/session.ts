/** Tokeny sesji i ciasteczka (docs/03 §5): w bazie tylko SHA-256 tokenu; cookie HttpOnly/Secure/SameSite=Lax. */
import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE_NAME = "coc_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 3600;

export interface IssuedSessionToken {
  /** Wartość trafiająca WYŁĄCZNIE do ciasteczka HttpOnly; nigdy do logów ani bazy. */
  readonly token: string;
  readonly tokenHash: string;
}

export const hashSessionToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

export function issueSessionToken(): IssuedSessionToken {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashSessionToken(token) };
}

export function sessionCookie(
  token: string,
  options: { maxAgeSeconds?: number; secure?: boolean } = {},
): string {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) throw new RangeError("Niepoprawny format tokenu sesji");
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    `Max-Age=${String(options.maxAgeSeconds ?? SESSION_TTL_SECONDS)}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  // Secure jest domyślne; wyłączenie tylko jawnie (lokalny http://localhost).
  if (options.secure !== false) parts.push("Secure");
  return parts.join("; ");
}

export function clearedSessionCookie(options: { secure?: boolean } = {}): string {
  const parts = [`${SESSION_COOKIE_NAME}=`, "Path=/", "Max-Age=0", "HttpOnly", "SameSite=Lax"];
  if (options.secure !== false) parts.push("Secure");
  return parts.join("; ");
}

/** Wyciąga token z nagłówka Cookie; ignoruje duplikaty (bierze pierwszy) i niepoprawne formaty. */
export function readSessionToken(cookieHeader: string | null | undefined): string | null {
  if (cookieHeader === null || cookieHeader === undefined) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE_NAME) {
      const value = rest.join("=");
      return /^[A-Za-z0-9_-]{20,}$/.test(value) ? value : null;
    }
  }
  return null;
}
