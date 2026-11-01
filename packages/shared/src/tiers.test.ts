import { describe, expect, it } from "vitest";

import { progressToNextTier, TIERS, tierFromRaw, tierInfo, xpFromRaw, XP_DIVISOR } from "./tiers";
import { MAX_UINT256, USDC_UNIT } from "./usdc";

describe("progi lig — AC-16", () => {
  it("tabela z AC-16: sumy (USDC) → liga", () => {
    const totals = [0, 1, 99, 100, 999, 1000, 9999, 10000, 24999, 25000, 99999, 100000];
    const tiers = [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6];
    totals.forEach((usdc, i) => {
      expect(tierFromRaw(BigInt(usdc) * USDC_UNIT), `${String(usdc)} USDC`).toBe(tiers[i]);
    });
  });

  it("XP = floor(raw / 100000); 1 USDC = 10 XP", () => {
    expect(xpFromRaw(0n)).toBe(0n);
    expect(xpFromRaw(99_999n)).toBe(0n);
    expect(xpFromRaw(100_000n)).toBe(1n);
    expect(xpFromRaw(USDC_UNIT)).toBe(10n);
    expect(xpFromRaw(99n * USDC_UNIT)).toBe(990n);
    expect(xpFromRaw(5_123_456n)).toBe(51n); // zaokrąglenie w dół
  });

  it("granice co do jednostki najmniejszej (próg −1 / próg / próg +1)", () => {
    for (const tier of TIERS) {
      const below = tierFromRaw(tier.thresholdRaw - 1n);
      expect(below, `${tier.name} − 1`).toBe(tier.id - 1);
      expect(tierFromRaw(tier.thresholdRaw), tier.name).toBe(tier.id);
      expect(tierFromRaw(tier.thresholdRaw + 1n), `${tier.name} + 1`).toBe(tier.id);
    }
  });

  it("XP na progu zgadza się z tabelą PRD (minimalne XP ligi)", () => {
    for (const tier of TIERS) {
      expect(xpFromRaw(tier.thresholdRaw), tier.name).toBe(tier.minXp);
      expect(tier.thresholdRaw / XP_DIVISOR).toBe(tier.minXp);
    }
  });

  it("progi są ściśle rosnące, a identyfikatory ciągłe 1..6", () => {
    TIERS.forEach((tier, i) => {
      expect(tier.id).toBe(i + 1);
      if (i > 0) expect(tier.thresholdRaw).toBeGreaterThan(TIERS[i - 1]?.thresholdRaw ?? 0n);
    });
    expect(TIERS).toHaveLength(6);
  });

  it("wartości brzegowe uint256 i błędy zakresu", () => {
    expect(tierFromRaw(MAX_UINT256)).toBe(6);
    expect(() => tierFromRaw(-1n)).toThrow(RangeError);
    expect(() => tierFromRaw(MAX_UINT256 + 1n)).toThrow(RangeError);
    expect(() => xpFromRaw(-1n)).toThrow(RangeError);
  });

  it("fuzz: monotoniczność ligi i XP", () => {
    let seed = 0x1234_5678_9abcn;
    const next = (): bigint => {
      seed = (seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
      return seed;
    };
    for (let i = 0; i < 2_000; i++) {
      const a = next() % (200_000n * USDC_UNIT);
      const b = a + (next() % (50_000n * USDC_UNIT));
      expect(tierFromRaw(b)).toBeGreaterThanOrEqual(tierFromRaw(a));
      expect(xpFromRaw(b)).toBeGreaterThanOrEqual(xpFromRaw(a));
    }
  });
});

describe("tierInfo / progressToNextTier", () => {
  it("tierInfo(0) to brak ligi", () => {
    expect(tierInfo(0)).toBeNull();
    expect(tierInfo(1)?.name).toBe("Supporter");
    expect(tierInfo(6)?.name).toBe("Diamond");
  });

  it("zero wpłat: następna Supporter, brakuje 1 USDC", () => {
    const p = progressToNextTier(0n);
    expect(p.current).toBe(0);
    expect(p.next?.name).toBe("Supporter");
    expect(p.remainingRaw).toBe(USDC_UNIT);
    expect(p.progressBp).toBe(0n);
  });

  it("w środku przedziału: Bronze → Silver", () => {
    // 550 USDC: między 100 a 1000 → (550−100)/(1000−100) = 50%
    const p = progressToNextTier(550n * USDC_UNIT);
    expect(p.current).toBe(2);
    expect(p.next?.name).toBe("Silver");
    expect(p.remainingRaw).toBe(450n * USDC_UNIT);
    expect(p.progressBp).toBe(5_000n);
  });

  it("najwyższa liga: brak następnej, postęp 100%", () => {
    const p = progressToNextTier(100_000n * USDC_UNIT);
    expect(p).toMatchObject({ current: 6, next: null, remainingRaw: 0n, progressBp: 10_000n });
  });

  it("postęp nigdy nie przekracza 10000 bp ani nie jest ujemny", () => {
    for (const tier of TIERS) {
      for (const total of [tier.thresholdRaw - 1n, tier.thresholdRaw, tier.thresholdRaw + 1n]) {
        const p = progressToNextTier(total);
        expect(p.progressBp).toBeGreaterThanOrEqual(0n);
        expect(p.progressBp).toBeLessThanOrEqual(10_000n);
      }
    }
  });
});
