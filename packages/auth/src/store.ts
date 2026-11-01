/** Magazyn nonce i sesji w Postgresie (tabele i funkcje z migracji 0004; rola `app_auth`, migracja 0005). */
import type { ClientBase } from "pg";

import { NONCE_TTL_SECONDS } from "./siwe";
import { SESSION_TTL_SECONDS, hashSessionToken, issueSessionToken } from "./session";

export interface NonceRequest {
  readonly nonceHash: string;
  readonly domain: string;
  readonly chainId: number;
  /** Opcjonalne powiązanie nonce z portfelem już przy wystawieniu. */
  readonly wallet?: string;
}

export async function storeNonce(db: ClientBase, request: NonceRequest): Promise<void> {
  await db.query(
    `insert into public.siwe_nonces (nonce_hash, wallet_lower, domain, chain_id, expires_at)
     values ($1, $2, $3, $4, now() + make_interval(secs => $5))`,
    [
      request.nonceHash,
      request.wallet?.toLowerCase() ?? null,
      request.domain,
      request.chainId,
      NONCE_TTL_SECONDS,
    ],
  );
}

/** Atomowe, jednorazowe zużycie (funkcja SQL): `true` dokładnie raz; replay, wygasły lub niezgodny nonce → `false`. */
export async function consumeNonce(
  db: ClientBase,
  args: { nonceHash: string; domain: string; chainId: number; wallet: string },
): Promise<boolean> {
  const result = await db.query<{ ok: boolean }>(
    "select app.consume_siwe_nonce($1, $2, $3, $4) as ok",
    [args.nonceHash, args.domain, args.chainId, args.wallet.toLowerCase()],
  );
  return result.rows[0]?.ok === true;
}

export async function createSession(
  db: ClientBase,
  wallet: string,
  options: { ttlSeconds?: number; rotatedFrom?: string } = {},
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const { token, tokenHash } = issueSessionToken();
  const ttl = options.ttlSeconds ?? SESSION_TTL_SECONDS;
  const result = await db.query<{ id: string; expires_at: Date }>(
    `insert into public.sessions (token_hash, wallet_lower, expires_at, rotated_from)
     values ($1, $2, now() + make_interval(secs => $3), $4) returning id, expires_at`,
    [tokenHash, wallet.toLowerCase(), ttl, options.rotatedFrom ?? null],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Nie udało się utworzyć sesji");
  return { token, sessionId: row.id, expiresAt: row.expires_at };
}

/** Portfel aktywnej sesji (nie wygasła, nie odwołana) albo `null`. */
export async function resolveSession(db: ClientBase, token: string): Promise<string | null> {
  const result = await db.query<{ wallet: string | null }>(
    "select app.session_wallet($1) as wallet",
    [hashSessionToken(token)],
  );
  return result.rows[0]?.wallet ?? null;
}

export async function revokeSession(db: ClientBase, token: string): Promise<boolean> {
  const result = await db.query(
    "update public.sessions set revoked_at = now() where token_hash = $1 and revoked_at is null",
    [hashSessionToken(token)],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Rotacja: stara sesja zostaje odwołana, nowa wskazuje poprzednią (wykrywanie kradzieży tokenu). */
export async function rotateSession(
  db: ClientBase,
  token: string,
): Promise<{ token: string; expiresAt: Date; wallet: string } | null> {
  const old = await db.query<{ id: string; wallet_lower: string }>(
    `update public.sessions set revoked_at = now()
      where token_hash = $1 and revoked_at is null and expires_at > now()
      returning id, wallet_lower`,
    [hashSessionToken(token)],
  );
  const row = old.rows[0];
  if (row === undefined) return null;
  const next = await createSession(db, row.wallet_lower, { rotatedFrom: row.id });
  return { token: next.token, expiresAt: next.expiresAt, wallet: row.wallet_lower };
}
