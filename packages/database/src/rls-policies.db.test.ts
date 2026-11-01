/**
 * Testy negatywne i pozytywne RLS (COC-023; AC-25, AC-26, AC-30) na PRAWDZIWYM Postgresie.
 * Każdy test działa w transakcji jako `SET LOCAL ROLE <rola>` z `app.wallet` ustawionym jak w backendzie,
 * po czym transakcja jest cofana. Role: gość (app_api bez portfela), właściciel/menedżer/reporter organizacji A,
 * właściciel organizacji B (inny tenant), recenzent, administrator, indexer, auth, oraz anon/authenticated.
 */
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadMigrations } from "./migrations.js";
import { migrateDown, migrateUp } from "./runner.js";
import {
  catalogSnapshot,
  createTempDatabase,
  ensureRole,
  type TempDatabase,
} from "./testing/db.js";
import {
  createDraftCampaign,
  createOrganization,
  createPublishedCampaign,
  hexAddr,
  hexHash,
  nextId,
  type CampaignFixture,
  type OrganizationFixture,
} from "./testing/fixtures.js";

const MIGRATIONS_DIR = new URL("../migrations", import.meta.url).pathname;

let temp: TempDatabase;
let client: Client;

const W = {
  ownerA: hexAddr(0xa001),
  managerA: hexAddr(0xa002),
  reporterA: hexAddr(0xa003),
  ownerB: hexAddr(0xb001),
  reviewer: hexAddr(0x7e01),
  admin: hexAddr(0xad01),
  stranger: hexAddr(0x5a01),
};

interface World {
  orgA: OrganizationFixture;
  orgB: OrganizationFixture;
  draftA: CampaignFixture;
  submittedA: CampaignFixture;
  pubA: CampaignFixture & { onchainCampaignId: number };
  draftB: CampaignFixture;
  pubB: CampaignFixture & { onchainCampaignId: number };
  privateDocA: string;
  privateDocB: string;
  publicImage: string;
  reportA: string;
  reportB: string;
}
let w: World;

function pgCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    return typeof error.code === "string" ? error.code : undefined;
  }
  return undefined;
}

type Attempt =
  | { ok: true; rows: Record<string, unknown>[]; rowCount: number }
  | { ok: false; code: string | undefined; message: string };

/** Wykonuje zapytanie w savepoincie, więc błąd nie psuje transakcji roli. */
async function attempt(sql: string, params: unknown[] = []): Promise<Attempt> {
  await client.query("savepoint attempt_sp");
  try {
    const result = await client.query(sql, params);
    await client.query("release savepoint attempt_sp");
    return {
      ok: true,
      rows: result.rows as Record<string, unknown>[],
      rowCount: result.rowCount ?? 0,
    };
  } catch (error) {
    await client.query("rollback to savepoint attempt_sp");
    return {
      ok: false,
      code: pgCode(error),
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Wykonuje blok jako dana rola i portfel (jak backend: SET LOCAL ROLE + set_config), potem cofa transakcję. */
async function as<T>(role: string, wallet: string | null, run: () => Promise<T>): Promise<T> {
  await client.query("begin");
  try {
    await client.query(`set local role ${role}`);
    await client.query("select set_config('app.wallet', $1, true)", [wallet ?? ""]);
    return await run();
  } finally {
    await client.query("rollback");
  }
}

const count = async (table: string, where = "true", params: unknown[] = []): Promise<number> => {
  const result = await attempt(`select count(*)::int as c from ${table} where ${where}`, params);
  if (!result.ok) throw new Error(`count ${table}: ${result.message}`);
  return (result.rows[0] as { c: number }).c;
};

const expectDenied = (result: Attempt, codes: string[] = ["42501"]): void => {
  expect(result.ok, "zapytanie powinno zostać odrzucone").toBe(false);
  if (!result.ok) expect(codes, result.message).toContain(result.code);
};
const expectNoRows = (result: Attempt): void => {
  expect(result.ok, result.ok ? "" : result.message).toBe(true);
  if (result.ok) expect(result.rowCount).toBe(0);
};
const expectOk = (result: Attempt): void => {
  expect(result.ok, result.ok ? "" : result.message).toBe(true);
};

beforeAll(async () => {
  temp = await createTempDatabase();
  client = new Client({ connectionString: temp.url });
  await client.connect();
  await ensureRole(client, "anon");
  await ensureRole(client, "authenticated");
  await migrateUp(client, loadMigrations(MIGRATIONS_DIR));
  // Test wykonuje SET ROLE: potrzebuje członkostwa w rolach aplikacyjnych (w produkcji robi to rola logowania backendu).
  for (const role of ["app_api", "app_indexer", "app_auth", "anon", "authenticated"]) {
    // W CI rola `postgres` ma wszystko; lokalnie członkostwo mogło zostać nadane wcześniej (wtedy GRANT bywa zbędny).
    await client.query(`grant ${role} to current_user`).catch(() => undefined);
  }

  const orgA = await createOrganization(client);
  const orgB = await createOrganization(client);
  const member = (org: OrganizationFixture, wallet: string, role: string) =>
    client.query(
      "insert into public.organization_members (organization_id, wallet_lower, role) values ($1, $2, $3::app.member_role)",
      [org.id, wallet, role],
    );
  await member(orgA, W.ownerA, "OWNER");
  await member(orgA, W.managerA, "MANAGER");
  await member(orgA, W.reporterA, "REPORTER");
  await member(orgB, W.ownerB, "OWNER");
  await client.query(
    "insert into public.staff_members (wallet_lower, role) values ($1, 'REVIEWER'), ($2, 'ADMIN')",
    [W.reviewer, W.admin],
  );

  const draftA = await createDraftCampaign(client, orgA, { creator: W.ownerA });
  const submittedA = await createDraftCampaign(client, orgA, { creator: W.ownerA });
  await client.query("update public.campaigns set status = 'SUBMITTED' where id = $1", [
    submittedA.id,
  ]);
  const pubA = await createPublishedCampaign(client, { organization: orgA, onchainCampaignId: 1 });
  const draftB = await createDraftCampaign(client, orgB, { creator: W.ownerB });
  const pubB = await createPublishedCampaign(client, { organization: orgB, onchainCampaignId: 2 });

  // Rewizja i recenzja z powodem prywatnym (recenzent spoza organizacji).
  const revision = await client.query<{ id: string }>(
    `insert into public.campaign_revisions (campaign_id, version, content_json, content_sha256, created_by)
     values ($1, 1, '{}'::jsonb, $2, $3) returning id`,
    [draftA.id, hexHash(nextId()), W.ownerA],
  );
  await client.query(
    `insert into public.campaign_reviews (campaign_id, revision_id, reviewer_wallet_lower, decision, reason_public, reason_private)
     values ($1, $2, $3, 'CHANGES_REQUESTED', 'Uzupełnij opis', 'TAJNY powód wewnętrzny')`,
    [draftA.id, revision.rows[0]?.id, W.reviewer],
  );

  const asset = async (
    bucket: string,
    visibility: string,
    orgId: string | null,
    mime = "application/pdf",
  ) =>
    (
      await client.query<{ id: string }>(
        `insert into public.assets (bucket, object_path, mime, size_bytes, sha256, owner_org_id, visibility, scan_status)
         values ($1, $2, $3, 1000, $4, $5, $6::app.asset_visibility, 'CLEAN') returning id`,
        [bucket, `f/${String(nextId())}`, mime, hexHash(nextId()), orgId, visibility],
      )
    ).rows[0]?.id ?? "";
  const privateDocA = await asset("private-organization-docs", "PRIVATE", orgA.id);
  const privateDocB = await asset("private-organization-docs", "PRIVATE", orgB.id);
  const publicImage = await asset("public-campaign-assets", "PUBLIC", orgA.id, "image/png");

  const report = async (campaignId: string, creator: string) =>
    (
      await client.query<{ id: string }>(
        `insert into public.impact_reports (campaign_id, version, period_start, period_end, created_by)
         values ($1, 1, '2026-11-01', '2027-01-01', $2) returning id`,
        [campaignId, creator],
      )
    ).rows[0]?.id ?? "";
  const reportA = await report(pubA.id, W.reporterA);
  const reportB = await report(pubB.id, W.ownerB);

  // Dane z łańcucha: jedna potwierdzona i jedna oczekująca darowizna dla opublikowanej kampanii A.
  for (const state of ["CONFIRMED", "PENDING"] as const) {
    const event = await client.query<{ id: string }>(
      `insert into public.chain_events (chain_id, contract_lower, event_name, tx_hash, log_index, block_number, block_hash, tx_index, args,
         canonical, confirmation_state, confirmed_at)
       values (421614, $1, 'DonationReceived', $2, 0, 300, $3, 0, '{}'::jsonb, true, $4::app.confirmation_state, $5) returning id`,
      [
        hexAddr(0xa1),
        hexHash(nextId()),
        hexHash(nextId()),
        state === "CONFIRMED" ? "CONFIRMED" : "OBSERVED",
        state === "CONFIRMED" ? new Date().toISOString() : null,
      ],
    );
    await client.query(
      `insert into public.donations (chain_event_id, campaign_id, chain_id, onchain_campaign_id, donor_wallet_lower, beneficiary_lower,
         token_address_lower, amount_raw, block_time, status)
       values ($1, $2, 421614, 1, $3, $4, $5, 5000000, now(), $6::app.donation_status)`,
      [event.rows[0]?.id, pubA.id, W.ownerA, orgA.safe, hexAddr(0xc1), state],
    );
  }
  await client.query(
    "insert into public.donor_stats (chain_id, wallet_lower, total_donated_raw, xp, tier, derived_at, source_block_number) values (421614, $1, 5000000, 50, 1, now(), 300)",
    [W.ownerA],
  );
  await client.query(
    "insert into public.donor_profiles (chain_id, wallet_lower, display_name, profile_public, leaderboard_opt_in) values (421614, $1, 'Publiczny', true, true), (421614, $2, 'Ukryty', false, false)",
    [W.ownerA, W.stranger],
  );
  await client.query(
    "insert into public.audit_logs (actor_type, action, entity_type, entity_id) values ('SYSTEM', 'TEST.SEED', 'campaigns', 'x')",
  );
  await client.query(
    "insert into public.abuse_reports (category, details_private) values ('FRAUD', 'szczegóły zgłoszenia')",
  );

  w = {
    orgA,
    orgB,
    draftA,
    submittedA,
    pubA,
    draftB,
    pubB,
    privateDocA,
    privateDocB,
    publicImage,
    reportA,
    reportB,
  };
});

afterAll(async () => {
  await client.end();
  await temp.drop();
});

describe("gość (app_api bez portfela)", () => {
  it("nie widzi żadnych wierszy tabel bazowych (poza publicznymi zasobami i flagami)", async () => {
    await as("app_api", null, async () => {
      for (const table of [
        "organizations",
        "organization_private",
        "organization_members",
        "campaigns",
        "campaign_revisions",
        "campaign_reviews",
        "impact_reports",
        "impact_report_reviews",
        "abuse_reports",
        "audit_logs",
        "donor_profiles",
        "donor_stats",
        "staff_members",
      ]) {
        expect(await count(`public.${table}`), table).toBe(0);
      }
      expect(await count("public.assets")).toBe(1); // tylko publiczny, czysty obraz
      expect(await count("public.system_flags")).toBeGreaterThan(0);
    });
  });

  it("widoki publiczne zwracają tylko dane publiczne", async () => {
    await as("app_api", null, async () => {
      expect(await count("public.public_organizations")).toBe(2);
      const campaigns = await attempt("select slug, status from public.public_campaigns");
      expectOk(campaigns);
      if (campaigns.ok)
        expect(campaigns.rows.map((r) => r.status).sort()).toEqual(["PUBLISHED", "PUBLISHED"]);
      expect(await count("public.public_donations")).toBe(1); // CONFIRMED, bez PENDING
      expect(await count("public.public_reports")).toBe(0); // raporty DRAFT bez dowodu on-chain
      expect(await count("public.public_donor_profiles")).toBe(1); // tylko profile_public
      expect(await count("public.public_leaderboard")).toBe(1);
    });
  });

  it("widok informacji zwrotnej jest pusty dla gościa", async () => {
    await as("app_api", null, async () => {
      expect(await count("public.campaign_review_feedback")).toBe(0);
    });
  });

  it("nie zapisuje nic poza zgłoszeniem nadużycia (bez odczytu) i nie zmienia flag", async () => {
    await as("app_api", null, async () => {
      expectDenied(
        await attempt(
          `insert into public.organizations (legal_name, display_name, country_code) values ('X', 'X', 'PL')`,
        ),
      );
      expectDenied(
        await attempt(
          `insert into public.audit_logs (actor_type, action, entity_type, entity_id) values ('USER', 'A', 'b', '1')`,
        ),
      );
      expectOk(
        await attempt(
          `insert into public.abuse_reports (category, details_private) values ('OTHER', 'zgłoszenie gościa')`,
        ),
      );
      expectDenied(
        await attempt(
          `insert into public.abuse_reports (category, details_private, status, handled_by, handled_at) values ('OTHER', 'x', 'TRIAGED', $1, now())`,
          [W.admin],
        ),
      );
      expectDenied(
        await attempt(
          `insert into public.abuse_reports (category, details_private) values ('OTHER', 'x') returning id`,
        ),
      ); // brak prawa odczytu
      expectNoRows(await attempt("update public.system_flags set enabled = true"));
      expectDenied(await attempt("select 1 from public.sessions"));
      expectDenied(await attempt("select 1 from public.siwe_nonces"));
    });
  });

  it("niepoprawny kontekst portfela kończy się błędem (fail-closed), a nie dostępem", async () => {
    await as("app_api", "to-nie-jest-adres", async () => {
      const result = await attempt("select count(*) from public.organizations");
      expectDenied(result, ["23514", "22P02"]);
    });
  });
});

describe("właściciel organizacji A (izolacja tenantów)", () => {
  it("widzi tylko własną organizację, jej dane prywatne, członków i kampanie", async () => {
    await as("app_api", W.ownerA, async () => {
      const orgs = await attempt("select id from public.organizations");
      expectOk(orgs);
      if (orgs.ok) expect(orgs.rows.map((r) => r.id)).toEqual([w.orgA.id]);
      expect(await count("public.organization_members")).toBe(3);
      expect(await count("public.organization_members", "organization_id = $1", [w.orgB.id])).toBe(
        0,
      );
      expect(await count("public.campaigns", "organization_id = $1", [w.orgB.id])).toBe(0);
      expect(await count("public.campaigns", "organization_id = $1", [w.orgA.id])).toBe(3);
      expect(await count("public.audit_logs")).toBe(0);
      expect(await count("public.abuse_reports")).toBe(0);
    });
  });

  it("prywatnych dokumentów organizacji B nie widzi; własne i publiczne tak", async () => {
    await as("app_api", W.ownerA, async () => {
      expect(await count("public.assets", "id = $1", [w.privateDocA])).toBe(1);
      expect(await count("public.assets", "id = $1", [w.privateDocB])).toBe(0);
      expect(await count("public.assets", "id = $1", [w.publicImage])).toBe(1);
    });
  });

  it("edytuje nazwę wyświetlaną, ale nie status, Safe ani dane prawne; nie rusza organizacji B", async () => {
    await as("app_api", W.ownerA, async () => {
      expectOk(
        await attempt("update public.organizations set display_name = 'Nowa nazwa' where id = $1", [
          w.orgA.id,
        ]),
      );
      expectDenied(
        await attempt("update public.organizations set status = 'SUSPENDED' where id = $1", [
          w.orgA.id,
        ]),
      );
      expectDenied(
        await attempt("update public.organizations set safe_address_lower = $2 where id = $1", [
          w.orgA.id,
          hexAddr(0xbad),
        ]),
      );
      expectDenied(
        await attempt("update public.organizations set legal_name = 'Inna' where id = $1", [
          w.orgA.id,
        ]),
      );
      expectNoRows(
        await attempt("update public.organizations set display_name = 'Przejęta' where id = $1", [
          w.orgB.id,
        ]),
      );
    });
  });

  it("zgłasza własną organizację jako PENDING i zostaje jej OWNER-em; nie może jej zatwierdzić ani dopisać siebie do cudzej", async () => {
    await as("app_api", W.stranger, async () => {
      const created = await attempt(
        `insert into public.organizations (legal_name, display_name, country_code) values ('Nowa Fundacja', 'Nowa', 'PL') returning id`,
      );
      // INSERT ... RETURNING wymaga prawa odczytu wiersza: przed dodaniem członka jeszcze go nie ma.
      expectDenied(created);
    });
    await as("app_api", W.stranger, async () => {
      expectDenied(
        await attempt(
          `insert into public.organizations (legal_name, display_name, country_code, status) values ('X', 'X', 'PL', 'APPROVED')`,
        ),
      );
      // Zgłoszenie z jawnym id (backend generuje uuid) i dopisanie pierwszego OWNER-a w tej samej transakcji.
      const id = "11111111-1111-4111-8111-111111111111";
      expectOk(
        await attempt(
          `insert into public.organizations (id, legal_name, display_name, country_code) values ($1, 'Nowa', 'Nowa', 'PL')`,
          [id],
        ),
      );
      expectOk(
        await attempt(
          `insert into public.organization_members (organization_id, wallet_lower, role) values ($1, $2, 'OWNER')`,
          [id, W.stranger],
        ),
      );
      expect(await count("public.organizations", "id = $1", [id])).toBe(1);
      // Drugi OWNER dopisany przez samozgłoszenie jest odrzucony (organizacja ma już członka).
      expectDenied(
        await attempt(
          `insert into public.organization_members (organization_id, wallet_lower, role) values ($1, $2, 'OWNER')`,
          [id, W.ownerA],
        ),
      );
      // Obcy nie dopisze się do istniejącej organizacji.
      expectDenied(
        await attempt(
          `insert into public.organization_members (organization_id, wallet_lower, role) values ($1, $2, 'OWNER')`,
          [w.orgA.id, W.stranger],
        ),
      );
    });
  });

  it("właściciel zarządza członkami swojej organizacji, ale nie nadaje OWNER-a i nie rusza cudzych", async () => {
    await as("app_api", W.ownerA, async () => {
      expectOk(
        await attempt(
          "update public.organization_members set revoked_at = now() where wallet_lower = $1",
          [W.reporterA],
        ),
      );
      expectDenied(
        await attempt(
          "update public.organization_members set role = 'OWNER' where wallet_lower = $1",
          [W.managerA],
        ),
      );
      expectNoRows(
        await attempt(
          "update public.organization_members set revoked_at = now() where wallet_lower = $1",
          [W.ownerB],
        ),
      );
    });
  });

  it("tworzy szkic kampanii własnej organizacji; nie cudzej, nie jako inny autor, nie w innym statusie", async () => {
    const insert = (org: string, creator: string, status = "DRAFT") =>
      attempt(
        `insert into public.campaigns (organization_id, chain_id, slug, title, cap_raw, start_at, end_at, beneficiary_lower, created_by_wallet_lower, status)
         values ($1, 421614, $2, 'T', 1, now(), now() + interval '1 day', $3, $4, $5::app.campaign_status)`,
        [org, `rls-${String(nextId())}`, w.orgA.safe, creator, status],
      );
    await as("app_api", W.ownerA, async () => {
      expectOk(await insert(w.orgA.id, W.ownerA));
      expectDenied(await insert(w.orgB.id, W.ownerA));
      expectDenied(await insert(w.orgA.id, W.managerA));
      expectDenied(await insert(w.orgA.id, W.ownerA, "SUBMITTED"), ["42501", "23514"]); // wyzwalacz lub RLS
    });
  });

  it("przechodzi DRAFT -> SUBMITTED, ale nie zatwierdza, nie publikuje i nie ustawia zatwierdzającego", async () => {
    await as("app_api", W.ownerA, async () => {
      expectOk(
        await attempt("update public.campaigns set title = 'Zmieniony tytuł' where id = $1", [
          w.draftA.id,
        ]),
      );
      expectDenied(
        await attempt("update public.campaigns set status = 'APPROVED' where id = $1", [
          w.draftA.id,
        ]),
        ["42501", "23514"],
      );
      expectDenied(
        await attempt("update public.campaigns set status = 'PUBLISHED' where id = $1", [
          w.draftA.id,
        ]),
        ["42501", "23514"],
      );
      expectDenied(
        await attempt("update public.campaigns set approved_by_wallet_lower = $2 where id = $1", [
          w.draftA.id,
          W.reviewer,
        ]),
      );
      expectDenied(
        await attempt("update public.campaigns set metadata_hash = $2 where id = $1", [
          w.draftA.id,
          hexHash(7),
        ]),
      );
      expectOk(
        await attempt("update public.campaigns set status = 'SUBMITTED' where id = $1", [
          w.draftA.id,
        ]),
      );
      // po złożeniu treść jest zamrożona dla autora
      expectDenied(
        await attempt("update public.campaigns set title = 'Po złożeniu' where id = $1", [
          w.draftA.id,
        ]),
      );
    });
  });

  it("nie edytuje cudzych kampanii ani opublikowanej (warunki zamrożone)", async () => {
    await as("app_api", W.ownerA, async () => {
      expectNoRows(
        await attempt("update public.campaigns set title = 'Hak' where id = $1", [w.draftB.id]),
      );
      expectNoRows(
        await attempt("update public.campaigns set title = 'Hak' where id = $1", [w.pubB.id]),
      );
      expectDenied(
        await attempt("update public.campaigns set beneficiary_lower = $2 where id = $1", [
          w.pubA.id,
          hexAddr(0xbad),
        ]),
        ["42501", "23514"],
      );
      expectDenied(
        await attempt("update public.campaigns set cap_raw = 1 where id = $1", [w.pubA.id]),
        ["42501", "23514"],
      );
      expectDenied(
        await attempt("update public.campaigns set onchain_campaign_id = 99 where id = $1", [
          w.pubA.id,
        ]),
        ["42501", "23514"],
      );
      expectDenied(
        await attempt("update public.campaigns set status = 'CLOSED' where id = $1", [w.pubA.id]),
        ["42501", "23514"],
      );
    });
  });

  it("członek organizacji nie rozpoczyna przeglądu własnej kampanii (przejście dozwolone w DB, ale nie dla autora)", async () => {
    await as("app_api", W.ownerA, async () => {
      expectDenied(
        await attempt("update public.campaigns set status = 'UNDER_REVIEW' where id = $1", [
          w.submittedA.id,
        ]),
      ); // wyłącznie 42501
    });
  });

  it("dodaje rewizje tylko do własnej kampanii (w DRAFT/SUBMITTED) jako siebie", async () => {
    const insert = (campaignId: string, by: string, version: number) =>
      attempt(
        `insert into public.campaign_revisions (campaign_id, version, content_json, content_sha256, created_by) values ($1, $2, '{}'::jsonb, $3, $4)`,
        [campaignId, version, hexHash(nextId()), by],
      );
    await as("app_api", W.ownerA, async () => {
      expectOk(await insert(w.draftA.id, W.ownerA, 2));
      expectDenied(await insert(w.draftB.id, W.ownerA, 1));
      expectDenied(await insert(w.draftA.id, W.managerA, 3)); // podszycie pod innego autora
      expectDenied(await insert(w.pubA.id, W.ownerA, 1)); // kampania opublikowana
      expect(await count("public.campaign_revisions", "campaign_id = $1", [w.draftB.id])).toBe(0);
    });
  });

  it("nie czyta recenzji ani powodów prywatnych; widok zwrotny pokazuje tylko powód publiczny własnych kampanii", async () => {
    await as("app_api", W.ownerA, async () => {
      expect(await count("public.campaign_reviews")).toBe(0);
      expectDenied(
        await attempt(
          `insert into public.campaign_reviews (campaign_id, revision_id, reviewer_wallet_lower, decision, reason_public) values ($1, $1, $2, 'APPROVED', 'x')`,
          [w.draftA.id, W.ownerA],
        ),
        ["42501", "23514", "23503"], // RLS, 4-eyes albo FK: w każdym razie odmowa
      );
      const feedback = await attempt("select * from public.campaign_review_feedback");
      expectOk(feedback);
      if (feedback.ok) {
        expect(feedback.rows).toHaveLength(1);
        expect(Object.keys(feedback.rows[0] ?? {}).sort()).toEqual([
          "campaign_id",
          "created_at",
          "decision",
          "reason_public",
        ]);
        expect(JSON.stringify(feedback.rows)).not.toContain("TAJNY");
      }
    });
    await as("app_api", W.ownerB, async () => {
      expect(await count("public.campaign_review_feedback")).toBe(0); // inny tenant nie widzi cudzej recenzji
    });
  });

  it("dodaje zasoby wyłącznie prywatne, w stanie PENDING, dla własnej organizacji", async () => {
    const insert = (orgId: string, visibility: string, scan: string, bucket: string) =>
      attempt(
        `insert into public.assets (bucket, object_path, mime, size_bytes, sha256, owner_org_id, visibility, scan_status)
         values ($1, $2, 'application/pdf', 10, $3, $4, $5::app.asset_visibility, $6)`,
        [bucket, `u/${String(nextId())}`, hexHash(nextId()), orgId, visibility, scan],
      );
    await as("app_api", W.ownerA, async () => {
      expectOk(await insert(w.orgA.id, "PRIVATE", "PENDING", "private-organization-docs"));
      expectDenied(await insert(w.orgB.id, "PRIVATE", "PENDING", "private-organization-docs"));
      expectDenied(await insert(w.orgA.id, "PRIVATE", "CLEAN", "private-organization-docs"));
      expectDenied(await insert(w.orgA.id, "PUBLIC", "CLEAN", "public-campaign-assets"));
    });
  });

  it("dane prywatne organizacji: własne tak (bez pól KYB), cudze nie", async () => {
    await as("app_api", W.ownerA, async () => {
      expectOk(
        await attempt(
          "insert into public.organization_private (organization_id, contact_email) values ($1, 'a@b.pl')",
          [w.orgA.id],
        ),
      );
      expectDenied(
        await attempt(
          "insert into public.organization_private (organization_id, contact_email) values ($1, 'a@b.pl')",
          [w.orgB.id],
        ),
      );
      expectDenied(
        await attempt(
          "update public.organization_private set kyb_result = 'PASSED' where organization_id = $1",
          [w.orgA.id],
        ),
        ["42501"],
      );
      expect(await count("public.organization_private")).toBe(1);
    });
  });

  it("własny profil: odczyt i zapis tak; cudzy nie; własny audyt (USER) tak, ADMIN nie", async () => {
    await as("app_api", W.ownerA, async () => {
      expect(await count("public.donor_profiles")).toBe(1);
      expectOk(
        await attempt("update public.donor_profiles set bio = 'Cześć' where wallet_lower = $1", [
          W.ownerA,
        ]),
      );
      expectNoRows(
        await attempt("update public.donor_profiles set bio = 'Hak' where wallet_lower = $1", [
          W.stranger,
        ]),
      );
      expectDenied(
        await attempt(
          "insert into public.donor_profiles (chain_id, wallet_lower) values (421614, $1)",
          [W.managerA],
        ),
      );
      expect(await count("public.donor_stats")).toBe(1);
      expectOk(
        await attempt(
          `insert into public.audit_logs (actor_wallet_lower, actor_type, action, entity_type, entity_id) values ($1, 'USER', 'PROFILE.UPDATED', 'donor_profiles', '1')`,
          [W.ownerA],
        ),
      );
      expectDenied(
        await attempt(
          `insert into public.audit_logs (actor_wallet_lower, actor_type, action, entity_type, entity_id) values ($1, 'ADMIN', 'X', 'y', '1')`,
          [W.ownerA],
        ),
      );
      expectDenied(
        await attempt(
          `insert into public.audit_logs (actor_wallet_lower, actor_type, action, entity_type, entity_id) values ($1, 'USER', 'X', 'y', '1')`,
          [W.managerA],
        ),
      );
    });
  });
});

describe("menedżer i reporter organizacji A", () => {
  it("reporter nie tworzy kampanii ani nie edytuje organizacji; menedżer tworzy kampanie, ale nie edytuje organizacji", async () => {
    const insertCampaign = (creator: string) =>
      attempt(
        `insert into public.campaigns (organization_id, chain_id, slug, title, cap_raw, start_at, end_at, beneficiary_lower, created_by_wallet_lower)
         values ($1, 421614, $2, 'T', 1, now(), now() + interval '1 day', $3, $4)`,
        [w.orgA.id, `rls-${String(nextId())}`, w.orgA.safe, creator],
      );
    await as("app_api", W.reporterA, async () => {
      expectDenied(await insertCampaign(W.reporterA));
      expectNoRows(
        await attempt("update public.organizations set display_name = 'x' where id = $1", [
          w.orgA.id,
        ]),
      );
    });
    await as("app_api", W.managerA, async () => {
      expectOk(await insertCampaign(W.managerA));
      expectNoRows(
        await attempt("update public.organizations set display_name = 'x' where id = $1", [
          w.orgA.id,
        ]),
      );
      expect(await count("public.organization_private")).toBe(0); // dane prywatne tylko OWNER
    });
  });

  it("reporter tworzy raport do opublikowanej kampanii własnej organizacji, nie cudzej; nie ustawia pól łańcuchowych", async () => {
    const insertReport = (campaignId: string, by: string, version: number) =>
      attempt(
        `insert into public.impact_reports (campaign_id, version, period_start, period_end, created_by) values ($1, $2, '2026-11-01', '2027-01-01', $3)`,
        [campaignId, version, by],
      );
    await as("app_api", W.reporterA, async () => {
      expectOk(await insertReport(w.pubA.id, W.reporterA, 2));
      expectDenied(await insertReport(w.pubB.id, W.reporterA, 2));
      expectDenied(await insertReport(w.pubA.id, W.managerA, 3));
      expectOk(
        await attempt("update public.impact_reports set status = 'SUBMITTED' where id = $1", [
          w.reportA,
        ]),
      );
      expectDenied(
        await attempt("update public.impact_reports set status = 'PUBLISHED' where id = $1", [
          w.reportA,
        ]),
        ["42501", "23514"],
      );
      expectDenied(
        await attempt("update public.impact_reports set onchain_report_id = 5 where id = $1", [
          w.reportA,
        ]),
      );
      expectDenied(
        await attempt("update public.impact_reports set content_sha256 = $2 where id = $1", [
          w.reportA,
          hexHash(1),
        ]),
      );
      expectNoRows(
        await attempt("update public.impact_reports set status = 'SUBMITTED' where id = $1", [
          w.reportB,
        ]),
      );
      expect(await count("public.impact_reports", "id = $1", [w.reportB])).toBe(0);
    });
  });
});

describe("właściciel organizacji B — inny tenant", () => {
  it("nie widzi ani nie zmienia niczego z organizacji A", async () => {
    await as("app_api", W.ownerB, async () => {
      expect(await count("public.organizations", "id = $1", [w.orgA.id])).toBe(0);
      expect(await count("public.campaigns", "organization_id = $1", [w.orgA.id])).toBe(0);
      expect(await count("public.impact_reports", "id = $1", [w.reportA])).toBe(0);
      expect(await count("public.assets", "id = $1", [w.privateDocA])).toBe(0);
      expectNoRows(
        await attempt("update public.campaigns set title = 'Hak' where id = $1", [w.draftA.id]),
      );
      expectDenied(
        await attempt(
          "insert into public.organization_members (organization_id, wallet_lower, role) values ($1, $2, 'MANAGER')",
          [w.orgA.id, W.ownerB],
        ),
      );
    });
  });
});

describe("recenzent (staff REVIEWER)", () => {
  it("widzi wszystkie kampanie i recenzje z powodem prywatnym, ale nie audyt ani dane prywatne organizacji", async () => {
    await as("app_api", W.reviewer, async () => {
      expect(await count("public.campaigns")).toBeGreaterThanOrEqual(5);
      expect(await count("public.campaign_reviews")).toBe(1);
      expect(await count("public.audit_logs")).toBe(0);
      expect(await count("public.organization_private")).toBe(0);
      expect(await count("public.abuse_reports")).toBe(1);
      expect(await count("public.staff_members")).toBe(2);
    });
  });

  it("prowadzi przegląd SUBMITTED -> UNDER_REVIEW -> APPROVED jako siebie, ale nie publikuje ani nie podszywa się", async () => {
    await as("app_api", W.reviewer, async () => {
      expectOk(
        await attempt("update public.campaigns set status = 'UNDER_REVIEW' where id = $1", [
          w.submittedA.id,
        ]),
      );
      expectDenied(
        await attempt(
          "update public.campaigns set status = 'APPROVED', approved_by_wallet_lower = $2, metadata_hash = $3 where id = $1",
          [w.submittedA.id, W.admin, hexHash(9)],
        ),
      ); // zatwierdzającym musi być wywołujący
      expectOk(
        await attempt(
          "update public.campaigns set status = 'APPROVED', approved_by_wallet_lower = $2, metadata_hash = $3 where id = $1",
          [w.submittedA.id, W.reviewer, hexHash(9)],
        ),
      );
      expectDenied(
        await attempt("update public.campaigns set status = 'PUBLISHING' where id = $1", [
          w.submittedA.id,
        ]),
      );
      expectDenied(
        await attempt("update public.campaigns set title = 'Zmiana treści autora' where id = $1", [
          w.submittedA.id,
        ]),
      );
    });
  });

  it("wydaje decyzje jako siebie; nie zmienia statusu organizacji; obsługuje zgłoszenia nadużyć jako siebie", async () => {
    await as("app_api", W.reviewer, async () => {
      const revisionId = (await attempt(
        "select id from public.campaign_revisions limit 1",
      )) as Extract<Attempt, { ok: true }>;
      const rev = revisionId.rows[0]?.id;
      expectOk(
        await attempt(
          `insert into public.campaign_reviews (campaign_id, revision_id, reviewer_wallet_lower, decision, reason_public) values ($1, $2, $3, 'REJECTED', 'powód')`,
          [w.draftA.id, rev, W.reviewer],
        ),
      );
      expectDenied(
        await attempt(
          `insert into public.campaign_reviews (campaign_id, revision_id, reviewer_wallet_lower, decision, reason_public) values ($1, $2, $3, 'REJECTED', 'powód')`,
          [w.draftA.id, rev, W.admin],
        ),
      ); // podszycie pod innego recenzenta
      expectNoRows(
        await attempt("update public.organizations set status = 'SUSPENDED' where id = $1", [
          w.orgA.id,
        ]),
      ); // organizacja poza USING: 0 wierszy, nie błąd
      expectOk(
        await attempt(
          "update public.abuse_reports set status = 'TRIAGED', handled_by = $1, handled_at = now()",
          [W.reviewer],
        ),
      );
      expectDenied(
        await attempt(
          "update public.abuse_reports set status = 'TRIAGED', handled_by = $1, handled_at = now()",
          [W.admin],
        ),
      );
      expectDenied(await attempt("update public.abuse_reports set details_private = 'zmieniono'"));
    });
  });
});

describe("administrator (staff ADMIN)", () => {
  it("czyta audyt i dane prywatne; zatwierdza organizację (Safe i weryfikacja); nie edytuje warunków opublikowanej kampanii", async () => {
    await as("app_api", W.admin, async () => {
      expect(await count("public.audit_logs")).toBeGreaterThanOrEqual(1);
      const id = "22222222-2222-4222-8222-222222222222";
      expectOk(
        await attempt(
          `insert into public.organizations (id, legal_name, display_name, country_code, safe_address_lower, safe_chain_id)
           values ($1, 'Oczekująca', 'Oczekująca', 'PL', $2, 421614)`,
          [id, hexAddr(0xfeed99)],
        ),
      );
      expectOk(
        await attempt(
          "update public.organizations set status = 'APPROVED', verified_at = now() where id = $1",
          [id],
        ),
      );
      expect(await count("public.public_organizations", "id = $1", [id])).toBe(1);
      expectOk(
        await attempt("update public.organizations set status = 'SUSPENDED' where id = $1", [
          w.orgA.id,
        ]),
      );
      expectOk(
        await attempt("update public.organizations set status = 'APPROVED' where id = $1", [
          w.orgA.id,
        ]),
      );
      expectDenied(
        await attempt("update public.campaigns set beneficiary_lower = $2 where id = $1", [
          w.pubA.id,
          hexAddr(0xbad),
        ]),
        ["42501", "23514"],
      );
      expectDenied(
        await attempt("update public.campaigns set status = 'PAUSED' where id = $1", [w.pubA.id]),
        ["42501"],
      ); // PAUSED pochodzi z łańcucha
    });
  });

  it("przełącza flagę awaryjną jako siebie; nie podszywa się; zapis audytu jako ADMIN tylko własny", async () => {
    await as("app_api", W.admin, async () => {
      expectOk(
        await attempt(
          "update public.system_flags set enabled = true, updated_by = $1 where key = 'checkout_disabled'",
          [W.admin],
        ),
      );
      expectDenied(
        await attempt(
          "update public.system_flags set enabled = true, updated_by = $1 where key = 'checkout_disabled'",
          [W.reviewer],
        ),
      );
      expectOk(
        await attempt(
          `insert into public.audit_logs (actor_wallet_lower, actor_type, action, entity_type, entity_id) values ($1, 'ADMIN', 'FLAG.SET', 'system_flags', 'checkout_disabled')`,
          [W.admin],
        ),
      );
    });
    await as("app_api", W.reviewer, async () => {
      expectNoRows(
        await attempt(
          "update public.system_flags set enabled = true, updated_by = $1 where key = 'checkout_disabled'",
          [W.reviewer],
        ),
      );
    });
  });
});

describe("rola indexera (app_indexer)", () => {
  it("zapisuje zdarzenia i projekcje; ustawia pola łańcuchowe kampanii; nie dotyka danych redakcyjnych", async () => {
    await as("app_indexer", null, async () => {
      expectOk(
        await attempt(
          `insert into public.chain_events (chain_id, contract_lower, event_name, tx_hash, log_index, block_number, block_hash, tx_index, args)
           values (421614, $1, 'CampaignPaused', $2, 0, 400, $3, 0, '{}'::jsonb)`,
          [hexAddr(0xa1), hexHash(nextId()), hexHash(nextId())],
        ),
      );
      expectOk(
        await attempt("update public.campaigns set status = 'PAUSED' where id = $1", [w.pubA.id]),
      );
      expectDenied(
        await attempt("update public.campaigns set title = 'Hak' where id = $1", [w.pubA.id]),
      ); // brak uprawnienia do kolumny
      expectDenied(await attempt("select 1 from public.organizations"));
      expectDenied(await attempt("select 1 from public.organization_private"));
      expectDenied(await attempt("select 1 from public.sessions"));
      expectDenied(
        await attempt(
          `insert into public.audit_logs (actor_type, action, entity_type, entity_id) values ('SYSTEM', 'A', 'b', '1')`,
        ),
      );
      expectOk(
        await attempt(
          `insert into public.audit_logs (actor_type, action, entity_type, entity_id) values ('INDEXER', 'INDEXER.REORG', 'chain_events', '1')`,
        ),
      );
    });
  });
});

describe("rola uwierzytelniania (app_auth)", () => {
  it("obsługuje tylko nonce i sesje: zużywa nonce atomowo, nie czyta danych domenowych", async () => {
    await as("app_auth", null, async () => {
      const nonce = "ab".repeat(32);
      expectOk(
        await attempt(
          `insert into public.siwe_nonces (nonce_hash, domain, chain_id, expires_at) values ($1, 'd.example', 421614, now() + interval '5 minutes')`,
          [nonce],
        ),
      );
      const consumed = await attempt(
        "select app.consume_siwe_nonce($1, 'd.example', 421614, $2) as ok",
        [nonce, W.ownerA],
      );
      expectOk(consumed);
      if (consumed.ok) expect((consumed.rows[0] as { ok: boolean }).ok).toBe(true);
      expectOk(
        await attempt(
          "insert into public.sessions (token_hash, wallet_lower, expires_at) values ($1, $2, now() + interval '1 day')",
          ["cd".repeat(32), W.ownerA],
        ),
      );
      expectDenied(await attempt("select 1 from public.organizations"));
      expectDenied(await attempt("select 1 from public.campaigns"));
      expectDenied(await attempt("select 1 from public.audit_logs"));
    });
  });
});

describe("anon i authenticated (role Supabase)", () => {
  it.each(["anon", "authenticated"])(
    "%s czyta widoki publiczne, ale nie tabel bazowych",
    async (role) => {
      await as(role, null, async () => {
        expect(await count("public.public_campaigns")).toBe(2);
        expect(await count("public.public_organizations")).toBe(2);
        for (const table of [
          "organizations",
          "campaigns",
          "organization_private",
          "audit_logs",
          "assets",
          "sessions",
          "staff_members",
        ]) {
          expectDenied(await attempt(`select 1 from public.${table}`));
        }
        expectDenied(await attempt("select 1 from public.campaign_review_feedback"));
      });
    },
  );
});

describe("widoki publiczne — whitelist kolumn (brak danych prywatnych)", () => {
  it("żaden widok nie zawiera kolumn prywatnych ani identyfikujących autora/zatwierdzającego", async () => {
    const result = await client.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and (table_name like 'public\\_%' or table_name = 'campaign_review_feedback')`,
    );
    const forbidden =
      /(reason_private|details_private|contact_|people_json|kyb_|retention|created_by|approved_by|handled_by|reporter_wallet|registry_number|legal_name|token_hash|nonce)/;
    const offenders = result.rows
      .filter((r) => forbidden.test(r.column_name))
      .map((r) => `${r.table_name}.${r.column_name}`);
    expect(offenders).toEqual([]);
    expect(result.rows.length).toBeGreaterThan(30);
  });
});

describe("rollback migracji 0005", () => {
  it("down przywraca dokładnie stan po 0004 (z wyjątkiem ról klastra); ponowne up działa", async () => {
    const migrations = loadMigrations(MIGRATIONS_DIR);
    const second = await createTempDatabase();
    const probe = new Client({ connectionString: second.url });
    await probe.connect();
    try {
      await ensureRole(probe, "anon");
      await ensureRole(probe, "authenticated");
      const upToFifth = migrations.slice(0, 5);
      await migrateUp(probe, migrations.slice(0, 4));
      const afterFourth = await catalogSnapshot(probe);
      await migrateUp(probe, upToFifth);
      const afterFifth = await catalogSnapshot(probe);
      expect(afterFifth).not.toEqual(afterFourth);
      await migrateDown(probe, upToFifth, 1);
      expect(await catalogSnapshot(probe)).toEqual(afterFourth);
      await migrateUp(probe, upToFifth);
      expect(await catalogSnapshot(probe)).toEqual(afterFifth);
    } finally {
      await probe.end();
      await second.drop();
    }
  });
});
