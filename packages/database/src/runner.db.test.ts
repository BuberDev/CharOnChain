/**
 * Testy integracyjne runnera na PRAWDZIWYM Postgresie (COC-004).
 * Wymagają TEST_DATABASE_URL (rola z CREATEDB). Brak zmiennej = BŁĄD, nie pominięcie:
 * niewykonany test nie jest zaliczonym testem.
 * Każdy plik testowy działa na własnej, tymczasowej bazie, usuwanej na końcu.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadMigrations, type Migration } from "./migrations.js";
import { catalogSnapshot } from "./testing/db.js";
import {
  findTablesWithoutRls,
  getStatus,
  migrateDown,
  migrateUp,
  MigrationFailedError,
  MigrationIntegrityError,
  runSeeds,
} from "./runner.js";

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

let dbName = "";
let dbUrl = "";
const clients: Client[] = [];
const tempDirs: string[] = [];

function withDatabase(adminUrl: string, database: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

async function connect(): Promise<Client> {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  clients.push(client);
  return client;
}

function migrationsDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "coc-db-test-"));
  tempDirs.push(dir);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

beforeAll(async () => {
  if (ADMIN_URL === undefined || ADMIN_URL === "") {
    throw new Error(
      "TEST_DATABASE_URL nie jest ustawione. Testy bazy wymagają lokalnego Postgresa (rola z CREATEDB).",
    );
  }
  dbName = `cc_test_${randomBytes(6).toString("hex")}`;
  dbUrl = withDatabase(ADMIN_URL, dbName);
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`create database ${dbName}`);
  } finally {
    await admin.end();
  }
});

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end().catch(() => undefined)));
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  if (ADMIN_URL === undefined || ADMIN_URL === "" || dbName === "") return;
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${dbName} with (force)`);
  } finally {
    await admin.end();
  }
});

describe("migracje: up, status, idempotencja", () => {
  it("stosuje bazową migrację, zapisuje sumę kontrolną i jest idempotentna", async () => {
    const migrations = loadMigrations(MIGRATIONS_DIR);
    const client = await connect();

    expect(await getStatus(client, migrations)).toEqual(
      migrations.map((m) => ({ version: m.version, name: m.name, state: "pending" })),
    );

    const applied = await migrateUp(client, migrations);
    expect(applied).toEqual(migrations.map((m) => m.version));

    const rows = await client.query<{ version: number; name: string; checksum: string }>(
      "select version, name, checksum from private.schema_migrations order by version",
    );
    expect(rows.rows).toEqual(
      migrations.map((m) => ({ version: m.version, name: m.name, checksum: m.checksum })),
    );

    expect(await migrateUp(client, migrations)).toEqual([]);
    expect((await getStatus(client, migrations)).every((s) => s.state === "applied")).toBe(true);
  });
});

describe("rollback — test z dokumentacji COC-004", () => {
  it("up → down → up daje identyczny stan katalogu (zrzut przed/po)", async () => {
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    const name = `cc_test_${randomBytes(6).toString("hex")}`;
    await admin.query(`create database ${name}`);
    const client = new Client({ connectionString: withDatabase(ADMIN_URL ?? "", name) });
    await client.connect();
    try {
      const migrations = loadMigrations(MIGRATIONS_DIR);
      const empty = await catalogSnapshot(client);
      expect(empty).toEqual([]);

      await migrateUp(client, migrations);
      const afterUp = await catalogSnapshot(client);
      expect(afterUp.length).toBeGreaterThan(0);

      const reverted = await migrateDown(client, migrations, migrations.length);
      expect(reverted).toEqual(migrations.map((m) => m.version).reverse());
      expect(await catalogSnapshot(client)).toEqual(empty);
      expect(
        (await client.query("select count(*)::int as n from private.schema_migrations")).rows[0],
      ).toEqual({ n: 0 });

      await migrateUp(client, migrations);
      expect(await catalogSnapshot(client)).toEqual(afterUp);
    } finally {
      await client.end();
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
    }
  });

  it("odrzuca nieprawidłową liczbę kroków", async () => {
    const client = await connect();
    const migrations = loadMigrations(MIGRATIONS_DIR);
    await expect(migrateDown(client, migrations, 0)).rejects.toThrow(RangeError);
    await expect(migrateDown(client, migrations, 1.5)).rejects.toThrow(RangeError);
  });
});

describe("integralność zastosowanych migracji", () => {
  it("wykrywa zmianę zastosowanej migracji (suma kontrolna)", async () => {
    const client = await connect();
    const migrations = loadMigrations(MIGRATIONS_DIR);
    await migrateUp(client, migrations);
    const tampered: Migration[] = migrations.map((m) => ({ ...m, checksum: "0".repeat(64) }));
    await expect(migrateUp(client, tampered)).rejects.toThrow(MigrationIntegrityError);
    await expect(migrateUp(client, tampered)).rejects.toThrow(/zmieniona po zastosowaniu/);
  });

  it("wykrywa zastosowaną migrację bez plików", async () => {
    const client = await connect();
    await expect(migrateUp(client, [])).rejects.toThrow(/nie ma jej plików/);
  });
});

describe("atomowość i równoległość", () => {
  it("błąd w migracji cofa całą migrację i nie zapisuje wersji", async () => {
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    const name = `cc_test_${randomBytes(6).toString("hex")}`;
    await admin.query(`create database ${name}`);
    const client = new Client({ connectionString: withDatabase(ADMIN_URL ?? "", name) });
    await client.connect();
    try {
      const dir = migrationsDir({
        "0001_ok.up.sql": "create schema ok_schema;",
        "0001_ok.down.sql": "drop schema ok_schema;",
        "0002_boom.up.sql": "create schema half_done; select 1/0;",
        "0002_boom.down.sql": "drop schema half_done;",
      });
      const migrations = loadMigrations(dir);
      await expect(migrateUp(client, migrations)).rejects.toThrow(MigrationFailedError);

      const schemas = await client.query<{ nspname: string }>(
        "select nspname from pg_namespace where nspname in ('ok_schema', 'half_done') order by 1",
      );
      expect(schemas.rows.map((r) => r.nspname)).toEqual(["ok_schema"]);
      const versions = await client.query<{ version: number }>(
        "select version from private.schema_migrations order by 1",
      );
      expect(versions.rows.map((r) => r.version)).toEqual([1]);
    } finally {
      await client.end();
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
    }
  });

  it("dwa równoległe uruchomienia nie zastosują migracji dwa razy (blokada doradcza)", async () => {
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    const name = `cc_test_${randomBytes(6).toString("hex")}`;
    await admin.query(`create database ${name}`);
    const url = withDatabase(ADMIN_URL ?? "", name);
    const a = new Client({ connectionString: url });
    const b = new Client({ connectionString: url });
    await Promise.all([a.connect(), b.connect()]);
    try {
      const migrations = loadMigrations(MIGRATIONS_DIR);
      const [first, second] = await Promise.all([
        migrateUp(a, migrations),
        migrateUp(b, migrations),
      ]);
      expect(first.length + second.length).toBe(migrations.length);
      const count = await a.query<{ n: number }>(
        "select count(*)::int as n from private.schema_migrations",
      );
      expect(count.rows[0]?.n).toBe(migrations.length);
    } finally {
      await Promise.all([a.end(), b.end()]);
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
    }
  });
});

describe("migracja bazowa: domeny i funkcje (docs/03 §1)", () => {
  it("app.evm_address: tylko 0x + 40 znaków hex małymi literami", async () => {
    const client = await connect();
    await migrateUp(client, loadMigrations(MIGRATIONS_DIR));
    const lower = `0x${"ab12".repeat(10)}`;
    const ok = await client.query<{ a: string }>("select $1::app.evm_address as a", [lower]);
    expect(ok.rows[0]?.a).toBe(lower);
    for (const bad of [
      lower.toUpperCase().replace("0X", "0x"),
      `0x${"a".repeat(39)}`,
      "abc",
      `0x${"g".repeat(40)}`,
      "",
    ]) {
      await expect(client.query("select $1::app.evm_address", [bad])).rejects.toThrow(
        /violates check constraint/,
      );
    }
  });

  it("app.hash32: 0x + 64 znaki hex małymi literami", async () => {
    const client = await connect();
    const good = `0x${"0f".repeat(32)}`;
    expect(
      (await client.query<{ h: string }>("select $1::app.hash32 as h", [good])).rows[0]?.h,
    ).toBe(good);
    for (const bad of [`0x${"0F".repeat(32)}`, `0x${"0f".repeat(31)}`, "0x"]) {
      await expect(client.query("select $1::app.hash32", [bad])).rejects.toThrow(
        /violates check constraint|value too long|string/,
      );
    }
  });

  it("app.usdc_raw: 0..uint256, bez ujemnych i bez przekroczenia zakresu", async () => {
    const client = await connect();
    const max = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    const over = "115792089237316195423570985008687907853269984665640564039457584007913129639936";
    for (const good of ["0", "1", "1000000", max]) {
      const r = await client.query<{ v: string }>("select $1::app.usdc_raw::text as v", [good]);
      expect(r.rows[0]?.v).toBe(good);
    }
    for (const bad of ["-1", over]) {
      await expect(client.query("select $1::app.usdc_raw", [bad])).rejects.toThrow(
        /violates check constraint|numeric field overflow/,
      );
    }
  });

  it("app.touch_updated_at aktualizuje updated_at przy UPDATE", async () => {
    const client = await connect();
    await client.query(`
      create temp table touch_probe (id int primary key, updated_at timestamptz not null);
      create trigger touch before update on touch_probe
        for each row execute function app.touch_updated_at();
      insert into touch_probe values (1, '2000-01-01T00:00:00Z');
    `);
    await client.query("update touch_probe set id = id where id = 1");
    const r = await client.query<{ fresh: boolean }>(
      "select updated_at > now() - interval '1 minute' as fresh from touch_probe where id = 1",
    );
    expect(r.rows[0]?.fresh).toBe(true);
  });
});

describe("RLS deny-by-default (docs/03 §3)", () => {
  it("tabela migracji ma włączone RLS, a lint wykrywa tabele bez RLS", async () => {
    const client = await connect();
    await migrateUp(client, loadMigrations(MIGRATIONS_DIR));
    const schemas = ["public", "app", "private"];
    expect(await findTablesWithoutRls(client, schemas)).toEqual([]);

    await client.query("create table public.rls_probe (id int)");
    expect(await findTablesWithoutRls(client, schemas)).toEqual(["public.rls_probe"]);
    await client.query("alter table public.rls_probe enable row level security");
    expect(await findTablesWithoutRls(client, schemas)).toEqual([]);
    await client.query("drop table public.rls_probe");
  });
});

describe("seed", () => {
  it("wykonuje pliki alfabetycznie w jednej transakcji; błąd cofa całość", async () => {
    const client = await connect();
    const good = migrationsDir({
      "02_b.sql": "insert into seed_probe values ('b');",
      "01_a.sql": "create temp table seed_probe (v text); insert into seed_probe values ('a');",
    });
    expect(await runSeeds(client, good)).toEqual(["01_a.sql", "02_b.sql"]);
    const rows = await client.query<{ v: string }>("select v from seed_probe order by v");
    expect(rows.rows.map((r) => r.v)).toEqual(["a", "b"]);

    const bad = migrationsDir({
      "01_a.sql": "create temp table seed_rollback (v int); insert into seed_rollback values (1);",
      "02_b.sql": "select 1/0;",
    });
    await expect(runSeeds(client, bad)).rejects.toThrow(/division by zero/);
    await expect(client.query("select * from seed_rollback")).rejects.toThrow(/does not exist/);

    expect(await runSeeds(client, migrationsDir({ "README.md": "x" }))).toEqual([]);
  });
});
