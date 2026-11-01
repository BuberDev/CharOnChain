import { describe, expect, it } from "vitest";

import {
  checkDonationAmount,
  formatUsdc,
  MAX_UINT256,
  MIN_DONATION_RAW,
  parseUsdc,
  rawFromJson,
  rawToJson,
  USDC_UNIT,
} from "./usdc";

/** Deterministyczny xorshift64 — fuzz bez zależności i bez niedeterminizmu w CI. */
function* randoms(seed: bigint): Generator<bigint> {
  const mask = (1n << 64n) - 1n;
  let s = seed & mask;
  for (;;) {
    s ^= (s << 13n) & mask;
    s ^= s >> 7n;
    s ^= (s << 17n) & mask;
    yield s;
  }
}

function random256(gen: Generator<bigint>): bigint {
  let value = 0n;
  for (let i = 0; i < 4; i++) value = (value << 64n) | (gen.next().value as bigint);
  return value;
}

describe("parseUsdc", () => {
  it.each([
    ["0", 0n],
    ["1", 1_000_000n],
    ["5", 5_000_000n],
    ["0.5", 500_000n],
    ["0.000001", 1n],
    ["5.123456", 5_123_456n],
    ["100000", 100_000_000_000n],
    ["12.30", 12_300_000n],
  ])("przyjmuje %s", (input, expected) => {
    expect(parseUsdc(input)).toEqual({ ok: true, raw: expected });
  });

  it.each([
    ["", "EMPTY"],
    [" 5", "FORMAT"],
    ["5 ", "FORMAT"],
    ["-1", "FORMAT"],
    ["+1", "FORMAT"],
    ["1,5", "FORMAT"],
    [".5", "FORMAT"],
    ["5.", "FORMAT"],
    ["1e6", "FORMAT"],
    ["0x10", "FORMAT"],
    ["NaN", "FORMAT"],
    ["Infinity", "FORMAT"],
    ["007", "FORMAT"],
    ["１２", "FORMAT"], // cyfry pełnoszerokościowe
    ["1.1234567", "TOO_MANY_DECIMALS"],
    ["0.0000001", "TOO_MANY_DECIMALS"],
  ] as const)("odrzuca %j (%s)", (input, code) => {
    expect(parseUsdc(input)).toEqual({ ok: false, code });
  });

  it("NIE zaokrągla nadmiarowych miejsc dziesiętnych (brak cichej utraty pieniędzy)", () => {
    expect(parseUsdc("1.9999999")).toEqual({ ok: false, code: "TOO_MANY_DECIMALS" });
  });

  it("odrzuca wartość powyżej uint256", () => {
    const tooBig = formatUsdc(MAX_UINT256, { minFractionDigits: 0 });
    expect(parseUsdc(tooBig)).toEqual({ ok: true, raw: MAX_UINT256 });
    // Zwiększamy część całkowitą o 1 USDC → przekroczenie uint256.
    const over = (MAX_UINT256 / USDC_UNIT + 1n).toString();
    expect(parseUsdc(over)).toEqual({ ok: false, code: "OVERFLOW" });
  });
});

describe("formatUsdc", () => {
  it.each([
    [0n, "0.00"],
    [1n, "0.000001"],
    [500_000n, "0.50"],
    [5_000_000n, "5.00"],
    [5_123_456n, "5.123456"],
    [5_120_000n, "5.12"],
    [1_000_000_000_000n, "1000000.00"],
  ])("formatuje %s → %s", (raw, expected) => {
    expect(formatUsdc(raw)).toBe(expected);
  });

  it("nigdy nie obcina cyfr znaczących (docs/04 §1)", () => {
    expect(formatUsdc(1_000_001n)).toBe("1.000001");
    expect(formatUsdc(1_000_010n)).toBe("1.00001");
  });

  it("obsługuje minFractionDigits, separator dziesiętny i tysięcy", () => {
    expect(formatUsdc(5_000_000n, { minFractionDigits: 0 })).toBe("5");
    expect(formatUsdc(5_000_000n, { minFractionDigits: 6 })).toBe("5.000000");
    expect(formatUsdc(1_234_567_890_000n, { groupSeparator: " ", decimalSeparator: "," })).toBe(
      "1 234 567,89",
    );
    expect(formatUsdc(999n * USDC_UNIT, { groupSeparator: " " })).toBe("999.00");
  });

  it("rzuca RangeError poza zakresem", () => {
    expect(() => formatUsdc(-1n)).toThrow(RangeError);
    expect(() => formatUsdc(MAX_UINT256 + 1n)).toThrow(RangeError);
    expect(() => formatUsdc(1n, { minFractionDigits: 7 })).toThrow(RangeError);
    expect(() => formatUsdc(1n, { minFractionDigits: 1.5 })).toThrow(RangeError);
  });

  it("round-trip parse(format(x)) == x dla wartości brzegowych i losowych", () => {
    const edge = [0n, 1n, 999_999n, 1_000_000n, 1_000_001n, 99_999_999n, MAX_UINT256];
    const gen = randoms(0x5eedn);
    const fuzz = Array.from({ length: 500 }, () => random256(gen));
    for (const raw of [...edge, ...fuzz]) {
      const text = formatUsdc(raw, { minFractionDigits: 0 });
      expect(parseUsdc(text)).toEqual({ ok: true, raw });
    }
  });
});

describe("serializacja JSON (kwoty jako string)", () => {
  it("round-trip", () => {
    expect(rawToJson(5_123_456n)).toBe("5123456");
    expect(rawFromJson("5123456")).toBe(5_123_456n);
    expect(rawFromJson(rawToJson(MAX_UINT256))).toBe(MAX_UINT256);
  });

  it("odrzuca niepoprawne wejścia", () => {
    for (const bad of [5_123_456, "5.1", "-1", "01", "", " 1", null, undefined, {}, "1e3"]) {
      expect(rawFromJson(bad)).toBeNull();
    }
    expect(rawFromJson((MAX_UINT256 + 1n).toString())).toBeNull();
    expect(() => rawToJson(-1n)).toThrow(RangeError);
  });
});

describe("checkDonationAmount — lustro reguł DonationRouter (AC-04)", () => {
  const usdc = (n: number): bigint => BigInt(n) * USDC_UNIT;

  it("AC-04: 8 USDC wolnego limitu, wpłata 9 → przekroczenie, 8 → ok", () => {
    expect(checkDonationAmount(usdc(9), usdc(8))).toEqual({
      ok: false,
      code: "CAP_EXCEEDED",
      maxAllowedRaw: usdc(8),
    });
    expect(checkDonationAmount(usdc(8), usdc(8))).toEqual({ ok: true });
  });

  it("AC-04: reszta 0.5 USDC — dokładnie 0.5 przechodzi, 0.4 nie", () => {
    expect(checkDonationAmount(500_000n, 500_000n)).toEqual({ ok: true });
    expect(checkDonationAmount(400_000n, 500_000n)).toEqual({
      ok: false,
      code: "BELOW_MINIMUM",
      maxAllowedRaw: 500_000n,
    });
  });

  it("minimum 1 USDC jest włącznie", () => {
    expect(checkDonationAmount(MIN_DONATION_RAW - 1n, usdc(5))).toMatchObject({
      ok: false,
      code: "BELOW_MINIMUM",
    });
    expect(checkDonationAmount(MIN_DONATION_RAW, usdc(5))).toEqual({ ok: true });
  });

  it("brak miejsca w limicie → CAP_REACHED", () => {
    expect(checkDonationAmount(usdc(1), 0n)).toEqual({
      ok: false,
      code: "CAP_REACHED",
      maxAllowedRaw: 0n,
    });
  });

  it("kwota zerowa lub ujemna → INVALID_AMOUNT", () => {
    expect(checkDonationAmount(0n, usdc(5))).toMatchObject({ ok: false, code: "INVALID_AMOUNT" });
    expect(checkDonationAmount(-1n, usdc(5))).toMatchObject({ ok: false, code: "INVALID_AMOUNT" });
  });

  it("zawsze proponuje pozostały limit jako maksimum", () => {
    const result = checkDonationAmount(usdc(100), usdc(7));
    expect(result).toMatchObject({ ok: false, maxAllowedRaw: usdc(7) });
  });

  it("fuzz: wynik ok ⇔ spełnione reguły kontraktu", () => {
    const gen = randoms(0xc0ffeen);
    for (let i = 0; i < 2_000; i++) {
      const remaining = (gen.next().value as bigint) % (50n * USDC_UNIT);
      const amount = (gen.next().value as bigint) % (60n * USDC_UNIT);
      const expected =
        remaining > 0n &&
        amount > 0n &&
        amount <= remaining &&
        (amount >= MIN_DONATION_RAW || amount === remaining);
      expect(checkDonationAmount(amount, remaining).ok).toBe(expected);
    }
  });
});
