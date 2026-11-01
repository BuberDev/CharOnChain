import { serializeErc6492Signature, type Address, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";

import { MAX_CONTRACT_SIGNATURE_BYTES, createContractSignatureVerifier } from "./contract-verifier";

const addr = (c: string): Address => `0x${c.repeat(40)}`;
const WALLET = addr("1");
const FACTORY = addr("f");
const OTHER_FACTORY = addr("e");

/** Podpis owinięty ERC-6492 (serializacja viem): abi.encode(factory, calldata, sig) ++ magic. */
const wrapped6492 = (factory: Address): Hex =>
  serializeErc6492Signature({
    address: factory,
    data: "0x1234",
    signature: `0x${"ab".repeat(65)}`,
  });

const args = (signature: Hex, chainId = 421614) => ({
  address: WALLET,
  message: "wiadomość",
  signature,
  chainId,
});
const ecdsaLike: Hex = `0x${"ab".repeat(65)}`;

describe("createContractSignatureVerifier (bez sieci)", () => {
  it("sieć spoza allowlisty → odmowa i brak wywołania RPC", async () => {
    const verifyMessage = vi.fn(() => Promise.resolve(true));
    const verify = createContractSignatureVerifier({
      clients: { 421614: { verifyMessage } },
      allowedFactories: [],
    });
    expect(await verify(args(ecdsaLike, 1))).toBe(false);
    expect(await verify(args(ecdsaLike, 421614))).toBe(true);
    expect(verifyMessage).toHaveBeenCalledTimes(1);
  });

  it("zbyt duży lub niepoprawny podpis → odmowa bez RPC (limit eth_call)", async () => {
    const verifyMessage = vi.fn(() => Promise.resolve(true));
    const verify = createContractSignatureVerifier({
      clients: { 421614: { verifyMessage } },
      allowedFactories: [],
    });
    const tooBig: Hex = `0x${"00".repeat(MAX_CONTRACT_SIGNATURE_BYTES + 1)}`;
    const exact: Hex = `0x${"00".repeat(MAX_CONTRACT_SIGNATURE_BYTES)}`;
    expect(await verify(args(tooBig))).toBe(false);
    expect(await verify(args("0xzz"))).toBe(false);
    expect(await verify(args("0x"))).toBe(false);
    expect(verifyMessage).not.toHaveBeenCalled();
    expect(await verify(args(exact))).toBe(true);
  });

  it("ERC-6492: fabryka spoza allowlisty → odmowa bez RPC; z allowlisty → weryfikacja (wielkość liter bez znaczenia)", async () => {
    const verifyMessage = vi.fn(() => Promise.resolve(true));
    const verify = createContractSignatureVerifier({
      clients: { 421614: { verifyMessage } },
      allowedFactories: [FACTORY.toUpperCase().replace("0X", "0x") as Address],
    });
    expect(await verify(args(wrapped6492(OTHER_FACTORY)))).toBe(false);
    expect(verifyMessage).not.toHaveBeenCalled();
    expect(await verify(args(wrapped6492(FACTORY)))).toBe(true);
    expect(verifyMessage).toHaveBeenCalledTimes(1);
  });

  it("fail-closed: błąd RPC, timeout i odpowiedź inna niż jawne true → false", async () => {
    const make = (impl: () => Promise<unknown>) =>
      createContractSignatureVerifier({
        clients: { 421614: { verifyMessage: impl as never } },
        allowedFactories: [],
        timeoutMs: 30,
      });
    expect(await make(() => Promise.reject(new Error("rpc down")))(args(ecdsaLike))).toBe(false);
    expect(await make(() => new Promise(() => undefined))(args(ecdsaLike))).toBe(false);
    expect(await make(() => Promise.resolve(1))(args(ecdsaLike))).toBe(false);
    expect(await make(() => Promise.resolve("true"))(args(ecdsaLike))).toBe(false);
    expect(await make(() => Promise.resolve(false))(args(ecdsaLike))).toBe(false);
    expect(await make(() => Promise.resolve(true))(args(ecdsaLike))).toBe(true);
  });

  it("timeout nie opóźnia szybkiej odpowiedzi i nie zostawia aktywnego timera", async () => {
    vi.useFakeTimers();
    try {
      const verify = createContractSignatureVerifier({
        clients: { 421614: { verifyMessage: () => Promise.resolve(true) } },
        allowedFactories: [],
        timeoutMs: 60_000,
      });
      expect(await verify(args(ecdsaLike))).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
