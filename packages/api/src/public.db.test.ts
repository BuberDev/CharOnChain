/**
 * Testy publicznego API odczytu na PRAWDZIWYM Postgresie, na roli `app_api` (COC-032): prywatność (whitelist),
 * izolacja sieci, stronicowanie keyset, kwoty jako ciągi, odporność na manipulację wejściem i wyciek błędów.
 */
import { randomBytes } from "node:crypto";

import { loadMigrations, migrateUp } from "@charonchain/database";
import {
  approveCampaign,
  createDraftCampaign,
  createOrganization,
  createPublishedCampaign,
  hexAddr,
  hexHash,
  nextId,
} from "@charonchain/database/testing/fixtures";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { decodeCursor, encodeCursor } from "./cursor.js";
import { respond, type ApiContext, type ApiResponse } from "./http.js";
import {
  escapeLike,
  getCampaign,
  getDonor,
  getProjectionStatus,
  getOrganization,
  listCampaignDonations,
  listCampaignReports,
  listCampaigns,
} from "./public.js";

const MIGRATIONS_DIR = new URL("../../database/migrations", import.meta.url).pathname;
const CHAIN = 421614;
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

let templateName: string;
let dbName: string;
let client: Client;
let ctx: ApiContext;

async function admin(sql: string): Promise<void> {
  const a = new Client({ connectionString: adminUrl() });
  await a.connect();
  try {
    await a.query(sql);
  } finally {
    await a.end();
  }
}

beforeAll(async () => {
  templateName = `cc_api_tpl_${randomBytes(5).toString("hex")}`;
  await admin(`create database ${templateName}`);
  const c = new Client({ connectionString: withDb(templateName) });
  await c.connect();
  await migrateUp(c, loadMigrations(MIGRATIONS_DIR));
  await c.end();
});

afterAll(async () => {
  await admin(`drop database if exists ${templateName} with (force)`);
});

beforeEach(async () => {
  dbName = `cc_api_${randomBytes(5).toString("hex")}`;
  await admin(`create database ${dbName} template ${templateName}`);
  client = new Client({ connectionString: withDb(dbName) });
  await client.connect();
  ctx = { db: client, chainId: CHAIN, requestId: "req_test" };
});

afterEach(async () => {
  await client.end();
  await admin(`drop database if exists ${dbName} with (force)`);
});

/** Fixture'y piszą jako właściciel; wszystkie odczyty API idą jako `app_api` (sprawdza uprawnienia widoków). */
async function asApi<T>(run: () => Promise<T>): Promise<T> {
  await client.query("set role app_api");
  try {
    return await run();
  } finally {
    await client.query("reset role");
  }
}

const body = (r: ApiResponse): Record<string, unknown> => r.body as Record<string, unknown>;
type Item = Record<string, unknown>;
const items = (r: ApiResponse): Item[] => body(r).items as Item[];

async function setSlug(id: string, slug: string, title?: string): Promise<void> {
  await client.query(
    "update public.campaigns set slug = $2, title = coalesce($3, title) where id = $1",
    [id, slug, title ?? null],
  );
}

let eventTx = 0;
async function addDonation(
  campaign: { id: string; onchainCampaignId: number },
  donor: string,
  amountRaw: string,
  options: { state?: "CONFIRMED" | "OBSERVED"; blockTime?: string; chainId?: number } = {},
): Promise<string> {
  const state = options.state ?? "CONFIRMED";
  const chainId = options.chainId ?? CHAIN;
  eventTx += 1;
  const txHash = hexHash(0x70000 + eventTx);
  const event = await client.query<{ id: string }>(
    `insert into public.chain_events
       (chain_id, contract_lower, event_name, tx_hash, log_index, block_number, block_hash, tx_index, args,
        canonical, confirmation_state, confirmed_at)
     values ($1, $2, 'DonationReceived', $3, 0, 100, $4, 0, $5::jsonb, true, $6::app.confirmation_state, $7)
     returning id`,
    [
      chainId,
      hexAddr(0xa1),
      txHash,
      hexHash(0xb1),
      JSON.stringify({ amountRaw }),
      state,
      state === "CONFIRMED" ? new Date().toISOString() : null,
    ],
  );
  await client.query(
    `insert into public.donations
       (chain_event_id, campaign_id, chain_id, onchain_campaign_id, donor_wallet_lower, beneficiary_lower,
        token_address_lower, amount_raw, block_time, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8::numeric, $9::timestamptz, $10::app.donation_status)`,
    [
      event.rows[0]?.id,
      campaign.id,
      chainId,
      campaign.onchainCampaignId,
      donor,
      hexAddr(0xbe),
      hexAddr(0xc1),
      amountRaw,
      options.blockTime ?? new Date().toISOString(),
      state === "CONFIRMED" ? "CONFIRMED" : "PENDING",
    ],
  );
  return txHash;
}

async function seedCursors(
  options: {
    count?: number;
    errorOn?: number;
    ageSeconds?: number;
    staleOn?: number;
    chainId?: number;
  } = {},
): Promise<void> {
  const count = options.count ?? 4;
  for (let i = 0; i < count; i += 1) {
    await client.query(
      `insert into public.indexer_cursors
         (chain_id, contract_lower, last_scanned_block, last_confirmed_block, status, updated_at)
       values ($1, $2, $3, $4, $5::app.indexer_status, now() - make_interval(secs => $6))`,
      [
        options.chainId ?? CHAIN,
        hexAddr(0xa1 + i),
        1000 + i,
        988 + i,
        options.errorOn === i ? "ERROR" : "IDLE",
        options.staleOn === i ? 600 : (options.ageSeconds ?? 1),
      ],
    );
  }
}

describe("GET /campaigns", () => {
  it("pokazuje tylko PUBLISHED/PAUSED/CLOSED w bieżącej sieci; szkice i inne sieci są niewidoczne", async () => {
    const pub = await createPublishedCampaign(client, { onchainCampaignId: 1 });
    await setSlug(pub.id, "widoczna");
    const org = await createOrganization(client);
    await createDraftCampaign(client, org); // DRAFT
    const approved = await createDraftCampaign(client, org);
    await approveCampaign(client, approved); // APPROVED, jeszcze nie opublikowana
    const other = await createPublishedCampaign(client, { chainId: 42161, onchainCampaignId: 1 });
    await setSlug(other.id, "mainnet-inna");

    const res = await asApi(() => listCampaigns(ctx, {}));
    expect(res.status).toBe(200);
    expect(items(res).map((i) => i.slug)).toEqual(["widoczna"]);
  });

  it("kwoty to ciągi dziesiętne (także powyżej 2^53); raised liczy tylko potwierdzone wpłaty", async () => {
    const big = "9007199254740993000000"; // > Number.MAX_SAFE_INTEGER
    const c = await createPublishedCampaign(client, { onchainCampaignId: 1, capRaw: big });
    await addDonation(c, hexAddr(0xd1), "9007199254740993");
    await addDonation(c, hexAddr(0xd2), "1000000");
    await addDonation(c, hexAddr(0xd3), "5000000", { state: "OBSERVED" });
    const res = await asApi(() => listCampaigns(ctx, {}));
    const item = items(res)[0] as Item;
    expect(item.capRaw).toBe(big);
    expect(item.raisedRaw).toBe("9007199255740993"); // 9007199254740993 + 1000000, bez OBSERVED
    expect(item.remainingRaw).toBe((BigInt(big) - 9007199255740993n).toString());
    expect(item.donationsCount).toBe(2);
    expect(typeof item.raisedRaw).toBe("string");
  });

  it("remainingRaw nie schodzi poniżej zera", async () => {
    const c = await createPublishedCampaign(client, { onchainCampaignId: 1, capRaw: "1000000" });
    await addDonation(c, hexAddr(0xd1), "1000000");
    await addDonation(c, hexAddr(0xd2), "2500000"); // anomalia projekcji: ponad limit
    const res = await asApi(() => listCampaigns(ctx, {}));
    expect((items(res)[0] as Item).raisedRaw).toBe("3500000");
    expect((items(res)[0] as Item).remainingRaw).toBe("0");
  });

  it("stronicuje keyset: bez duplikatów i luk, malejąco po created_at, nextCursor=null na końcu", async () => {
    const org = await createOrganization(client);
    for (let n = 1; n <= 7; n += 1) {
      const c = await createPublishedCampaign(client, { organization: org, onchainCampaignId: n });
      await setSlug(c.id, `kampania-${String(n)}`);
      // Wspólny znacznik czasu dla kilku wierszy sprawdza rozstrzyganie po id.
      await client.query("update public.campaigns set created_at = $2::timestamptz where id = $1", [
        c.id,
        n <= 4 ? "2026-11-01T10:00:00.123456Z" : `2026-11-02T10:00:0${String(n)}.000001Z`,
      ]);
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const res = await asApi(() =>
        listCampaigns(ctx, { limit: "3", ...(cursor ? { cursor } : {}) }),
      );
      expect(res.status).toBe(200);
      for (const i of items(res)) seen.push(i.slug as string);
      cursor = (body(res).nextCursor as string | null) ?? undefined;
      pages += 1;
    } while (cursor !== undefined && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(7); // bez powtórzeń na granicach stron
    expect(new Set(seen).size).toBe(7);
    // Najnowsze (5–7, późniejsza data) pierwsze; 4 wiersze o identycznym czasie na końcu.
    expect(seen.slice(0, 3)).toEqual(["kampania-7", "kampania-6", "kampania-5"]);
  });

  it("filtry: status, kategoria (bez względu na wielkość liter), q ze znakami specjalnymi LIKE dosłownie", async () => {
    const org = await createOrganization(client);
    const a = await createPublishedCampaign(client, { organization: org, onchainCampaignId: 1 });
    const b = await createPublishedCampaign(client, { organization: org, onchainCampaignId: 2 });
    await setSlug(a.id, "a", "Ciepły obiad 100% dla dzieci");
    await setSlug(b.id, "b", "Ciepły obiad dla seniorów");
    await client.query("update public.campaigns set category = 'Food' where id = $1", [a.id]);
    await client.query("update public.campaigns set status = 'PAUSED' where id = $1", [b.id]);

    expect(
      items(await asApi(() => listCampaigns(ctx, { status: "PAUSED" }))).map((i) => i.slug),
    ).toEqual(["b"]);
    expect(
      items(await asApi(() => listCampaigns(ctx, { category: "food" }))).map((i) => i.slug),
    ).toEqual(["a"]);
    // „%” i „_” nie są wildcardami: „100%” pasuje tylko do dosłownego „100%”.
    expect(items(await asApi(() => listCampaigns(ctx, { q: "100%" }))).map((i) => i.slug)).toEqual([
      "a",
    ]);
    expect(items(await asApi(() => listCampaigns(ctx, { q: "%" }))).map((i) => i.slug)).toEqual([
      "a",
    ]);
    expect(items(await asApi(() => listCampaigns(ctx, { q: "_" })))).toEqual([]);
    expect(escapeLike("a_b%c\\d")).toBe("a\\_b\\%c\\\\d");
  });

  it("odrzuca nieprawidłowe wejście (400) bez ujawniania wartości", async () => {
    for (const query of [
      { limit: "0" },
      { limit: "51" },
      { limit: "abc" },
      { status: "DRAFT" },
      { q: "" },
    ]) {
      const res = await respond(ctx, () => listCampaigns(ctx, query));
      expect(res.status).toBe(400);
      const err = (res.body as { error: { code: string; fields: string[] } }).error;
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(res.body)).not.toContain("DRAFT");
    }
    const bad = await respond(ctx, () => listCampaigns(ctx, { cursor: "to-nie-jest-kursor!" }));
    expect(bad.status).toBe(400);
    expect((bad.body as { error: { code: string } }).error.code).toBe("INVALID_CURSOR");
  });
});

describe("GET /campaigns/:slug", () => {
  it("zwraca szczegóły z organizacją i raportami; nie zawiera pól prywatnych", async () => {
    const c = await createPublishedCampaign(client, { onchainCampaignId: 1 });
    await setSlug(c.id, "szczegoly");
    const res = await asApi(() => getCampaign(ctx, "szczegoly"));
    expect(res.status).toBe(200);
    const data = body(res).data as Item;
    expect(data.slug).toBe("szczegoly");
    expect(data.beneficiary).toBe(c.organization.safe);
    expect(data.reports).toEqual([]);
    const text = JSON.stringify(res.body).toLowerCase();
    for (const forbidden of [
      "reason_private",
      "legal_name",
      "created_by",
      "approved_by",
      "tax_id",
      "email",
    ]) {
      expect(text).not.toContain(forbidden);
    }
    expect(Object.keys(data).sort()).toEqual(
      [
        "beneficiary",
        "capRaw",
        "category",
        "chainId",
        "descriptionMd",
        "donationsCount",
        "endAt",
        "id",
        "metadataHash",
        "onchainCampaignId",
        "organization",
        "publishedTxHash",
        "raisedRaw",
        "remainingRaw",
        "reports",
        "slug",
        "startAt",
        "status",
        "summary",
        "title",
      ].sort(),
    );
  });

  it("404 dla szkicu, nieistniejącej i z innej sieci — jednakowa odpowiedź; 400 dla złego sluga", async () => {
    const org = await createOrganization(client);
    const draft = await createDraftCampaign(client, org);
    await setSlug(draft.id, "szkic");
    const other = await createPublishedCampaign(client, { chainId: 42161, onchainCampaignId: 1 });
    await setSlug(other.id, "inna-siec");
    const results = await asApi(() =>
      Promise.all(
        ["szkic", "brak", "inna-siec"].map((s) => respond(ctx, () => getCampaign(ctx, s))),
      ),
    );
    for (const r of results) {
      expect(r.status).toBe(404);
      expect(r.body).toEqual(results[0]?.body);
    }
    const bad = await respond(ctx, () => getCampaign(ctx, "'; drop table campaigns; --"));
    expect(bad.status).toBe(400);
  });
});

describe("GET /campaigns/:slug/donations", () => {
  it("tylko potwierdzone; stronicowanie przy identycznych block_time nie gubi ani nie dubluje", async () => {
    const c = await createPublishedCampaign(client, { onchainCampaignId: 1 });
    await setSlug(c.id, "wplaty");
    const txs: string[] = [];
    for (let n = 1; n <= 5; n += 1) {
      txs.push(
        await addDonation(c, hexAddr(0xd000 + n), String(n * 1_000_000), {
          blockTime: "2026-11-01T12:00:00.000000Z",
        }),
      );
    }
    await addDonation(c, hexAddr(0xdead), "9000000", { state: "OBSERVED" });
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const res = await asApi(() =>
        listCampaignDonations(ctx, "wplaty", { limit: "2", ...(cursor ? { cursor } : {}) }),
      );
      for (const i of items(res)) seen.push(i.id as string);
      cursor = (body(res).nextCursor as string | null) ?? undefined;
      if (cursor === undefined) break;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    const all = await asApi(() => listCampaignDonations(ctx, "wplaty", {}));
    expect(
      items(all)
        .map((i) => i.amountRaw)
        .sort(),
    ).toEqual(["1000000", "2000000", "3000000", "4000000", "5000000"]);
    expect(JSON.stringify(all.body)).not.toContain("dead");
    // Dowód on-chain: każdy wiersz wskazuje transakcję zdarzenia (a nie obserwowanej, niepotwierdzonej wpłaty).
    expect(
      items(all)
        .map((i) => i.txHash)
        .sort(),
    ).toEqual([...txs].sort());
    expect(items(all)[0]).toMatchObject({ logIndex: 0, blockNumber: "100" });
  });

  it("404 dla nieopublikowanej kampanii", async () => {
    const org = await createOrganization(client);
    const draft = await createDraftCampaign(client, org);
    await setSlug(draft.id, "szkic2");
    const res = await asApi(() => respond(ctx, () => listCampaignDonations(ctx, "szkic2", {})));
    expect(res.status).toBe(404);
  });
});

describe("raporty, organizacje, darczyńcy", () => {
  it("raporty: tylko te z potwierdzonym dowodem on-chain; okres jako data tekstowa (bez przesunięć stref)", async () => {
    const c = await createPublishedCampaign(client, { onchainCampaignId: 1 });
    await setSlug(c.id, "z-raportem");
    const draftReport = await client.query<{ id: string }>(
      `insert into public.impact_reports (campaign_id, version, period_start, period_end, created_by)
       values ($1, 1, '2026-11-01', '2027-02-28', $2) returning id`,
      [c.id, hexAddr(0x7e57)],
    );
    const empty = await asApi(() => listCampaignReports(ctx, "z-raportem"));
    expect(items(empty)).toEqual([]); // szkic nie jest publiczny

    const id = draftReport.rows[0]?.id;
    await client.query("update public.impact_reports set status = 'SUBMITTED' where id = $1", [id]);
    await client.query("update public.impact_reports set status = 'REDACTING' where id = $1", [id]);
    const tx = hexHash(nextId());
    await client.query(
      `insert into public.chain_events
         (chain_id, contract_lower, event_name, tx_hash, log_index, block_number, block_hash, tx_index, args,
          canonical, confirmation_state, confirmed_at)
       values ($1, $2, 'ReportPublished', $3, 0, 200, $4, 0, $5::jsonb, true, 'CONFIRMED', now())`,
      [
        CHAIN,
        hexAddr(0x1ac7),
        tx,
        hexHash(nextId()),
        JSON.stringify({
          reportId: "7",
          campaignId: "1",
          contentSha256: `0x${"a".repeat(64)}`,
          publicUri: "ipfs://x",
          version: "1",
        }),
      ],
    );
    await client.query(
      `update public.impact_reports set status = 'PUBLISHED', public_uri = 'ipfs://x',
         content_sha256 = $2, onchain_report_id = 7, publish_tx_hash = $3 where id = $1`,
      [id, `0x${"a".repeat(64)}`, tx],
    );
    const res = await asApi(() => listCampaignReports(ctx, "z-raportem"));
    const [report] = items(res);
    expect(report).toMatchObject({
      version: 1,
      status: "PUBLISHED",
      onchainReportId: "7",
      periodStart: "2026-11-01",
      periodEnd: "2027-02-28",
      reviewTxHash: null,
    });
    const detail = (body(await asApi(() => getCampaign(ctx, "z-raportem"))).data as Item)
      .reports as Item[];
    expect(detail).toHaveLength(1);
  });

  it("organizacja: tylko zatwierdzona, bez danych prywatnych, w bieżącej sieci", async () => {
    const approved = await createOrganization(client);
    const pending = await createOrganization(client, { approved: false });
    const mainnet = await createOrganization(client, { chainId: 42161 });
    const ok = await asApi(() => getOrganization(ctx, approved.id));
    expect(Object.keys(body(ok).data as Item).sort()).toEqual([
      "countryCode",
      "displayName",
      "id",
      "safeAddress",
      "safeChainId",
      "verifiedAt",
    ]);
    expect(JSON.stringify(ok.body)).not.toMatch(/legal_name|Testowa/);
    for (const org of [pending, mainnet]) {
      expect((await asApi(() => respond(ctx, () => getOrganization(ctx, org.id)))).status).toBe(
        404,
      );
    }
    expect((await respond(ctx, () => getOrganization(ctx, "nie-uuid"))).status).toBe(400);
  });

  it("darczyńca: tylko profil opt-in; brak profilu i profil prywatny są nieodróżnialne", async () => {
    const c = await createPublishedCampaign(client, { onchainCampaignId: 1 });
    const publicWallet = hexAddr(0xa11ce);
    const privateWallet = hexAddr(0xb0b);
    await addDonation(c, publicWallet, "150000000");
    await addDonation(c, privateWallet, "5000000");
    await client.query(
      `insert into public.donor_profiles (chain_id, wallet_lower, display_name, bio, profile_public)
       values ($1, $2, 'Alicja', 'Lubię pomagać', true), ($1, $3, 'Bob', 'Prywatny', false)`,
      [CHAIN, publicWallet, privateWallet],
    );
    // Ten sam portfel ma publiczny profil w INNEJ sieci: nie może być widoczny w tej.
    await client.query(
      `insert into public.donor_profiles (chain_id, wallet_lower, display_name, profile_public)
       values (42161, $1, 'Alicja (mainnet)', true)`,
      [publicWallet],
    );
    const res = await asApi(() =>
      getDonor(ctx, String(CHAIN), publicWallet.toUpperCase().replace("0X", "0x")),
    );
    expect(body(res).data).toMatchObject({
      wallet: publicWallet,
      displayName: "Alicja",
      totalDonatedRaw: "150000000",
      donationsCount: 1,
      tier: 2,
      scope: "CONFIRMED_DONATIONS_VIA_CHARONCHAIN_ON_THIS_CHAIN",
    });
    const hidden = await asApi(() =>
      respond(ctx, () => getDonor(ctx, String(CHAIN), privateWallet)),
    );
    const missing = await asApi(() =>
      respond(ctx, () => getDonor(ctx, String(CHAIN), hexAddr(0x1234))),
    );
    const wrongChain = await asApi(() => respond(ctx, () => getDonor(ctx, "42161", publicWallet)));
    for (const r of [hidden, missing, wrongChain]) {
      expect(r.status).toBe(404);
      expect(r.body).toEqual(hidden.body);
    }
    expect(JSON.stringify(hidden.body)).not.toContain("Bob");
  });
});

describe("kopertowanie błędów i kursory", () => {
  it("nieoczekiwany błąd bazy → 500 bez treści błędu, SQL i wartości; callback dostaje oryginał", async () => {
    const failing: ApiContext = {
      ...ctx,
      db: {
        query: () =>
          Promise.reject(new Error('relacja "public.secret_table" nie istnieje: select * from x')),
      } as never,
    };
    let logged: unknown;
    const res = await respond(
      failing,
      () => listCampaigns(failing, {}),
      (e) => (logged = e),
    );
    expect(res.status).toBe(500);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/secret_table|select|relacja/);
    expect((res.body as { error: { requestId: string } }).error.requestId).toBe("req_test");
    expect(logged).toBeInstanceOf(Error);
  });

  it("kursor: round-trip i odrzucanie manipulacji", () => {
    const c = { t: "2026-11-01T10:00:00.123456Z", i: "123e4567-e89b-12d3-a456-426614174000" };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    const evil = Buffer.from(JSON.stringify({ t: "2026-11-01'; drop", i: c.i })).toString(
      "base64url",
    );
    expect(() => decodeCursor(evil)).toThrow(/kursor/i);
    expect(() => decodeCursor(Buffer.from("{}").toString("base64url"))).toThrow();
    expect(() => decodeCursor("A".repeat(300))).toThrow();
  });

  it("dane prywatne organizacji są niewidoczne dla roli API bez tożsamości (RLS), choć istnieją", async () => {
    const org = await createOrganization(client);
    await client.query(
      "insert into public.organization_private (organization_id, contact_email) values ($1, 'tajny@example.org')",
      [org.id],
    );
    const owner = await client.query("select 1 from public.organization_private");
    expect(owner.rowCount).toBe(1);
    const asApp = await asApi(() => client.query("select * from public.organization_private"));
    expect(asApp.rowCount).toBe(0);
    const res = await asApi(() => getOrganization(ctx, org.id));
    expect(JSON.stringify(res.body)).not.toContain("tajny@example.org");
  });
});

describe("status projekcji (AC-33)", () => {
  it("brak kursorów lub niepełny skan → UNAVAILABLE i sumy niefinalne", async () => {
    expect(await asApi(() => getProjectionStatus(ctx))).toMatchObject({
      state: "UNAVAILABLE",
      final: false,
    });
    await seedCursors({ count: 3 });
    expect(await asApi(() => getProjectionStatus(ctx))).toMatchObject({
      state: "UNAVAILABLE",
      final: false,
    });
  });

  it("sprawny indexer → OK i final; confirmedBlock to najsłabszy kursor", async () => {
    await seedCursors();
    expect(await asApi(() => getProjectionStatus(ctx))).toEqual({
      state: "OK",
      confirmedBlock: "988",
      ageSeconds: 1,
      final: true,
    });
  });

  it("status ERROR (np. niezgodność z kontraktem) → sumy niefinalne", async () => {
    await seedCursors({ errorOn: 2 });
    expect(await asApi(() => getProjectionStatus(ctx))).toMatchObject({
      state: "ERROR",
      final: false,
    });
  });

  it("kursor, który stoi dłużej niż próg → STALE; próg jest konfigurowalny", async () => {
    await seedCursors({ ageSeconds: 600 });
    expect(await asApi(() => getProjectionStatus(ctx))).toMatchObject({
      state: "STALE",
      final: false,
      ageSeconds: 600,
    });
    expect(
      await asApi(() => getProjectionStatus({ ...ctx, staleAfterSeconds: 1200 })),
    ).toMatchObject({ state: "OK", final: true });
  });

  it("wystarczy JEDEN stojący kursor, by dane były nieaktualne (liczy się najstarszy)", async () => {
    await seedCursors({ staleOn: 3 });
    expect(await asApi(() => getProjectionStatus(ctx))).toMatchObject({
      state: "STALE",
      final: false,
    });
  });

  it("kursory innej sieci nie wpływają na status bieżącej sieci", async () => {
    await seedCursors({ chainId: 42161 });
    expect(await asApi(() => getProjectionStatus(ctx))).toMatchObject({ state: "UNAVAILABLE" });
  });

  it("wszystkie odpowiedzi z sumami niosą status projekcji; sumy nie są ukrywane, tylko oznaczone", async () => {
    const c = await createPublishedCampaign(client, { onchainCampaignId: 1 });
    await setSlug(c.id, "ze-statusem");
    await addDonation(c, hexAddr(0xa11ce), "2000000");
    await client.query(
      "insert into public.donor_profiles (chain_id, wallet_lower, display_name, profile_public) values ($1, $2, 'A', true)",
      [CHAIN, hexAddr(0xa11ce)],
    );
    await seedCursors({ errorOn: 0 });
    const responses = await asApi(() =>
      Promise.all([
        listCampaigns(ctx, {}),
        getCampaign(ctx, "ze-statusem"),
        listCampaignDonations(ctx, "ze-statusem", {}),
        getDonor(ctx, String(CHAIN), hexAddr(0xa11ce)),
      ]),
    );
    for (const r of responses) {
      expect((body(r).projection as { state: string; final: boolean }).state).toBe("ERROR");
      expect((body(r).projection as { final: boolean }).final).toBe(false);
    }
    expect((items(responses[0])[0] as Item).raisedRaw).toBe("2000000");
  });
});
