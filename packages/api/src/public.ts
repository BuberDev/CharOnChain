/**
 * Publiczne API odczytu (COC-032; docs/03 §4). Czyta WYŁĄCZNIE z widoków whitelistowych `public_*` (migracja 0005),
 * więc nawet błąd w zapytaniu nie ujawni kolumn prywatnych. Wywoływać na połączeniu roli `app_api` (testy to
 * wymuszają). Kwoty: ciągi dziesiętne. Sumy ("zebrano") to PROJEKCJA z potwierdzonych zdarzeń, nie źródło prawdy.
 */
import { tierFromRaw, xpFromRaw } from "@charonchain/shared";
import { z } from "zod";

import { decodeCursor, encodeCursor } from "./cursor.js";
import { ApiError, PUBLIC_CACHE_HEADERS, type ApiContext, type ApiResponse } from "./http.js";

const LIMIT = z.coerce.number().int().min(1).max(50).default(20);
const CURSOR = z.string().min(1).max(200).optional();
const SLUG = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const ADDRESS = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((v) => v.toLowerCase());

export const listCampaignsQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  status: z.enum(["PUBLISHED", "PAUSED", "CLOSED"]).optional(),
  limit: LIMIT,
  cursor: CURSOR,
});

const pageQuery = z.object({ limit: LIMIT, cursor: CURSOR });

/** Po tylu sekundach bez aktualizacji kursora dane uznajemy za nieaktualne (zgodnie z progiem alarmu indexera). */
export const DEFAULT_STALE_AFTER_SECONDS = 300;

export type ProjectionState = "OK" | "STALE" | "ERROR" | "UNAVAILABLE";

export interface ProjectionStatus {
  /** `OK` = indexer działa i ostatnie uzgadnianie z kontraktem nie wykryło różnic. Inaczej sumy NIE są finalne. */
  readonly state: ProjectionState;
  /** Ostatni blok, do którego projekcja jest potwierdzona (najsłabszy kursor) — jako ciąg dziesiętny. */
  readonly confirmedBlock: string | null;
  readonly ageSeconds: number | null;
  /** Czy sumy ("zebrano", statystyki) wolno pokazywać jako ostateczne (AC-33). */
  readonly final: boolean;
}

/**
 * Status projekcji z `public_indexer_status` (AC-33): gdy indexer stoi, ma błąd albo nie ma danych, API
 * oznacza sumy jako niefinalne zamiast je ukrywać lub pokazywać jako pewne.
 */
export async function getProjectionStatus(ctx: ApiContext): Promise<ProjectionStatus> {
  const result = await ctx.db.query<{
    cursors: number;
    confirmed_block: string;
    has_error: boolean;
    age_seconds: number;
  }>(
    `select cursors, confirmed_block::text as confirmed_block, has_error, age_seconds
       from public.public_indexer_status where chain_id = $1`,
    [ctx.chainId],
  );
  const row = result.rows[0];
  if (row === undefined || row.cursors < EXPECTED_CURSORS) {
    return {
      state: "UNAVAILABLE",
      confirmedBlock: row?.confirmed_block ?? null,
      ageSeconds: row?.age_seconds ?? null,
      final: false,
    };
  }
  const staleAfter = ctx.staleAfterSeconds ?? DEFAULT_STALE_AFTER_SECONDS;
  const state: ProjectionState = row.has_error
    ? "ERROR"
    : row.age_seconds > staleAfter
      ? "STALE"
      : "OK";
  return {
    state,
    confirmedBlock: row.confirmed_block,
    ageSeconds: Math.round(row.age_seconds),
    final: state === "OK",
  };
}

/** Indexer śledzi cztery kontrakty SC-1.0; mniej kursorów oznacza niepełny skan. */
const EXPECTED_CURSORS = 4;

const ok = (body: unknown): ApiResponse => ({ status: 200, body, headers: PUBLIC_CACHE_HEADERS });
const notFound = (what: string): ApiError =>
  new ApiError(404, "NOT_FOUND", `Nie znaleziono: ${what}.`);

/** Znaki specjalne wzorca LIKE traktujemy dosłownie. */
export const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (c) => `\\${c}`);

const CURSOR_TS = (column: string): string =>
  `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

interface CampaignRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: string;
  status: "PUBLISHED" | "PAUSED" | "CLOSED";
  cap_raw: string;
  raised_raw: string;
  remaining_raw: string;
  donations_count: string;
  start_at: Date;
  end_at: Date;
  chain_id: number;
  onchain_campaign_id: string;
  organization_id: string;
  org_name: string | null;
  cursor_ts: string;
}

const CAMPAIGN_SELECT = `
  select c.id, c.slug, c.title, c.summary, c.category, c.status,
         c.cap_raw::text as cap_raw,
         coalesce(d.raised, 0)::text as raised_raw,
         greatest(c.cap_raw - coalesce(d.raised, 0), 0)::text as remaining_raw,
         coalesce(d.cnt, 0)::text as donations_count,
         c.start_at, c.end_at, c.chain_id, c.onchain_campaign_id::text as onchain_campaign_id,
         c.organization_id, o.display_name as org_name,
         ${CURSOR_TS("c.created_at")} as cursor_ts
    from public.public_campaigns c
    left join public.public_organizations o on o.id = c.organization_id
    left join lateral (
      select sum(pd.amount_raw) as raised, count(*) as cnt
        from public.public_donations pd where pd.campaign_id = c.id
    ) d on true`;

function campaignDto(row: CampaignRow): Record<string, unknown> {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    category: row.category,
    status: row.status,
    capRaw: row.cap_raw,
    raisedRaw: row.raised_raw,
    remainingRaw: row.remaining_raw,
    donationsCount: Number(row.donations_count),
    startAt: row.start_at.toISOString(),
    endAt: row.end_at.toISOString(),
    chainId: row.chain_id,
    onchainCampaignId: row.onchain_campaign_id,
    organization:
      row.org_name === null ? null : { id: row.organization_id, displayName: row.org_name },
  };
}

/** GET /api/v1/campaigns */
export async function listCampaigns(ctx: ApiContext, rawQuery: unknown): Promise<ApiResponse> {
  const query = listCampaignsQuery.parse(rawQuery);
  const values: unknown[] = [ctx.chainId];
  const where: string[] = ["c.chain_id = $1"];
  if (query.status !== undefined) {
    values.push(query.status);
    where.push(`c.status = $${String(values.length)}::app.campaign_status`);
  }
  if (query.category !== undefined) {
    values.push(query.category);
    where.push(`lower(c.category) = lower($${String(values.length)})`);
  }
  if (query.q !== undefined) {
    values.push(`%${escapeLike(query.q)}%`);
    const n = String(values.length);
    where.push(`(c.title ilike $${n} escape '\\' or c.summary ilike $${n} escape '\\')`);
  }
  if (query.cursor !== undefined) {
    const cursor = decodeCursor(query.cursor);
    values.push(cursor.t, cursor.i);
    const a = String(values.length - 1);
    const b = String(values.length);
    where.push(`(c.created_at, c.id) < ($${a}::timestamptz, $${b}::uuid)`);
  }
  values.push(query.limit + 1);
  const result = await ctx.db.query<CampaignRow>(
    `${CAMPAIGN_SELECT}
      where ${where.join(" and ")}
      order by c.created_at desc, c.id desc
      limit $${String(values.length)}`,
    values,
  );
  const page = result.rows.slice(0, query.limit);
  const last = page.at(-1);
  const hasMore = result.rows.length > query.limit;
  return ok({
    projection: await getProjectionStatus(ctx),
    items: page.map(campaignDto),
    nextCursor:
      hasMore && last !== undefined ? encodeCursor({ t: last.cursor_ts, i: last.id }) : null,
  });
}

interface ReportRow {
  id: string;
  version: number;
  status: string;
  public_uri: string;
  content_sha256: string;
  onchain_report_id: string;
  publish_tx_hash: string;
  review_tx_hash: string | null;
  period_start: string;
  period_end: string;
  created_at: Date;
}

const REPORT_SELECT = `
  select r.id, r.version, r.status, r.public_uri, r.content_sha256,
         r.onchain_report_id::text as onchain_report_id, r.publish_tx_hash, r.review_tx_hash,
         r.period_start::text as period_start, r.period_end::text as period_end, r.created_at
    from public.public_reports r`;

function reportDto(row: ReportRow): Record<string, unknown> {
  return {
    id: row.id,
    version: row.version,
    // Status raportu ≠ weryfikacja organizacji ≠ transakcja darowizny (CLAUDE.md pkt 12): tylko fakty z łańcucha.
    status: row.status,
    publicUri: row.public_uri,
    contentSha256: row.content_sha256,
    onchainReportId: row.onchain_report_id,
    publishTxHash: row.publish_tx_hash,
    reviewTxHash: row.review_tx_hash,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    createdAt: row.created_at.toISOString(),
  };
}

async function reportsOf(ctx: ApiContext, campaignId: string): Promise<Record<string, unknown>[]> {
  const result = await ctx.db.query<ReportRow>(
    `${REPORT_SELECT} where r.campaign_id = $1 order by r.version desc`,
    [campaignId],
  );
  return result.rows.map(reportDto);
}

interface CampaignDetailRow extends CampaignRow {
  description_md: string;
  beneficiary_lower: string;
  metadata_hash: string | null;
  published_tx_hash: string | null;
  org_country: string | null;
  org_verified_at: Date | null;
  org_safe: string | null;
}

/** GET /api/v1/campaigns/:slug */
export async function getCampaign(ctx: ApiContext, rawSlug: unknown): Promise<ApiResponse> {
  const slug = SLUG.parse(rawSlug);
  const result = await ctx.db.query<CampaignDetailRow>(
    `select base.*, pc.description_md, pc.beneficiary_lower, pc.metadata_hash, pc.published_tx_hash,
            o.country_code as org_country, o.verified_at as org_verified_at, o.safe_address_lower as org_safe
       from (${CAMPAIGN_SELECT} where c.chain_id = $1 and c.slug = $2) base
       join public.public_campaigns pc on pc.id = base.id
       left join public.public_organizations o on o.id = base.organization_id`,
    [ctx.chainId, slug],
  );
  const row = result.rows[0];
  if (row === undefined) throw notFound("kampania");
  const dto = campaignDto(row);
  return ok({
    projection: await getProjectionStatus(ctx),
    data: {
      ...dto,
      descriptionMd: row.description_md,
      beneficiary: row.beneficiary_lower,
      metadataHash: row.metadata_hash,
      publishedTxHash: row.published_tx_hash,
      organization:
        row.org_name === null
          ? null
          : {
              id: row.organization_id,
              displayName: row.org_name,
              countryCode: row.org_country,
              safeAddress: row.org_safe,
              verifiedAt: row.org_verified_at?.toISOString() ?? null,
            },
      reports: await reportsOf(ctx, row.id),
    },
  });
}

async function campaignIdBySlug(ctx: ApiContext, slug: string): Promise<string> {
  const found = await ctx.db.query<{ id: string }>(
    "select id from public.public_campaigns where chain_id = $1 and slug = $2",
    [ctx.chainId, slug],
  );
  const id = found.rows[0]?.id;
  if (id === undefined) throw notFound("kampania");
  return id;
}

interface DonationRow {
  id: string;
  donor_wallet_lower: string;
  amount_raw: string;
  block_time: Date;
  tx_hash: string;
  log_index: number;
  block_number: string;
  cursor_ts: string;
}

/** GET /api/v1/campaigns/:slug/donations — wyłącznie potwierdzone, bez obietnicy anonimowości. */
export async function listCampaignDonations(
  ctx: ApiContext,
  rawSlug: unknown,
  rawQuery: unknown,
): Promise<ApiResponse> {
  const slug = SLUG.parse(rawSlug);
  const query = pageQuery.parse(rawQuery);
  const campaignId = await campaignIdBySlug(ctx, slug);
  const values: unknown[] = [campaignId];
  let cursorSql = "";
  if (query.cursor !== undefined) {
    const cursor = decodeCursor(query.cursor);
    values.push(cursor.t, cursor.i);
    cursorSql = "and (d.block_time, d.id) < ($2::timestamptz, $3::uuid)";
  }
  values.push(query.limit + 1);
  const result = await ctx.db.query<DonationRow>(
    `select d.id, d.donor_wallet_lower, d.amount_raw::text as amount_raw, d.block_time,
            d.tx_hash, d.log_index, d.block_number::text as block_number,
            ${CURSOR_TS("d.block_time")} as cursor_ts
       from public.public_donations d
      where d.campaign_id = $1 ${cursorSql}
      order by d.block_time desc, d.id desc
      limit $${String(values.length)}`,
    values,
  );
  const page = result.rows.slice(0, query.limit);
  const last = page.at(-1);
  return ok({
    projection: await getProjectionStatus(ctx),
    items: page.map((row) => ({
      id: row.id,
      donor: row.donor_wallet_lower,
      amountRaw: row.amount_raw,
      blockTime: row.block_time.toISOString(),
      // Dowód: transakcja i zdarzenie w łańcuchu (link do eksploratora buduje frontend).
      txHash: row.tx_hash,
      logIndex: row.log_index,
      blockNumber: row.block_number,
    })),
    nextCursor:
      result.rows.length > query.limit && last !== undefined
        ? encodeCursor({ t: last.cursor_ts, i: last.id })
        : null,
  });
}

/** GET /api/v1/campaigns/:slug/reports */
export async function listCampaignReports(ctx: ApiContext, rawSlug: unknown): Promise<ApiResponse> {
  const slug = SLUG.parse(rawSlug);
  const campaignId = await campaignIdBySlug(ctx, slug);
  return ok({ items: await reportsOf(ctx, campaignId) });
}

/** GET /api/v1/organizations/:id */
export async function getOrganization(ctx: ApiContext, rawId: unknown): Promise<ApiResponse> {
  const id = UUID.parse(rawId).toLowerCase();
  const result = await ctx.db.query<{
    id: string;
    display_name: string;
    country_code: string | null;
    safe_address_lower: string;
    safe_chain_id: number;
    verified_at: Date | null;
  }>(
    `select id, display_name, country_code, safe_address_lower, safe_chain_id, verified_at
       from public.public_organizations where id = $1 and safe_chain_id = $2`,
    [id, ctx.chainId],
  );
  const row = result.rows[0];
  if (row === undefined) throw notFound("organizacja");
  return ok({
    data: {
      id: row.id,
      displayName: row.display_name,
      countryCode: row.country_code,
      safeAddress: row.safe_address_lower,
      safeChainId: row.safe_chain_id,
      verifiedAt: row.verified_at?.toISOString() ?? null,
    },
  });
}

/**
 * GET /api/v1/donors/:chainId/:address — tylko profile opt-in. Brak profilu i profil niepubliczny są
 * nieodróżnialne (404), żeby nie ujawniać, że portfel istnieje. Statystyki liczone z potwierdzonych wpłat
 * widocznych publicznie; zakres to wpłaty przez CharOnChain w tej sieci, nie cała historia portfela.
 */
export async function getDonor(
  ctx: ApiContext,
  rawChainId: unknown,
  rawAddress: unknown,
): Promise<ApiResponse> {
  const chainId = z.coerce.number().int().parse(rawChainId);
  const wallet = ADDRESS.parse(rawAddress);
  if (chainId !== ctx.chainId) throw notFound("profil");
  const profile = await ctx.db.query<{ display_name: string | null; bio: string | null }>(
    "select display_name, bio from public.public_donor_profiles where chain_id = $1 and wallet_lower = $2",
    [chainId, wallet],
  );
  const row = profile.rows[0];
  if (row === undefined) throw notFound("profil");
  const totals = await ctx.db.query<{ total: string; cnt: string }>(
    `select coalesce(sum(amount_raw), 0)::text as total, count(*)::text as cnt
       from public.public_donations where chain_id = $1 and donor_wallet_lower = $2`,
    [chainId, wallet],
  );
  const total = BigInt(totals.rows[0]?.total ?? "0");
  return ok({
    projection: await getProjectionStatus(ctx),
    data: {
      chainId,
      wallet,
      displayName: row.display_name,
      bio: row.bio,
      totalDonatedRaw: total.toString(),
      donationsCount: Number(totals.rows[0]?.cnt ?? "0"),
      xp: xpFromRaw(total).toString(),
      tier: tierFromRaw(total),
      scope: "CONFIRMED_DONATIONS_VIA_CHARONCHAIN_ON_THIS_CHAIN",
    },
  });
}
