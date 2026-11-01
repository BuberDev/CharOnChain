import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getAddress, isAddress } from "viem";
import { describe, expect, it } from "vitest";

import {
  ARBITRUM_ONE_CHAIN_ID,
  ARBITRUM_SEPOLIA_CHAIN_ID,
  getNetwork,
  isNativeUsdc,
  NATIVE_USDC_ARBITRUM_ONE,
  NETWORKS,
  resolveDefaultChainId,
  UnsupportedChainError,
} from "./networks";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("konfiguracja sieci", () => {
  it("obsługuje dokładnie Arbitrum One (42161) i Sepolia (421614)", () => {
    expect(Object.keys(NETWORKS).sort()).toEqual(["421614", "42161"].sort());
    expect(getNetwork(42161)).toMatchObject({ key: "arbitrum-one", isTestnet: false });
    expect(getNetwork(421614)).toMatchObject({ key: "arbitrum-sepolia", isTestnet: true });
  });

  it.each([0, 1, 10, 137, 42170, -1, 1.5, Number.NaN])("odrzuca nieobsługiwaną sieć %s", (id) => {
    expect(() => getNetwork(id)).toThrow(UnsupportedChainError);
  });

  it("na testnecie nie ma wymyślonego adresu USDC (zero stałych bez weryfikacji)", () => {
    expect(getNetwork(ARBITRUM_SEPOLIA_CHAIN_ID).nativeUsdc).toBeNull();
  });
});

describe("natywne USDC na Arbitrum One", () => {
  it("stała ma poprawną sumę kontrolną EIP-55 i jest adresem EVM", () => {
    expect(isAddress(NATIVE_USDC_ARBITRUM_ONE, { strict: true })).toBe(true);
    expect(getAddress(NATIVE_USDC_ARBITRUM_ONE)).toBe(NATIVE_USDC_ARBITRUM_ONE);
  });

  it("jest zgodna z dokumentacją (README, docs/02, docs/07) — wykrywa rozjazd kod ↔ docs", () => {
    for (const file of ["README.md", "docs/02-SMART-CONTRACTS.md", "docs/07-REFERENCES.md"]) {
      const text = readFileSync(join(REPO_ROOT, file), "utf8");
      expect(text, file).toContain(NATIVE_USDC_ARBITRUM_ONE);
    }
  });

  it("isNativeUsdc: mainnet akceptuje wyłącznie stałą (bez względu na wielkość liter)", () => {
    expect(isNativeUsdc(ARBITRUM_ONE_CHAIN_ID, NATIVE_USDC_ARBITRUM_ONE)).toBe(true);
    expect(isNativeUsdc(ARBITRUM_ONE_CHAIN_ID, NATIVE_USDC_ARBITRUM_ONE.toLowerCase())).toBe(true);
    expect(isNativeUsdc(ARBITRUM_ONE_CHAIN_ID, "0x1111111111111111111111111111111111111111")).toBe(
      false,
    );
    expect(isNativeUsdc(ARBITRUM_ONE_CHAIN_ID, "")).toBe(false);
  });

  it("isNativeUsdc: mainnet ignoruje „skonfigurowany” token (nie da się podmienić USDC)", () => {
    const fake = "0x2222222222222222222222222222222222222222";
    expect(isNativeUsdc(ARBITRUM_ONE_CHAIN_ID, fake, fake)).toBe(false);
  });

  it("isNativeUsdc: testnet tylko dla tokenu przekazanego z manifestu", () => {
    const configured = "0x3333333333333333333333333333333333333333";
    expect(isNativeUsdc(ARBITRUM_SEPOLIA_CHAIN_ID, configured)).toBe(false);
    expect(isNativeUsdc(ARBITRUM_SEPOLIA_CHAIN_ID, configured, configured)).toBe(true);
    expect(isNativeUsdc(ARBITRUM_SEPOLIA_CHAIN_ID, NATIVE_USDC_ARBITRUM_ONE, configured)).toBe(
      false,
    );
  });

  it("isNativeUsdc: nieobsługiwana sieć → zawsze false", () => {
    expect(isNativeUsdc(1, NATIVE_USDC_ARBITRUM_ONE)).toBe(false);
  });
});

describe("resolveDefaultChainId (CLAUDE.md pkt 3: domyślnie Sepolia)", () => {
  it("domyślnie Arbitrum Sepolia", () => {
    expect(resolveDefaultChainId({})).toBe(ARBITRUM_SEPOLIA_CHAIN_ID);
    expect(resolveDefaultChainId({ NEXT_PUBLIC_DEFAULT_CHAIN_ID: "" })).toBe(
      ARBITRUM_SEPOLIA_CHAIN_ID,
    );
    expect(resolveDefaultChainId({ NEXT_PUBLIC_DEFAULT_CHAIN_ID: "421614" })).toBe(421614);
  });

  it("mainnet wymaga APP_ENV=production", () => {
    for (const appEnv of [undefined, "local", "staging", "Production", ""]) {
      expect(() =>
        resolveDefaultChainId({ NEXT_PUBLIC_DEFAULT_CHAIN_ID: "42161", APP_ENV: appEnv }),
      ).toThrow(/APP_ENV=production/);
    }
    expect(
      resolveDefaultChainId({ NEXT_PUBLIC_DEFAULT_CHAIN_ID: "42161", APP_ENV: "production" }),
    ).toBe(ARBITRUM_ONE_CHAIN_ID);
  });

  it("odrzuca nieobsługiwane i niepoprawne wartości", () => {
    for (const bad of ["1", "abc", "-1", "421614.0", "0x66eee", "42161 "]) {
      expect(() => resolveDefaultChainId({ NEXT_PUBLIC_DEFAULT_CHAIN_ID: bad })).toThrow(
        UnsupportedChainError,
      );
    }
  });
});
