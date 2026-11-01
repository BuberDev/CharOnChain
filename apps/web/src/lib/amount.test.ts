import { MIN_DONATION_RAW } from "@charonchain/shared";
import { describe, expect, it } from "vitest";

import { amountToInput, validateAmount } from "./amount";

const USDC = 1_000_000n;
const REMAINING = 6_579_500_000n; // 6 579,50 USDC

describe("validateAmount — poprawne kwoty", () => {
  it.each([
    ["25", 25n * USDC],
    ["1", 1n * USDC],
    ["12.5", 12_500_000n],
    ["12,5", 12_500_000n],
    ["  10  ", 10n * USDC],
  ])("akceptuje %j", (input, expected) => {
    expect(validateAmount(input, REMAINING)).toEqual({ state: "ok", raw: expected });
  });

  it("akceptuje dokładnie pozostały limit", () => {
    expect(validateAmount("6579.50", REMAINING)).toEqual({ state: "ok", raw: REMAINING });
  });

  it("wyjątek końcówki celu: kwota poniżej 1 USDC jest dozwolona tylko gdy dokładnie domyka limit", () => {
    expect(validateAmount("0.5", 500_000n)).toEqual({ state: "ok", raw: 500_000n });
    const notClosing = validateAmount("0.4", 500_000n);
    expect(notClosing.state).toBe("error");
    if (notClosing.state === "error") expect(notClosing.code).toBe("BELOW_MINIMUM");
  });
});

describe("validateAmount — błędy parsowania (bez podpowiedzi kwoty)", () => {
  it.each([
    ["", "EMPTY"],
    ["   ", "EMPTY"],
    ["abc", "FORMAT"],
    ["-5", "FORMAT"],
    ["1e3", "FORMAT"],
    ["1.000.50", "FORMAT"],
    ["1,000.50", "FORMAT"],
    ["007", "FORMAT"],
    ["1.2345678", "TOO_MANY_DECIMALS"],
  ])("odrzuca %j jako %s", (input, code) => {
    expect(validateAmount(input, REMAINING)).toEqual({ state: "error", code, suggestRaw: null });
  });

  it("nie zaokrągla po cichu: siedem miejsc po przecinku to błąd, nie 1,23", () => {
    expect(validateAmount("1,2345678", REMAINING).state).toBe("error");
  });
});

describe("validateAmount — reguły limitu", () => {
  it("kwota ponad pozostały limit: CAP_EXCEEDED z podpowiedzią równą limitowi", () => {
    expect(validateAmount("7000", REMAINING)).toEqual({
      state: "error",
      code: "CAP_EXCEEDED",
      suggestRaw: REMAINING,
    });
  });

  it("cel osiągnięty: CAP_REACHED bez podpowiedzi", () => {
    expect(validateAmount("10", 0n)).toEqual({
      state: "error",
      code: "CAP_REACHED",
      suggestRaw: null,
    });
  });

  it("zero to INVALID_AMOUNT bez podpowiedzi", () => {
    expect(validateAmount("0", REMAINING)).toEqual({
      state: "error",
      code: "INVALID_AMOUNT",
      suggestRaw: null,
    });
  });

  it("poniżej minimum podpowiada minimum (1 USDC), a NIE cały pozostały limit", () => {
    const result = validateAmount("0.5", REMAINING);
    expect(result).toEqual({ state: "error", code: "BELOW_MINIMUM", suggestRaw: MIN_DONATION_RAW });
  });

  it("poniżej minimum, gdy limit jest mniejszy niż minimum: podpowiada dokładnie domknięcie", () => {
    const result = validateAmount("0.1", 500_000n);
    expect(result).toEqual({ state: "error", code: "BELOW_MINIMUM", suggestRaw: 500_000n });
  });

  it("żadna podpowiedź nigdy nie przekracza pozostałego limitu ani nie jest zerem", () => {
    for (const input of ["0.5", "0.999999", "7000", "1000000", "0.1"]) {
      for (const remaining of [500_000n, 1n * USDC, 3n * USDC, REMAINING]) {
        const result = validateAmount(input, remaining);
        if (result.state === "error" && result.suggestRaw !== null) {
          expect(result.suggestRaw).toBeGreaterThan(0n);
          expect(result.suggestRaw).toBeLessThanOrEqual(remaining);
        }
      }
    }
  });
});

describe("amountToInput — tekst wstawiany do pola musi przechodzić walidację", () => {
  it.each([
    1n * USDC,
    25n * USDC,
    500_000n,
    1_234_567n,
    999n * USDC,
    1_000n * USDC,
    6_579_500_000n,
    10_000n * USDC,
    1_234_567_890_123n,
  ])("%s jednostek: zapis kanoniczny i pełny roundtrip", (raw) => {
    const text = amountToInput(raw);
    expect(text).toMatch(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/); // bez separatora tysięcy, bez przecinka
    // limit równy kwocie => walidator musi ją przyjąć bez żadnej zmiany wartości
    expect(validateAmount(text, raw)).toEqual({ state: "ok", raw });
  });

  it("nie dodaje zbędnych zer ani separatora tysięcy", () => {
    expect(amountToInput(6_579_500_000n)).toBe("6579.5");
    expect(amountToInput(10_000n * USDC)).toBe("10000");
    expect(amountToInput(500_000n)).toBe("0.5");
  });

  it("podpowiedź z każdego błędu limitu da się zastosować i jest przyjmowana", () => {
    for (const [input, remaining] of [
      ["7000", 6_579_500_000n],
      ["0.5", 6_579_500_000n],
      ["99999", 1_234_567_000n],
      ["0.1", 500_000n],
    ] as const) {
      const first = validateAmount(input, remaining);
      expect(first.state).toBe("error");
      if (first.state !== "error" || first.suggestRaw === null) throw new Error("brak podpowiedzi");
      expect(validateAmount(amountToInput(first.suggestRaw), remaining)).toEqual({
        state: "ok",
        raw: first.suggestRaw,
      });
    }
  });
});
