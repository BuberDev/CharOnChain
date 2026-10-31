/**
 * Sieci i natywne USDC (COC-002). docs/02 §1, README „Decyzje zamknięte”.
 *
 *  - Produkcja: Arbitrum One (42161), natywne USDC Circle — NIE USDC.e.
 *  - Test: Arbitrum Sepolia (421614), adres tokenu podawany konfiguracyjnie po weryfikacji;
 *    w kodzie nie ma żadnego wymyślonego adresu testowego.
 *  - Domyślnie Sepolia; mainnet tylko jawnie (CLAUDE.md pkt 3).
 */
import { getAddress, type Address } from "viem";

export const ARBITRUM_ONE_CHAIN_ID = 42161;
export const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;

export type SupportedChainId = typeof ARBITRUM_ONE_CHAIN_ID | typeof ARBITRUM_SEPOLIA_CHAIN_ID;

/**
 * Natywne USDC na Arbitrum One — wartość z README/PRD/docs/02/docs/07. `getAddress` rzuca wyjątek
 * przy błędnej sumie kontrolnej EIP-55, więc literówka wyłoży się przy ładowaniu modułu.
 * UWAGA: to sprawdza FORMAT adresu, nie tożsamość tokenu. Tożsamość trzeba potwierdzić on-chain
 * i w eksploratorze przed wydaniem (docs/05 §6, manifest release).
 */
export const NATIVE_USDC_ARBITRUM_ONE: Address = getAddress(
  "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
);

export interface NetworkConfig {
  readonly chainId: SupportedChainId;
  readonly key: "arbitrum-one" | "arbitrum-sepolia";
  readonly name: string;
  readonly isTestnet: boolean;
  readonly explorerUrl: string;
  /** Natywne USDC zweryfikowane w repo; null = podawane konfiguracyjnie (manifest). */
  readonly nativeUsdc: Address | null;
}

export const NETWORKS: Readonly<Record<SupportedChainId, NetworkConfig>> = {
  [ARBITRUM_ONE_CHAIN_ID]: {
    chainId: ARBITRUM_ONE_CHAIN_ID,
    key: "arbitrum-one",
    name: "Arbitrum One",
    isTestnet: false,
    explorerUrl: "https://arbiscan.io",
    nativeUsdc: NATIVE_USDC_ARBITRUM_ONE,
  },
  [ARBITRUM_SEPOLIA_CHAIN_ID]: {
    chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
    key: "arbitrum-sepolia",
    name: "Arbitrum Sepolia",
    isTestnet: true,
    explorerUrl: "https://sepolia.arbiscan.io",
    nativeUsdc: null,
  },
};

export class UnsupportedChainError extends Error {
  readonly chainId: number;
  constructor(chainId: number) {
    super(`Nieobsługiwana sieć: ${String(chainId)}. Dozwolone: 42161, 421614.`);
    this.name = "UnsupportedChainError";
    this.chainId = chainId;
  }
}

export function isSupportedChainId(chainId: number): chainId is SupportedChainId {
  return chainId === ARBITRUM_ONE_CHAIN_ID || chainId === ARBITRUM_SEPOLIA_CHAIN_ID;
}

export function getNetwork(chainId: number): NetworkConfig {
  if (!isSupportedChainId(chainId)) throw new UnsupportedChainError(chainId);
  return NETWORKS[chainId];
}

/**
 * Czy `token` jest natywnym USDC dla danej sieci?
 *  - 42161: wyłącznie stała z repo (porównanie bez rozróżniania wielkości liter),
 *  - 421614: wyłącznie token jawnie przekazany z manifestu (`configuredToken`); brak ⇒ false.
 * Zawsze false dla nieobsługiwanej sieci i dla niepoprawnych adresów (AC-10).
 */
export function isNativeUsdc(chainId: number, token: string, configuredToken?: string): boolean {
  if (!isSupportedChainId(chainId)) return false;
  const expected = getNetwork(chainId).nativeUsdc ?? configuredToken ?? null;
  return expected !== null && expected.toLowerCase() === token.toLowerCase();
}

export type EnvLike = Readonly<Record<string, string | undefined>>;

/**
 * Domyślna sieć aplikacji z env. Domyślnie Sepolia. Mainnet (42161) tylko przy
 * `APP_ENV=production` — ochrona przed przypadkowym użyciem produkcji w local/staging.
 */
export function resolveDefaultChainId(env: EnvLike): SupportedChainId {
  const raw = env.NEXT_PUBLIC_DEFAULT_CHAIN_ID;
  if (raw === undefined || raw === "") return ARBITRUM_SEPOLIA_CHAIN_ID;
  if (!/^[0-9]+$/.test(raw)) throw new UnsupportedChainError(Number.NaN);
  const chainId = Number(raw);
  if (!isSupportedChainId(chainId)) throw new UnsupportedChainError(chainId);
  if (chainId === ARBITRUM_ONE_CHAIN_ID && env.APP_ENV !== "production") {
    throw new Error(
      "Arbitrum One (42161) wymaga APP_ENV=production i jawnej decyzji właściciela (CLAUDE.md pkt 3).",
    );
  }
  return chainId;
}
