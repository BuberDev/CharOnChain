import { describe, expect, it } from "vitest";

import { ManifestError, parseManifest } from "./manifest.js";
import { NATIVE_USDC_ARBITRUM_ONE } from "./networks.js";

// Adresy syntetyczne składające się z cyfr (suma kontrolna EIP-55 nie ma wpływu na zapis).
const A = (n: number): string => `0x${String(n).repeat(40)}`;

function validManifest(): Record<string, unknown> {
  return {
    chainId: 421614,
    gitCommitSha: "a".repeat(40),
    solcVersion: "0.8.28",
    sourcesHash: `0x${"b".repeat(64)}`,
    usdc: A(1),
    contracts: { registry: A(2), router: A(3), reputation: A(4), impact: A(5) },
    roles: {
      adminSafe: A(6),
      guardian: A(7),
      registrar: A(8),
      reputationGovernor: A(6),
      reportPublisher: A(9),
      reviewer: "0x" + "1".repeat(39) + "0",
    },
  };
}

function issuesOf(input: unknown): readonly string[] {
  try {
    parseManifest(input);
  } catch (error) {
    if (error instanceof ManifestError) return error.issues;
    throw error;
  }
  return [];
}

describe("parseManifest — poprawny manifest", () => {
  it("przyjmuje poprawny manifest Sepolia", () => {
    const manifest = parseManifest(validManifest());
    expect(manifest.chainId).toBe(421614);
    expect(manifest.contracts.router).toBe(A(3));
  });

  it("normalizuje adresy zapisane małymi literami do EIP-55", () => {
    const input = validManifest();
    input.usdc = NATIVE_USDC_ARBITRUM_ONE.toLowerCase();
    input.chainId = 42161;
    const manifest = parseManifest(input);
    expect(manifest.usdc).toBe(NATIVE_USDC_ARBITRUM_ONE);
  });

  it("mainnet przyjmuje wyłącznie natywne USDC", () => {
    const input = { ...validManifest(), chainId: 42161, usdc: NATIVE_USDC_ARBITRUM_ONE };
    expect(issuesOf(input)).toEqual([]);
  });

  it("opcjonalna sekcja AA: poprawna przechodzi", () => {
    const input = {
      ...validManifest(),
      accountAbstraction: {
        entryPoint: A(1).replace(/1/g, "4"),
        accountFactories: [A(5).replace(/5/g, "2")],
        accountImplementations: [A(7).replace(/7/g, "3")],
      },
    };
    expect(issuesOf(input)).toEqual([]);
  });
});

describe("parseManifest — odrzucenia", () => {
  it("odrzuca nieobsługiwany chainId", () => {
    expect(issuesOf({ ...validManifest(), chainId: 1 }).length).toBeGreaterThan(0);
  });

  it("mainnet z innym tokenem niż natywne USDC (np. USDC.e) → błąd", () => {
    const issues = issuesOf({ ...validManifest(), chainId: 42161, usdc: A(1) });
    expect(issues.join("\n")).toMatch(/natywne USDC/);
  });

  it("odrzuca adres zerowy", () => {
    const input = validManifest();
    input.usdc = "0x" + "0".repeat(40);
    expect(issuesOf(input).join("\n")).toMatch(/zerowy/);
  });

  it("odrzuca błędną sumę kontrolną EIP-55 (mieszana wielkość liter)", () => {
    const flipped = NATIVE_USDC_ARBITRUM_ONE.replace(/[a-f]/, (c) => c.toUpperCase());
    // Jeśli pierwsza litera była już wielka, odwróć w drugą stronę.
    const bad =
      flipped === NATIVE_USDC_ARBITRUM_ONE
        ? NATIVE_USDC_ARBITRUM_ONE.replace(/[A-F]/, (c) => c.toLowerCase())
        : flipped;
    expect(bad).not.toBe(NATIVE_USDC_ARBITRUM_ONE);
    const input = { ...validManifest(), chainId: 42161, usdc: bad };
    expect(issuesOf(input).join("\n")).toMatch(/suma kontrolna|EIP-55/);
  });

  it("odrzuca nie-adresy i śmieci", () => {
    for (const bad of ["", "0x123", "hello", 123, null, undefined, "0x" + "g".repeat(40)]) {
      expect(issuesOf({ ...validManifest(), usdc: bad }).length).toBeGreaterThan(0);
    }
  });

  it("reportPublisher i reviewer muszą być różni (AC-23)", () => {
    const input = validManifest();
    (input.roles as Record<string, unknown>).reviewer = A(9);
    expect(issuesOf(input).join("\n")).toMatch(/AC-23/);
  });

  it("guardian musi być osobny od adminSafe", () => {
    const input = validManifest();
    (input.roles as Record<string, unknown>).guardian = A(6);
    expect(issuesOf(input).join("\n")).toMatch(/guardian/);
  });

  it("adresy kontraktów muszą być unikalne", () => {
    const input = validManifest();
    (input.contracts as Record<string, unknown>).impact = A(2);
    expect(issuesOf(input).join("\n")).toMatch(/unikalne/);
  });

  it("rola nie może wskazywać kontraktu ani tokenu", () => {
    const input = validManifest();
    (input.roles as Record<string, unknown>).registrar = A(3);
    expect(issuesOf(input).join("\n")).toMatch(/Rola nie może/);
    const input2 = validManifest();
    (input2.roles as Record<string, unknown>).registrar = A(1);
    expect(issuesOf(input2).join("\n")).toMatch(/Rola nie może/);
  });

  it("odrzuca niepoprawne metadane wydania (SHA, solc, hash źródeł)", () => {
    expect(issuesOf({ ...validManifest(), gitCommitSha: "xyz" }).length).toBeGreaterThan(0);
    expect(issuesOf({ ...validManifest(), solcVersion: "latest" }).length).toBeGreaterThan(0);
    expect(issuesOf({ ...validManifest(), sourcesHash: "0x12" }).length).toBeGreaterThan(0);
  });

  it("AA: pusta lista fabryk lub implementacji → błąd", () => {
    const base = {
      entryPoint: A(4),
      accountFactories: [A(2)],
      accountImplementations: [A(3)],
    };
    expect(
      issuesOf({ ...validManifest(), accountAbstraction: { ...base, accountFactories: [] } })
        .length,
    ).toBeGreaterThan(0);
    expect(
      issuesOf({
        ...validManifest(),
        accountAbstraction: { ...base, accountImplementations: [] },
      }).length,
    ).toBeGreaterThan(0);
  });

  it("brak wymaganych pól → błędy z nazwami pól", () => {
    const input = validManifest();
    delete input.contracts;
    expect(issuesOf(input).join("\n")).toMatch(/contracts/);
  });
});
