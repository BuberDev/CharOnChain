import { describe, expect, it } from "vitest";

import { CanonicalJsonError, canonicalBytes, canonicalize, contentSha256 } from "./canonical-json";

describe("RFC 8785 — przykłady z dokumentu", () => {
  it("sortuje klucze według jednostek kodu UTF-16 (§3.2.3, przykład z sortowaniem)", () => {
    const input = {
      "\u20ac": "Euro Sign",
      "\r": "Carriage Return",
      "\ufb33": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "\ud83d\ude00": "Emoji: Grinning Face",
      "\u0080": "Control",
      "\u00f6": "Latin Small Letter O With Diaeresis",
    };
    // Sprawdzamy napis wynikowy (JSON.parse zmieniłby kolejność kluczy-liczb).
    expect(canonicalize(input)).toBe(
      '{"\\r":"Carriage Return","1":"One","\u0080":"Control","\u00f6":"Latin Small Letter O With Diaeresis",' +
        '"\u20ac":"Euro Sign","\ud83d\ude00":"Emoji: Grinning Face","\ufb33":"Hebrew Letter Dalet With Dagesh"}',
    );
  });

  it("serializuje liczby jak ECMAScript (tabela z §3.2.2.3)", () => {
    const cases: [number, string][] = [
      [333333333.33333329, "333333333.3333333"],
      [1e30, "1e+30"],
      [4.5, "4.5"],
      [0.002, "0.002"],
      [1e-27, "1e-27"],
      [0, "0"],
      [-0, "0"],
      [1.0, "1"],
      [1e21, "1e+21"],
      [123456789012345680000, "123456789012345680000"],
      [-1e-7, "-1e-7"],
    ];
    for (const [value, expected] of cases) expect(canonicalize(value)).toBe(expected);
  });

  it("przykład z §3.2.2: literały, napisy i tablica", () => {
    const input = {
      numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 1e-27],
      string: "\u20ac$\u000f\u000aA'\u0042\u0022\u005c\\\"/",
      literals: [null, true, false],
    };
    expect(canonicalize(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it("nie zostawia białych znaków i zagnieżdża obiekty rekurencyjnie", () => {
    expect(canonicalize({ b: { z: 1, a: [3, { y: 2, x: 1 }] }, a: "x" })).toBe(
      '{"a":"x","b":{"a":[3,{"x":1,"y":2}],"z":1}}',
    );
  });

  it("escapuje znaki sterujące małymi literami hex i nie escapuje reszty (np. polskie znaki, /)", () => {
    expect(canonicalize("\u001f\u007f/ąę")).toBe('"\\u001f\u007f/ąę"');
  });
});

describe("wejście odrzucane zamiast naprawiane", () => {
  it.each([
    ["undefined", { a: undefined }, "$.a"],
    ["NaN", { a: Number.NaN }, "$.a"],
    ["Infinity", [Number.POSITIVE_INFINITY], "$[0]"],
    ["BigInt", { amount: 1n }, "$.amount"],
    ["funkcja", { f: () => 1 }, "$.f"],
    ["Date", { d: new Date(0) }, "$.d"],
    ["Map", { m: new Map() }, "$.m"],
    ["niesparowany surogat w wartości", { s: "\ud800" }, "$.s"],
    ["niesparowany surogat w kluczu", { "\udc00": 1 }, "$.\udc00"],
  ])("%s", (_name, value, path) => {
    expect(() => canonicalize(value)).toThrow(CanonicalJsonError);
    try {
      canonicalize(value);
    } catch (error) {
      expect((error as CanonicalJsonError).path).toBe(path);
    }
  });

  it("obiekty bez prototypu są dozwolone", () => {
    const bare = Object.create(null) as Record<string, number>;
    bare.b = 1;
    bare.a = 2;
    expect(canonicalize(bare)).toBe('{"a":2,"b":1}');
  });
});

describe("contentSha256 (AC-24)", () => {
  // Fixture niezależny od TS: ten sam hash liczy Python hashlib i test Solidity (ImpactRegistry.t.sol).
  const report = {
    campaignId: 1,
    servedMeals: 1200,
    period: { from: "2026-11-01", to: "2027-02-28" },
  };
  const EXPECTED = "0xaf0fb0d267400419fc5bfc340c1e6b9655f66e9361d46246e8a006f256e8fbd3";

  it("kanonizacja daje dokładnie bajty użyte w teście Solidity, a hash jest identyczny", () => {
    expect(canonicalize(report)).toBe(
      '{"campaignId":1,"period":{"from":"2026-11-01","to":"2027-02-28"},"servedMeals":1200}',
    );
    expect(contentSha256(report)).toBe(EXPECTED);
  });

  it("kolejność kluczy wejścia nie wpływa na hash", () => {
    const shuffled = {
      servedMeals: 1200,
      period: { to: "2027-02-28", from: "2026-11-01" },
      campaignId: 1,
    };
    expect(contentSha256(shuffled)).toBe(EXPECTED);
  });

  it("zmiana jednego bajtu treści zmienia hash (mismatch wykrywalny)", () => {
    expect(contentSha256({ ...report, servedMeals: 1201 })).not.toBe(EXPECTED);
  });

  it("hashuje bajty UTF-8 (wielobajtowe znaki)", () => {
    expect(canonicalBytes({ a: "ą" })).toEqual(new TextEncoder().encode('{"a":"ą"}'));
    expect(contentSha256({ a: "ą" })).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
