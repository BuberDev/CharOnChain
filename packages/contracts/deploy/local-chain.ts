/**
 * Łańcuch lokalny w procesie (EDR z Hardhat 3) dla testów, które potrzebują prawdziwego EVM: skrypt wdrożenia,
 * weryfikator podpisów kont kontraktowych. WYŁĄCZNIE testy — nie łączy się z żadną siecią.
 */
import hre from "hardhat";
import {
  createPublicClient,
  createWalletClient,
  custom,
  getAddress,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";

import { loadArtifact, type ContractName } from "./artifacts.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface TestArtifact {
  readonly abi: Abi;
  readonly bytecode: Hex;
}

/** Artefakt kontraktu pomocniczego z `test/` (np. `utils/MockUSDC.sol/MockUSDC`). */
export function loadTestArtifact(path: string): TestArtifact {
  const parsed = JSON.parse(
    readFileSync(join(packageRoot, "artifacts", "test", `${path}.json`), "utf8"),
  ) as {
    abi: Abi;
    bytecode: Hex;
  };
  return { abi: parsed.abi, bytecode: parsed.bytecode };
}

export interface LocalChain {
  readonly publicClient: PublicClient;
  readonly accounts: readonly Address[];
  wallet(address: Address): WalletClient;
  increaseTime(seconds: number): Promise<void>;
  deploy(
    artifact: TestArtifact | ContractName,
    args?: readonly unknown[],
    from?: Address,
  ): Promise<Address>;
  close(): Promise<void>;
}

export async function createLocalChain(): Promise<LocalChain> {
  const connection = await hre.network.create();
  const transport = custom(connection.provider as never);
  const publicClient = createPublicClient({ transport });
  const accounts = (
    (await connection.provider.request({ method: "eth_accounts" })) as string[]
  ).map((a) => getAddress(a));
  const wallet = (address: Address): WalletClient =>
    createWalletClient({ account: address, transport });
  return {
    publicClient,
    accounts,
    wallet,
    async increaseTime(seconds) {
      await connection.provider.request({ method: "evm_increaseTime", params: [seconds] });
      await connection.provider.request({ method: "evm_mine", params: [] });
    },
    async deploy(artifact, args = [], sender) {
      const from = sender ?? accounts[0];
      if (from === undefined) throw new Error("brak kont w łańcuchu lokalnym");
      const loaded = typeof artifact === "string" ? loadArtifact(artifact) : artifact;
      const hash = await wallet(from).deployContract({
        abi: loaded.abi,
        bytecode: loaded.bytecode,
        args,
        account: from,
        chain: null,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success" || receipt.contractAddress == null)
        throw new Error("wdrożenie nie powiodło się");
      return getAddress(receipt.contractAddress);
    },
    async close() {
      await connection.close();
    },
  };
}
