/**
 * Produkcyjny weryfikator podpisów kont KONTRAKTOWYCH (COC-073; docs/11 §6.1, §8; AC-55): ERC-1271 (konto
 * wdrożone) i ERC-6492 (konto jeszcze niewdrożone, z fabryką). Wstrzykiwany do `login()` jako
 * `ContractSignatureVerifier`. Własności bezpieczeństwa:
 *  - tylko sieci z jawnej allowlisty (klient RPC per `chainId`); wiadomość SIWE dla innej sieci → odmowa;
 *  - dla ERC-6492 fabryka z podpisu MUSI być na allowliście zatwierdzonych fabryk — inaczej `eth_call` wywołałby
 *    dowolny kontrakt wskazany przez atakującego;
 *  - limit rozmiaru podpisu i limit czasu całego sprawdzenia (nie blokujemy żądań logowania na wolnym RPC);
 *  - fail-closed: błąd RPC, timeout, nieznany format → `false`, nigdy sukces;
 *  - sukces wyłącznie dla jawnego `true`.
 * Sesja logowania NIE jest zgodą na przesyłanie środków (docs/03 §5).
 */
import {
  isErc6492Signature,
  parseErc6492Signature,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import type { ContractSignatureVerifier } from "./siwe";

export const MAX_CONTRACT_SIGNATURE_BYTES = 8_192;
export const DEFAULT_VERIFY_TIMEOUT_MS = 5_000;

export interface ContractVerifierOptions {
  /** Klient RPC per sieć. Sieć bez klienta jest odrzucana. */
  readonly clients: Readonly<Record<number, Pick<PublicClient, "verifyMessage">>>;
  /** Zatwierdzone fabryki kont dozwolone w podpisach ERC-6492 (małe litery nie są wymagane). */
  readonly allowedFactories: readonly Address[];
  readonly timeoutMs?: number;
}

const byteLength = (hex: Hex): number => (hex.length - 2) / 2;

export function createContractSignatureVerifier(
  options: ContractVerifierOptions,
): ContractSignatureVerifier {
  const factories = new Set(options.allowedFactories.map((a) => a.toLowerCase()));
  const timeoutMs = options.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;

  return async ({ address, message, signature, chainId }) => {
    const client = options.clients[chainId];
    if (client === undefined) return false;
    if (
      !/^0x([0-9a-fA-F]{2})+$/.test(signature) ||
      byteLength(signature) > MAX_CONTRACT_SIGNATURE_BYTES
    ) {
      return false;
    }
    try {
      if (isErc6492Signature(signature)) {
        const wrapped = parseErc6492Signature(signature);
        if (wrapped.address === undefined || !factories.has(wrapped.address.toLowerCase()))
          return false;
      }
    } catch {
      return false;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<false>((resolve) => {
        timer = setTimeout(() => {
          resolve(false);
        }, timeoutMs);
      });
      const verified = client
        .verifyMessage({ address, message, signature })
        .then((ok: unknown) => ok === true);
      return await Promise.race([verified, timeout]);
    } catch {
      return false;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}
