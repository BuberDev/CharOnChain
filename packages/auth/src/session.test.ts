import { describe, expect, it } from "vitest";

import {
  SESSION_COOKIE_NAME,
  clearedSessionCookie,
  hashSessionToken,
  issueSessionToken,
  readSessionToken,
  sessionCookie,
} from "./session";

describe("token sesji", () => {
  it("ma 256 bitów entropii, jest unikalny, a hash to SHA-256 hex", () => {
    const a = issueSessionToken();
    const b = issueSessionToken();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.tokenHash).toBe(hashSessionToken(a.token));
  });
});

describe("ciasteczko", () => {
  const { token } = issueSessionToken();

  it("ma HttpOnly, Secure, SameSite=Lax i Max-Age; Secure wyłączalne tylko jawnie", () => {
    const cookie = sessionCookie(token);
    for (const attr of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=604800"])
      expect(cookie).toContain(attr);
    expect(sessionCookie(token, { secure: false })).not.toContain("Secure");
    expect(sessionCookie(token, { maxAgeSeconds: 60 })).toContain("Max-Age=60");
  });

  it("odmawia tokenu o niepoprawnym formacie (wstrzyknięcie atrybutów)", () => {
    expect(() => sessionCookie("x; Domain=evil.com")).toThrow(RangeError);
    expect(() => sessionCookie("krótki")).toThrow(RangeError);
  });

  it("wylogowanie czyści ciasteczko (Max-Age=0)", () => {
    expect(clearedSessionCookie()).toContain("Max-Age=0");
    expect(clearedSessionCookie()).toContain("HttpOnly");
  });

  it("odczyt tokenu z nagłówka Cookie", () => {
    expect(readSessionToken(`a=b; ${SESSION_COOKIE_NAME}=${token}; c=d`)).toBe(token);
    expect(readSessionToken(`${SESSION_COOKIE_NAME}=za-krotki`)).toBeNull();
    expect(readSessionToken("a=b")).toBeNull();
    expect(readSessionToken(null)).toBeNull();
    expect(readSessionToken(`${SESSION_COOKIE_NAME}=${token}; ${SESSION_COOKIE_NAME}=inny`)).toBe(
      token,
    );
  });
});
