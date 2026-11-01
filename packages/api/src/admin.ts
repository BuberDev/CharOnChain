/**
 * API administracyjne/recenzenckie (COC-033; docs/03 §4): przegląd kampanii (4-eyes), przygotowanie publikacji dla
 * Safe. Backend NIGDY nie podpisuje i nie wysyła transakcji — zwraca calldata dla Safe rejestratora; status
 * PUBLISHED ustawia wyłącznie indexer po potwierdzonym evencie (AC-01). Autoryzację egzekwuje baza; tu dodatkowo
 * jawne sprawdzenia roli, żeby odmowa była czytelna i nie zależała od wyzwalacza.
 */
import { encodeFunctionData, getAddress, parseAbi, type Address, type Hex } from "viem";
import { z } from "zod";

import { organizationHash } from "./hashes.js";
import { ApiError, type ApiContext, type ApiResponse } from "./http.js";
import { requireWallet, withActor, writeAudit, type Tx } from "./identity.js";

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const ADDRESS = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

/** Lustro `ICampaignRegistry.createCampaign` (zgodność pilnuje test na podstawie interfejsu Solidity). */
export const REGISTRY_WRITE_ABI = parseAbi([
  "function createCampaign(address beneficiary, uint128 capRaw, uint64 startAt, uint64 endAt, bytes32 orgHash, bytes32 metadataHash) returns (uint64 campaignId)",
]);

export const reviewInput = z
  .object({
    decision: z.enum(["APPROVED", "REJECTED", "CHANGES_REQUESTED"]),
    reasonPublic: z.string().trim().max(1000).optional(),
    reasonPrivate: z.string().trim().max(4000).optional(),
  })
  .refine(
    (v) => v.decision === "APPROVED" || (v.reasonPublic !== undefined && v.reasonPublic !== ""),
    {
      message: "powód publiczny jest wymagany dla odrzucenia i próśb o zmiany",
      path: ["reasonPublic"],
    },
  );

const okData = (data: unknown): ApiResponse => ({ status: 200, body: { data } });

async function requireStaff(tx: Tx, role?: "ADMIN"): Promise<void> {
  requireWallet(tx);
  const result = await tx.query<{ ok: boolean }>("select app.is_staff($1::app.staff_role) as ok", [
    role ?? null,
  ]);
  if (result.rows[0]?.ok !== true)
    throw new ApiError(403, "FORBIDDEN", "Brak uprawnień do wykonania tej operacji.");
}

interface ReviewCampaign {
  status: string;
  organization_id: string;
}

async function loadForReview(tx: Tx, id: string): Promise<ReviewCampaign> {
  const result = await tx.query<ReviewCampaign>(
    "select status::text as status, organization_id from public.campaigns where id = $1",
    [id],
  );
  const row = result.rows[0];
  if (row === undefined) throw new ApiError(404, "NOT_FOUND", "Nie znaleziono: kampania.");
  return row;
}

/** GET /api/v1/admin/review-queue — kampanie czekające na przegląd (tylko personel). */
export async function listReviewQueue(ctx: ApiContext, wallet: string): Promise<ApiResponse> {
  const rows = await withActor(ctx, wallet, async (tx) => {
    await requireStaff(tx);
    const result = await tx.query<{
      id: string;
      slug: string;
      title: string;
      status: string;
      organization_id: string;
    }>(
      `select id, slug, title, status::text as status, organization_id from public.campaigns
        where status in ('SUBMITTED', 'UNDER_REVIEW') and chain_id = $1 order by updated_at, id`,
      [tx.chainId],
    );
    return result.rows;
  });
  return okData(
    rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      status: r.status,
      organizationId: r.organization_id,
    })),
  );
}

/** POST /api/v1/admin/campaigns/:id/start-review — SUBMITTED → UNDER_REVIEW. */
export async function beginCampaignReview(
  ctx: ApiContext,
  wallet: string,
  rawId: unknown,
): Promise<ApiResponse> {
  const id = UUID.parse(rawId).toLowerCase();
  await withActor(ctx, wallet, async (tx) => {
    await requireStaff(tx);
    await loadForReview(tx, id);
    const moved = await tx.query(
      "update public.campaigns set status = 'UNDER_REVIEW' where id = $1 and status = 'SUBMITTED'",
      [id],
    );
    if (moved.rowCount === 0)
      throw new ApiError(409, "STATE_CONFLICT", "Kampania nie oczekuje na przegląd.");
    await writeAudit(tx, {
      action: "CAMPAIGN.START_REVIEW",
      entityType: "campaign",
      entityId: id,
      before: { status: "SUBMITTED" },
      after: { status: "UNDER_REVIEW" },
    });
  });
  return okData({ id, status: "UNDER_REVIEW" });
}

/**
 * POST /api/v1/admin/campaigns/:id/review — decyzja recenzenta. APPROVED ustawia zatwierdzającego (zalogowany
 * recenzent) i `metadata_hash` = hash niezmiennej rewizji, którą oceniono; REJECTED kończy sprawę;
 * CHANGES_REQUESTED zwraca szkic autorowi. 4-eyes egzekwuje baza (autor i członkowie organizacji nie zatwierdzają).
 */
export async function decideCampaignReview(
  ctx: ApiContext,
  wallet: string,
  rawId: unknown,
  rawInput: unknown,
): Promise<ApiResponse> {
  const id = UUID.parse(rawId).toLowerCase();
  const input = reviewInput.parse(rawInput);
  const status = await withActor(ctx, wallet, async (tx) => {
    const actor = requireWallet(tx);
    await requireStaff(tx);
    const campaign = await loadForReview(tx, id);
    if (campaign.status !== "UNDER_REVIEW") {
      throw new ApiError(
        409,
        "STATE_CONFLICT",
        "Decyzję można podjąć tylko dla kampanii w przeglądzie.",
      );
    }
    const revision = await tx.query<{ id: string; content_sha256: string }>(
      "select id, content_sha256 from public.campaign_revisions where campaign_id = $1 order by version desc limit 1",
      [id],
    );
    const latest = revision.rows[0];
    if (latest === undefined)
      throw new ApiError(409, "STATE_CONFLICT", "Kampania nie ma rewizji do oceny.");

    try {
      await tx.query(
        `insert into public.campaign_reviews (campaign_id, revision_id, reviewer_wallet_lower, decision, reason_public, reason_private)
         values ($1, $2, $3, $4::app.review_decision, $5, $6)`,
        [
          id,
          latest.id,
          actor,
          input.decision,
          input.reasonPublic ?? null,
          input.reasonPrivate ?? null,
        ],
      );
    } catch (error) {
      if (error instanceof Error && /4-eyes/.test(error.message)) {
        throw new ApiError(
          403,
          "FOUR_EYES_VIOLATION",
          "Ta osoba nie może zatwierdzić tej kampanii (zasada czterech oczu).",
        );
      }
      throw error;
    }

    let next: "APPROVED" | "REJECTED" | "DRAFT";
    if (input.decision === "APPROVED") {
      next = "APPROVED";
      await tx.query(
        `update public.campaigns set status = 'APPROVED', approved_by_wallet_lower = $2, metadata_hash = $3
          where id = $1 and status = 'UNDER_REVIEW'`,
        [id, actor, latest.content_sha256],
      );
    } else {
      next = input.decision === "REJECTED" ? "REJECTED" : "DRAFT";
      await tx.query(
        "update public.campaigns set status = $2::app.campaign_status where id = $1 and status = 'UNDER_REVIEW'",
        [id, next],
      );
    }
    const check = await tx.query<{ status: string }>(
      "select status::text as status from public.campaigns where id = $1",
      [id],
    );
    if (check.rows[0]?.status !== next)
      throw new ApiError(409, "STATE_CONFLICT", "Stan kampanii zmienił się w trakcie decyzji.");
    await writeAudit(tx, {
      action: `CAMPAIGN.REVIEW_${input.decision}`,
      entityType: "campaign",
      entityId: id,
      before: { status: "UNDER_REVIEW" },
      after: { status: next, revisionSha256: latest.content_sha256 },
    });
    return next;
  });
  return okData({ id, status });
}

export interface PublicationIntent {
  readonly chainId: number;
  /** Kontrakt docelowy dla Safe: `CampaignRegistry`. */
  readonly to: Address;
  readonly value: "0";
  readonly data: Hex;
  readonly function: "createCampaign";
  readonly arguments: {
    readonly beneficiary: Address;
    readonly capRaw: string;
    readonly startAt: string;
    readonly endAt: string;
    readonly orgHash: Hex;
    readonly metadataHash: Hex;
  };
}

interface PublishRow {
  status: string;
  organization_id: string;
  chain_id: number;
  beneficiary_lower: string;
  cap_raw: string;
  start_epoch: string;
  end_epoch: string;
  metadata_hash: string | null;
}

/**
 * POST /api/v1/admin/campaigns/:id/publish-intent — tylko ADMIN. APPROVED → PUBLISHING i calldata dla Safe
 * rejestratora (idempotentne: dla PUBLISHING zwraca ten sam calldata bez zmiany stanu). Nie podpisuje niczego.
 */
export async function prepareCampaignPublication(
  ctx: ApiContext,
  wallet: string,
  rawId: unknown,
  rawRegistry: unknown,
): Promise<ApiResponse> {
  const id = UUID.parse(rawId).toLowerCase();
  const registry = getAddress(ADDRESS.parse(rawRegistry));
  const intent = await withActor(ctx, wallet, async (tx) => {
    await requireStaff(tx, "ADMIN");
    const result = await tx.query<PublishRow>(
      `select status::text as status, organization_id, chain_id, beneficiary_lower, cap_raw::text as cap_raw,
              extract(epoch from start_at)::bigint::text as start_epoch, extract(epoch from end_at)::bigint::text as end_epoch,
              metadata_hash
         from public.campaigns where id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (row === undefined) throw new ApiError(404, "NOT_FOUND", "Nie znaleziono: kampania.");
    if (row.status !== "APPROVED" && row.status !== "PUBLISHING") {
      throw new ApiError(
        409,
        "STATE_CONFLICT",
        "Publikację można przygotować tylko dla zatwierdzonej kampanii.",
      );
    }
    if (row.chain_id !== tx.chainId)
      throw new ApiError(409, "STATE_CONFLICT", "Kampania należy do innej sieci.");
    if (row.metadata_hash === null)
      throw new ApiError(409, "STATE_CONFLICT", "Brak hasha metadanych zatwierdzonej rewizji.");

    if (row.status === "APPROVED") {
      // Wyzwalacz bazy sprawdza m.in. zatwierdzoną organizację i zgodność beneficjenta z jej Safe.
      await tx.query(
        "update public.campaigns set status = 'PUBLISHING' where id = $1 and status = 'APPROVED'",
        [id],
      );
      await writeAudit(tx, {
        action: "CAMPAIGN.PREPARE_PUBLICATION",
        entityType: "campaign",
        entityId: id,
        before: { status: "APPROVED" },
        after: { status: "PUBLISHING", registry },
      });
    }

    const args = {
      beneficiary: getAddress(row.beneficiary_lower),
      capRaw: row.cap_raw,
      startAt: row.start_epoch,
      endAt: row.end_epoch,
      orgHash: organizationHash(row.organization_id),
      metadataHash: row.metadata_hash as Hex,
    };
    const data = encodeFunctionData({
      abi: REGISTRY_WRITE_ABI,
      functionName: "createCampaign",
      args: [
        args.beneficiary,
        BigInt(args.capRaw),
        BigInt(args.startAt),
        BigInt(args.endAt),
        args.orgHash,
        args.metadataHash,
      ],
    });
    const built: PublicationIntent = {
      chainId: row.chain_id,
      to: registry,
      value: "0",
      data,
      function: "createCampaign",
      arguments: args,
    };
    return built;
  });
  return okData(intent);
}

/**
 * POST /api/v1/admin/campaigns/:id/cancel-publication — PUBLISHING → APPROVED, gdy transakcja Safe NIE została
 * wykonana. UWAGA operacyjna: jeśli transakcja została już wykonana, indexer zgłosi anomalię (zdarzenie bez
 * kampanii w PUBLISHING) zamiast zgadywać — to wymaga decyzji operatora.
 */
export async function cancelCampaignPublication(
  ctx: ApiContext,
  wallet: string,
  rawId: unknown,
): Promise<ApiResponse> {
  const id = UUID.parse(rawId).toLowerCase();
  await withActor(ctx, wallet, async (tx) => {
    await requireStaff(tx, "ADMIN");
    await loadForReview(tx, id);
    const moved = await tx.query(
      "update public.campaigns set status = 'APPROVED' where id = $1 and status = 'PUBLISHING'",
      [id],
    );
    if (moved.rowCount === 0)
      throw new ApiError(
        409,
        "STATE_CONFLICT",
        "Kampania nie jest w trakcie przygotowania publikacji.",
      );
    await writeAudit(tx, {
      action: "CAMPAIGN.CANCEL_PUBLICATION",
      entityType: "campaign",
      entityId: id,
      before: { status: "PUBLISHING" },
      after: { status: "APPROVED" },
    });
  });
  return okData({ id, status: "APPROVED" });
}
