/**
 * Abstrakcja RPC używana przez indexer. Wąski interfejs ułatwia testy na symulowanym łańcuchu (reorgi) i
 * pozwala podmienić dostawcę (RPC test/mainnet rozdzielone, docs/03 §6). Adapter viem: `createViemRpc`.
 */
import { parseAbi, type Address, type Hex, type PublicClient } from "viem";

export interface RawLog {
  readonly address: Address;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly transactionHash: Hex;
  readonly transactionIndex: number;
  readonly logIndex: number;
  readonly topics: readonly Hex[];
  readonly data: Hex;
}

export interface BlockInfo {
  readonly hash: Hex;
  readonly timestamp: bigint;
}

export interface OnchainCampaign {
  readonly beneficiary: Address;
  readonly capRaw: bigint;
  readonly startAt: bigint;
  readonly endAt: bigint;
  readonly orgHash: Hex;
  readonly metadataHash: Hex;
  readonly status: number;
}

export interface ChainRpc {
  getBlockNumber(): Promise<bigint>;
  getBlock(blockNumber: bigint): Promise<BlockInfo | null>;
  getLogs(args: {
    addresses: readonly Address[];
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<RawLog[]>;
  /** Odczyt `CampaignRegistry.getCampaign` w danym bloku (parametry kampanii niezmienne poza metadataHash/status). */
  getCampaign(registry: Address, campaignId: bigint, blockNumber: bigint): Promise<OnchainCampaign>;
  /** Getter routera: `totalDonatedRaw(wallet)` i `raisedRaw(campaignId)` w danym bloku (uzgadnianie, AC-33). */
  totalDonatedRaw(router: Address, wallet: Address, blockNumber: bigint): Promise<bigint>;
  raisedRaw(router: Address, campaignId: bigint, blockNumber: bigint): Promise<bigint>;
}

const READ_ABI = parseAbi([
  "function getCampaign(uint64 campaignId) view returns ((address beneficiary, uint128 capRaw, uint64 startAt, uint64 endAt, bytes32 orgHash, bytes32 metadataHash, uint8 status))",
  "function totalDonatedRaw(address donor) view returns (uint256)",
  "function raisedRaw(uint64 campaignId) view returns (uint256)",
]);

export function createViemRpc(client: PublicClient): ChainRpc {
  return {
    getBlockNumber: () => client.getBlockNumber(),
    async getBlock(blockNumber) {
      try {
        const block = await client.getBlock({ blockNumber });
        return { hash: block.hash, timestamp: block.timestamp };
      } catch {
        return null; // blok jeszcze nieznany (np. po reorgu skracającym łańcuch)
      }
    },
    async getLogs({ addresses, fromBlock, toBlock }) {
      const logs = await client.getLogs({ address: [...addresses], fromBlock, toBlock });
      return logs.map((log) => ({
        address: log.address,
        blockNumber: log.blockNumber,
        blockHash: log.blockHash,
        transactionHash: log.transactionHash,
        transactionIndex: log.transactionIndex,
        logIndex: log.logIndex,
        topics: log.topics as readonly Hex[],
        data: log.data,
      }));
    },
    async getCampaign(registry, campaignId, blockNumber) {
      const result = await client.readContract({
        address: registry,
        abi: READ_ABI,
        functionName: "getCampaign",
        args: [campaignId],
        blockNumber,
      });
      return { ...result, capRaw: result.capRaw, startAt: result.startAt, endAt: result.endAt };
    },
    totalDonatedRaw: (router, wallet, blockNumber) =>
      client.readContract({
        address: router,
        abi: READ_ABI,
        functionName: "totalDonatedRaw",
        args: [wallet],
        blockNumber,
      }),
    raisedRaw: (router, campaignId, blockNumber) =>
      client.readContract({
        address: router,
        abi: READ_ABI,
        functionName: "raisedRaw",
        args: [campaignId],
        blockNumber,
      }),
  };
}
