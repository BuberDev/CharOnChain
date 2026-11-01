/**
 * Cykl indexera (COC-030/031): skan z NAKŁADKĄ bloków (docs/03 §6 „zakładka”), idempotentny zapis, wykrywanie
 * zniknięcia zdarzeń (reorg), awans do CONFIRMED po buforze potwierdzeń, projekcje i kursor.
 * `last_scanned` ≠ `last_confirmed`; „potwierdzone na Arbitrum” to NIE finalizacja na Ethereum L1.
 */
import type { ClientBase } from "pg";
import type { Address } from "viem";

import { EVENTS_BY_CONTRACT, type ContractKind } from "./abi.js";
import { decodeLog } from "./decode.js";
import { confirmUpTo, getCursor, orphanMissing, saveCursor, upsertEvent } from "./journal.js";
import { projectAll, type Anomaly, type ProjectionResult } from "./projections.js";
import type { ChainRpc } from "./rpc.js";

export interface IndexerConfig {
  readonly chainId: 42161 | 421614;
  readonly contracts: Readonly<Record<ContractKind, Address>>;
  /** Natywny USDC środowiska (zapisywany przy darowiznach). */
  readonly usdc: Address;
  /** Bufor potwierdzeń w blokach L2 (np. 12). Musi być mniejszy niż `overlap`. */
  readonly confirmations: bigint;
  /** Ile bloków wstecz skanujemy ponownie w każdym cyklu (np. 100). */
  readonly overlap: bigint;
  readonly maxRange: bigint;
  readonly startBlock: bigint;
}

export class ReorgDuringScanError extends Error {
  constructor(readonly block: bigint) {
    super(`Hash bloku ${block.toString()} zmienił się w trakcie skanu (reorg) — powtórz cykl`);
    this.name = "ReorgDuringScanError";
  }
}

export function assertConfig(config: IndexerConfig): void {
  if (config.confirmations < 0n || config.overlap <= config.confirmations) {
    throw new RangeError(
      "overlap musi być większy niż confirmations (inaczej zdarzenia OBSERVED mogłyby zostać pominięte)",
    );
  }
  if (config.maxRange < 1n) throw new RangeError("maxRange musi być >= 1");
  const addresses = Object.values(config.contracts).map((a) => a.toLowerCase());
  if (new Set(addresses).size !== addresses.length)
    throw new RangeError("adresy kontraktów muszą być unikalne");
}

export interface CycleResult {
  head: bigint;
  confirmedHead: bigint;
  eventsInserted: number;
  eventsMoved: number;
  eventsOrphaned: number;
  eventsConfirmed: number;
  projection: ProjectionResult;
  anomalies: Anomaly[];
}

const ORDER: readonly ContractKind[] = ["registry", "router", "reputation", "impact"];

export async function runCycle(
  db: ClientBase,
  rpc: ChainRpc,
  config: IndexerConfig,
): Promise<CycleResult> {
  assertConfig(config);
  const head = await rpc.getBlockNumber();
  const confirmedHead = head > config.confirmations ? head - config.confirmations : 0n;
  let inserted = 0;
  let moved = 0;
  let orphaned = 0;

  for (const kind of ORDER) {
    const address = config.contracts[kind];
    const cursor = await getCursor(db, config.chainId, address, config.startBlock);
    const overlapFrom =
      cursor.lastScanned > config.overlap ? cursor.lastScanned - config.overlap : 0n;
    let from = overlapFrom > config.startBlock ? overlapFrom : config.startBlock;
    if (from > head) continue;

    while (from <= head) {
      const to = from + config.maxRange - 1n < head ? from + config.maxRange - 1n : head;
      const before = await rpc.getBlock(to);
      const logs = await rpc.getLogs({ addresses: [address], fromBlock: from, toBlock: to });
      const after = await rpc.getBlock(to);
      // Spójność: jeśli hash bloku końcowego zmienił się w trakcie pobierania, wynik jest niewiarygodny.
      if ((before?.hash ?? null) !== (after?.hash ?? null)) throw new ReorgDuringScanError(to);

      await db.query("begin");
      try {
        const seen: { tx: string; logIndex: number }[] = [];
        for (const log of logs) {
          const decoded = decodeLog(log, kind);
          if (decoded === null) continue;
          // Zdarzenie musi należeć do ABI tego kontraktu (inny kontrakt nie może „podszyć się” pod nasz).
          if (!EVENTS_BY_CONTRACT[kind].some((e) => e.name === decoded.eventName)) continue;
          const outcome = await upsertEvent(db, config.chainId, decoded);
          if (outcome === "INSERTED") inserted += 1;
          if (outcome === "MOVED" || outcome === "REVIVED") moved += 1;
          seen.push({ tx: log.transactionHash, logIndex: log.logIndex });
        }
        orphaned += await orphanMissing(db, {
          chainId: config.chainId,
          contract: address,
          fromBlock: from,
          toBlock: to,
          seen,
        });
        await saveCursor(db, {
          chainId: config.chainId,
          contract: address,
          scanned: to,
          confirmed: confirmedHead,
          blockHash: after?.hash ?? null,
          status: to < head ? "SYNCING" : "IDLE",
        });
        await db.query("commit");
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
      from = to + 1n;
    }
  }

  await db.query("begin");
  try {
    const confirmed = await confirmUpTo(db, config.chainId, confirmedHead);
    const projection = await projectAll(db, rpc, {
      chainId: config.chainId,
      registry: config.contracts.registry,
      usdc: config.usdc,
      confirmedHead,
    });
    await db.query("commit");
    return {
      head,
      confirmedHead,
      eventsInserted: inserted,
      eventsMoved: moved,
      eventsOrphaned: orphaned,
      eventsConfirmed: confirmed,
      projection,
      anomalies: projection.anomalies,
    };
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

export interface Mismatch {
  readonly subject: string;
  readonly db: bigint;
  readonly chain: bigint;
}

/**
 * Uzgadnianie z getterami kontraktu w ostatnim potwierdzonym bloku (AC-33): sumy darczyńców i kampanii z bazy
 * muszą być równe `totalDonatedRaw` / `raisedRaw`. Niezgodność = alarm; baza NIE jest „naprawiana” po cichu.
 */
export async function reconcile(
  db: ClientBase,
  rpc: ChainRpc,
  config: IndexerConfig,
): Promise<Mismatch[]> {
  const head = await rpc.getBlockNumber();
  const block = head > config.confirmations ? head - config.confirmations : 0n;
  const mismatches: Mismatch[] = [];

  const stats = await db.query<{ wallet_lower: string; total: string }>(
    "select wallet_lower, total_donated_raw::text as total from public.donor_stats where chain_id = $1",
    [config.chainId],
  );
  for (const row of stats.rows) {
    const chain = await rpc.totalDonatedRaw(
      config.contracts.router,
      row.wallet_lower as Address,
      block,
    );
    if (chain !== BigInt(row.total))
      mismatches.push({ subject: `donor ${row.wallet_lower}`, db: BigInt(row.total), chain });
  }
  const campaigns = await db.query<{ onchain_campaign_id: string; raised: string }>(
    `select c.onchain_campaign_id::text, coalesce(sum(d.amount_raw) filter (where d.status = 'CONFIRMED'), 0)::text as raised
       from public.campaigns c left join public.donations d on d.campaign_id = c.id
      where c.chain_id = $1 and c.onchain_campaign_id is not null group by c.onchain_campaign_id`,
    [config.chainId],
  );
  for (const row of campaigns.rows) {
    const chain = await rpc.raisedRaw(
      config.contracts.router,
      BigInt(row.onchain_campaign_id),
      block,
    );
    if (chain !== BigInt(row.raised))
      mismatches.push({
        subject: `campaign #${row.onchain_campaign_id}`,
        db: BigInt(row.raised),
        chain,
      });
  }

  await db.query(
    "update public.donor_stats set last_reconciliation_at = now() where chain_id = $1",
    [config.chainId],
  );
  await db.query(
    "update public.indexer_cursors set status = $2::app.indexer_status where chain_id = $1",
    [config.chainId, mismatches.length === 0 ? "IDLE" : "ERROR"],
  );
  return mismatches;
}
