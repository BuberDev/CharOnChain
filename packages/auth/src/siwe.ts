/**
 * SIWE (EIP-4361) po stronie serwera (COC-024/073; docs/03 §5; AC-26, AC-55). Czyste funkcje: bez dostępu do
 * bazy i sieci. Zasady (docs/03 §5): nonce ≥ 128 bit entropii, TTL 5 min, jednorazowy; wiadomość zawiera
 * dokładną domenę, URI, chain ID, czas i wygaśnięcie; sesja NIGDY nie jest zgodą na przesyłanie USDC.
 */
import { createHash, randomBytes } from "node:crypto";

import { createSiweMessage, parseSiweMessage, type SiweMessage } from "viem/siwe";
import { getAddress, isAddress, type Address, type Hex } from "viem";

export const NONCE_TTL_SECONDS = 300;
/** Najdłuższy dopuszczalny czas ważności wiadomości SIWE (od issuedAt do expirationTime). */
export const MAX_MESSAGE_LIFETIME_SECONDS = 600;
/** Tolerancja zegara przy `issuedAt` z przyszłości. */
export const CLOCK_SKEW_SECONDS = 60;

export const SIWE_STATEMENT =
  "Zaloguj się do CharOnChain. Podpis nie przenosi środków i nie daje zgody na żadną płatność.";

export interface IssuedNonce {
  /** Wartość wysyłana klientowi (128 bitów entropii, hex). Nigdy nie jest logowana ani zapisywana. */
  readonly nonce: string;
  /** SHA-256 nonce (64 znaki hex) — jedyna postać zapisywana w bazie. */
  readonly nonceHash: string;
}

export const hashNonce = (nonce: string): string =>
  createHash("sha256").update(nonce, "utf8").digest("hex");

export function issueNonce(): IssuedNonce {
  const nonce = randomBytes(16).toString("hex");
  return { nonce, nonceHash: hashNonce(nonce) };
}

export interface SiweParams {
  readonly address: Address;
  readonly domain: string;
  readonly uri: string;
  readonly chainId: number;
  readonly nonce: string;
  readonly issuedAt: Date;
}

/** Buduje wiadomość do podpisu (używane przez testy i przez ewentualny render po stronie serwera). */
export function buildSiweMessage(params: SiweParams): string {
  return createSiweMessage({
    address: params.address,
    domain: params.domain,
    uri: params.uri,
    chainId: params.chainId,
    nonce: params.nonce,
    version: "1",
    statement: SIWE_STATEMENT,
    issuedAt: params.issuedAt,
    expirationTime: new Date(params.issuedAt.getTime() + NONCE_TTL_SECONDS * 1000),
  });
}

export type SiweFailure =
  | "MALFORMED"
  | "BAD_ADDRESS"
  | "DOMAIN_MISMATCH"
  | "URI_MISMATCH"
  | "CHAIN_NOT_ALLOWED"
  | "BAD_NONCE"
  | "BAD_VERSION"
  | "MISSING_TIME"
  | "NOT_YET_VALID"
  | "EXPIRED"
  | "LIFETIME_TOO_LONG";

export type SiweValidation =
  | {
      readonly ok: true;
      readonly message: SiweMessage & { address: Address; chainId: number; nonce: string };
    }
  | { readonly ok: false; readonly code: SiweFailure };

export interface SiweExpectations {
  /** Dokładna domena serwisu (host[:port]); porównanie ścisłe, bez dopasowań częściowych. */
  readonly domain: string;
  /** Dopuszczalne URI (pełne origin-y); wiadomość musi wskazywać jedno z nich. */
  readonly allowedUris: readonly string[];
  readonly allowedChainIds: readonly number[];
  readonly now: Date;
}

/** Waliduje treść wiadomości (BEZ sprawdzania podpisu i nonce w bazie). */
export function validateSiweMessage(raw: string, expected: SiweExpectations): SiweValidation {
  let parsed: SiweMessage;
  try {
    parsed = parseSiweMessage(raw) as SiweMessage;
  } catch {
    return { ok: false, code: "MALFORMED" };
  }
  const { address, domain, uri, chainId, nonce, version, issuedAt, expirationTime, notBefore } =
    parsed;
  if (
    address === undefined ||
    domain === undefined ||
    uri === undefined ||
    chainId === undefined ||
    nonce === undefined
  ) {
    return { ok: false, code: "MALFORMED" };
  }
  // EIP-4361 wymaga adresu w formacie EIP-55: porównanie ścisłe z wersją ze sumą kontrolną.
  if (!isAddress(address, { strict: true }) || getAddress(address) !== address)
    return { ok: false, code: "BAD_ADDRESS" };
  if (version !== "1") return { ok: false, code: "BAD_VERSION" };
  if (domain !== expected.domain) return { ok: false, code: "DOMAIN_MISMATCH" };
  if (!expected.allowedUris.includes(uri)) return { ok: false, code: "URI_MISMATCH" };
  if (!expected.allowedChainIds.includes(chainId)) return { ok: false, code: "CHAIN_NOT_ALLOWED" };
  // Nonce wystawiany przez nas to 32 znaki hex; inne formaty nie mogły zostać wystawione.
  if (!/^[0-9a-f]{32}$/.test(nonce)) return { ok: false, code: "BAD_NONCE" };
  if (issuedAt === undefined || expirationTime === undefined)
    return { ok: false, code: "MISSING_TIME" };

  const now = expected.now.getTime();
  if (issuedAt.getTime() > now + CLOCK_SKEW_SECONDS * 1000)
    return { ok: false, code: "NOT_YET_VALID" };
  if (notBefore !== undefined && notBefore.getTime() > now)
    return { ok: false, code: "NOT_YET_VALID" };
  if (expirationTime.getTime() <= now) return { ok: false, code: "EXPIRED" };
  if (expirationTime.getTime() - issuedAt.getTime() > MAX_MESSAGE_LIFETIME_SECONDS * 1000) {
    return { ok: false, code: "LIFETIME_TOO_LONG" };
  }
  return { ok: true, message: { ...parsed, address, chainId, nonce } };
}

/**
 * Weryfikator podpisu konta KONTRAKTOWEGO (EIP-1271 / ERC-6492 dla kont jeszcze niewdrożonych) — wstrzykiwany,
 * bo wymaga `eth_call` na właściwej sieci (`chainId` z wiadomości). Implementacja produkcyjna: viem
 * `publicClient.verifyMessage` (obsługuje 1271 i 6492) z allowlistą RPC, limitem czasu i gazu (COC-073).
 */
export type ContractSignatureVerifier = (args: {
  address: Address;
  message: string;
  signature: Hex;
  chainId: number;
}) => Promise<boolean>;

/** Najpierw tani odzysk ECDSA (EOA, bez sieci); dopiero potem weryfikator kont kontraktowych. */
export async function verifySiweSignature(args: {
  address: Address;
  message: string;
  signature: Hex;
  chainId: number;
  contractVerifier?: ContractSignatureVerifier;
}): Promise<boolean> {
  const { verifyMessage } = await import("viem");
  // Podpis ERC-6492 (kończy się magiczną sygnaturą) nie jest ECDSA — od razu do weryfikatora kont kontraktowych.
  const looksLikeEcdsa = /^0x[0-9a-fA-F]{130}$/.test(args.signature);
  if (looksLikeEcdsa) {
    try {
      if (
        await verifyMessage({
          address: args.address,
          message: args.message,
          signature: args.signature,
        })
      )
        return true;
    } catch {
      // Zły format podpisu: przechodzimy do weryfikatora kont kontraktowych (jeśli jest), inaczej odmowa.
    }
  }
  if (args.contractVerifier === undefined) return false;
  try {
    return await args.contractVerifier({
      address: args.address,
      message: args.message,
      signature: args.signature,
      chainId: args.chainId,
    });
  } catch {
    return false; // awaria RPC = odmowa (fail-closed), nigdy sukces
  }
}
