/**
 * Runner migracji Postgres (COC-004).
 *
 *  - jedna blokada doradcza (pg_advisory_lock) — równoległe uruchomienia są bezpieczne,
 *  - każda migracja w osobnej transakcji (atomowo: błąd cofa zmiany i nie zapisuje wersji),
 *  - sumy kontrolne zastosowanych migracji: modyfikacja zastosowanego pliku jest wykrywana,
 *  - cofanie (down) wyłącznie dla ostatnich N migracji, w odwrotnej kolejności.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ClientBase } from "pg";

import type { Migration } from "./migrations.js";

/** Stały klucz blokady doradczej CharOnChain (dowolna stała 64-bit). */
const ADVISORY_LOCK_KEY = "7283001";

export class MigrationIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationIntegrityError";
  }
}

export class MigrationFailedError extends Error {
  readonly version: number;
  constructor(migration: Pick<Migration, "version" | "name">, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Migracja ${String(migration.version)}_${migration.name} nie powiodła się: ${reason}`, {
      cause,
    });
    this.name = "MigrationFailedError";
    this.version = migration.version;
  }
}

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
}

export interface MigrationStatus {
  readonly version: number;
  readonly name: string;
  readonly state: "applied" | "pending";
}

async function withLock<T>(client: ClientBase, fn: () => Promise<T>): Promise<T> {
  await client.query("select pg_advisory_lock($1::bigint)", [ADVISORY_LOCK_KEY]);
  try {
    return await fn();
  } finally {
    await client.query("select pg_advisory_unlock($1::bigint)", [ADVISORY_LOCK_KEY]);
  }
}

/** Tabela migracji jest własnością runnera, w schemacie `private`, z włączonym RLS (deny-by-default). */
async function ensureMigrationTable(client: ClientBase): Promise<void> {
  await client.query(`
    create schema if not exists private;
    create table if not exists private.schema_migrations (
      version    integer primary key check (version > 0),
      name       text not null,
      checksum   text not null,
      applied_at timestamptz not null default now()
    );
    alter table private.schema_migrations enable row level security;
  `);
}

async function readApplied(client: ClientBase): Promise<AppliedMigration[]> {
  const result = await client.query<AppliedMigration>(
    "select version, name, checksum from private.schema_migrations order by version",
  );
  return result.rows;
}

/** Zastosowane migracje muszą tworzyć prefiks 1..k i zgadzać się z plikami (nazwa + suma kontrolna). */
function verifyApplied(applied: readonly AppliedMigration[], local: readonly Migration[]): void {
  applied.forEach((row, index) => {
    if (row.version !== index + 1) {
      throw new MigrationIntegrityError(
        `Zastosowane migracje nie tworzą ciągłego prefiksu (oczekiwano ${String(index + 1)}, jest ${String(row.version)}).`,
      );
    }
    const file = local.find((m) => m.version === row.version);
    if (file === undefined) {
      throw new MigrationIntegrityError(
        `Migracja ${String(row.version)}_${row.name} jest zastosowana w bazie, ale nie ma jej plików.`,
      );
    }
    if (file.name !== row.name || file.checksum !== row.checksum) {
      throw new MigrationIntegrityError(
        `Migracja ${String(row.version)}_${row.name} została zmieniona po zastosowaniu (niezgodna suma kontrolna). Dodaj nową migrację zamiast edytować starą.`,
      );
    }
  });
}

export async function getStatus(
  client: ClientBase,
  migrations: readonly Migration[],
): Promise<MigrationStatus[]> {
  return withLock(client, async () => {
    await ensureMigrationTable(client);
    const applied = await readApplied(client);
    verifyApplied(applied, migrations);
    const appliedVersions = new Set(applied.map((row) => row.version));
    return migrations.map((m) => ({
      version: m.version,
      name: m.name,
      state: appliedVersions.has(m.version) ? ("applied" as const) : ("pending" as const),
    }));
  });
}

/** Stosuje oczekujące migracje; zwraca listę zastosowanych wersji. */
export async function migrateUp(
  client: ClientBase,
  migrations: readonly Migration[],
): Promise<number[]> {
  return withLock(client, async () => {
    await ensureMigrationTable(client);
    const applied = await readApplied(client);
    verifyApplied(applied, migrations);
    const lastApplied = applied.at(-1)?.version ?? 0;

    const done: number[] = [];
    for (const migration of migrations.filter((m) => m.version > lastApplied)) {
      await client.query("begin");
      try {
        await client.query(migration.upSql);
        await client.query(
          "insert into private.schema_migrations (version, name, checksum) values ($1, $2, $3)",
          [migration.version, migration.name, migration.checksum],
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw new MigrationFailedError(migration, error);
      }
      done.push(migration.version);
    }
    return done;
  });
}

/** Cofa ostatnie `steps` zastosowanych migracji (domyślnie 1); zwraca cofnięte wersje. */
export async function migrateDown(
  client: ClientBase,
  migrations: readonly Migration[],
  steps = 1,
): Promise<number[]> {
  if (!Number.isInteger(steps) || steps < 1)
    throw new RangeError("steps musi być liczbą całkowitą >= 1");
  return withLock(client, async () => {
    await ensureMigrationTable(client);
    const applied = await readApplied(client);
    verifyApplied(applied, migrations);

    const reverted: number[] = [];
    for (const row of applied.slice(-steps).reverse()) {
      const migration = migrations.find((m) => m.version === row.version);
      if (migration === undefined)
        throw new MigrationIntegrityError("Brak pliku migracji do cofnięcia.");
      await client.query("begin");
      try {
        await client.query(migration.downSql);
        await client.query("delete from private.schema_migrations where version = $1", [
          row.version,
        ]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw new MigrationFailedError(migration, error);
      }
      reverted.push(row.version);
    }
    return reverted;
  });
}

/** Wykonuje pliki seed/*.sql (alfabetycznie) w jednej transakcji. Zwraca nazwy wykonanych plików. */
export async function runSeeds(client: ClientBase, dir: string): Promise<string[]> {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) return [];
  await client.query("begin");
  try {
    for (const file of files) await client.query(readFileSync(join(dir, file), "utf8"));
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
  return files;
}

/**
 * Lista tabel bez włączonego RLS w podanych schematach (docs/03 §3: deny-by-default).
 * Używana w testach: każda nowa tabela w schemacie wystawianym lub wspólnym musi mieć RLS.
 */
export async function findTablesWithoutRls(
  client: ClientBase,
  schemas: readonly string[],
): Promise<string[]> {
  const result = await client.query<{ name: string }>(
    `select n.nspname || '.' || c.relname as name
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p')
        and n.nspname = any($1::text[])
        and not c.relrowsecurity
      order by 1`,
    [schemas],
  );
  return result.rows.map((row) => row.name);
}
