import { describe, expect, it } from "vitest";

import { redactUrl, resolveTarget, UnsafeTargetError } from "./target.js";

const LOCAL = "postgres://user:s3cr3t@localhost:5432/charonchain";
const REMOTE = "postgres://user:s3cr3t@db.example.com:5432/charonchain";

function reason(env: Record<string, string | undefined>): string {
  try {
    resolveTarget(env);
  } catch (error) {
    if (error instanceof UnsafeTargetError) return error.message;
    throw error;
  }
  return "";
}

describe("resolveTarget — local", () => {
  it("domyślnie local; lokalny host dozwolony; down i seed dozwolone", () => {
    const target = resolveTarget({ DATABASE_URL: LOCAL });
    expect(target).toMatchObject({
      appEnv: "local",
      host: "localhost",
      database: "charonchain",
      allowDown: true,
      allowSeed: true,
    });
  });

  it.each(["localhost", "127.0.0.1", "[::1]"])("akceptuje lokalny host %s", (host) => {
    expect(
      resolveTarget({ APP_ENV: "local", DATABASE_URL: `postgres://u:p@${host}:5432/db` }).appEnv,
    ).toBe("local");
  });

  it("akceptuje gniazdo unix (pusty host)", () => {
    expect(
      resolveTarget({ APP_ENV: "local", DATABASE_URL: "postgres:///db?host=/var/run/postgresql" })
        .host,
    ).toBe("");
  });

  it("local ze zdalnym hostem → odmowa", () => {
    expect(reason({ APP_ENV: "local", DATABASE_URL: REMOTE })).toMatch(/nie jest lokalny/);
    expect(reason({ DATABASE_URL: REMOTE })).toMatch(/nie jest lokalny/);
  });
});

describe("resolveTarget — staging", () => {
  it("zdalny host dozwolony; seed i down dozwolone", () => {
    expect(resolveTarget({ APP_ENV: "staging", DATABASE_URL: REMOTE })).toMatchObject({
      appEnv: "staging",
      allowSeed: true,
      allowDown: true,
    });
  });
});

describe("resolveTarget — production", () => {
  it("wymaga jawnego potwierdzenia hosta", () => {
    expect(reason({ APP_ENV: "production", DATABASE_URL: REMOTE })).toMatch(
      /MIGRATE_CONFIRM_PRODUCTION=db\.example\.com/,
    );
    expect(
      reason({
        APP_ENV: "production",
        DATABASE_URL: REMOTE,
        MIGRATE_CONFIRM_PRODUCTION: "inny.example.com",
      }),
    ).toMatch(/MIGRATE_CONFIRM_PRODUCTION/);
  });

  it("po potwierdzeniu: migracje tak, ale seed i down ZABRONIONE", () => {
    const target = resolveTarget({
      APP_ENV: "production",
      DATABASE_URL: REMOTE,
      MIGRATE_CONFIRM_PRODUCTION: "db.example.com",
    });
    expect(target).toMatchObject({ appEnv: "production", allowSeed: false, allowDown: false });
  });

  it("lokalny host przy production → odmowa (prawdopodobna pomyłka)", () => {
    expect(
      reason({
        APP_ENV: "production",
        DATABASE_URL: LOCAL,
        MIGRATE_CONFIRM_PRODUCTION: "localhost",
      }),
    ).toMatch(/pomyłk/);
  });
});

describe("resolveTarget — walidacja wejścia i sekrety", () => {
  it("brak DATABASE_URL", () => {
    expect(reason({})).toMatch(/Brak DATABASE_URL/);
    expect(reason({ DATABASE_URL: "" })).toMatch(/Brak DATABASE_URL/);
  });

  it("nieznane APP_ENV", () => {
    expect(reason({ APP_ENV: "prod", DATABASE_URL: LOCAL })).toMatch(/Nieznane APP_ENV/);
  });

  it("niepoprawny URL lub schemat", () => {
    expect(reason({ DATABASE_URL: "nie-url" })).toMatch(/poprawnym adresem URL/);
    expect(reason({ DATABASE_URL: "mysql://u:p@localhost/db" })).toMatch(/postgres/);
  });

  it("komunikaty błędów nie zawierają hasła", () => {
    const messages = [
      reason({ APP_ENV: "local", DATABASE_URL: REMOTE }),
      reason({ APP_ENV: "production", DATABASE_URL: REMOTE }),
      reason({ DATABASE_URL: "nie-url://s3cr3t" }),
    ];
    for (const message of messages) expect(message).not.toContain("s3cr3t");
  });

  it("redactedUrl maskuje hasło", () => {
    const target = resolveTarget({ DATABASE_URL: LOCAL });
    expect(target.redactedUrl).not.toContain("s3cr3t");
    expect(target.redactedUrl).toContain("***");
    expect(redactUrl(new URL("postgres://u@localhost/db"))).not.toContain("***");
  });
});
