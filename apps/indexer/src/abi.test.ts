import { readFileSync } from "node:fs";

import { toEventSelector, type AbiEvent } from "viem";
import { describe, expect, it } from "vitest";

import { ALL_EVENTS } from "./abi.js";

/** ABI indexera musi być lustrem interfejsu kontraktów (docs/02 §4): inaczej logi byłyby dekodowane błędnie. */
describe("ABI zdarzeń == interfejs Solidity", () => {
  const source = readFileSync(
    new URL("../../../contracts/src/interfaces/ICharOnChain.sol", import.meta.url),
    "utf8",
  );
  const declared = [...source.matchAll(/event\s+(\w+)\s*\(([\s\S]*?)\)\s*;/g)].map((m) => {
    const name = m[1] ?? "";
    const types = (m[2] ?? "")
      .split(",")
      .map((p) => p.trim().split(/\s+/)[0] ?? "")
      .filter((t) => t !== "");
    return { name, signature: `${name}(${types.join(",")})` };
  });

  it("interfejs deklaruje dokładnie 9 zdarzeń i wszystkie są w ABI indexera", () => {
    expect(declared.map((d) => d.name).sort()).toEqual(ALL_EVENTS.map((e) => e.name).sort());
    expect(declared).toHaveLength(9);
  });

  it.each(declared)("selektor $name zgadza się z interfejsem", ({ name, signature }) => {
    const event = (ALL_EVENTS as readonly AbiEvent[]).find((e) => e.name === name);
    expect(event).toBeDefined();
    if (event === undefined) return;
    const fromAbi = toEventSelector(event);
    const fromSolidity = toEventSelector(`event ${signature}`);
    expect(fromAbi).toBe(fromSolidity);
  });
});
