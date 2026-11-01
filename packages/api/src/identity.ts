/**
 * Tożsamość żądania w bazie (docs/03 §3, §5): każde żądanie z sesją wykonuje się w TRANSAKCJI jako rola `app_api`
 * z ustawionym `app.wallet` (`SET LOCAL`/`set_config(..., true)` — znika z końcem transakcji, więc nie przecieka
 * między żądaniami na tym samym połączeniu z puli). Autoryzację egzekwuje baza (RLS + wyzwalacze `*_authz`);
 * ta warstwa tłumaczy jej odmowy na bezpieczne odpowiedzi API i nigdy nie ufa polom z wejścia co do tożsamości.
 */
import { ApiError, type ApiContext } from "./http.js";

const WALLET = /^0x[0-9a-f]{40}$/;

export interface Tx {
  readonly query: ApiContext["db"]["query"];
  readonly wallet: string | null;
  readonly requestId: string;
  readonly chainId: number;
}

function pgCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/**
 * Mapuje błędy Postgresa na odpowiedzi API bez ujawniania treści (nazwy ograniczeń, SQL, wartości).
 * Nieznany kod → oryginalny błąd (trafi do 500 przez `respond`).
 */
export function mapDatabaseError(error: unknown): unknown {
  if (error instanceof ApiError) return error;
  switch (pgCode(error)) {
    case "42501": // brak uprawnień / naruszenie polityki RLS
      return new ApiError(403, "FORBIDDEN", "Brak uprawnień do wykonania tej operacji.");
    case "23505": // unikalność (np. slug, Safe)
      return new ApiError(409, "ALREADY_EXISTS", "Taki zasób już istnieje.");
    case "23514": // reguły biznesowe w wyzwalaczach i ograniczeniach CHECK
      return new ApiError(
        409,
        "STATE_CONFLICT",
        "Operacja jest niedozwolona w bieżącym stanie zasobu.",
      );
    case "23503": // klucz obcy
      return new ApiError(400, "INVALID_REFERENCE", "Wskazany zasób nie istnieje.");
    default:
      return error;
  }
}

/** Wykonuje `run` w transakcji jako `app_api` z tożsamością `wallet` (null = gość). */
export async function withActor<T>(
  ctx: ApiContext,
  wallet: string | null,
  run: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (wallet !== null && !WALLET.test(wallet)) {
    throw new ApiError(401, "UNAUTHENTICATED", "Wymagane zalogowanie.");
  }
  await ctx.db.query("begin");
  try {
    await ctx.db.query("set local role app_api");
    await ctx.db.query("select set_config('app.wallet', $1, true)", [wallet ?? ""]);
    const result = await run({
      query: ctx.db.query.bind(ctx.db),
      wallet,
      requestId: ctx.requestId,
      chainId: ctx.chainId,
    });
    await ctx.db.query("commit");
    return result;
  } catch (error) {
    await ctx.db.query("rollback");
    throw mapDatabaseError(error);
  }
}

export function requireWallet(tx: Tx): string {
  if (tx.wallet === null) throw new ApiError(401, "UNAUTHENTICATED", "Wymagane zalogowanie.");
  return tx.wallet;
}

/** Wpis audytowy (append-only) w tej samej transakcji co zmiana — albo oba, albo żaden. */
export async function writeAudit(
  tx: Tx,
  entry: {
    action: string;
    entityType: string;
    entityId: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  },
): Promise<void> {
  const wallet = requireWallet(tx);
  await tx.query(
    `insert into public.audit_logs (actor_wallet_lower, actor_type, action, entity_type, entity_id, before_json, after_json, request_id)
     values ($1, case when app.is_staff() then 'ADMIN' else 'USER' end::app.actor_type, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
    [
      wallet,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.before === undefined || entry.before === null ? null : JSON.stringify(entry.before),
      entry.after === undefined || entry.after === null ? null : JSON.stringify(entry.after),
      tx.requestId,
    ],
  );
}
