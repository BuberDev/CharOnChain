/**
 * Narzędzia WYŁĄCZNIE dla testów integracyjnych bazy (nie trafiają do buildu produkcyjnego).
 * Wymagają TEST_DATABASE_URL (rola z CREATEDB; do tworzenia ról anon/authenticated: CREATEROLE
 * lub role istniejące wcześniej). Brak zmiennej to błąd — niewykonany test nie jest zaliczony.
 */
import { randomBytes } from "node:crypto";

import { Client } from "pg";

export function adminUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error(
      "TEST_DATABASE_URL nie jest ustawione. Testy bazy wymagają lokalnego Postgresa (rola z CREATEDB).",
    );
  }
  return url;
}

export function withDatabase(url: string, database: string): string {
  const copy = new URL(url);
  copy.pathname = `/${database}`;
  return copy.toString();
}

export interface TempDatabase {
  readonly name: string;
  readonly url: string;
  /** Usuwa bazę (wymusza rozłączenie klientów). */
  drop(): Promise<void>;
}

export async function createTempDatabase(): Promise<TempDatabase> {
  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  const name = `cc_test_${randomBytes(6).toString("hex")}`;
  try {
    await admin.query(`create database ${name}`);
  } finally {
    await admin.end();
  }
  return {
    name,
    url: withDatabase(adminUrl(), name),
    async drop() {
      const dropper = new Client({ connectionString: adminUrl() });
      await dropper.connect();
      try {
        await dropper.query(`drop database if exists ${name} with (force)`);
      } finally {
        await dropper.end();
      }
    },
  };
}

/** Role Supabase (klienckie) są klastrowe — tworzymy tylko, jeśli ich nie ma. */
export async function ensureRole(client: Client, role: "anon" | "authenticated"): Promise<void> {
  const exists = await client.query("select 1 from pg_roles where rolname = $1", [role]);
  if (exists.rowCount === 0) await client.query(`create role ${role} nologin`);
}

/**
 * Zrzut obiektów katalogu poza schematem `private` (należy do runnera): schematy, typy (domeny,
 * enumy), funkcje, tabele (z flagą RLS), kolumny, ograniczenia, indeksy, wyzwalacze.
 * Służy do dowodu, że `down` cofa dokładnie to, co zrobiło `up`.
 */
export async function catalogSnapshot(client: Client): Promise<string[]> {
  const result = await client.query<{ line: string }>(`
    select 'schema:' || nspname as line from pg_namespace
      where nspname not like 'pg\\_%' and nspname not in ('information_schema', 'public', 'private')
    union all
    select 'type:' || n.nspname || '.' || t.typname || ':' || t.typtype::text
        || coalesce(':' || (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
                              from pg_enum e where e.enumtypid = t.oid), '')
      from pg_type t join pg_namespace n on n.oid = t.typnamespace
      where n.nspname not like 'pg\\_%' and n.nspname not in ('information_schema', 'private')
        and t.typtype in ('d', 'e')
    union all
    select 'func:' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname not like 'pg\\_%' and n.nspname not in ('information_schema', 'private')
    union all
    select 'table:' || n.nspname || '.' || c.relname || ':rls=' || c.relrowsecurity::text
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p')
        and n.nspname not like 'pg\\_%' and n.nspname not in ('information_schema', 'private')
    union all
    select 'column:' || n.nspname || '.' || c.relname || '.' || a.attname || ':'
        || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':'
        || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attnum > 0 and not a.attisdropped and c.relkind in ('r', 'p')
        and n.nspname not like 'pg\\_%' and n.nspname not in ('information_schema', 'private')
    union all
    select 'constraint:' || n.nspname || '.' || coalesce(c.relname, t.typname) || ':' || con.conname
        || ':' || pg_get_constraintdef(con.oid)
      from pg_constraint con
      join pg_namespace n on n.oid = con.connamespace
      left join pg_class c on c.oid = con.conrelid
      left join pg_type t on t.oid = con.contypid
      where n.nspname not like 'pg\\_%' and n.nspname not in ('information_schema', 'private')
    union all
    select 'index:' || schemaname || '.' || indexname || ':' || indexdef from pg_indexes
      where schemaname not like 'pg\\_%' and schemaname not in ('information_schema', 'private')
    union all
    select 'trigger:' || n.nspname || '.' || c.relname || ':' || tg.tgname
      from pg_trigger tg
      join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where not tg.tgisinternal
        and n.nspname not like 'pg\\_%' and n.nspname not in ('information_schema', 'private')
    order by 1`);
  return result.rows.map((row) => row.line);
}
