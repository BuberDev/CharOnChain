import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { checksumOf, loadMigrations, MigrationFilesError } from "./migrations.js";

const REAL_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const created: string[] = [];
function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "coc-migrations-"));
  created.push(dir);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function problemsOf(dir: string): string {
  try {
    loadMigrations(dir);
  } catch (error) {
    if (error instanceof MigrationFilesError) return error.problems.join("\n");
    throw error;
  }
  return "";
}

describe("loadMigrations — migracje z repozytorium", () => {
  it("ładuje poprawny zestaw z parami up/down i ciągłą numeracją", () => {
    const migrations = loadMigrations(REAL_DIR);
    expect(migrations.length).toBeGreaterThanOrEqual(1);
    migrations.forEach((m, i) => {
      expect(m.version).toBe(i + 1);
      expect(m.upSql.trim()).not.toBe("");
      expect(m.downSql.trim()).not.toBe("");
      expect(m.checksum).toMatch(/^[0-9a-f]{64}$/);
    });
    expect(migrations[0]?.name).toBe("baseline");
  });
});

describe("loadMigrations — walidacja", () => {
  const ok = {
    "0001_a.up.sql": "select 1;",
    "0001_a.down.sql": "select 1;",
  };

  it("przyjmuje minimalny poprawny zestaw", () => {
    expect(loadMigrations(fixture(ok))).toHaveLength(1);
  });

  it("wykrywa lukę w numeracji", () => {
    const dir = fixture({
      ...ok,
      "0003_c.up.sql": "select 1;",
      "0003_c.down.sql": "select 1;",
    });
    expect(problemsOf(dir)).toMatch(/ciągła/);
  });

  it("wymaga pliku .down.sql", () => {
    expect(problemsOf(fixture({ "0001_a.up.sql": "select 1;" }))).toMatch(/brak pliku \.down\.sql/);
  });

  it("wymaga pliku .up.sql", () => {
    expect(problemsOf(fixture({ "0001_a.down.sql": "select 1;" }))).toMatch(/brak pliku \.up\.sql/);
  });

  it.each(["1_a.up.sql", "0001_A.up.sql", "0001-a.up.sql", "0001_a.sql", "0001_a.UP.sql"])(
    "odrzuca niepoprawną nazwę %s",
    (name) => {
      expect(problemsOf(fixture({ ...ok, [name]: "select 1;" }))).toMatch(/Niepoprawna nazwa/);
    },
  );

  it("odrzuca różne nazwy w parze up/down", () => {
    const dir = fixture({ "0001_a.up.sql": "select 1;", "0001_b.down.sql": "select 1;" });
    expect(problemsOf(dir)).toMatch(/różne nazwy/);
  });

  it("odrzuca pusty plik", () => {
    expect(problemsOf(fixture({ ...ok, "0001_a.up.sql": "  \n" }))).toMatch(/Pusty plik/);
  });

  it.each([
    "begin;",
    "BEGIN;",
    "begin transaction;",
    "BEGIN WORK;",
    "begin isolation level serializable;",
    "begin read only;",
    "commit;",
    "COMMIT TRANSACTION;",
    "commit and chain;",
    "rollback;",
    "rollback work;",
    "start transaction;",
    "  start transaction isolation level repeatable read;",
  ])("odrzuca sterowanie transakcją (%s) — runner zarządza transakcją", (statement) => {
    const dir = fixture({ ...ok, "0001_a.up.sql": `select 1;\n${statement}\nselect 2;` });
    expect(problemsOf(dir)).toMatch(/BEGIN\/COMMIT\/ROLLBACK/);
  });

  it("akceptuje blok BEGIN … END w ciele funkcji PL/pgSQL (to nie jest sterowanie transakcją)", () => {
    const body = [
      "create function f() returns trigger language plpgsql as $$",
      "begin",
      "  new.updated_at := now();",
      "  return new;",
      "end;",
      "$$;",
    ].join("\n");
    expect(problemsOf(fixture({ ...ok, "0001_a.up.sql": body }))).toBe("");
    const compact =
      "create function g() returns int language plpgsql as $$\nbegin return 1; end $$;";
    expect(problemsOf(fixture({ ...ok, "0001_a.up.sql": compact }))).toBe("");
  });

  it("ignoruje pliki nie-SQL, a zgłasza wiele problemów naraz", () => {
    const dir = fixture({ "README.md": "x", "bad.sql": "x", "0002_b.up.sql": "select 1;" });
    const problems = problemsOf(dir);
    expect(problems).toMatch(/Niepoprawna nazwa pliku: bad\.sql/);
    expect(problems).toMatch(/ciągła/);
    expect(problems).not.toMatch(/README/);
  });
});

describe("checksumOf", () => {
  it("jest niezależna od końców linii (CRLF == LF)", () => {
    expect(checksumOf("a\r\nb\r\n")).toBe(checksumOf("a\nb\n"));
  });

  it("zmienia się przy zmianie treści", () => {
    expect(checksumOf("select 1;")).not.toBe(checksumOf("select 2;"));
  });
});
