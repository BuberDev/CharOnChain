/**
 * CLI migracji: `node dist/cli.js <up|down [n]|status|seed>`.
 * Konfiguracja wyłącznie ze zmiennych środowiskowych (DATABASE_URL, APP_ENV, ...). Nigdy nie
 * drukuje haseł. Odmawia niebezpiecznych kombinacji (patrz target.ts).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

import { loadMigrations } from "./migrations.js";
import { getStatus, migrateDown, migrateUp, runSeeds } from "./runner.js";
import { resolveTarget, UnsafeTargetError } from "./target.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, arg] = argv;
  if (command === undefined || !["up", "down", "status", "seed"].includes(command)) {
    print("Użycie: migrate <up | down [n] | status | seed>");
    return 2;
  }

  const target = resolveTarget(process.env);
  if (command === "down" && !target.allowDown) {
    throw new UnsafeTargetError("Cofanie migracji jest zabronione w tym środowisku.");
  }
  if (command === "seed" && !target.allowSeed) {
    throw new UnsafeTargetError("Seedowanie jest zabronione w tym środowisku.");
  }

  const migrations = loadMigrations(join(PACKAGE_ROOT, "migrations"));
  print(`Cel: ${target.redactedUrl} (APP_ENV=${target.appEnv})`);

  const client = new Client({ connectionString: target.url });
  await client.connect();
  try {
    if (command === "up") {
      const done = await migrateUp(client, migrations);
      print(done.length === 0 ? "Brak oczekujących migracji." : `Zastosowano: ${done.join(", ")}`);
    } else if (command === "down") {
      const steps = arg === undefined ? 1 : Number(arg);
      const reverted = await migrateDown(client, migrations, steps);
      print(`Cofnięto: ${reverted.join(", ") || "(nic)"}`);
    } else if (command === "status") {
      for (const row of await getStatus(client, migrations)) {
        print(`${String(row.version).padStart(4, "0")}_${row.name}\t${row.state}`);
      }
    } else {
      const files = await runSeeds(client, join(PACKAGE_ROOT, "seed"));
      print(files.length === 0 ? "Brak plików seed." : `Seed: ${files.join(", ")}`);
    }
  } finally {
    await client.end();
  }
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`BŁĄD: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
