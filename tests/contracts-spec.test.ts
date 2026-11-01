/**
 * Statyczne straże kontraktów SC-1.0 (CLAUDE.md pkt 5; docs/02): wykonują się w `pnpm test`, bez EVM.
 * Pełna weryfikacja zachowania to testy Solidity (`pnpm test:contracts`); tu pilnujemy tego, co łatwo
 * zepsuć przez przypadek: rozjazdu interfejsu ze specyfikacją i zakazanych konstrukcji.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url).pathname;
const read = (path: string): string => readFileSync(join(root, path), "utf8");
const srcDir = join(root, "packages/contracts/src");
const contractSources = readdirSync(srcDir).filter((f) => f.endsWith(".sol"));

/** Usuwa komentarze, żeby straże nie reagowały na opisy (np. „brak selfdestruct”). */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("interfejs: kopia implementacji jest identyczna ze specyfikacją (DOC-14)", () => {
  it("packages/contracts/src/interfaces/ICharOnChain.sol == contracts/src/interfaces/ICharOnChain.sol", () => {
    expect(read("packages/contracts/src/interfaces/ICharOnChain.sol")).toBe(
      read("contracts/src/interfaces/ICharOnChain.sol"),
    );
  });
});

describe("zakazane konstrukcje w kontraktach produkcyjnych", () => {
  it("są cztery kontrakty SC-1.0 plus wspólne błędy", () => {
    expect(contractSources.sort()).toEqual([
      "CampaignRegistry.sol",
      "DonationRouter.sol",
      "Errors.sol",
      "ImpactRegistry.sol",
      "ReputationSBT.sol",
    ]);
  });

  it.each(contractSources)(
    "%s: brak delegatecall, selfdestruct, assembly i inline `call{value`",
    (file) => {
      const code = stripComments(read(`packages/contracts/src/${file}`));
      expect(code).not.toMatch(/\bdelegatecall\b/i);
      expect(code).not.toMatch(/\bselfdestruct\b/i);
      expect(code).not.toMatch(/\bassembly\b/);
      expect(code).not.toMatch(/\.call\s*\{\s*value/);
    },
  );

  it.each(contractSources)(
    "%s: brak funkcji wypłaty/ratunku/upgrade i brak proxy (CLAUDE.md pkt 5)",
    (file) => {
      const code = stripComments(read(`packages/contracts/src/${file}`));
      const forbidden =
        /function\s+(withdraw|rescue|sweep|recover|emergencyWithdraw|upgrade\w*|setImplementation|initialize|setBeneficiary|setFee\w*)\b/i;
      expect(code).not.toMatch(forbidden);
      expect(code).not.toMatch(
        /\b(UUPSUpgradeable|TransparentUpgradeableProxy|ERC1967|Initializable)\b/,
      );
      expect(code).not.toMatch(/\bpayable\b/);
    },
  );

  it.each(contractSources)("%s: kompilator przypięty (0.8.28), licencja MIT", (file) => {
    const source = read(`packages/contracts/src/${file}`);
    expect(source).toMatch(/^\/\/ SPDX-License-Identifier: MIT/m);
    expect(source).toMatch(/^pragma solidity (0\.8\.28|\^0\.8\.24);/m);
    expect(source).not.toMatch(/pragma solidity [>^]/); // implementacje bez zakresów wersji
  });

  it("żaden kontrakt nie zna paymastera, bundlera ani EntryPoint (docs/02 §9)", () => {
    for (const file of contractSources) {
      const code = stripComments(read(`packages/contracts/src/${file}`));
      expect(code, file).not.toMatch(/paymaster|bundler|entrypoint/i);
    }
  });

  it("mock USDC istnieje wyłącznie w test/, nie w src/", () => {
    expect(contractSources.join(" ")).not.toMatch(/Mock/);
    expect(readdirSync(join(root, "packages/contracts/test/utils"))).toContain("MockUSDC.sol");
  });
});
