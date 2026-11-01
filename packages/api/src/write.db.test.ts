/**
 * Testy API zapisu (COC-033) na PRAWDZIWYM Postgresie: przepływ organizacja → szkic → zgłoszenie → przegląd (4-eyes)
 * → przygotowanie publikacji dla Safe. Autoryzacja jest egzekwowana przez bazę (RLS + wyzwalacze) — testy sprawdzają,
 * że API poprawnie je wykorzystuje, tłumaczy odmowy i zapisuje audyt atomowo.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import { loadMigrations, migrateUp } from "@charonchain/database";
import { hexAddr } from "@charonchain/database/testing/fixtures";
import { contentSha256 } from "@charonchain/shared";
import { Client } from "pg";
import { decodeFunctionData, toEventSelector, toFunctionSelector, type Hex } from "viem";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  REGISTRY_WRITE_ABI,
  beginCampaignReview,
  cancelCampaignPublication,
  decideCampaignReview,
  listReviewQueue,
  prepareCampaignPublication,
} from "./admin.js";
import { organizationHash } from "./hashes.js";
import { respond, type ApiContext, type ApiResponse } from "./http.js";
import { withActor } from "./identity.js";
import {
  applyForOrganization,
  createCampaignDraft,
  submitCampaignDraft,
  updateCampaignDraft,
} from "./org-campaigns.js";

const MIGRATIONS_DIR = new URL("../../database/migrations", import.meta.url).pathname;
const CHAIN = 421614;
const REGISTRY = "0x00000000000000000000000000000000000000a1";
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

const W = {
  owner: hexAddr(0xa001),
  manager: hexAddr(0xa002),
  reporter: hexAddr(0xa003),
  stranger: hexAddr(0x5a01),
  reviewer: hexAddr(0x7e01),
  reviewer2: hexAddr(0x7e02),
  admin: hexAddr(0xad01),
};
const SAFE = hexAddr(0x5afe01);

let templateName: string;
let dbName: string;
let client: Client;
let ctx: ApiContext;

/** Zapytania pomocnicze testu: wiersze jako `unknown` (bez `any` z biblioteki pg). */
const q = (sql: string, params: unknown[] = []) =>
  client.query<Record<string, unknown>>(sql, params);

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
  templateName = `cc_wr_tpl_${randomBytes(5).toString("hex")}`;
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
  dbName = `cc_wr_${randomBytes(5).toString("hex")}`;
  await admin(`create database ${dbName} template ${templateName}`);
  client = new Client({ connectionString: withDb(dbName) });
  await client.connect();
  ctx = { db: client, chainId: CHAIN, requestId: "req_write" };
  await q(
    "insert into public.staff_members (wallet_lower, role) values ($1, 'REVIEWER'), ($2, 'REVIEWER'), ($3, 'ADMIN')",
    [W.reviewer, W.reviewer2, W.admin],
  );
});
afterEach(async () => {
  await client.end();
  await admin(`drop database if exists ${dbName} with (force)`);
});

type Data = Record<string, unknown>;
const data = (r: ApiResponse): Data => (r.body as { data: Data }).data;
const errorOf = (r: ApiResponse): { code: string; message: string } =>
  (r.body as { error: { code: string; message: string } }).error;
const call = (run: () => Promise<ApiResponse>): Promise<ApiResponse> => respond(ctx, run);

const ORG_INPUT = {
  legalName: "Fundacja Pomocna Dłoń",
  displayName: "Pomocna Dłoń",
  countryCode: "PL",
  safeAddress: SAFE.toUpperCase().replace("0X", "0x"),
  contactPerson: "Anna Nowak",
  contactEmail: "anna@example.org",
};

const CAMPAIGN_INPUT = {
  title: "Ciepłe posiłki zimą",
  summary: "Zbiórka na ciepłe posiłki.",
  descriptionMd: "## Cel\nPosiłki dla 40 osób.",
  category: "food",
  slug: "cieple-posilki",
  capRaw: "5000000000",
  startAt: "2026-12-01T00:00:00Z",
  endAt: "2027-03-01T00:00:00.789Z",
};

/** Organizacja zgłoszona przez API, potem zatwierdzona przez admina (proces KYB poza zakresem API). */
async function approvedOrg(safe: string = ORG_INPUT.safeAddress): Promise<string> {
  const res = await call(() =>
    applyForOrganization(ctx, W.owner, { ...ORG_INPUT, safeAddress: safe }),
  );
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  const id = data(res).id as string;
  await q(
    "update public.organizations set status = 'APPROVED', verified_at = now() where id = $1",
    [id],
  );
  await q(
    "insert into public.organization_members (organization_id, wallet_lower, role) values ($1, $2, 'MANAGER'), ($1, $3, 'REPORTER')",
    [id, W.manager, W.reporter],
  );
  return id;
}

async function draftIn(orgId: string, over: Record<string, unknown> = {}): Promise<string> {
  const res = await call(() =>
    createCampaignDraft(ctx, W.manager, orgId, { ...CAMPAIGN_INPUT, ...over }),
  );
  expect(res.status).toBe(201);
  return data(res).id as string;
}

async function underReview(): Promise<{ orgId: string; id: string }> {
  const orgId = await approvedOrg();
  const id = await draftIn(orgId);
  expect((await call(() => submitCampaignDraft(ctx, W.manager, id))).status).toBe(200);
  expect((await call(() => beginCampaignReview(ctx, W.reviewer, id))).status).toBe(200);
  return { orgId, id };
}

const statusOf = async (id: string): Promise<string> =>
  (
    await client.query<{ s: string }>(
      "select status::text as s from public.campaigns where id = $1",
      [id],
    )
  ).rows[0]?.s ?? "";
const auditCount = async (): Promise<number> =>
  Number(
    (await client.query<{ c: string }>("select count(*)::text as c from public.audit_logs")).rows[0]
      ?.c,
  );

describe("withActor (tożsamość w transakcji)", () => {
  it("ustawia rolę i portfel tylko na czas transakcji; nic nie przecieka na połączenie", async () => {
    const inside = await withActor(ctx, W.owner, async (tx) => {
      const r = await tx.query<{ u: string; w: string }>(
        "select current_user as u, current_setting('app.wallet') as w",
      );
      return r.rows[0];
    });
    expect(inside).toEqual({ u: "app_api", w: W.owner });
    const after = await client.query<{ u: string; w: string | null }>(
      "select current_user as u, nullif(current_setting('app.wallet', true), '') as w",
    );
    expect(after.rows[0]?.u).not.toBe("app_api");
    expect(after.rows[0]?.w).toBeNull();
  });

  it("odrzuca niepoprawny portfel (401) bez dotykania bazy; błąd wycofuje transakcję", async () => {
    const res = await call(() => applyForOrganization(ctx, "0xNIE-PORTFEL", ORG_INPUT));
    expect(res.status).toBe(401);
    await expect(
      withActor(ctx, W.owner, async (tx) => {
        await tx.query(
          "insert into public.audit_logs (actor_wallet_lower, actor_type, action, entity_type, entity_id) values ($1, 'USER', 'X.Y', 'campaign', '1')",
          [W.owner],
        );
        throw new Error("awaria po zapisie");
      }),
    ).rejects.toThrow("awaria po zapisie");
    expect(await auditCount()).toBe(0);
  });
});

describe("wniosek organizacji", () => {
  it("tworzy organizację PENDING, właściciela, dane prywatne i audyt — wszystko albo nic", async () => {
    const res = await call(() => applyForOrganization(ctx, W.owner, ORG_INPUT));
    expect(res.status).toBe(201);
    const id = data(res).id as string;
    const org = (
      await q(
        "select status::text as status, safe_address_lower, safe_chain_id, verified_at from public.organizations where id = $1",
        [id],
      )
    ).rows[0];
    expect(org).toEqual({
      status: "PENDING",
      safe_address_lower: SAFE,
      safe_chain_id: CHAIN,
      verified_at: null,
    });
    expect(
      (
        await q(
          "select role::text as role from public.organization_members where organization_id = $1 and wallet_lower = $2",
          [id, W.owner],
        )
      ).rows,
    ).toEqual([{ role: "OWNER" }]);
    expect(
      (
        await q(
          "select contact_email from public.organization_private where organization_id = $1",
          [id],
        )
      ).rows,
    ).toEqual([{ contact_email: "anna@example.org" }]);
    const audit = (
      await q("select actor_type::text as t, action, entity_id from public.audit_logs")
    ).rows;
    expect(audit).toEqual([{ t: "USER", action: "ORGANIZATION.APPLY", entity_id: id }]);
  });

  it("drugi wniosek z tym samym Safe → 409 i brak śladów po nieudanej próbie", async () => {
    await call(() => applyForOrganization(ctx, W.owner, ORG_INPUT));
    const before = await auditCount();
    const dup = await call(() =>
      applyForOrganization(ctx, W.stranger, { ...ORG_INPUT, legalName: "Inna" }),
    );
    expect(dup.status).toBe(409);
    expect(errorOf(dup).code).toBe("ALREADY_EXISTS");
    expect(await auditCount()).toBe(before);
    expect(
      Number((await q("select count(*)::int as c from public.organizations")).rows[0]?.c),
    ).toBe(1);
  });

  it("walidacja wejścia (400) i ignorowanie prób ustawienia statusu / weryfikacji", async () => {
    for (const bad of [
      { ...ORG_INPUT, countryCode: "pl" },
      { ...ORG_INPUT, safeAddress: "0x123" },
      { ...ORG_INPUT, contactEmail: "bez-malpy" },
      { ...ORG_INPUT, legalName: "" },
    ]) {
      expect((await call(() => applyForOrganization(ctx, W.owner, bad))).status).toBe(400);
    }
    const res = await call(() =>
      applyForOrganization(ctx, W.owner, {
        ...ORG_INPUT,
        status: "APPROVED",
        verifiedAt: "2026-01-01T00:00:00Z",
      }),
    );
    const org = (
      await q(
        "select status::text as status, verified_at from public.organizations where id = $1",
        [data(res).id],
      )
    ).rows[0];
    expect(org).toEqual({ status: "PENDING", verified_at: null });
  });
});

describe("szkice kampanii", () => {
  it("beneficjent to zweryfikowany Safe organizacji, czas zapisany co do sekundy, autor = sesja", async () => {
    const orgId = await approvedOrg();
    const res = await call(() =>
      createCampaignDraft(ctx, W.manager, orgId, {
        ...CAMPAIGN_INPUT,
        beneficiary: hexAddr(0xbad),
        chainId: 42161,
        createdBy: W.stranger,
      }),
    );
    expect(res.status).toBe(201);
    expect(data(res)).toMatchObject({
      beneficiary: SAFE,
      chainId: CHAIN,
      status: "DRAFT",
      capRaw: "5000000000",
      endAt: "2027-03-01T00:00:00.000Z",
    });
    const row = (await q("select created_by_wallet_lower from public.campaigns")).rows[0];
    expect(row).toEqual({ created_by_wallet_lower: W.manager });
  });

  it("organizacja niezatwierdzona, obcy użytkownik, reporter i walidacja kwot/czasu", async () => {
    const pending = data(
      await call(() =>
        applyForOrganization(ctx, W.owner, { ...ORG_INPUT, safeAddress: hexAddr(0x5afe02) }),
      ),
    ).id as string;
    const notApproved = await call(() =>
      createCampaignDraft(ctx, W.owner, pending, CAMPAIGN_INPUT),
    );
    expect(notApproved.status).toBe(409);
    expect(errorOf(notApproved).code).toBe("ORG_NOT_APPROVED");

    const orgId = await approvedOrg();
    expect(
      (await call(() => createCampaignDraft(ctx, W.stranger, orgId, CAMPAIGN_INPUT))).status,
    ).toBe(404); // cudza organizacja jest niewidoczna
    const reporter = await call(() => createCampaignDraft(ctx, W.reporter, orgId, CAMPAIGN_INPUT));
    expect(reporter.status).toBe(403);
    expect(errorOf(reporter).code).toBe("FORBIDDEN");

    for (const bad of [
      { capRaw: "999999" }, // poniżej 1 USDC
      { capRaw: String(2n ** 128n) }, // powyżej uint128
      { capRaw: "12.5" },
      { endAt: "2026-12-01T00:00:00Z" }, // koniec = początek
      { startAt: "2026-12-01" }, // bez czasu/strefy
      { slug: "Zły Slug" },
    ]) {
      expect(
        (
          await call(() =>
            createCampaignDraft(ctx, W.manager, orgId, { ...CAMPAIGN_INPUT, ...bad }),
          )
        ).status,
      ).toBe(400);
    }
    await draftIn(orgId);
    const dup = await call(() => createCampaignDraft(ctx, W.owner, orgId, CAMPAIGN_INPUT));
    expect(dup.status).toBe(409);
    expect(errorOf(dup).code).toBe("ALREADY_EXISTS");
  });

  it("edycja tylko w DRAFT, tylko dozwolone pola; obcy nie widzi kampanii; po zgłoszeniu zablokowana", async () => {
    const orgId = await approvedOrg();
    const id = await draftIn(orgId);
    const ok = await call(() =>
      updateCampaignDraft(ctx, W.owner, id, { title: "Nowy tytuł", capRaw: "6000000000" }),
    );
    expect(ok.status).toBe(200);
    expect(data(ok)).toMatchObject({ title: "Nowy tytuł", capRaw: "6000000000" });
    for (const bad of [
      { beneficiary: hexAddr(0xbad) },
      { status: "APPROVED" },
      { organizationId: orgId },
      {},
      { endAt: "2020-01-01T00:00:00Z" },
    ]) {
      expect((await call(() => updateCampaignDraft(ctx, W.owner, id, bad))).status).toBe(400);
    }
    expect(
      (await call(() => updateCampaignDraft(ctx, W.stranger, id, { title: "x" }))).status,
    ).toBe(404);
    const asReporter = await call(() => updateCampaignDraft(ctx, W.reporter, id, { title: "x" }));
    expect(asReporter.status).toBe(403); // widzi szkic, ale polityka RLS nie pozwala go zmieniać
    expect((await q("select title from public.campaigns where id = $1", [id])).rows[0]).toEqual({
      title: "Nowy tytuł",
    });

    await call(() => submitCampaignDraft(ctx, W.owner, id));
    const late = await call(() =>
      updateCampaignDraft(ctx, W.owner, id, { title: "po zgłoszeniu" }),
    );
    expect(late.status).toBe(409);
    expect((await q("select title from public.campaigns where id = $1", [id])).rows[0]).toEqual({
      title: "Nowy tytuł",
    });
  });

  it("zgłoszenie tworzy niezmienną rewizję z hashem RFC 8785; ponowne zgłoszenie → 409", async () => {
    const orgId = await approvedOrg();
    const id = await draftIn(orgId);
    const res = await call(() => submitCampaignDraft(ctx, W.manager, id));
    expect(res.status).toBe(200);
    expect(data(res)).toMatchObject({ status: "SUBMITTED", version: 1 });
    const rev = (
      await client.query<{ content_json: Record<string, unknown>; content_sha256: string }>(
        "select content_json, content_sha256 from public.campaign_revisions",
      )
    ).rows[0];
    expect(rev?.content_sha256).toBe(data(res).contentSha256);
    expect(contentSha256(rev?.content_json)).toBe(rev?.content_sha256); // hash odtwarzalny z zapisanej treści
    expect(rev?.content_json).toMatchObject({
      beneficiary: SAFE,
      capRaw: "5000000000",
      chainId: CHAIN,
    });
    expect((await call(() => submitCampaignDraft(ctx, W.manager, id))).status).toBe(409);
    expect((await call(() => submitCampaignDraft(ctx, W.stranger, id))).status).toBe(404);
    expect(await statusOf(id)).toBe("SUBMITTED");
  });
});

describe("przegląd (4-eyes)", () => {
  it("kolejka i start przeglądu tylko dla personelu", async () => {
    const orgId = await approvedOrg();
    const id = await draftIn(orgId);
    await call(() => submitCampaignDraft(ctx, W.manager, id));
    expect((await call(() => listReviewQueue(ctx, W.manager))).status).toBe(403);
    expect((await call(() => beginCampaignReview(ctx, W.manager, id))).status).toBe(403);
    const queue = await call(() => listReviewQueue(ctx, W.reviewer));
    expect((data(queue) as unknown as Data[]).map((r) => r.id)).toEqual([id]);
    expect((await call(() => beginCampaignReview(ctx, W.reviewer, id))).status).toBe(200);
    expect((await call(() => beginCampaignReview(ctx, W.reviewer, id))).status).toBe(409);
  });

  it("zatwierdzenie ustawia recenzenta i metadata_hash = hash ocenionej rewizji", async () => {
    const { id } = await underReview();
    const res = await call(() =>
      decideCampaignReview(ctx, W.reviewer, id, { decision: "APPROVED" }),
    );
    expect(res.status).toBe(200);
    const row = (
      await q(
        "select status::text as status, approved_by_wallet_lower, metadata_hash from public.campaigns where id = $1",
        [id],
      )
    ).rows[0];
    const rev = (
      await q("select content_sha256 from public.campaign_revisions where campaign_id = $1", [id])
    ).rows[0];
    expect(row).toEqual({
      status: "APPROVED",
      approved_by_wallet_lower: W.reviewer,
      metadata_hash: rev?.content_sha256,
    });
    expect(
      (await q("select decision::text as d, reviewer_wallet_lower from public.campaign_reviews"))
        .rows,
    ).toEqual([{ d: "APPROVED", reviewer_wallet_lower: W.reviewer }]);
  });

  it("autor i członek organizacji nie zatwierdzą (FOUR_EYES_VIOLATION), a próba nie zostawia śladu poza audytem braku", async () => {
    const { id, orgId } = await underReview();
    // Recenzent, który jest też członkiem organizacji kampanii.
    await q(
      "insert into public.organization_members (organization_id, wallet_lower, role) values ($1, $2, 'REPORTER')",
      [orgId, W.reviewer2],
    );
    const before = await auditCount();
    const res = await call(() =>
      decideCampaignReview(ctx, W.reviewer2, id, { decision: "APPROVED" }),
    );
    expect(res.status).toBe(403);
    expect(errorOf(res).code).toBe("FOUR_EYES_VIOLATION");
    expect(await statusOf(id)).toBe("UNDER_REVIEW");
    expect(
      Number((await q("select count(*)::int as c from public.campaign_reviews")).rows[0]?.c),
    ).toBe(0);
    expect(await auditCount()).toBe(before);
    // Zwykły członek organizacji nie jest personelem w ogóle.
    expect(
      (await call(() => decideCampaignReview(ctx, W.manager, id, { decision: "APPROVED" }))).status,
    ).toBe(403);
  });

  it("odrzucenie i prośba o zmiany wymagają publicznego powodu; zmiany wracają do DRAFT i dają rewizję v2", async () => {
    const { id } = await underReview();
    expect(
      (await call(() => decideCampaignReview(ctx, W.reviewer, id, { decision: "REJECTED" })))
        .status,
    ).toBe(400);
    expect(
      (
        await call(() =>
          decideCampaignReview(ctx, W.reviewer, id, {
            decision: "CHANGES_REQUESTED",
            reasonPublic: "   ",
          }),
        )
      ).status,
    ).toBe(400);
    const changes = await call(() =>
      decideCampaignReview(ctx, W.reviewer, id, {
        decision: "CHANGES_REQUESTED",
        reasonPublic: "Doprecyzuj cel.",
        reasonPrivate: "notatka wewnętrzna",
      }),
    );
    expect(data(changes)).toMatchObject({ status: "DRAFT" });
    await call(() => updateCampaignDraft(ctx, W.manager, id, { summary: "Doprecyzowany cel." }));
    const resubmitted = await call(() => submitCampaignDraft(ctx, W.manager, id));
    expect(data(resubmitted)).toMatchObject({ version: 2 });
    await call(() => beginCampaignReview(ctx, W.reviewer, id));
    expect(
      data(
        await call(() =>
          decideCampaignReview(ctx, W.reviewer, id, {
            decision: "REJECTED",
            reasonPublic: "Brak dokumentów.",
          }),
        ),
      ).status,
    ).toBe("REJECTED");
    expect(
      (await call(() => decideCampaignReview(ctx, W.reviewer, id, { decision: "APPROVED" })))
        .status,
    ).toBe(409); // REJECTED jest końcowe
    // Powód prywatny nie jest widoczny dla autora (widok feedbacku daje tylko publiczny).
    const feedback = await withActor(
      ctx,
      W.manager,
      async (tx) =>
        (
          await tx.query<Record<string, unknown>>(
            "select decision::text as d, reason_public from public.campaign_review_feedback order by created_at",
          )
        ).rows,
    );
    expect(feedback).toEqual([
      { d: "CHANGES_REQUESTED", reason_public: "Doprecyzuj cel." },
      { d: "REJECTED", reason_public: "Brak dokumentów." },
    ]);
  });
});

describe("przygotowanie publikacji dla Safe", () => {
  async function approved(): Promise<{ id: string; orgId: string }> {
    const ctxInfo = await underReview();
    await call(() => decideCampaignReview(ctx, W.reviewer, ctxInfo.id, { decision: "APPROVED" }));
    return ctxInfo;
  }

  it("tylko ADMIN; wynik to calldata zgodny z kampanią; status PUBLISHING (nie PUBLISHED)", async () => {
    const { id, orgId } = await approved();
    expect(
      (await call(() => prepareCampaignPublication(ctx, W.reviewer, id, REGISTRY))).status,
    ).toBe(403);
    expect(
      (await call(() => prepareCampaignPublication(ctx, W.manager, id, REGISTRY))).status,
    ).toBe(403);
    expect(await statusOf(id)).toBe("APPROVED");

    const res = await call(() => prepareCampaignPublication(ctx, W.admin, id, REGISTRY));
    expect(res.status).toBe(200);
    const intent = data(res) as {
      to: string;
      chainId: number;
      value: string;
      data: Hex;
      arguments: Record<string, string>;
    };
    expect(intent).toMatchObject({ chainId: CHAIN, value: "0" });
    expect(intent.to.toLowerCase()).toBe(REGISTRY);
    const decoded = decodeFunctionData({ abi: REGISTRY_WRITE_ABI, data: intent.data });
    const meta = (
      await client.query<{ metadata_hash: string }>(
        "select metadata_hash from public.campaigns where id = $1",
        [id],
      )
    ).rows[0]?.metadata_hash;
    expect(decoded.functionName).toBe("createCampaign");
    expect((decoded.args[0] as string).toLowerCase()).toBe(SAFE);
    expect(decoded.args.slice(1)).toEqual([
      5000000000n,
      BigInt(Date.parse(CAMPAIGN_INPUT.startAt) / 1000),
      BigInt(Math.floor(Date.parse(CAMPAIGN_INPUT.endAt) / 1000)),
      organizationHash(orgId),
      meta,
    ]);
    expect(await statusOf(id)).toBe("PUBLISHING");
    expect(
      (
        await q(
          "select action from public.audit_logs where action = 'CAMPAIGN.PREPARE_PUBLICATION'",
        )
      ).rowCount,
    ).toBe(1);
  });

  it("idempotentne dla PUBLISHING (ten sam calldata, bez nowego audytu); anulowanie wraca do APPROVED", async () => {
    const { id } = await approved();
    const first = data(await call(() => prepareCampaignPublication(ctx, W.admin, id, REGISTRY)));
    const auditAfterFirst = await auditCount();
    // Odczyt gotowego calldata (gałąź idempotentna nie robi UPDATE, więc nie chroni jej wyzwalacz) też tylko dla ADMIN.
    expect(
      (await call(() => prepareCampaignPublication(ctx, W.reviewer, id, REGISTRY))).status,
    ).toBe(403);
    const second = data(await call(() => prepareCampaignPublication(ctx, W.admin, id, REGISTRY)));
    expect(second).toEqual(first);
    expect(await auditCount()).toBe(auditAfterFirst);

    expect((await call(() => cancelCampaignPublication(ctx, W.reviewer, id))).status).toBe(403);
    expect((await call(() => cancelCampaignPublication(ctx, W.admin, id))).status).toBe(200);
    expect(await statusOf(id)).toBe("APPROVED");
    expect((await call(() => cancelCampaignPublication(ctx, W.admin, id))).status).toBe(409);
    expect((await call(() => prepareCampaignPublication(ctx, W.admin, id, REGISTRY))).status).toBe(
      200,
    );
  });

  it("kampania niezatwierdzona lub niepoprawny adres rejestru → odmowa; API nie umie ustawić PUBLISHED", async () => {
    const orgId = await approvedOrg();
    const id = await draftIn(orgId);
    expect((await call(() => prepareCampaignPublication(ctx, W.admin, id, REGISTRY))).status).toBe(
      409,
    );
    expect((await call(() => prepareCampaignPublication(ctx, W.admin, id, "0x123"))).status).toBe(
      400,
    );
    await expect(
      withActor(ctx, W.admin, (tx) =>
        tx.query("update public.campaigns set status = 'PUBLISHED' where id = $1", [id]),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" }); // statusy z łańcucha ustawia tylko indexer
  });

  it("audyt: każda akcja ma wpis z aktorem (ADMIN dla personelu, USER dla członka organizacji)", async () => {
    const { id } = await approved();
    await call(() => prepareCampaignPublication(ctx, W.admin, id, REGISTRY));
    const rows = (
      await q(
        "select action, actor_type::text as t, actor_wallet_lower as w, request_id from public.audit_logs order by created_at, id",
      )
    ).rows;
    expect(rows.map((r) => r.action)).toEqual([
      "ORGANIZATION.APPLY",
      "CAMPAIGN.CREATE_DRAFT",
      "CAMPAIGN.SUBMIT",
      "CAMPAIGN.START_REVIEW",
      "CAMPAIGN.REVIEW_APPROVED",
      "CAMPAIGN.PREPARE_PUBLICATION",
    ]);
    expect(rows.map((r) => r.t)).toEqual(["USER", "USER", "USER", "ADMIN", "ADMIN", "ADMIN"]);
    expect(rows.every((r) => r.request_id === "req_write")).toBe(true);
  });
});

describe("zgodność z kontraktem", () => {
  it("selektor createCampaign zgadza się z interfejsem Solidity", () => {
    const source = readFileSync(
      new URL("../../../contracts/src/interfaces/ICharOnChain.sol", import.meta.url),
      "utf8",
    );
    const match = /function\s+createCampaign\s*\(([\s\S]*?)\)\s*external/.exec(source);
    const types = (match?.[1] ?? "")
      .split(",")
      .map((p) => p.trim().split(/\s+/)[0])
      .join(",");
    expect(types).toBe("address,uint128,uint64,uint64,bytes32,bytes32");
    expect(toFunctionSelector(`function createCampaign(${types})`)).toBe(
      toFunctionSelector("function createCampaign(address,uint128,uint64,uint64,bytes32,bytes32)"),
    );
    expect(toFunctionSelector(REGISTRY_WRITE_ABI[0])).toBe(
      toFunctionSelector(`function createCampaign(${types})`),
    );
    expect(toEventSelector("event X()")).toMatch(/^0x/);
  });

  it("organizationHash: deterministyczny, 32 bajty, zależny od identyfikatora", () => {
    const a = organizationHash("123e4567-e89b-12d3-a456-426614174000");
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(organizationHash("123E4567-E89B-12D3-A456-426614174000")).toBe(a);
    expect(organizationHash("123e4567-e89b-12d3-a456-426614174001")).not.toBe(a);
    expect(() => organizationHash("nie-uuid")).toThrow(TypeError);
  });
});
