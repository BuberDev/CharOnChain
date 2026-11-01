/**
 * Test integracyjny logowania SIWE na PRAWDZIWYM Postgresie (migracje z @charonchain/database):
 * jednorazowość nonce (także przy 10 równoległych próbach), brak spalania nonce błędnym podpisem,
 * sesje (wygaśnięcie, odwołanie, rotacja). AC-26.
 */
import { randomBytes } from "node:crypto";

import { loadMigrations, migrateUp } from "@charonchain/database";
import { Client } from "pg";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { login } from "./login";
import { SESSION_COOKIE_NAME } from "./session";
import { buildSiweMessage, hashNonce, issueNonce } from "./siwe";
import {
  consumeNonce,
  createSession,
  resolveSession,
  revokeSession,
  rotateSession,
  storeNonce,
} from "./store";

const MIGRATIONS_DIR = new URL("../../database/migrations", import.meta.url).pathname;
const adminUrl = (): string => {
  const url = process.env.TEST_DATABASE_URL;
  if (url === undefined || url === "") throw new Error("TEST_DATABASE_URL nie jest ustawione");
  return url;
};
const withDb = (name: string): string => {
  const u = new URL(adminUrl());
  u.pathname = `/${name}`;
  return u.toString();
};

const DOMAIN = "charonchain.example";
const account = privateKeyToAccount(generatePrivateKey());
let dbName: string;
let client: Client;

const expectations = () => ({
  domain: DOMAIN,
  allowedUris: [`https://${DOMAIN}`],
  allowedChainIds: [421614],
  now: new Date(),
});

async function freshLogin(): Promise<{ message: string; signature: `0x${string}`; nonce: string }> {
  const { nonce, nonceHash } = issueNonce();
  await storeNonce(client, { nonceHash, domain: DOMAIN, chainId: 421614 });
  const message = buildSiweMessage({
    address: account.address,
    domain: DOMAIN,
    uri: `https://${DOMAIN}`,
    chainId: 421614,
    nonce,
    issuedAt: new Date(),
  });
  return { message, signature: await account.signMessage({ message }), nonce };
}

beforeAll(async () => {
  dbName = `cc_auth_${randomBytes(5).toString("hex")}`;
  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();
  client = new Client({ connectionString: withDb(dbName) });
  await client.connect();
  await migrateUp(client, loadMigrations(MIGRATIONS_DIR));
});

afterAll(async () => {
  await client.end();
  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.end();
});

describe("login SIWE", () => {
  it("poprawne logowanie tworzy sesję, którą można rozpoznać po tokenie", async () => {
    const { message, signature } = await freshLogin();
    const result = await login(client, { message, signature }, expectations());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.wallet).toBe(account.address.toLowerCase());
    expect(await resolveSession(client, result.token)).toBe(account.address.toLowerCase());
    // w bazie jest tylko hash tokenu
    const stored = await client.query<{ token_hash: string }>(
      "select token_hash from public.sessions",
    );
    expect(JSON.stringify(stored.rows)).not.toContain(result.token);
    expect(SESSION_COOKIE_NAME).toBe("coc_session");
  });

  it("replay tej samej wiadomości jest odrzucony (nonce jednorazowy)", async () => {
    const { message, signature } = await freshLogin();
    expect((await login(client, { message, signature }, expectations())).ok).toBe(true);
    expect(await login(client, { message, signature }, expectations())).toEqual({
      ok: false,
      code: "NONCE_INVALID",
    });
  });

  it("błędny podpis nie spala nonce: poprawna próba zaraz potem działa", async () => {
    const { message, signature } = await freshLogin();
    const forged = await privateKeyToAccount(generatePrivateKey()).signMessage({ message });
    expect(await login(client, { message, signature: forged }, expectations())).toEqual({
      ok: false,
      code: "BAD_SIGNATURE",
    });
    expect((await login(client, { message, signature }, expectations())).ok).toBe(true);
  });

  it("nonce nieznany serwerowi (nie wystawiony) jest odrzucony, choć podpis jest poprawny", async () => {
    const { nonce } = issueNonce(); // NIE zapisany w bazie
    const message = buildSiweMessage({
      address: account.address,
      domain: DOMAIN,
      uri: `https://${DOMAIN}`,
      chainId: 421614,
      nonce,
      issuedAt: new Date(),
    });
    const signature = await account.signMessage({ message });
    expect(await login(client, { message, signature }, expectations())).toEqual({
      ok: false,
      code: "NONCE_INVALID",
    });
  });

  it("nonce wystawiony dla innej domeny lub sieci nie działa", async () => {
    const { nonce, nonceHash } = issueNonce();
    await storeNonce(client, { nonceHash, domain: "inna.example", chainId: 421614 });
    const message = buildSiweMessage({
      address: account.address,
      domain: DOMAIN,
      uri: `https://${DOMAIN}`,
      chainId: 421614,
      nonce,
      issuedAt: new Date(),
    });
    expect(
      await login(
        client,
        { message, signature: await account.signMessage({ message }) },
        expectations(),
      ),
    ).toEqual({ ok: false, code: "NONCE_INVALID" });
  });

  it("nonce powiązany z innym portfelem nie pozwala zalogować cudzego adresu", async () => {
    const { nonce, nonceHash } = issueNonce();
    await storeNonce(client, {
      nonceHash,
      domain: DOMAIN,
      chainId: 421614,
      wallet: privateKeyToAccount(generatePrivateKey()).address,
    });
    const message = buildSiweMessage({
      address: account.address,
      domain: DOMAIN,
      uri: `https://${DOMAIN}`,
      chainId: 421614,
      nonce,
      issuedAt: new Date(),
    });
    expect(
      await login(
        client,
        { message, signature: await account.signMessage({ message }) },
        expectations(),
      ),
    ).toEqual({ ok: false, code: "NONCE_INVALID" });
  });

  it("10 równoległych prób z tą samą wiadomością: dokładnie jedna sesja", async () => {
    const { message, signature } = await freshLogin();
    const clients = await Promise.all(
      Array.from({ length: 10 }, async () => {
        const c = new Client({ connectionString: withDb(dbName) });
        await c.connect();
        return c;
      }),
    );
    try {
      const before = await client.query<{ c: string }>(
        "select count(*)::text as c from public.sessions",
      );
      const results = await Promise.all(
        clients.map((c) => login(c, { message, signature }, expectations())),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const after = await client.query<{ c: string }>(
        "select count(*)::text as c from public.sessions",
      );
      expect(Number(after.rows[0]?.c) - Number(before.rows[0]?.c)).toBe(1);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });

  it("wiadomość niepoprawna treściowo jest odrzucona zanim dotknie bazy (domena)", async () => {
    const { message, signature } = await freshLogin();
    const result = await login(
      client,
      { message, signature },
      { ...expectations(), domain: "evil.example" },
    );
    expect(result).toEqual({ ok: false, code: "DOMAIN_MISMATCH" });
    // nonce nadal ważny
    expect((await login(client, { message, signature }, expectations())).ok).toBe(true);
  });
});

describe("nonce w bazie", () => {
  it("wygasły nonce nie jest zużywany", async () => {
    const { nonceHash } = issueNonce();
    await client.query(
      `insert into public.siwe_nonces (nonce_hash, domain, chain_id, issued_at, expires_at)
       values ($1, $2, 421614, now() - interval '10 minutes', now() - interval '5 minutes')`,
      [nonceHash, DOMAIN],
    );
    expect(
      await consumeNonce(client, {
        nonceHash,
        domain: DOMAIN,
        chainId: 421614,
        wallet: account.address,
      }),
    ).toBe(false);
  });

  it("hash nonce w bazie to SHA-256, nie sam nonce", async () => {
    const { nonce, nonceHash } = issueNonce();
    await storeNonce(client, { nonceHash, domain: DOMAIN, chainId: 421614 });
    const rows = await client.query("select 1 from public.siwe_nonces where nonce_hash = $1", [
      nonce,
    ]);
    expect(rows.rowCount).toBe(0);
    expect(hashNonce(nonce)).toBe(nonceHash);
  });
});

describe("sesje", () => {
  it("wygasła i odwołana sesja nie jest rozpoznawana; nieznany token też nie", async () => {
    const live = await createSession(client, account.address);
    expect(await resolveSession(client, live.token)).toBe(account.address.toLowerCase());
    expect(await revokeSession(client, live.token)).toBe(true);
    expect(await revokeSession(client, live.token)).toBe(false);
    expect(await resolveSession(client, live.token)).toBeNull();
    expect(await resolveSession(client, "x".repeat(43))).toBeNull();

    const short = await createSession(client, account.address, { ttlSeconds: 1 });
    await client.query("select pg_sleep(1.2)");
    expect(await resolveSession(client, short.token)).toBeNull();
  });

  it("rotacja odwołuje starą sesję i tworzy nową powiązaną z poprzednią; ponowna rotacja starego tokenu się nie udaje", async () => {
    const first = await createSession(client, account.address);
    const rotated = await rotateSession(client, first.token);
    expect(rotated).not.toBeNull();
    if (rotated === null) return;
    expect(await resolveSession(client, first.token)).toBeNull();
    expect(await resolveSession(client, rotated.token)).toBe(account.address.toLowerCase());
    expect(await rotateSession(client, first.token)).toBeNull(); // stary token użyty ponownie
    const link = await client.query<{ rotated_from: string | null }>(
      "select rotated_from from public.sessions where token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')",
      [rotated.token],
    );
    expect(link.rows[0]?.rotated_from).toBe(first.sessionId);
  });
});
