/**
 * Ligi i XP (COC-002; docs/01 §6 — „jedyna wersja prawdy”). Wszystko na `bigint`.
 *
 * xp   = floor(totalDonatedRaw / 100000)    (1 USDC = 10 XP)
 * tier = najwyższy próg <= totalDonatedRaw  (0 = brak wpłat)
 *
 * To lustro `ReputationSBT.tierOf` do wyświetlania i testów. Źródłem prawdy jest kontrakt;
 * przy niezgodności UI czyta kontrakt (docs/03 `donor_stats` to cache).
 */
import { MAX_UINT256, USDC_UNIT } from "./usdc.js";

export const XP_DIVISOR = 100_000n;

export type TierId = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface Tier {
  readonly id: Exclude<TierId, 0>;
  readonly name: "Supporter" | "Bronze" | "Silver" | "Gold" | "Platinum" | "Diamond";
  /** Próg w jednostkach najmniejszych USDC. */
  readonly thresholdRaw: bigint;
  /** Minimalne XP przy progu (zgodne z tabelą PRD). */
  readonly minXp: bigint;
}

const usdc = (whole: bigint): bigint => whole * USDC_UNIT;

export const TIERS: readonly Tier[] = [
  { id: 1, name: "Supporter", thresholdRaw: usdc(1n), minXp: 10n },
  { id: 2, name: "Bronze", thresholdRaw: usdc(100n), minXp: 1_000n },
  { id: 3, name: "Silver", thresholdRaw: usdc(1_000n), minXp: 10_000n },
  { id: 4, name: "Gold", thresholdRaw: usdc(10_000n), minXp: 100_000n },
  { id: 5, name: "Platinum", thresholdRaw: usdc(25_000n), minXp: 250_000n },
  { id: 6, name: "Diamond", thresholdRaw: usdc(100_000n), minXp: 1_000_000n },
];

function assertTotal(totalDonatedRaw: bigint): void {
  if (totalDonatedRaw < 0n || totalDonatedRaw > MAX_UINT256) {
    throw new RangeError("totalDonatedRaw poza zakresem uint256");
  }
}

export function xpFromRaw(totalDonatedRaw: bigint): bigint {
  assertTotal(totalDonatedRaw);
  return totalDonatedRaw / XP_DIVISOR;
}

export function tierFromRaw(totalDonatedRaw: bigint): TierId {
  assertTotal(totalDonatedRaw);
  let result: TierId = 0;
  for (const tier of TIERS) {
    if (totalDonatedRaw >= tier.thresholdRaw) result = tier.id;
  }
  return result;
}

export function tierInfo(id: TierId): Tier | null {
  return TIERS.find((t) => t.id === id) ?? null;
}

export interface TierProgress {
  readonly current: TierId;
  readonly next: Tier | null;
  /** Ile brakuje do kolejnej ligi; 0n dla najwyższej. */
  readonly remainingRaw: bigint;
  /** Postęp w bieżącym przedziale w punktach bazowych (0–10000), całkowity, bez floatów. */
  readonly progressBp: bigint;
}

export function progressToNextTier(totalDonatedRaw: bigint): TierProgress {
  const current = tierFromRaw(totalDonatedRaw);
  const next = TIERS.find((t) => t.id === current + 1) ?? null;
  if (next === null) return { current, next: null, remainingRaw: 0n, progressBp: 10_000n };
  const floor = tierInfo(current)?.thresholdRaw ?? 0n;
  const span = next.thresholdRaw - floor;
  return {
    current,
    next,
    remainingRaw: next.thresholdRaw - totalDonatedRaw,
    progressBp: ((totalDonatedRaw - floor) * 10_000n) / span,
  };
}
