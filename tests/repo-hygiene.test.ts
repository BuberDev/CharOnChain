import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

function trackedFiles(): string[] {
  // Pliki usunięte w katalogu roboczym, a jeszcze niezacommitowane, nie istnieją na dysku.
  return git("ls-files", "-z")
    .split("\0")
    .filter((f) => f.length > 0 && existsSync(join(ROOT, f)));
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const WORKSPACES = [
  "package.json",
  "apps/web/package.json",
  "apps/admin/package.json",
  "apps/indexer/package.json",
  "packages/contracts/package.json",
  "packages/database/package.json",
  "packages/ui/package.json",
  "packages/shared/package.json",
];

function parsePackage(rel: string): PackageJson {
  return JSON.parse(read(rel)) as PackageJson;
}

function dependencyEntries(pkg: PackageJson): [string, string][] {
  return [
    ...Object.entries(pkg.dependencies ?? {}),
    ...Object.entries(pkg.devDependencies ?? {}),
    ...Object.entries(pkg.optionalDependencies ?? {}),
  ];
}

describe("układ monorepo (COC-001)", () => {
  it("zawiera wszystkie wymagane aplikacje i pakiety", () => {
    for (const rel of WORKSPACES) {
      expect(existsSync(join(ROOT, rel)), `${rel} musi istnieć`).toBe(true);
    }
    const names = WORKSPACES.slice(1).map((rel) => parsePackage(rel).name);
    expect(names).toEqual([
      "@charonchain/web",
      "@charonchain/admin",
      "@charonchain/indexer",
      "@charonchain/contracts",
      "@charonchain/database",
      "@charonchain/ui",
      "@charonchain/shared",
    ]);
  });
});

describe("polityka zależności (CLAUDE.md pkt 4: przypięte wersje, bez latest)", () => {
  const EXACT = /^(\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?|workspace:\*)$/;

  it("każda zależność ma dokładną wersję lub workspace:* (bez ^, ~, *, latest)", () => {
    const offenders: string[] = [];
    for (const rel of WORKSPACES) {
      for (const [name, version] of dependencyEntries(parsePackage(rel))) {
        if (!EXACT.test(version)) offenders.push(`${rel}: ${name}@${version}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("ta sama zależność ma tę samą wersję w całym workspace", () => {
    const versions = new Map<string, Set<string>>();
    for (const rel of WORKSPACES) {
      for (const [name, version] of dependencyEntries(parsePackage(rel))) {
        const set = versions.get(name) ?? new Set<string>();
        set.add(version);
        versions.set(name, set);
      }
    }
    const conflicts = [...versions.entries()]
      .filter(([, set]) => set.size > 1)
      .map(([name, set]) => `${name}: ${[...set].join(" vs ")}`);
    expect(conflicts).toEqual([]);
  });
});

describe("higiena sekretów (docs/05 §4, CLAUDE.md pkt 9)", () => {
  const SECRET_KEY = /(SECRET|PRIVATE|SERVICE_ROLE|PASSWORD|TOKEN|DATABASE_URL|^RPC_URL_)/;
  const FORBIDDEN_PUBLIC = /(SERVICE_ROLE|PRIVATE|SECRET|PASSWORD|TOKEN|DATABASE)/;

  function envEntries(): [string, string][] {
    return read(".env.example")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map((line): [string, string] => {
        const idx = line.indexOf("=");
        return [line.slice(0, idx), line.slice(idx + 1)];
      });
  }

  it(".env.example ma puste wartości wszystkich kluczy sekretnych", () => {
    const leaked = envEntries().filter(([key, value]) => SECRET_KEY.test(key) && value !== "");
    expect(leaked).toEqual([]);
  });

  it("zmienne NEXT_PUBLIC_* nie mają nazw sugerujących sekret", () => {
    const bad = envEntries()
      .map(([key]) => key)
      .filter((key) => key.startsWith("NEXT_PUBLIC_") && FORBIDDEN_PUBLIC.test(key));
    expect(bad).toEqual([]);
  });

  it(".gitignore ignoruje .env, ale nie .env.example", () => {
    const ignored = (path: string): boolean => {
      try {
        git("check-ignore", "-q", path);
        return true;
      } catch {
        return false;
      }
    };
    expect(ignored(".env")).toBe(true);
    expect(ignored(".env.local")).toBe(true);
    expect(ignored(".env.example")).toBe(false);
  });

  it("w śledzonych plikach nie ma przypisanych kluczy prywatnych ani seed phrase", () => {
    const ASSIGNED_KEY =
      /\b(PRIVATE_KEY|MNEMONIC|SEED_PHRASE|SECRET_KEY)\b\s*[=:]\s*["']?(0x)?[0-9a-fA-F]{64}\b/;
    const offenders = trackedFiles()
      .filter((f) => f !== "pnpm-lock.yaml" && !f.endsWith(".gitkeep"))
      .filter((f) => ASSIGNED_KEY.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("nie śledzimy plików systemowych ani lokalnych (.DS_Store, .env)", () => {
    const offenders = trackedFiles().filter(
      (f) => f.endsWith(".DS_Store") || /(^|\/)\.env(\.(?!example$).+)?$/.test(f),
    );
    expect(offenders).toEqual([]);
  });
});
