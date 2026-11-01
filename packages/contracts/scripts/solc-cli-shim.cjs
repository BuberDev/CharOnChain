#!/usr/bin/env node
/* global require, process, console */
/**
 * Atrapa CLI `solc` oparta na solc-js (pakiet npm `solc`, przypięty), do uruchamiania Slithera OFFLINE,
 * gdy binarki solc nie da się pobrać (binaries.soliditylang.org zablokowane). Obsługuje tylko to, czego używa
 * crytic-compile: `--version` i `--combined-json …` (z remappingami i ścieżkami .sol w argumentach).
 * Użycie (z katalogu pakietu, patrz AUDIT-NOTES.md):
 *   slither src/X.sol --solc scripts/solc-cli-shim.cjs --solc-remaps "@openzeppelin/contracts/=node_modules/@openzeppelin/contracts/"
 * Slither wykrywa foundry.toml i wymaga `forge` — uruchamiaj go w katalogu bez foundry.toml (kopia src + symlink node_modules).
 */
const fs = require("node:fs");
const path = require("node:path");

const pkgRoot = path.resolve(__dirname, "..");
const solc = require(path.join(pkgRoot, "node_modules", "solc"));
const args = process.argv.slice(2);

function readImport(importPath) {
  const candidates = [
    path.resolve(process.cwd(), importPath),
    importPath.startsWith("@openzeppelin/contracts/")
      ? path.join(pkgRoot, "node_modules", importPath)
      : path.join(pkgRoot, "node_modules", "..", importPath),
    importPath.startsWith("node_modules/") ? path.join(pkgRoot, importPath) : importPath,
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return { contents: fs.readFileSync(candidate, "utf8") };
  }
  return { error: `File not found: ${importPath}` };
}

if (args.includes("--version")) {
  console.log("solc, the solidity compiler commandline interface");
  console.log(`Version: ${solc.version().replace("Emscripten.clang", "Linux.g++")}`);
} else if (args.includes("--combined-json")) {
  const remappings = args.filter((a) => a.includes("=") && !a.startsWith("--"));
  const sources = {};
  for (const file of args.filter((a) => a.endsWith(".sol"))) {
    sources[file] = { content: fs.readFileSync(file, "utf8") };
  }
  const input = {
    language: "Solidity",
    sources,
    settings: {
      remappings,
      evmVersion: "cancun",
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        "*": {
          "*": [
            "abi",
            "evm.bytecode.object",
            "evm.deployedBytecode.object",
            "evm.bytecode.sourceMap",
            "evm.deployedBytecode.sourceMap",
            "userdoc",
            "devdoc",
            "evm.methodIdentifiers",
          ],
          "": ["ast"],
        },
      },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: readImport }));
  const errors = (output.errors ?? []).filter((e) => e.severity === "error");
  if (errors.length > 0) {
    console.error(errors.map((e) => e.formattedMessage).join("\n"));
    process.exit(1);
  }
  const contracts = {};
  for (const [file, byName] of Object.entries(output.contracts ?? {})) {
    for (const [name, c] of Object.entries(byName)) {
      contracts[`${file}:${name}`] = {
        abi: c.abi,
        bin: c.evm.bytecode.object,
        "bin-runtime": c.evm.deployedBytecode.object,
        srcmap: c.evm.bytecode.sourceMap,
        "srcmap-runtime": c.evm.deployedBytecode.sourceMap,
        userdoc: c.userdoc,
        devdoc: c.devdoc,
        hashes: c.evm.methodIdentifiers,
      };
    }
  }
  const ordered = Object.entries(output.sources).sort((a, b) => a[1].id - b[1].id);
  const result = {
    contracts,
    sourceList: ordered.map(([name]) => name),
    sources: Object.fromEntries(ordered.map(([name, v]) => [name, { AST: v.ast, ast: v.ast }])),
    version: solc.version().replace("Emscripten.clang", "Linux.g++"),
  };
  // Zapis z callbackiem: process.exit przed opróżnieniem potoku ucinałby duży JSON.
  process.stdout.write(JSON.stringify(result), () => process.exit(0));
} else {
  console.error(`solc-cli-shim: nieobsługiwane argumenty ${args.join(" ")}`);
  process.exit(2);
}
