import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import {
  MAX_MESSAGE_LIFETIME_SECONDS,
  NONCE_TTL_SECONDS,
  buildSiweMessage,
  hashNonce,
  issueNonce,
  validateSiweMessage,
  verifySiweSignature,
} from "./siwe";

const account = privateKeyToAccount(generatePrivateKey()); // klucz losowy, tylko na czas testu
const other = privateKeyToAccount(generatePrivateKey());
const NOW = new Date("2026-11-01T12:00:00Z");
const EXPECT = {
  domain: "charonchain.example",
  allowedUris: ["https://charonchain.example"],
  allowedChainIds: [421614],
  now: NOW,
};

const message = (overrides: Partial<Parameters<typeof buildSiweMessage>[0]> = {}): string =>
  buildSiweMessage({
    address: account.address,
    domain: "charonchain.example",
    uri: "https://charonchain.example",
    chainId: 421614,
    nonce: issueNonce().nonce,
    issuedAt: NOW,
    ...overrides,
  });

describe("nonce", () => {
  it("ma 128 bitów entropii (32 znaki hex), jest unikalny, a w bazie ląduje tylko jego SHA-256", () => {
    const a = issueNonce();
    const b = issueNonce();
    expect(a.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.nonceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.nonceHash).toBe(hashNonce(a.nonce));
    expect(a.nonceHash).not.toContain(a.nonce);
  });
});

describe("validateSiweMessage", () => {
  it("akceptuje poprawną wiadomość i zwraca sparsowane pola", () => {
    const result = validateSiweMessage(message(), EXPECT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.address).toBe(account.address);
      expect(result.message.chainId).toBe(421614);
    }
  });

  it.each([
    ["inna domena", { domain: "evil.example" }, "DOMAIN_MISMATCH"],
    ["domena z poddomeną", { domain: "charonchain.example.evil.io" }, "DOMAIN_MISMATCH"],
    ["inny URI", { uri: "https://evil.example" }, "URI_MISMATCH"],
    ["niedozwolona sieć", { chainId: 1 }, "CHAIN_NOT_ALLOWED"],
    ["za krótki nonce", { nonce: "abcdefgh" }, "BAD_NONCE"],
    ["nonce nie z naszego formatu", { nonce: "ABCDEF0123456789ABCDEF0123456789" }, "BAD_NONCE"],
    [
      "issuedAt z przyszłości",
      { issuedAt: new Date(NOW.getTime() + 10 * 60_000) },
      "NOT_YET_VALID",
    ],
    [
      "wygasła wiadomość",
      { issuedAt: new Date(NOW.getTime() - (NONCE_TTL_SECONDS + 1) * 1000) },
      "EXPIRED",
    ],
  ] as const)("odrzuca: %s", (_name, overrides, code) => {
    const result = validateSiweMessage(message(overrides), EXPECT);
    expect(result).toEqual({ ok: false, code });
  });

  it("odrzuca adres bez sumy kontrolnej EIP-55 (małe litery)", () => {
    const raw = message().replace(account.address, account.address.toLowerCase());
    expect(validateSiweMessage(raw, EXPECT)).toEqual({ ok: false, code: "BAD_ADDRESS" });
  });

  it("odrzuca wiadomość bez czasu wygaśnięcia oraz zbyt długo ważną", () => {
    const noExpiry = message().replace(/\nExpiration Time: .*/, "");
    expect(validateSiweMessage(noExpiry, EXPECT)).toEqual({ ok: false, code: "MISSING_TIME" });
    const long = message().replace(
      /Expiration Time: .*/,
      `Expiration Time: ${new Date(NOW.getTime() + (MAX_MESSAGE_LIFETIME_SECONDS + 60) * 1000).toISOString()}`,
    );
    expect(validateSiweMessage(long, EXPECT)).toEqual({ ok: false, code: "LIFETIME_TOO_LONG" });
  });

  it("odrzuca śmieci i wiadomość z inną wersją", () => {
    expect(validateSiweMessage("to nie jest SIWE", EXPECT)).toEqual({
      ok: false,
      code: "MALFORMED",
    });
    expect(validateSiweMessage("", EXPECT)).toEqual({ ok: false, code: "MALFORMED" });
    expect(validateSiweMessage(message().replace("Version: 1", "Version: 2"), EXPECT).ok).toBe(
      false,
    );
  });

  it("oświadczenie wprost mówi, że podpis nie jest zgodą na płatność", () => {
    expect(message()).toContain("Podpis nie przenosi środków");
  });
});

describe("verifySiweSignature", () => {
  it("akceptuje podpis EOA bez dostępu do sieci i odrzuca podpis innego portfela", async () => {
    const raw = message();
    const signature = await account.signMessage({ message: raw });
    const base = { address: account.address, message: raw, chainId: 421614 };
    expect(await verifySiweSignature({ ...base, signature })).toBe(true);
    const foreign = await other.signMessage({ message: raw });
    expect(await verifySiweSignature({ ...base, signature: foreign })).toBe(false);
    expect(await verifySiweSignature({ ...base, signature: `0x${"00".repeat(65)}` })).toBe(false);
    expect(await verifySiweSignature({ ...base, signature: "0x1234" })).toBe(false);
  });

  it("podpis zmodyfikowanej wiadomości nie przechodzi", async () => {
    const raw = message();
    const signature = await account.signMessage({ message: raw });
    expect(
      await verifySiweSignature({
        address: account.address,
        message: `${raw} `,
        signature,
        chainId: 421614,
      }),
    ).toBe(false);
  });

  it("konto kontraktowe: weryfikator jest wołany dopiero, gdy ECDSA nie pasuje, z chainId z wiadomości", async () => {
    const raw = message();
    const calls: { chainId: number; signature: string }[] = [];
    const verifier = (args: { chainId: number; signature: string }): Promise<boolean> => {
      calls.push({ chainId: args.chainId, signature: args.signature });
      return Promise.resolve(true);
    };
    const wrapped =
      `0x${"ab".repeat(120)}6492649264926492649264926492649264926492649264926492649264926492` as const;
    const ok = await verifySiweSignature({
      address: account.address,
      message: raw,
      signature: wrapped,
      chainId: 421614,
      contractVerifier: verifier,
    });
    expect(ok).toBe(true);
    expect(calls).toEqual([{ chainId: 421614, signature: wrapped }]);

    // Poprawny podpis EOA nie wywołuje weryfikatora (brak zbędnych eth_call).
    calls.length = 0;
    const eoa = await account.signMessage({ message: raw });
    await verifySiweSignature({
      address: account.address,
      message: raw,
      signature: eoa,
      chainId: 421614,
      contractVerifier: verifier,
    });
    expect(calls).toHaveLength(0);
  });

  it("awaria weryfikatora lub brak weryfikatora = odmowa (fail-closed)", async () => {
    const raw = message();
    const wrapped = `0x${"cd".repeat(150)}` as const;
    const base = { address: account.address, message: raw, signature: wrapped, chainId: 421614 };
    expect(await verifySiweSignature(base)).toBe(false);
    expect(
      await verifySiweSignature({
        ...base,
        contractVerifier: () => Promise.reject(new Error("RPC down")),
      }),
    ).toBe(false);
    expect(
      await verifySiweSignature({ ...base, contractVerifier: () => Promise.resolve(false) }),
    ).toBe(false);
  });
});
