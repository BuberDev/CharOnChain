/**
 * Testy integracyjne migracji 0003_organizations_campaigns (COC-020) na PRAWDZIWYM Postgresie.
 * Pokrywają: AC-01 (publikacja dopiero po potwierdzonym evencie), AC-02 (organizacja musi być APPROVED),
 * AC-03/INV-05 (niezmienne warunki), AC-23/4-eyes, niemutowalność rewizji i recenzji, FK donacji do kampanii,
 * brak publicznego dostępu (RLS deny-by-default).
 */
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadMigrations } from "./migrations.js";
import { findTablesWithoutRls, migrateDown, migrateUp } from "./runner.js";
import {
  catalogSnapshot,
  createTempDatabase,
  ensureRole,
  type TempDatabase,
} from "./testing/db.js";
import {
  approveCampaign,
  createDraftCampaign,
  createOrganization,
  createPublishedCampaign,
  hexAddr,
  hexHash,
  insertCampaignCreatedEvent,
  nextId,
} from "./testing/fixtures.js";

const MIGRATIONS_DIR = new URL("../migrations", import.meta.url).pathname;

let temp: TempDatabase;
let client: Client;

function pgCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    return typeof error.code === "string" ? error.code : undefined;
  }
  return undefined;
}

async function expectPgError(
  run: () => Promise<unknown>,
  code: string,
  message?: RegExp,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    expect(pgCode(error), text).toBe(code);
    if (message !== undefined) expect(text).toMatch(message);
    return;
  }
  throw new Error(`Oczekiwano błędu SQLSTATE ${code}, ale zapytanie przeszło`);
}

const setStatus = (id: string, status: string): Promise<unknown> =>
  client.query("update public.campaigns set status = $2::app.campaign_status where id = $1", [
    id,
    status,
  ]);

beforeAll(async () => {
  temp = await createTempDatabase();
  client = new Client({ connectionString: temp.url });
  await client.connect();
  await ensureRole(client, "anon");
  await ensureRole(client, "authenticated");
  await migrateUp(client, loadMigrations(MIGRATIONS_DIR));
});

afterAll(async () => {
  await client.end();
  await temp.drop();
});

describe("organizations", () => {
  it("nowa organizacja jest PENDING; kod kraju to dwie wielkie litery", async () => {
    const result = await client.query<{ status: string }>(
      `insert into public.organizations (legal_name, display_name, country_code)
       values ('Fundacja A', 'A', 'PL') returning status`,
    );
    expect(result.rows[0]?.status).toBe("PENDING");
    // char(2): zbyt długi napis daje 22001, pozostałe złe wartości łamią CHECK (23514).
    const expected: [string, string][] = [
      ["pl", "23514"],
      ["POL", "22001"],
      ["P1", "23514"],
      ["", "23514"],
    ];
    for (const [bad, code] of expected) {
      await expectPgError(
        () =>
          client.query(
            `insert into public.organizations (legal_name, display_name, country_code) values ('X', 'X', $1)`,
            [bad],
          ),
        code,
      );
    }
  });

  it("APPROVED wymaga zweryfikowanego Safe i daty weryfikacji (AC-02)", async () => {
    await expectPgError(
      () =>
        client.query(
          `insert into public.organizations (legal_name, display_name, country_code, status)
           values ('X', 'X', 'PL', 'APPROVED')`,
        ),
      "23514",
    );
    await expectPgError(
      () =>
        client.query(
          `insert into public.organizations (legal_name, display_name, country_code, status, safe_address_lower, safe_chain_id)
           values ('X', 'X', 'PL', 'APPROVED', $1, 421614)`,
          [hexAddr(0x77)],
        ),
      "23514",
    );
    await createOrganization(client); // poprawna zatwierdzona organizacja
  });

  it("adres i sieć Safe idą parami; sieć ograniczona do 42161/421614; adres małymi literami", async () => {
    await expectPgError(
      () =>
        client.query(
          `insert into public.organizations (legal_name, display_name, country_code, safe_address_lower)
           values ('X', 'X', 'PL', $1)`,
          [hexAddr(0x10)],
        ),
      "23514",
    );
    await expectPgError(
      () =>
        client.query(
          `insert into public.organizations (legal_name, display_name, country_code, safe_address_lower, safe_chain_id)
           values ('X', 'X', 'PL', $1, 1)`,
          [hexAddr(0x11)],
        ),
      "23514",
    );
    await expectPgError(
      () =>
        client.query(
          `insert into public.organizations (legal_name, display_name, country_code, safe_address_lower, safe_chain_id)
           values ('X', 'X', 'PL', $1, 421614)`,
          ["0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD"],
        ),
      "23514",
    );
  });

  it("jeden Safe = jedna organizacja na sieci; ten sam adres na innej sieci jest dozwolony", async () => {
    const safe = hexAddr(0xdead01);
    await createOrganization(client, { safe, chainId: 421614 });
    await expectPgError(() => createOrganization(client, { safe, chainId: 421614 }), "23505");
    await createOrganization(client, { safe, chainId: 42161 });
  });

  it("wygaśnięcie weryfikacji musi być po jej dacie", async () => {
    const org = await createOrganization(client);
    await expectPgError(
      () =>
        client.query(
          "update public.organizations set verification_expires_at = verified_at - interval '1 day' where id = $1",
          [org.id],
        ),
      "23514",
    );
    await client.query(
      "update public.organizations set verification_expires_at = verified_at + interval '1 year' where id = $1",
      [org.id],
    );
  });

  it("updated_at jest odświeżane wyzwalaczem", async () => {
    const org = await createOrganization(client);
    const before = await client.query<{ updated_at: Date }>(
      "select updated_at from public.organizations where id = $1",
      [org.id],
    );
    await client.query("select pg_sleep(0.05)");
    await client.query(
      "update public.organizations set display_name = 'Nowa nazwa' where id = $1",
      [org.id],
    );
    const after = await client.query<{ updated_at: Date }>(
      "select updated_at from public.organizations where id = $1",
      [org.id],
    );
    expect(after.rows[0]?.updated_at.getTime()).toBeGreaterThan(
      before.rows[0]?.updated_at.getTime() ?? 0,
    );
  });
});

describe("organization_private i organization_members", () => {
  it("dane prywatne: e-mail ma poprawny format, people_json to tablica, wynik KYB z listy", async () => {
    const org = await createOrganization(client);
    await client.query(
      "insert into public.organization_private (organization_id, contact_email) values ($1, 'a@b.pl')",
      [org.id],
    );
    const org2 = await createOrganization(client);
    await expectPgError(
      () =>
        client.query(
          "insert into public.organization_private (organization_id, contact_email) values ($1, 'zly-email')",
          [org2.id],
        ),
      "23514",
    );
    await expectPgError(
      () =>
        client.query(
          "insert into public.organization_private (organization_id, people_json) values ($1, '{}'::jsonb)",
          [org2.id],
        ),
      "23514",
    );
    await expectPgError(
      () =>
        client.query(
          "insert into public.organization_private (organization_id, kyb_result) values ($1, 'OK')",
          [org2.id],
        ),
      "23514",
    );
  });

  it("jedno aktywne członkostwo portfela; po odwołaniu można dodać ponownie", async () => {
    const org = await createOrganization(client);
    const wallet = hexAddr(0xbeef01);
    await client.query(
      "insert into public.organization_members (organization_id, wallet_lower, role) values ($1, $2, 'OWNER')",
      [org.id, wallet],
    );
    await expectPgError(
      () =>
        client.query(
          "insert into public.organization_members (organization_id, wallet_lower, role) values ($1, $2, 'MANAGER')",
          [org.id, wallet],
        ),
      "23505",
    );
    await client.query(
      "update public.organization_members set revoked_at = now() where organization_id = $1 and wallet_lower = $2",
      [org.id, wallet],
    );
    await client.query(
      "insert into public.organization_members (organization_id, wallet_lower, role) values ($1, $2, 'MANAGER')",
      [org.id, wallet],
    );
    // ten sam portfel w innej organizacji jest dozwolony
    const other = await createOrganization(client);
    await client.query(
      "insert into public.organization_members (organization_id, wallet_lower, role) values ($1, $2, 'REPORTER')",
      [other.id, wallet],
    );
  });

  it("revoked_at nie może poprzedzać created_at; rola z listy", async () => {
    const org = await createOrganization(client);
    await expectPgError(
      () =>
        client.query(
          `insert into public.organization_members (organization_id, wallet_lower, role, created_at, revoked_at)
           values ($1, $2, 'OWNER', now(), now() - interval '1 day')`,
          [org.id, hexAddr(0xbeef02)],
        ),
      "23514",
    );
    await expectPgError(
      () =>
        client.query(
          "insert into public.organization_members (organization_id, wallet_lower, role) values ($1, $2, 'ADMIN')",
          [org.id, hexAddr(0xbeef03)],
        ),
      "22P02",
    );
  });
});

describe("campaigns — ograniczenia danych", () => {
  it("limit: > 0 i mieści się w uint128; okno: koniec po początku; slug: format i unikalność", async () => {
    const org = await createOrganization(client);
    const make = (overrides: { cap?: string; slug?: string; start?: string; end?: string }) =>
      client.query(
        `insert into public.campaigns
           (organization_id, chain_id, slug, title, cap_raw, start_at, end_at, beneficiary_lower, created_by_wallet_lower)
         values ($1, 421614, $2, 'T', $3::numeric, $4::timestamptz, $5::timestamptz, $6, $7)`,
        [
          org.id,
          overrides.slug ?? `slug-${String(nextId())}`,
          overrides.cap ?? "1000000",
          overrides.start ?? "2027-01-01T00:00:00Z",
          overrides.end ?? "2027-02-01T00:00:00Z",
          org.safe,
          hexAddr(0xc0de),
        ],
      );
    await make({});
    await expectPgError(() => make({ cap: "0" }), "23514");
    await expectPgError(() => make({ cap: "340282366920938463463374607431768211456" }), "23514"); // uint128 + 1
    await make({ cap: "340282366920938463463374607431768211455" }); // dokładnie uint128 max
    await expectPgError(() => make({ end: "2027-01-01T00:00:00Z" }), "23514");
    await expectPgError(() => make({ end: "2026-12-01T00:00:00Z" }), "23514");
    for (const bad of ["Zly Slug", "-a", "a-", "a--b", "ą", "A", ""]) {
      await expectPgError(() => make({ slug: bad }), "23514");
    }
    await make({ slug: "dobry-slug-2027" });
    await expectPgError(() => make({ slug: "dobry-slug-2027" }), "23505");
  });

  it("nowa kampania musi być DRAFT, bez zatwierdzenia i faktów z łańcucha", async () => {
    const org = await createOrganization(client);
    const insert = (extra: string, value: string) =>
      client.query(
        `insert into public.campaigns
           (organization_id, chain_id, slug, title, cap_raw, start_at, end_at, beneficiary_lower, created_by_wallet_lower, ${extra})
         values ($1, 421614, $2, 'T', 1, now(), now() + interval '1 day', $3, $4, ${value})`,
        [org.id, `s-${String(nextId())}`, org.safe, hexAddr(0xc0de)],
      );
    await expectPgError(() => insert("status", "'PUBLISHED'"), "23514");
    await expectPgError(() => insert("onchain_campaign_id", "5"), "23514");
    await expectPgError(() => insert("published_tx_hash", `'${hexHash(9)}'`), "23514");
    await expectPgError(() => insert("approved_by_wallet_lower", `'${hexAddr(0xa)}'`), "23514");
  });

  it("identyfikator on-chain jest unikalny w sieci (różne sieci mogą mieć ten sam)", async () => {
    await createPublishedCampaign(client, { onchainCampaignId: 50, chainId: 421614 });
    await createPublishedCampaign(client, { onchainCampaignId: 50, chainId: 42161 });
    await expectPgError(
      () => createPublishedCampaign(client, { onchainCampaignId: 50, chainId: 421614 }),
      "23505",
    );
  });
});

describe("campaigns — maszyna stanów, 4-eyes i publikacja (AC-01, AC-02)", () => {
  it("pełna ścieżka DRAFT -> PUBLISHED -> PAUSED -> PUBLISHED -> CLOSED", async () => {
    const published = await createPublishedCampaign(client, { onchainCampaignId: 101 });
    await setStatus(published.id, "PAUSED");
    await setStatus(published.id, "PUBLISHED");
    await setStatus(published.id, "CLOSED");
    const row = await client.query<{ status: string }>(
      "select status from public.campaigns where id = $1",
      [published.id],
    );
    expect(row.rows[0]?.status).toBe("CLOSED");
  });

  it.each([
    ["DRAFT", "PUBLISHED"],
    ["DRAFT", "APPROVED"],
    ["DRAFT", "UNDER_REVIEW"],
    ["DRAFT", "PUBLISHING"],
    ["DRAFT", "CLOSED"],
  ])("niedozwolone przejście %s -> %s", async (from, to) => {
    const org = await createOrganization(client);
    const draft = await createDraftCampaign(client, org);
    expect(from).toBe("DRAFT");
    await expectPgError(() => setStatus(draft.id, to), "23514", /Niedozwolone przej/);
  });

  it("CLOSED i REJECTED są stanami ostatecznymi", async () => {
    const closed = await createPublishedCampaign(client, { onchainCampaignId: 102 });
    await setStatus(closed.id, "CLOSED");
    for (const to of ["PUBLISHED", "PAUSED", "APPROVED", "DRAFT"]) {
      await expectPgError(() => setStatus(closed.id, to), "23514");
    }
    const org = await createOrganization(client);
    const draft = await createDraftCampaign(client, org);
    await setStatus(draft.id, "SUBMITTED");
    await setStatus(draft.id, "UNDER_REVIEW");
    await setStatus(draft.id, "REJECTED");
    await expectPgError(() => setStatus(draft.id, "DRAFT"), "23514");
  });

  it("AC-02: kampania niezatwierdzonej organizacji nie przechodzi do APPROVED", async () => {
    const pendingOrg = await createOrganization(client, { approved: false });
    const draft = await createDraftCampaign(client, pendingOrg);
    await setStatus(draft.id, "SUBMITTED");
    await setStatus(draft.id, "UNDER_REVIEW");
    await expectPgError(
      () =>
        client.query(
          "update public.campaigns set status = 'APPROVED', approved_by_wallet_lower = $2, metadata_hash = $3 where id = $1",
          [draft.id, draft.approver, hexHash(nextId())],
        ),
      "23514",
      /Organizacja nie jest zatwierdzona/,
    );
  });

  it("4-eyes: autor nie może być zatwierdzającym; zatwierdzenie wymaga zatwierdzającego i hasha metadanych", async () => {
    const org = await createOrganization(client);
    const draft = await createDraftCampaign(client, org);
    await setStatus(draft.id, "SUBMITTED");
    await setStatus(draft.id, "UNDER_REVIEW");
    await expectPgError(
      () =>
        client.query(
          "update public.campaigns set status = 'APPROVED', approved_by_wallet_lower = created_by_wallet_lower, metadata_hash = $2 where id = $1",
          [draft.id, hexHash(nextId())],
        ),
      "23514",
    );
    await expectPgError(() => setStatus(draft.id, "APPROVED"), "23514"); // brak zatwierdzającego
    await expectPgError(
      () =>
        client.query(
          "update public.campaigns set status = 'APPROVED', approved_by_wallet_lower = $2 where id = $1",
          [draft.id, draft.approver],
        ),
      "23514",
    ); // brak hasha metadanych
  });

  it("beneficjent musi być zweryfikowanym Safe organizacji na tej samej sieci (przy PUBLISHING)", async () => {
    const org = await createOrganization(client);
    const draft = await createDraftCampaign(client, org, { beneficiary: hexAddr(0xbad0bad) });
    await approveCampaign(client, draft);
    await expectPgError(() => setStatus(draft.id, "PUBLISHING"), "23514", /zweryfikowanym Safe/);
  });

  it("AC-01: PUBLISHED wymaga potwierdzonego, kanonicznego CampaignCreated zgodnego z kampanią", async () => {
    const org = await createOrganization(client);
    const publish = async (
      txHash: string,
      onchainId: number,
      event?: Parameters<typeof insertCampaignCreatedEvent>[1],
    ) => {
      const draft = await createDraftCampaign(client, org, { slug: `pub-${String(nextId())}` });
      await approveCampaign(client, draft);
      await setStatus(draft.id, "PUBLISHING");
      if (event !== undefined)
        await insertCampaignCreatedEvent(client, { ...event, capRaw: event.capRaw });
      return client.query(
        "update public.campaigns set status = 'PUBLISHED', onchain_campaign_id = $2, published_tx_hash = $3 where id = $1",
        [draft.id, onchainId, txHash],
      );
    };
    const base = { chainId: org.chainId, beneficiary: org.safe, capRaw: "10000000" };

    // brak zdarzenia
    await expectPgError(() => publish(hexHash(nextId()), 201), "23514", /CampaignCreated/);
    // zdarzenie tylko OBSERVED
    let tx = hexHash(nextId());
    await expectPgError(
      () =>
        publish(tx, 202, {
          ...base,
          txHash: tx,
          onchainCampaignId: 202,
          confirmationState: "OBSERVED",
        }),
      "23514",
    );
    // zdarzenie ORPHANED
    tx = hexHash(nextId());
    await expectPgError(
      () =>
        publish(tx, 203, {
          ...base,
          txHash: tx,
          onchainCampaignId: 203,
          confirmationState: "ORPHANED",
        }),
      "23514",
    );
    // niezgodny capRaw
    tx = hexHash(nextId());
    await expectPgError(
      () => publish(tx, 204, { ...base, txHash: tx, onchainCampaignId: 204, capRaw: "9999999" }),
      "23514",
    );
    // niezgodny beneficjent
    tx = hexHash(nextId());
    await expectPgError(
      () =>
        publish(tx, 205, {
          ...base,
          txHash: tx,
          onchainCampaignId: 205,
          beneficiary: hexAddr(0x1234),
        }),
      "23514",
    );
    // niezgodny identyfikator on-chain
    tx = hexHash(nextId());
    await expectPgError(
      () => publish(tx, 207, { ...base, txHash: tx, onchainCampaignId: 206 }),
      "23514",
    );
    // poprawne
    tx = hexHash(nextId());
    await publish(tx, 208, { ...base, txHash: tx, onchainCampaignId: 208 });
  });

  it("opublikowany rekord ma identyfikator i hash transakcji (constraint)", async () => {
    const org = await createOrganization(client);
    const draft = await createDraftCampaign(client, org);
    await approveCampaign(client, draft);
    await setStatus(draft.id, "PUBLISHING");
    await expectPgError(() => setStatus(draft.id, "PUBLISHED"), "23514");
  });
});

describe("campaigns — niezmienność (AC-03, INV-05)", () => {
  it("od PUBLISHING zamrożone: beneficjent, limit, okno, sieć, organizacja, autor; treść opisowa edytowalna", async () => {
    const published = await createPublishedCampaign(client, { onchainCampaignId: 301 });
    const other = await createOrganization(client);
    const updates = [
      ["beneficiary_lower = $2", hexAddr(0x999)],
      ["cap_raw = $2::numeric", "99"],
      ["start_at = start_at + interval '1 day'", null],
      ["end_at = end_at + interval '1 day'", null],
      ["chain_id = 42161", null],
      ["organization_id = $2", other.id],
      ["created_by_wallet_lower = $2", hexAddr(0x998)],
    ] as const;
    for (const [setClause, value] of updates) {
      await expectPgError(
        () =>
          value === null
            ? client.query(`update public.campaigns set ${setClause} where id = $1`, [published.id])
            : client.query(`update public.campaigns set ${setClause} where id = $1`, [
                published.id,
                value,
              ]),
        "23514",
      );
    }
    await client.query(
      "update public.campaigns set title = 'Nowy tytuł', description_md = 'Opis' where id = $1",
      [published.id],
    );
  });

  it("onchain_campaign_id i published_tx_hash niezmienne po ustawieniu", async () => {
    const published = await createPublishedCampaign(client, { onchainCampaignId: 302 });
    await expectPgError(
      () =>
        client.query("update public.campaigns set onchain_campaign_id = 999 where id = $1", [
          published.id,
        ]),
      "23514",
    );
    await expectPgError(
      () =>
        client.query("update public.campaigns set published_tx_hash = $2 where id = $1", [
          published.id,
          hexHash(5),
        ]),
      "23514",
    );
  });

  it("w DRAFT można edytować warunki (jeszcze nie ma publikacji)", async () => {
    const org = await createOrganization(client);
    const draft = await createDraftCampaign(client, org);
    await client.query(
      "update public.campaigns set cap_raw = 5000000, end_at = end_at + interval '1 day' where id = $1",
      [draft.id],
    );
  });

  it("kampanii nie można usunąć", async () => {
    const published = await createPublishedCampaign(client, { onchainCampaignId: 303 });
    await expectPgError(
      () => client.query("delete from public.campaigns where id = $1", [published.id]),
      "23514",
      /Usuwanie/,
    );
  });
});

describe("campaign_revisions i campaign_reviews", () => {
  async function draftWithRevision() {
    const org = await createOrganization(client);
    const draft = await createDraftCampaign(client, org);
    const revision = await client.query<{ id: string }>(
      `insert into public.campaign_revisions (campaign_id, version, content_json, content_sha256, created_by)
       values ($1, 1, '{"title":"T"}'::jsonb, $2, $3) returning id`,
      [draft.id, hexHash(nextId()), draft.creator],
    );
    return { org, draft, revisionId: revision.rows[0]?.id ?? "" };
  }

  it("wersje są unikalne per kampania; hash i treść walidowane; wiersze niemutowalne", async () => {
    const { draft, revisionId } = await draftWithRevision();
    await expectPgError(
      () =>
        client.query(
          `insert into public.campaign_revisions (campaign_id, version, content_json, content_sha256, created_by)
           values ($1, 1, '{}'::jsonb, $2, $3)`,
          [draft.id, hexHash(nextId()), draft.creator],
        ),
      "23505",
    );
    await expectPgError(
      () =>
        client.query(
          `insert into public.campaign_revisions (campaign_id, version, content_json, content_sha256, created_by)
           values ($1, 2, '[]'::jsonb, $2, $3)`,
          [draft.id, hexHash(nextId()), draft.creator],
        ),
      "23514",
    );
    await expectPgError(
      () =>
        client.query(
          `insert into public.campaign_revisions (campaign_id, version, content_json, content_sha256, created_by)
           values ($1, 2, '{}'::jsonb, '0xabc', $2)`,
          [draft.id, draft.creator],
        ),
      "23514",
    );
    await client.query(
      `insert into public.campaign_revisions (campaign_id, version, content_json, content_sha256, created_by)
       values ($1, 2, '{"title":"T2"}'::jsonb, $2, $3)`,
      [draft.id, hexHash(nextId()), draft.creator],
    );
    await expectPgError(
      () =>
        client.query(
          "update public.campaign_revisions set content_json = '{}'::jsonb where id = $1",
          [revisionId],
        ),
      "23514",
      /append-only/,
    );
    await expectPgError(
      () => client.query("delete from public.campaign_revisions where id = $1", [revisionId]),
      "23514",
      /append-only/,
    );
  });

  it("recenzja musi dotyczyć rewizji TEJ kampanii (złożony FK)", async () => {
    const a = await draftWithRevision();
    const b = await draftWithRevision();
    await expectPgError(
      () =>
        client.query(
          `insert into public.campaign_reviews (campaign_id, revision_id, reviewer_wallet_lower, decision)
           values ($1, $2, $3, 'APPROVED')`,
          [a.draft.id, b.revisionId, hexAddr(0xe1)],
        ),
      "23503",
    );
  });

  it("4-eyes w recenzjach: autor i aktywny członek organizacji nie zatwierdzają; odwołany członek i obcy tak", async () => {
    const { org, draft, revisionId } = await draftWithRevision();
    const member = hexAddr(0xfeed01);
    await client.query(
      "insert into public.organization_members (organization_id, wallet_lower, role) values ($1, $2, 'MANAGER')",
      [org.id, member],
    );
    const review = (reviewer: string, decision = "APPROVED") =>
      client.query(
        `insert into public.campaign_reviews (campaign_id, revision_id, reviewer_wallet_lower, decision, reason_public)
         values ($1, $2, $3, $4::app.review_decision, 'powód')`,
        [draft.id, revisionId, reviewer, decision],
      );
    await expectPgError(() => review(draft.creator), "23514", /Autor kampanii/);
    await expectPgError(() => review(member), "23514", /Członek organizacji/);
    // Prośba o zmiany i odrzucenie nie są ograniczone regułą zatwierdzania.
    await review(member, "CHANGES_REQUESTED");
    // Niezależny recenzent zatwierdza.
    await review(draft.approver);
    // Po odwołaniu członkostwa ten portfel nie jest już „wewnątrz” organizacji.
    await client.query(
      "update public.organization_members set revoked_at = now() where organization_id = $1 and wallet_lower = $2",
      [org.id, member],
    );
    await review(member);
  });

  it("odrzucenie i prośba o zmiany wymagają powodu publicznego; recenzje są append-only", async () => {
    const { draft, revisionId } = await draftWithRevision();
    await expectPgError(
      () =>
        client.query(
          `insert into public.campaign_reviews (campaign_id, revision_id, reviewer_wallet_lower, decision)
           values ($1, $2, $3, 'REJECTED')`,
          [draft.id, revisionId, draft.approver],
        ),
      "23514",
    );
    const inserted = await client.query<{ id: string }>(
      `insert into public.campaign_reviews (campaign_id, revision_id, reviewer_wallet_lower, decision, reason_public)
       values ($1, $2, $3, 'REJECTED', 'Brak dokumentów') returning id`,
      [draft.id, revisionId, draft.approver],
    );
    const id = inserted.rows[0]?.id ?? "";
    await expectPgError(
      () =>
        client.query("update public.campaign_reviews set decision = 'APPROVED' where id = $1", [
          id,
        ]),
      "23514",
      /append-only/,
    );
    await expectPgError(
      () => client.query("delete from public.campaign_reviews where id = $1", [id]),
      "23514",
      /append-only/,
    );
  });
});

describe("donations -> campaigns (uzupełnienie COC-021)", () => {
  async function eventFor(chainId: number): Promise<string> {
    const result = await client.query<{ id: string }>(
      `insert into public.chain_events
         (chain_id, contract_lower, event_name, tx_hash, log_index, block_number, block_hash, tx_index, args)
       values ($1, $2, 'DonationReceived', $3, 0, 100, $4, 0, '{}'::jsonb) returning id`,
      [chainId, hexAddr(0xa1), hexHash(nextId()), hexHash(nextId())],
    );
    return result.rows[0]?.id ?? "";
  }
  const donation = (
    eventId: string,
    campaignId: string | null,
    chainId: number,
    onchainId: number,
  ) =>
    client.query(
      `insert into public.donations
         (chain_event_id, campaign_id, chain_id, onchain_campaign_id, donor_wallet_lower, beneficiary_lower,
          token_address_lower, amount_raw, block_time, status)
       values ($1, $2, $3, $4, $5, $6, $7, 1000000, now(), 'PENDING')`,
      [eventId, campaignId, chainId, onchainId, hexAddr(0xd1), hexAddr(0xe1), hexAddr(0xc1)],
    );

  it("darowizna musi wskazywać istniejącą kampanię z tą samą siecią i identyfikatorem on-chain", async () => {
    const published = await createPublishedCampaign(client, { onchainCampaignId: 401 });
    await donation(await eventFor(421614), published.id, 421614, 401);
    await expectPgError(
      () => donation(null as unknown as string, published.id, 421614, 401),
      "23502",
    );
    await expectPgError(async () => donation(await eventFor(421614), null, 421614, 401), "23502"); // campaign_id wymagane
    await expectPgError(
      async () => donation(await eventFor(421614), published.id, 421614, 402),
      "23503",
    ); // inny onchain id
    await expectPgError(
      async () =>
        donation(await eventFor(421614), "00000000-0000-0000-0000-000000000000", 421614, 401),
      "23503",
    );
  });
});

describe("brak publicznego dostępu — RLS deny-by-default (docs/03 §3)", () => {
  const TABLES = [
    "organizations",
    "organization_private",
    "organization_members",
    "campaigns",
    "campaign_revisions",
    "campaign_reviews",
  ];

  it("wszystkie tabele mają włączone RLS", async () => {
    expect(await findTablesWithoutRls(client, ["public", "app", "private"])).toEqual([]);
  });

  it.each(["anon", "authenticated"])(
    "%s nie ma żadnych uprawnień do nowych tabel",
    async (role) => {
      for (const table of TABLES) {
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
          const result = await client.query<{ allowed: boolean }>(
            "select has_table_privilege($1, $2, $3) as allowed",
            [role, `public.${table}`, privilege],
          );
          expect(result.rows[0]?.allowed, `${role} ${privilege} ${table}`).toBe(false);
        }
      }
    },
  );

  it.each(["anon", "authenticated"])(
    "nawet po nadaniu uprawnień %s nie czyta ani nie zapisuje — blokuje RLS",
    async (role) => {
      const org = await createOrganization(client);
      await client.query("begin");
      try {
        await client.query(
          `grant select, insert, update, delete on ${TABLES.map((t) => `public.${t}`).join(", ")} to ${role}`,
        );
        await client.query(`set local role ${role}`);
        for (const table of TABLES) {
          const rows = await client.query(`select 1 from public.${table}`);
          expect(rows.rowCount, `${role} czyta ${table}`).toBe(0);
        }
        await expectPgError(
          () =>
            client.query(
              `insert into public.organizations (legal_name, display_name, country_code) values ('Hack', 'Hack', 'PL')`,
            ),
          "42501",
        );
        expect(org.id).not.toBe("");
      } finally {
        await client.query("rollback");
      }
    },
  );
});

describe("rollback migracji 0003", () => {
  it("down przywraca dokładnie stan po 0002; ponowne up działa", async () => {
    const migrations = loadMigrations(MIGRATIONS_DIR);
    const second = await createTempDatabase();
    const probe = new Client({ connectionString: second.url });
    await probe.connect();
    try {
      await ensureRole(probe, "anon");
      await ensureRole(probe, "authenticated");
      // Zakres tylko do 0003 (późniejsze migracje mają własne testy rollbacku).
      const upToThird = migrations.slice(0, 3);
      await migrateUp(probe, migrations.slice(0, 2));
      const afterSecond = await catalogSnapshot(probe);
      await migrateUp(probe, upToThird);
      const afterThird = await catalogSnapshot(probe);
      expect(afterThird).not.toEqual(afterSecond);
      await migrateDown(probe, upToThird, 1);
      expect(await catalogSnapshot(probe)).toEqual(afterSecond);
      await migrateUp(probe, upToThird);
      expect(await catalogSnapshot(probe)).toEqual(afterThird);
    } finally {
      await probe.end();
      await second.drop();
    }
  });
});
