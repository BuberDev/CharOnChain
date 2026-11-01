/**
 * Weryfikator kont kontraktowych na prawdziwym EVM (EDR): ERC-1271 dla konta wdrożonego i ERC-6492 dla konta,
 * którego jeszcze nie ma (fabryka CREATE2). Sprawdza też, że weryfikacja nie wdraża konta (tylko `eth_call`).
 */
import {
  loadTestArtifact,
  createLocalChain,
  type LocalChain,
} from "@charonchain/contracts/testing";
import {
  encodeFunctionData,
  hashMessage,
  isAddress,
  keccak256,
  serializeErc6492Signature,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createContractSignatureVerifier } from "./contract-verifier";
import { buildSiweMessage, issueNonce, verifySiweSignature } from "./siwe";

const wallet = loadTestArtifact("utils/SignatureWallet.sol/SignatureWallet");
const factory = loadTestArtifact("utils/SignatureWallet.sol/SignatureWalletFactory");

let chain: LocalChain;
let chainId: number;
let factoryAddress: Address;

beforeAll(async () => {
  chain = await createLocalChain();
  chainId = await chain.publicClient.getChainId();
  factoryAddress = await chain.deploy(factory);
});
afterAll(async () => {
  await chain.close();
});

const verifierFor = (allowedFactories: Address[] = [factoryAddress]) =>
  createContractSignatureVerifier({
    clients: { [chainId]: chain.publicClient },
    allowedFactories,
    timeoutMs: 20_000,
  });

const owner = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
const MESSAGE = "Zaloguj się do CharOnChain (test).";
const signRaw = (account: typeof owner, message: string): Promise<Hex> =>
  account.sign({ hash: hashMessage(message) });

describe("ERC-1271 (konto wdrożone)", () => {
  it("podpis właściciela jest poprawny; podpis obcy, inna wiadomość i inny adres — nie", async () => {
    const account = await chain.deploy(wallet, [owner.address]);
    const verify = verifierFor();
    const good = await signRaw(owner, MESSAGE);
    expect(await verify({ address: account, message: MESSAGE, signature: good, chainId })).toBe(
      true,
    );
    expect(
      await verify({
        address: account,
        message: MESSAGE,
        signature: await signRaw(stranger, MESSAGE),
        chainId,
      }),
    ).toBe(false);
    expect(
      await verify({ address: account, message: `${MESSAGE} x`, signature: good, chainId }),
    ).toBe(false);
    const other = await chain.deploy(wallet, [stranger.address]);
    expect(await verify({ address: other, message: MESSAGE, signature: good, chainId })).toBe(
      false,
    );
  });

  it("adres bez kodu (EOA): poprawny podpis ECDSA przechodzi, cudzy nie", async () => {
    const verify = verifierFor();
    const signature = await signRaw(owner, MESSAGE);
    expect(await verify({ address: owner.address, message: MESSAGE, signature, chainId })).toBe(
      true,
    );
    expect(await verify({ address: stranger.address, message: MESSAGE, signature, chainId })).toBe(
      false,
    );
  });

  it("pełna ścieżka verifySiweSignature: konto kontraktowe przechodzi, a bez weryfikatora jest odrzucane (fail-closed)", async () => {
    const account = await chain.deploy(wallet, [owner.address]);
    const message = buildSiweMessage({
      address: account,
      domain: "charonchain.test",
      uri: "https://charonchain.test",
      chainId,
      nonce: issueNonce().nonce,
      issuedAt: new Date(),
    });
    const signature = await signRaw(owner, message);
    expect(
      await verifySiweSignature({
        address: account,
        message,
        signature,
        chainId,
        contractVerifier: verifierFor(),
      }),
    ).toBe(true);
    expect(await verifySiweSignature({ address: account, message, signature, chainId })).toBe(
      false,
    );
  });
});

describe("ERC-6492 (konto jeszcze niewdrożone)", () => {
  const SALT = keccak256(toHex("sol"));

  async function counterfactual(ownerAddress: Address, salt: Hex = SALT) {
    const predicted = (await chain.publicClient.readContract({
      address: factoryAddress,
      abi: factory.abi,
      functionName: "predict",
      args: [ownerAddress, salt],
    })) as Address;
    const createCalldata = encodeFunctionData({
      abi: factory.abi,
      functionName: "create",
      args: [ownerAddress, salt],
    });
    return { predicted, createCalldata };
  }
  const wrap = (factoryAddr: Address, calldata: Hex, inner: Hex): Hex =>
    serializeErc6492Signature({ address: factoryAddr, data: calldata, signature: inner });

  it("poprawny podpis niewdrożonego konta z fabryki z allowlisty przechodzi i NIE wdraża konta", async () => {
    const { predicted, createCalldata } = await counterfactual(owner.address);
    expect(await chain.publicClient.getCode({ address: predicted })).toBeUndefined();
    const inner = await signRaw(owner, MESSAGE);
    const signature = wrap(factoryAddress, createCalldata, inner);
    expect(await verifierFor()({ address: predicted, message: MESSAGE, signature, chainId })).toBe(
      true,
    );
    expect(await chain.publicClient.getCode({ address: predicted })).toBeUndefined(); // tylko eth_call
  });

  it("ta sama poprawna sygnatura z fabryką SPOZA allowlisty jest odrzucona", async () => {
    const { predicted, createCalldata } = await counterfactual(
      owner.address,
      keccak256(toHex("inna")),
    );
    const signature = wrap(factoryAddress, createCalldata, await signRaw(owner, MESSAGE));
    expect(
      await verifierFor([`0x${"9".repeat(40)}`])({
        address: predicted,
        message: MESSAGE,
        signature,
        chainId,
      }),
    ).toBe(false);
  });

  it("podpis obcego dla niewdrożonego konta jest odrzucony", async () => {
    const { predicted, createCalldata } = await counterfactual(
      owner.address,
      keccak256(toHex("obcy")),
    );
    const signature = wrap(factoryAddress, createCalldata, await signRaw(stranger, MESSAGE));
    expect(await verifierFor()({ address: predicted, message: MESSAGE, signature, chainId })).toBe(
      false,
    );
  });

  it("fabryka wywołana z niezgodnym adresem docelowym nie daje fałszywego sukcesu", async () => {
    const { createCalldata } = await counterfactual(owner.address, keccak256(toHex("zly-adres")));
    const signature = wrap(factoryAddress, createCalldata, await signRaw(owner, MESSAGE));
    const wrongTarget: Address = `0x${"7".repeat(40)}`;
    expect(isAddress(wrongTarget)).toBe(true);
    expect(
      await verifierFor()({ address: wrongTarget, message: MESSAGE, signature, chainId }),
    ).toBe(false);
  });
});
