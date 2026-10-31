/**
 * Ładowanie i walidacja plików migracji (COC-004).
 *
 * Konwencja: `NNNN_nazwa.up.sql` + `NNNN_nazwa.down.sql`, numery ciągłe od 0001.
 * Każda migracja ma parę up/down (potrzebną do testu rollbacku). Runner sam otwiera transakcję,
 * więc pliki NIE mogą zawierać BEGIN/COMMIT/ROLLBACK. Instrukcji niedozwolonych w transakcji
 * (np. CREATE INDEX CONCURRENTLY) nie używamy w tym runnerze.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly upSql: string;
  readonly downSql: string;
  /** SHA-256 pliku up (z normalizacją końców linii). Zapisywany w bazie przy aplikowaniu. */
  readonly checksum: string;
}

export class MigrationFilesError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`Niepoprawne pliki migracji:\n- ${problems.join("\n- ")}`);
    this.name = "MigrationFilesError";
    this.problems = problems;
  }
}

const FILE_NAME = /^(\d{4})_([a-z][a-z0-9_]*)\.(up|down)\.sql$/;
// Sterowanie transakcją na początku linii. `begin` w ciele funkcji PL/pgSQL (bez średnika po
// słowie kluczowym) NIE jest sterowaniem transakcją i musi przechodzić walidację.
const TRANSACTION_CONTROL = [
  /^\s*begin(?:\s+(?:transaction|work))?(?:\s+isolation\s+level\s+[a-z ]+?)?(?:\s+read\s+(?:only|write))?(?:\s+(?:not\s+)?deferrable)?\s*;/im,
  /^\s*(?:commit|rollback)(?:\s+(?:transaction|work))?(?:\s+and\s+(?:no\s+)?chain)?\s*;/im,
  /^\s*start\s+transaction\b/im,
];

export function checksumOf(sql: string): string {
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

interface Group {
  name: string;
  up?: string;
  down?: string;
}

/** Wczytuje migracje z katalogu; rzuca `MigrationFilesError` z pełną listą problemów. */
export function loadMigrations(dir: string): Migration[] {
  const problems: string[] = [];
  const groups = new Map<number, Group>();

  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".sql")) continue;
    const match = FILE_NAME.exec(file);
    if (!match) {
      problems.push(`Niepoprawna nazwa pliku: ${file} (oczekiwano NNNN_nazwa.up.sql / .down.sql)`);
      continue;
    }
    const version = Number(match[1]);
    const name = match[2] ?? "";
    const direction = match[3] === "up" ? "up" : "down";
    const sql = readFileSync(join(dir, file), "utf8");

    if (sql.trim() === "") problems.push(`Pusty plik: ${file}`);
    if (TRANSACTION_CONTROL.some((pattern) => pattern.test(sql))) {
      problems.push(`${file}: BEGIN/COMMIT/ROLLBACK niedozwolone — runner zarządza transakcją`);
    }

    const group = groups.get(version) ?? { name };
    if (group.name !== name) {
      problems.push(`Wersja ${String(version)}: różne nazwy plików (${group.name} / ${name})`);
    }
    if (group[direction] !== undefined) problems.push(`Zduplikowany plik: ${file}`);
    group[direction] = sql;
    groups.set(version, group);
  }

  const versions = [...groups.keys()].sort((a, b) => a - b);
  versions.forEach((version, index) => {
    if (version !== index + 1) {
      problems.push(`Numeracja musi być ciągła od 0001; brakuje ${String(index + 1)}`);
    }
  });

  const migrations: Migration[] = [];
  for (const version of versions) {
    const group = groups.get(version);
    if (group === undefined) continue;
    if (group.up === undefined) problems.push(`Wersja ${String(version)}: brak pliku .up.sql`);
    if (group.down === undefined) problems.push(`Wersja ${String(version)}: brak pliku .down.sql`);
    if (group.up !== undefined && group.down !== undefined) {
      migrations.push({
        version,
        name: group.name,
        upSql: group.up,
        downSql: group.down,
        checksum: checksumOf(group.up),
      });
    }
  }

  if (problems.length > 0) throw new MigrationFilesError([...new Set(problems)]);
  return migrations;
}
