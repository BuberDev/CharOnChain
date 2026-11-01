/**
 * Dekodowanie logów do rekordów journala. Konwencja `chain_events.args` (zależą od niej wyzwalacze bazy z
 * migracji 0003/0004): klucze jak w ABI, WSZYSTKIE liczby jako ciągi dziesiętne, adresy i bytes32 małymi literami.
 */
import { decodeEventLog, type Hex } from "viem";

import { ALL_WATCHED_EVENTS, type ContractKind } from "./abi.js";
import type { RawLog } from "./rpc.js";

export interface DecodedEvent {
  readonly kind: ContractKind;
  readonly eventName: string;
  readonly args: Record<string, string>;
  readonly log: RawLog;
}

function normalize(value: unknown): string {
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.startsWith("0x") ? value.toLowerCase() : value;
  throw new TypeError(`Nieobsługiwany typ argumentu zdarzenia: ${typeof value}`);
}

/** Zwraca `null` dla logów, których nie znamy (np. Transfer) — to nie jest błąd. */
export function decodeLog(log: RawLog, kind: ContractKind): DecodedEvent | null {
  try {
    const decoded = decodeEventLog({
      abi: ALL_WATCHED_EVENTS,
      topics: log.topics as [Hex, ...Hex[]],
      data: log.data,
      strict: true,
    });
    const args: Record<string, string> = {};
    for (const [key, value] of Object.entries(decoded.args as unknown as Record<string, unknown>)) {
      args[key] = normalize(value);
    }
    return { kind, eventName: decoded.eventName, args, log };
  } catch {
    return null;
  }
}
