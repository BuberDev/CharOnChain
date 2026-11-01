/**
 * API organizacji (COC-033; docs/03 §4): wniosek organizacji, szkice kampanii, edycja i zgłoszenie do przeglądu.
 * Tożsamość pochodzi WYŁĄCZNIE z sesji (`wallet`), nigdy z treści żądania. Uprawnienia egzekwuje baza (RLS i wyzwalacze);
 * ten moduł waliduje wejście, ustala beneficjenta (zawsze zweryfikowany Safe organizacji — użytkownik go nie wybiera)
 * i zapisuje ślad audytowy w tej samej transakcji. CSRF, limity żądań i uwierzytelnienie sesji należą do warstwy HTTP.
 */
import { randomUUID } from "node:crypto";

import { MIN_DONATION_RAW, contentSha256 } from "@charonchain/shared";
import { z } from "zod";

import { ApiError, type ApiContext, type ApiResponse } from "./http.js";
import { requireWallet, withActor, writeAudit, type Tx } from "./identity.js";

const MAX_UINT128 = (1n << 128n) - 1n;
const PLAIN = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    // eslint-disable-next-line no-control-regex -- znaki sterujące w tekstach jednoliniowych są niedozwolone
    .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), "znaki sterujące są niedozwolone");

const ADDRESS = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((v) => v.toLowerCase());
const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const orgApplicationInput = z.object({
  legalName: PLAIN(300),
  displayName: PLAIN(200),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  registryNumber: PLAIN(100).optional(),
  safeAddress: ADDRESS,
  contactPerson: PLAIN(200).optional(),
  contactEmail: z
    .string()
    .trim()
    .max(254)
    .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)
    .optional(),
});

const capRaw = z
  .string()
  .regex(/^[1-9][0-9]{0,38}$/)
  .refine((v) => {
    // Zod 4 uruchamia refine także po nieudanym regexie — BigInt("12.5") rzuciłby wyjątek (→ 500 zamiast 400).
    if (!/^[1-9][0-9]{0,38}$/.test(v)) return false;
    const n = BigInt(v);
    return n >= MIN_DONATION_RAW && n <= MAX_UINT128;
  }, "limit musi mieścić się w zakresie od 1 USDC do uint128");

/** ISO-8601 z czasem i strefą; zapisujemy z dokładnością do sekundy (tak jak on-chain). */
const instant = z.iso.datetime({ offset: true }).transform((v) => Math.floor(Date.parse(v) / 1000));

const campaignFields = {
  title: PLAIN(200),
  summary: z.string().trim().max(500),
  descriptionMd: z.string().max(20_000),
  category: PLAIN(60),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  capRaw,
  startAt: instant,
  endAt: instant,
};

export const campaignDraftInput = z.object(campaignFields).refine((v) => v.endAt > v.startAt, {
  message: "koniec musi być po początku",
  path: ["endAt"],
});

export const campaignPatchInput = z
  .object({
    title: campaignFields.title,
    summary: campaignFields.summary,
    descriptionMd: campaignFields.descriptionMd,
    category: campaignFields.category,
    slug: campaignFields.slug,
    capRaw: campaignFields.capRaw,
    startAt: campaignFields.startAt,
    endAt: campaignFields.endAt,
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "brak pól do zmiany" });

const created = (data: unknown): ApiResponse => ({ status: 201, body: { data } });
const okData = (data: unknown): ApiResponse => ({ status: 200, body: { data } });

/** POST /api/v1/orgs/applications */
export async function applyForOrganization(
  ctx: ApiContext,
  wallet: string,
  rawInput: unknown,
): Promise<ApiResponse> {
  const input = orgApplicationInput.parse(rawInput);
  const id = randomUUID();
  await withActor(ctx, wallet, async (tx) => {
    const actor = requireWallet(tx);
    // Bez RETURNING: wnioskodawca zobaczy wiersz dopiero jako członek (polityka SELECT).
    await tx.query(
      `insert into public.organizations
         (id, legal_name, display_name, country_code, registry_number, status, safe_address_lower, safe_chain_id)
       values ($1, $2, $3, $4, $5, 'PENDING', $6, $7)`,
      [
        id,
        input.legalName,
        input.displayName,
        input.countryCode,
        input.registryNumber ?? null,
        input.safeAddress,
        ctx.chainId,
      ],
    );
    await tx.query(
      "insert into public.organization_members (organization_id, wallet_lower, role) values ($1, $2, 'OWNER')",
      [id, actor],
    );
    if (input.contactPerson !== undefined || input.contactEmail !== undefined) {
      await tx.query(
        "insert into public.organization_private (organization_id, contact_person, contact_email) values ($1, $2, $3)",
        [id, input.contactPerson ?? null, input.contactEmail ?? null],
      );
    }
    await writeAudit(tx, {
      action: "ORGANIZATION.APPLY",
      entityType: "organization",
      entityId: id,
      after: { status: "PENDING", safeChainId: ctx.chainId },
    });
  });
  return created({ id, status: "PENDING" });
}

interface CampaignRow {
  id: string;
  organization_id: string;
  slug: string;
  title: string;
  summary: string;
  description_md: string;
  category: string;
  status: string;
  cap_raw: string;
  start_epoch: string;
  end_epoch: string;
  beneficiary_lower: string;
  chain_id: number;
}

const CAMPAIGN_COLUMNS = `id, organization_id, slug, title, summary, description_md, category, status::text as status,
  cap_raw::text as cap_raw, extract(epoch from start_at)::bigint::text as start_epoch,
  extract(epoch from end_at)::bigint::text as end_epoch, beneficiary_lower, chain_id`;

function draftDto(row: CampaignRow): Record<string, unknown> {
  return {
    id: row.id,
    organizationId: row.organization_id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    descriptionMd: row.description_md,
    category: row.category,
    status: row.status,
    capRaw: row.cap_raw,
    startAt: new Date(Number(row.start_epoch) * 1000).toISOString(),
    endAt: new Date(Number(row.end_epoch) * 1000).toISOString(),
    beneficiary: row.beneficiary_lower,
    chainId: row.chain_id,
  };
}

async function loadCampaign(tx: Tx, id: string): Promise<CampaignRow> {
  const result = await tx.query<CampaignRow>(
    `select ${CAMPAIGN_COLUMNS} from public.campaigns where id = $1`,
    [id],
  );
  const row = result.rows[0];
  // Wiersz niewidoczny dla RLS wygląda jak brak wiersza: nie ujawniamy istnienia cudzych kampanii.
  if (row === undefined) throw new ApiError(404, "NOT_FOUND", "Nie znaleziono: kampania.");
  return row;
}

/** POST /api/v1/orgs/:id/campaigns */
export async function createCampaignDraft(
  ctx: ApiContext,
  wallet: string,
  rawOrgId: unknown,
  rawInput: unknown,
): Promise<ApiResponse> {
  const orgId = UUID.parse(rawOrgId).toLowerCase();
  const input = campaignDraftInput.parse(rawInput);
  const id = randomUUID();
  const row = await withActor(ctx, wallet, async (tx) => {
    const actor = requireWallet(tx);
    const org = await tx.query<{ status: string; safe: string | null; chain: number | null }>(
      `select status::text as status, safe_address_lower as safe, safe_chain_id as chain
         from public.organizations where id = $1`,
      [orgId],
    );
    const o = org.rows[0];
    if (o === undefined) throw new ApiError(404, "NOT_FOUND", "Nie znaleziono: organizacja.");
    if (o.status !== "APPROVED" || o.safe === null || o.chain !== ctx.chainId) {
      throw new ApiError(409, "ORG_NOT_APPROVED", "Organizacja nie jest zatwierdzona w tej sieci.");
    }
    await tx.query(
      `insert into public.campaigns
         (id, organization_id, chain_id, slug, title, summary, description_md, category, status, cap_raw,
          start_at, end_at, beneficiary_lower, created_by_wallet_lower)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT', $9::numeric, to_timestamp($10), to_timestamp($11), $12, $13)`,
      [
        id,
        orgId,
        ctx.chainId,
        input.slug,
        input.title,
        input.summary,
        input.descriptionMd,
        input.category,
        input.capRaw,
        input.startAt,
        input.endAt,
        o.safe, // beneficjent = zweryfikowany Safe organizacji; użytkownik go nie wskazuje
        actor,
      ],
    );
    await writeAudit(tx, {
      action: "CAMPAIGN.CREATE_DRAFT",
      entityType: "campaign",
      entityId: id,
      after: { status: "DRAFT" },
    });
    return loadCampaign(tx, id);
  });
  return created(draftDto(row));
}

const COLUMN_BY_FIELD = {
  title: "title",
  summary: "summary",
  descriptionMd: "description_md",
  category: "category",
  slug: "slug",
  capRaw: "cap_raw",
  startAt: "start_at",
  endAt: "end_at",
} as const;

/** PATCH /api/v1/campaign-drafts/:id — tylko DRAFT. Beneficjent, sieć i organizacja nie są edytowalne. */
export async function updateCampaignDraft(
  ctx: ApiContext,
  wallet: string,
  rawId: unknown,
  rawPatch: unknown,
): Promise<ApiResponse> {
  const id = UUID.parse(rawId).toLowerCase();
  const patch = campaignPatchInput.parse(rawPatch);
  const row = await withActor(ctx, wallet, async (tx) => {
    requireWallet(tx);
    const current = await loadCampaign(tx, id);
    const startEpoch = patch.startAt ?? Number(current.start_epoch);
    const endEpoch = patch.endAt ?? Number(current.end_epoch);
    if (endEpoch <= startEpoch) {
      throw new ApiError(400, "VALIDATION_ERROR", "Nieprawidłowe dane wejściowe.");
    }
    const sets: string[] = [];
    const values: unknown[] = [id];
    for (const [field, column] of Object.entries(COLUMN_BY_FIELD)) {
      const value = patch[field as keyof typeof patch];
      if (value === undefined) continue;
      values.push(value);
      const n = String(values.length);
      sets.push(
        column === "start_at" || column === "end_at"
          ? `${column} = to_timestamp($${n})`
          : column === "cap_raw"
            ? `${column} = $${n}::numeric`
            : `${column} = $${n}`,
      );
    }
    const updated = await tx.query(
      `update public.campaigns set ${sets.join(", ")} where id = $1 and status = 'DRAFT'`,
      values,
    );
    if (updated.rowCount === 0) {
      // Szkic widoczny, a zmiana nie dotknęła wiersza = polityka RLS (np. rola REPORTER) — to brak uprawnień.
      if (current.status === "DRAFT") {
        throw new ApiError(403, "FORBIDDEN", "Brak uprawnień do wykonania tej operacji.");
      }
      throw new ApiError(409, "STATE_CONFLICT", "Kampanię można edytować tylko w statusie DRAFT.");
    }
    await writeAudit(tx, {
      action: "CAMPAIGN.UPDATE_DRAFT",
      entityType: "campaign",
      entityId: id,
      before: { fields: [] },
      after: { fields: Object.keys(patch).sort() },
    });
    return loadCampaign(tx, id);
  });
  return okData(draftDto(row));
}

/** Niezmienna treść rewizji (to, co oceniają recenzenci i co staje się `metadataHash` on-chain). */
export function revisionContent(row: CampaignRow): Record<string, string | number> {
  return {
    title: row.title,
    summary: row.summary,
    descriptionMd: row.description_md,
    category: row.category,
    slug: row.slug,
    capRaw: row.cap_raw,
    startAt: row.start_epoch,
    endAt: row.end_epoch,
    beneficiary: row.beneficiary_lower,
    chainId: row.chain_id,
    organizationId: row.organization_id,
  };
}

/** POST /api/v1/campaign-drafts/:id/submit — niezmienna rewizja + status SUBMITTED. */
export async function submitCampaignDraft(
  ctx: ApiContext,
  wallet: string,
  rawId: unknown,
): Promise<ApiResponse> {
  const id = UUID.parse(rawId).toLowerCase();
  const result = await withActor(ctx, wallet, async (tx) => {
    const actor = requireWallet(tx);
    const row = await loadCampaign(tx, id);
    if (row.status !== "DRAFT") {
      throw new ApiError(409, "STATE_CONFLICT", "Do przeglądu można zgłosić tylko szkic (DRAFT).");
    }
    const content = revisionContent(row);
    const hash = contentSha256(content);
    const revision = await tx.query<{ version: number }>(
      `insert into public.campaign_revisions (campaign_id, version, content_json, content_sha256, created_by)
       values ($1, (select coalesce(max(version), 0) + 1 from public.campaign_revisions where campaign_id = $1),
               $2::jsonb, $3, $4)
       returning version`,
      [id, JSON.stringify(content), hash, actor],
    );
    const moved = await tx.query(
      "update public.campaigns set status = 'SUBMITTED' where id = $1 and status = 'DRAFT'",
      [id],
    );
    if (moved.rowCount === 0) {
      throw new ApiError(409, "STATE_CONFLICT", "Do przeglądu można zgłosić tylko szkic (DRAFT).");
    }
    await writeAudit(tx, {
      action: "CAMPAIGN.SUBMIT",
      entityType: "campaign",
      entityId: id,
      before: { status: "DRAFT" },
      after: { status: "SUBMITTED", contentSha256: hash },
    });
    return { version: revision.rows[0]?.version ?? 1, contentSha256: hash };
  });
  return okData({ id, status: "SUBMITTED", ...result });
}
