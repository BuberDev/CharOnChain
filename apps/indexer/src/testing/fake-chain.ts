/**
 * Symulowany łańcuch do testów indexera: bloki z hashami, logi zakodowane prawdziwym ABI, reorgi (podmiana
 * ogona), odczyty getterów kontraktów. WYŁĄCZNIE do testów (nie trafia do builda: wyłączone w tsconfig.build).
 */
import {
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
  toHex,
  type Abi,
  type AbiEvent,
  type Address,
  type Hex,
} from "viem";

import { IMPACT_EVENTS, REGISTRY_EVENTS, ROUTER_EVENTS } from "../abi.js";
import type { BlockInfo, ChainRpc, OnchainCampaign, RawLog } from "../rpc.js";

interface FakeBlock {
  number: bigint;
  hash: Hex;
  timestamp: bigint;
  logs: Omit<RawLog, "blockNumber" | "blockHash">[];
}

let salt = 0;
const nextHash = (label: string): Hex => keccak256(toHex(`${label}:${String(++salt)}`));

export class FakeChain implements ChainRpc {
  blocks: FakeBlock[] = [];
  campaigns = new Map<string, OnchainCampaign>();
  /** Hook do testów „reorg w trakcie skanu”: wołany przy każdym getBlock. */
  onGetBlock: ((n: bigint) => void) | undefined;

  constructor(
    readonly addresses: {
      registry: Address;
      router: Address;
      reputation: Address;
      impact: Address;
    },
    initialHeight = 0n,
  ) {
    for (let n = 0n; n <= initialHeight; n += 1n) this.blocks.push(this.emptyBlock(n));
  }

  private emptyBlock(number: bigint): FakeBlock {
    return {
      number,
      hash: nextHash(`block${number.toString()}`),
      timestamp: 1_800_000_000n + number * 2n,
      logs: [],
    };
  }

  get head(): bigint {
    return BigInt(this.blocks.length - 1);
  }

  mine(count = 1): void {
    for (let i = 0; i < count; i += 1)
      this.blocks.push(this.emptyBlock(BigInt(this.blocks.length)));
  }

  mineUntil(height: bigint): void {
    while (this.head < height) this.mine();
  }

  /** Dodaje log do bloku (tworzy bloki, jeśli trzeba). Zwraca hash transakcji. */
  emit(
    blockNumber: bigint,
    address: Address,
    abi: Abi,
    eventName: string,
    args: Record<string, unknown>,
  ): Hex {
    this.mineUntil(blockNumber);
    const block = this.blocks[Number(blockNumber)];
    if (block === undefined) throw new Error("blok nie istnieje");
    const event = (abi as readonly AbiEvent[]).find((e) => e.name === eventName);
    if (event === undefined) throw new Error(`nieznane zdarzenie ${eventName}`);
    const topics = encodeEventTopics({ abi: [event], eventName, args }) as Hex[];
    const nonIndexed = event.inputs.filter((i) => !("indexed" in i && i.indexed));
    const data = encodeAbiParameters(
      nonIndexed,
      nonIndexed.map((i) => args[i.name ?? ""]) as never,
    );
    const transactionHash = nextHash(`tx-${eventName}`);
    block.logs.push({
      address,
      transactionHash,
      transactionIndex: block.logs.length,
      logIndex: block.logs.length,
      topics,
      data,
    });
    return transactionHash;
  }

  /** Reorg: usuwa bloki od `fromBlock` wzwyż (z nowymi hashami) i opcjonalnie dodaje nowy ogon. */
  reorg(fromBlock: bigint, newLength?: number): void {
    const keep = this.blocks.slice(0, Number(fromBlock));
    this.blocks = keep;
    const length = newLength ?? 0;
    for (let i = 0; i < length; i += 1)
      this.blocks.push(this.emptyBlock(BigInt(this.blocks.length)));
  }

  setCampaign(id: bigint, campaign: OnchainCampaign): void {
    this.campaigns.set(id.toString(), campaign);
  }

  // --- ChainRpc
  getBlockNumber(): Promise<bigint> {
    return Promise.resolve(this.head);
  }

  getBlock(blockNumber: bigint): Promise<BlockInfo | null> {
    this.onGetBlock?.(blockNumber);
    const block = this.blocks[Number(blockNumber)];
    return Promise.resolve(
      block === undefined ? null : { hash: block.hash, timestamp: block.timestamp },
    );
  }

  getLogs(args: {
    addresses: readonly Address[];
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<RawLog[]> {
    const wanted = new Set(args.addresses.map((a) => a.toLowerCase()));
    const out: RawLog[] = [];
    for (const block of this.blocks) {
      if (block.number < args.fromBlock || block.number > args.toBlock) continue;
      for (const log of block.logs) {
        if (wanted.has(log.address.toLowerCase()))
          out.push({ ...log, blockNumber: block.number, blockHash: block.hash });
      }
    }
    return Promise.resolve(out);
  }

  getCampaign(_registry: Address, campaignId: bigint): Promise<OnchainCampaign> {
    const found = this.campaigns.get(campaignId.toString());
    if (found === undefined)
      return Promise.reject(new Error(`kampania ${campaignId.toString()} nie istnieje`));
    return Promise.resolve(found);
  }

  /** Gettery liczone z kanonicznego łańcucha (do uzgadniania): sumują DonationReceived do bloku. */
  private donations(blockNumber: bigint): { campaignId: bigint; donor: string; amount: bigint }[] {
    const rows: { campaignId: bigint; donor: string; amount: bigint }[] = [];
    for (const block of this.blocks) {
      if (block.number > blockNumber) break;
      for (const log of block.logs) {
        if (log.address.toLowerCase() !== this.addresses.router.toLowerCase()) continue;
        const campaignId = BigInt(log.topics[1] ?? "0x0");
        const donor = `0x${(log.topics[2] ?? "0x").slice(-40)}`.toLowerCase();
        rows.push({ campaignId, donor, amount: BigInt(log.data) });
      }
    }
    return rows;
  }

  totalDonatedRaw(_router: Address, wallet: Address, blockNumber: bigint): Promise<bigint> {
    return Promise.resolve(
      this.donations(blockNumber)
        .filter((d) => d.donor === wallet.toLowerCase())
        .reduce((s, d) => s + d.amount, 0n),
    );
  }

  raisedRaw(_router: Address, campaignId: bigint, blockNumber: bigint): Promise<bigint> {
    return Promise.resolve(
      this.donations(blockNumber)
        .filter((d) => d.campaignId === campaignId)
        .reduce((s, d) => s + d.amount, 0n),
    );
  }
}

export const registryAbi = REGISTRY_EVENTS;
export const routerAbi = ROUTER_EVENTS;
export const impactAbi = IMPACT_EVENTS;
