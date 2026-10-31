/**
 * Manifest wdrożenia (COC-002; docs/02 §8 pkt 4): jedno miejsce prawdy o adresach środowiska.
 * Walidacja jest restrykcyjna — manifest, który nie przechodzi, nie może trafić do aplikacji.
 *
 * Sekcja `accountAbstraction` jest opcjonalna do czasu ADR-007 (dostawca). Pola dostawcy
 * (bundler, paymaster provider, klucze) NIE są tu zgadywane; dochodzą w COC-070/071.
 */
import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";

import {
  ARBITRUM_ONE_CHAIN_ID,
  ARBITRUM_SEPOLIA_CHAIN_ID,
  NATIVE_USDC_ARBITRUM_ONE,
} from "./networks.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Adres EVM: małe litery LUB poprawna suma kontrolna EIP-55 (mieszana wielkość z błędną sumą
 * jest odrzucana). Wynik jest znormalizowany do postaci EIP-55. Adres zerowy jest niedozwolony.
 */
const addressSchema = z
  .string()
  .refine((value) => isAddress(value, { strict: true }), {
    message: "Niepoprawny adres EVM lub błędna suma kontrolna EIP-55",
  })
  .refine((value) => value.toLowerCase() !== ZERO_ADDRESS, {
    message: "Adres zerowy jest niedozwolony",
  })
  .transform((value): Address => getAddress(value));

const chainIdSchema = z.union([
  z.literal(ARBITRUM_ONE_CHAIN_ID),
  z.literal(ARBITRUM_SEPOLIA_CHAIN_ID),
]);

const accountAbstractionSchema = z.object({
  /** Wersja i adres EntryPoint — do zweryfikowania on-chain na danej sieci przed wpisaniem. */
  entryPoint: addressSchema,
  /** Zatwierdzone fabryki kont (allowlista paymastera i weryfikacji ERC-6492, docs/11 §6.1, §8). */
  accountFactories: z.array(addressSchema).min(1),
  /** Zatwierdzone implementacje kont (audytowane). */
  accountImplementations: z.array(addressSchema).min(1),
  /** Adres paymastera; opcjonalny, dopóki ADR-007 nie wybierze dostawcy. */
  paymaster: addressSchema.optional(),
});

export const manifestSchema = z
  .object({
    chainId: chainIdSchema,
    gitCommitSha: z.string().regex(/^[0-9a-f]{40}$/, "Oczekiwano 40 znaków hex (małe litery)"),
    solcVersion: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, "Oczekiwano wersji x.y.z"),
    sourcesHash: z.string().regex(/^0x[0-9a-f]{64}$/, "Oczekiwano 0x + 64 znaki hex"),
    usdc: addressSchema,
    contracts: z.object({
      registry: addressSchema,
      router: addressSchema,
      reputation: addressSchema,
      impact: addressSchema,
    }),
    roles: z.object({
      /** DEFAULT_ADMIN_ROLE — wyłącznie Safe, nigdy EOA dewelopera (AC-30). */
      adminSafe: addressSchema,
      /** PAUSER_ROLE — osobny adres, bez możliwości odblokowania (docs/02 §1). */
      guardian: addressSchema,
      registrar: addressSchema,
      reputationGovernor: addressSchema,
      reportPublisher: addressSchema,
      reviewer: addressSchema,
    }),
    accountAbstraction: accountAbstractionSchema.optional(),
  })
  .superRefine((manifest, ctx) => {
    const issue = (path: (string | number)[], message: string): void => {
      ctx.addIssue({ code: "custom", path, message });
    };

    // Natywne USDC wyłącznie zweryfikowane na mainnecie (README, CLAUDE.md pkt 5).
    if (manifest.chainId === ARBITRUM_ONE_CHAIN_ID && manifest.usdc !== NATIVE_USDC_ARBITRUM_ONE) {
      issue(["usdc"], "Na Arbitrum One dozwolone jest wyłącznie natywne USDC Circle (nie USDC.e).");
    }

    // Rozdział ról (docs/02 §5, AC-23): publisher ≠ reviewer, guardian ≠ admin.
    if (manifest.roles.reportPublisher === manifest.roles.reviewer) {
      issue(
        ["roles", "reviewer"],
        "reportPublisher i reviewer muszą być różnymi adresami (AC-23).",
      );
    }
    if (manifest.roles.guardian === manifest.roles.adminSafe) {
      issue(["roles", "guardian"], "guardian musi być adresem osobnym od adminSafe.");
    }

    // Kontrakty muszą mieć unikalne adresy.
    const contractAddresses = Object.values(manifest.contracts);
    if (new Set(contractAddresses).size !== contractAddresses.length) {
      issue(["contracts"], "Adresy kontraktów muszą być unikalne.");
    }

    // Kontrakt nie może być jednocześnie rolą ani tokenem.
    const all = new Set<Address>([...contractAddresses, manifest.usdc]);
    for (const [name, address] of Object.entries(manifest.roles)) {
      if (all.has(address)) issue(["roles", name], "Rola nie może wskazywać kontraktu ani tokenu.");
    }
  });

export type Manifest = z.output<typeof manifestSchema>;

export class ManifestError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`Niepoprawny manifest wdrożenia:\n- ${issues.join("\n- ")}`);
    this.name = "ManifestError";
    this.issues = issues;
  }
}

/** Waliduje i normalizuje manifest; rzuca `ManifestError` z listą problemów. */
export function parseManifest(input: unknown): Manifest {
  const result = manifestSchema.safeParse(input);
  if (!result.success) {
    throw new ManifestError(
      result.error.issues.map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`),
    );
  }
  return result.data;
}
