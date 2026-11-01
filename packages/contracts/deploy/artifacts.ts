/** Ładowanie artefaktów kompilacji Hardhat 3 (ABI + bajtkod) oraz skrót źródeł do manifestu. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { keccak256, toBytes, type Abi, type Hex } from "viem";

export const CONTRACT_NAMES = [
  "CampaignRegistry",
  "DonationRouter",
  "ReputationSBT",
  "ImpactRegistry",
] as const;
export type ContractName = (typeof CONTRACT_NAMES)[number];

export interface LoadedArtifact {
  readonly abi: Abi;
  readonly bytecode: Hex;
}

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadArtifact(name: ContractName, root: string = packageRoot): LoadedArtifact {
  const path = join(root, "artifacts", "src", `${name}.sol`, `${name}.json`);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `Brak artefaktu ${name} (${path}). Uruchom najpierw: pnpm --filter @charonchain/contracts run build`,
    );
  }
  const parsed = JSON.parse(raw) as { abi?: Abi; bytecode?: string };
  if (
    parsed.abi === undefined ||
    parsed.bytecode === undefined ||
    !/^0x[0-9a-fA-F]+$/.test(parsed.bytecode)
  ) {
    throw new Error(`Artefakt ${name} jest niepełny (brak ABI lub bajtkodu).`);
  }
  return { abi: parsed.abi, bytecode: parsed.bytecode as Hex };
}

function listSolidity(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listSolidity(full));
    else if (entry.endsWith(".sol")) out.push(full);
  }
  return out;
}

/**
 * `sourcesHash` manifestu: keccak256 po posortowanych parach (ścieżka względna `/`, zawartość) plików
 * `src/**.sol`. Deterministyczny, niezależny od systemu plików; zmiana jakiegokolwiek źródła zmienia skrót.
 */
export function computeSourcesHash(root: string = packageRoot): Hex {
  const srcDir = join(root, "src");
  const parts = listSolidity(srcDir).map((file) => {
    const rel = relative(root, file).split(sep).join("/");
    return `${rel}\n${readFileSync(file, "utf8")}\n`;
  });
  return keccak256(toBytes(parts.join("\u0000")));
}
