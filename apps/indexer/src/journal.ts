/**
 * Journal zdarzeń (docs/03 §2, §6; AC-13, AC-14): idempotentny zapis, stany OBSERVED → CONFIRMED → ORPHANED,
 * powrót zdarzenia w innym bloku, brak usuwania. Treść (`args`) jest niezmienna — pilnuje tego wyzwalacz bazy.
 */
import type { ClientBase } from "pg";

import type { DecodedEvent } from "./decode.js";

export type UpsertOutcome = "INSERTED" | "UNCHANGED" | "MOVED" | "REVIVED";

interface StoredEvent {
  id: string;
  block_number: string;
  block_hash: string;
  confirmation_state: "OBSERVED" | "CONFIRMED" | "ORPHANED";
  canonical: boolean;
}

/**
 * Zapisuje zdarzenie. Ponowne przetworzenie tej samej pozycji `(chain, tx, logIndex)` w tym samym bloku nic nie
 * zmienia (AC-13). Gdy zdarzenie wróciło w INNYM bloku albo było ORPHANED, wraca do OBSERVED (historia w bazie).
 */
export async function upsertEvent(
  db: ClientBase,
  chainId: number,
  event: DecodedEvent,
): Promise<UpsertOutcome> {
  const { log } = event;
  const existing = await db.query<StoredEvent>(
    `select id, block_number::text, block_hash, confirmation_state, canonical
       from public.chain_events where chain_id = $1 and tx_hash = $2 and log_index = $3 for update`,
    [chainId, log.transactionHash.toLowerCase(), log.logIndex],
  );
  const row = existing.rows[0];
  if (row === undefined) {
    await db.query(
      `insert into public.chain_events
         (chain_id, contract_lower, event_name, tx_hash, log_index, block_number, block_hash, tx_index, args)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        chainId,
        log.address.toLowerCase(),
        event.eventName,
        log.transactionHash.toLowerCase(),
        log.logIndex,
        log.blockNumber.toString(),
        log.blockHash.toLowerCase(),
        log.transactionIndex,
        JSON.stringify(event.args),
      ],
    );
    return "INSERTED";
  }
  const sameBlock =
    row.block_hash === log.blockHash.toLowerCase() &&
    row.block_number === log.blockNumber.toString();
  if (sameBlock && row.canonical) return "UNCHANGED";
  // Zdarzenie wróciło (po reorgu) — w tym samym albo innym bloku — jako nowe, jeszcze niepotwierdzone.
  await db.query(
    `update public.chain_events
        set block_number = $2, block_hash = $3, tx_index = $4, canonical = true,
            confirmation_state = 'OBSERVED', confirmed_at = null
      where id = $1`,
    [row.id, log.blockNumber.toString(), log.blockHash.toLowerCase(), log.transactionIndex],
  );
  return sameBlock ? "REVIVED" : "MOVED";
}

/**
 * Oznacza jako ORPHANED kanoniczne zdarzenia z zakresu bloków, których NIE ma w świeżo pobranych logach
 * (zniknęły z łańcucha). Zwraca liczbę oznaczonych.
 */
export async function orphanMissing(
  db: ClientBase,
  args: {
    chainId: number;
    contract: string;
    fromBlock: bigint;
    toBlock: bigint;
    seen: readonly { tx: string; logIndex: number }[];
  },
): Promise<number> {
  const seenKeys = new Set(args.seen.map((s) => `${s.tx.toLowerCase()}:${String(s.logIndex)}`));
  const stored = await db.query<{ id: string; tx_hash: string; log_index: number }>(
    `select id, tx_hash, log_index from public.chain_events
      where chain_id = $1 and contract_lower = $2 and canonical
        and block_number between $3 and $4 for update`,
    [args.chainId, args.contract.toLowerCase(), args.fromBlock.toString(), args.toBlock.toString()],
  );
  const missing = stored.rows.filter((r) => !seenKeys.has(`${r.tx_hash}:${String(r.log_index)}`));
  for (const row of missing) {
    await db.query(
      "update public.chain_events set canonical = false, confirmation_state = 'ORPHANED' where id = $1",
      [row.id],
    );
  }
  return missing.length;
}

/** Awansuje kanoniczne zdarzenia OBSERVED do CONFIRMED, gdy blok jest głębiej niż bufor potwierdzeń. */
export async function confirmUpTo(
  db: ClientBase,
  chainId: number,
  confirmedHead: bigint,
): Promise<number> {
  const result = await db.query(
    `update public.chain_events set confirmation_state = 'CONFIRMED', confirmed_at = now()
      where chain_id = $1 and canonical and confirmation_state = 'OBSERVED' and block_number <= $2`,
    [chainId, confirmedHead.toString()],
  );
  return result.rowCount ?? 0;
}

export interface Cursor {
  lastScanned: bigint;
  lastConfirmed: bigint;
}

export async function getCursor(
  db: ClientBase,
  chainId: number,
  contract: string,
  startBlock: bigint,
): Promise<Cursor> {
  const initial = startBlock > 0n ? startBlock - 1n : 0n;
  await db.query(
    `insert into public.indexer_cursors (chain_id, contract_lower, last_scanned_block, last_confirmed_block)
     values ($1, $2, $3, $3) on conflict do nothing`,
    [chainId, contract.toLowerCase(), initial.toString()],
  );
  const result = await db.query<{ s: string; c: string }>(
    "select last_scanned_block::text as s, last_confirmed_block::text as c from public.indexer_cursors where chain_id = $1 and contract_lower = $2",
    [chainId, contract.toLowerCase()],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Kursor nie istnieje po utworzeniu");
  return { lastScanned: BigInt(row.s), lastConfirmed: BigInt(row.c) };
}

export async function saveCursor(
  db: ClientBase,
  args: {
    chainId: number;
    contract: string;
    scanned: bigint;
    confirmed: bigint;
    blockHash: string | null;
    status: "IDLE" | "SYNCING" | "RECONCILING" | "ERROR";
  },
): Promise<void> {
  // last_confirmed nie wyprzedza last_scanned (constraint); kursor nie cofa się poniżej potwierdzonego.
  const confirmed = args.confirmed > args.scanned ? args.scanned : args.confirmed;
  await db.query(
    `update public.indexer_cursors
        set last_scanned_block = $3, last_confirmed_block = least($3::bigint, greatest(last_confirmed_block, $4::bigint)),
            last_block_hash = $5, status = $6::app.indexer_status
      where chain_id = $1 and contract_lower = $2`,
    [
      args.chainId,
      args.contract.toLowerCase(),
      args.scanned.toString(),
      confirmed.toString(),
      args.blockHash?.toLowerCase() ?? null,
      args.status,
    ],
  );
}
