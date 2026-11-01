import { describe, expect, it } from "vitest";

import { formatInteger, formatUsdcLocale } from "./amount";
import { progressBasisPoints } from "./meter";

const USDC = 1_000_000n;
const NBSP = " ";

describe("formatUsdcLocale", () => {
  it("PL: przecinek dziesiętny i niełamliwa spacja jako separator tysięcy", () => {
    expect(formatUsdcLocale(3_420_500_000n, "pl")).toBe(`3${NBSP}420,50`);
    expect(formatUsdcLocale(25n * USDC, "pl")).toBe("25,00");
  });

  it("EN: kropka dziesiętna i przecinek jako separator tysięcy", () => {
    expect(formatUsdcLocale(3_420_500_000n, "en")).toBe("3,420.50");
    expect(formatUsdcLocale(25n * USDC, "en")).toBe("25.00");
  });

  it("nigdy nie zaokrągla: pokazuje wszystkie znaczące miejsca, do 6 cyfr", () => {
    expect(formatUsdcLocale(1n, "en")).toBe("0.000001");
    expect(formatUsdcLocale(1_234_567n, "en")).toBe("1.234567");
    expect(formatUsdcLocale(999_999n, "en")).toBe("0.999999");
  });

  it("jest dokładny dla wartości powyżej 2^53 (bez liczb zmiennoprzecinkowych)", () => {
    const big = 9_007_199_254_740_993n * USDC; // 2^53 + 1 USDC
    expect(formatUsdcLocale(big, "en", 0)).toBe("9,007,199,254,740,993");
  });

  it("minFractionDigits=0 ucina tylko zbędne zera", () => {
    expect(formatUsdcLocale(10_000n * USDC, "pl", 0)).toBe(`10${NBSP}000`);
    expect(formatUsdcLocale(500_000n, "pl", 0)).toBe("0,5");
  });
});

describe("formatInteger", () => {
  it("grupuje tysiące według języka", () => {
    expect(formatInteger(1_234_567n, "pl")).toBe(`1${NBSP}234${NBSP}567`);
    expect(formatInteger(1_234_567n, "en")).toBe("1,234,567");
    expect(formatInteger(250n, "pl")).toBe("250");
    expect(formatInteger(0n, "en")).toBe("0");
  });
});

describe("progressBasisPoints", () => {
  it("liczy punkty bazowe w arytmetyce całkowitej, z zaokrągleniem w dół", () => {
    expect(progressBasisPoints(1n, 3n)).toBe(3333);
    expect(progressBasisPoints(3_420_500_000n, 10_000n * USDC)).toBe(3420);
    expect(progressBasisPoints(0n, 10n * USDC)).toBe(0);
  });

  it("ogranicza do 100% i nie dzieli przez zero", () => {
    expect(progressBasisPoints(11n * USDC, 10n * USDC)).toBe(10_000);
    expect(progressBasisPoints(10n * USDC, 10n * USDC)).toBe(10_000);
    expect(progressBasisPoints(5n, 0n)).toBe(0);
    expect(progressBasisPoints(5n, -1n)).toBe(0);
  });

  it("nie pokazuje 100% przed domknięciem celu (zawsze w dół)", () => {
    expect(progressBasisPoints(9_999_999n, 10n * USDC)).toBe(9999);
  });

  it("jest dokładne dla bardzo dużych kwot", () => {
    const cap = 2n ** 200n;
    expect(progressBasisPoints(cap / 2n, cap)).toBe(5000);
  });
});
