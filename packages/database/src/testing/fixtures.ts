/**
 * Fixture'y WYŁĄCZNIE dla testów integracyjnych bazy: prawdziwe przejścia przez wyzwalacze (bez omijania
 * reguł), więc test na fixture'ach nie może „oszukać” maszyny stanów kampanii.
 */
import type { Client } from "pg";

let counter = 0x1000;

export const hexHash = (n: number): string => `0x${n.toString(16).padStart(64, "0")}`;
export const hexAddr = (n: number): string => `0x${n.toString(16).padStart(40, "0")}`;
export const nextId = (): number => ++counter;

export interface OrganizationFixture {
  readonly id: string;
  readonly safe: string;
  readonly chainId: number;
}

export async function createOrganization(
  client: Client,
  options: { chainId?: number; approved?: boolean; safe?: string } = {},
): Promise<OrganizationFixture> {
  const n = nextId();
  const chainId = options.chainId ?? 421614;
  const safe = options.safe ?? hexAddr(0x5afe0000 + n);
  const approved = options.approved ?? true;
  const result = await client.query<{ id: string }>(
    `insert into public.organizations
       (legal_name, display_name, country_code, status, safe_address_lower, safe_chain_id, verified_at)
     values ($1, $2, 'PL', $3::app.org_status, $4, $5, $6)
     returning id`,
    [
      `Fundacja Testowa ${String(n)}`,
      `Fundacja ${String(n)}`,
      approved ? "APPROVED" : "PENDING",
      safe,
      chainId,
      approved ? new Date().toISOString() : null,
    ],
  );
  return { id: result.rows[0]?.id ?? "", safe, chainId };
}

export interface CampaignFixture {
  readonly id: string;
  readonly organization: OrganizationFixture;
  readonly creator: string;
  readonly approver: string;
  readonly capRaw: string;
}

export async function createDraftCampaign(
  client: Client,
  organization: OrganizationFixture,
  options: { capRaw?: string; slug?: string; creator?: string; beneficiary?: string } = {},
): Promise<CampaignFixture> {
  const n = nextId();
  const creator = options.creator ?? hexAddr(0xc0de0000 + n);
  const capRaw = options.capRaw ?? "10000000";
  const result = await client.query<{ id: string }>(
    `insert into public.campaigns
       (organization_id, chain_id, slug, title, cap_raw, start_at, end_at, beneficiary_lower, created_by_wallet_lower)
     values ($1, $2, $3, 'Zbiórka testowa', $4::numeric, now() - interval '1 day', now() + interval '30 days', $5, $6)
     returning id`,
    [
      organization.id,
      organization.chainId,
      options.slug ?? `zbiorka-${String(n)}`,
      capRaw,
      options.beneficiary ?? organization.safe,
      creator,
    ],
  );
  return {
    id: result.rows[0]?.id ?? "",
    organization,
    creator,
    approver: hexAddr(0xa11e0000 + n),
    capRaw,
  };
}

/** Przeprowadza kampanię przez DRAFT -> ... -> APPROVED (z niezależnym zatwierdzającym i hashem metadanych). */
export async function approveCampaign(client: Client, campaign: CampaignFixture): Promise<void> {
  await client.query("update public.campaigns set status = 'SUBMITTED' where id = $1", [
    campaign.id,
  ]);
  await client.query("update public.campaigns set status = 'UNDER_REVIEW' where id = $1", [
    campaign.id,
  ]);
  await client.query(
    `update public.campaigns
        set status = 'APPROVED', approved_by_wallet_lower = $2, metadata_hash = $3
      where id = $1`,
    [campaign.id, campaign.approver, hexHash(nextId())],
  );
}

export async function insertCampaignCreatedEvent(
  client: Client,
  options: {
    chainId: number;
    txHash: string;
    onchainCampaignId: number;
    beneficiary: string;
    capRaw: string;
    confirmationState?: "OBSERVED" | "CONFIRMED" | "ORPHANED";
  },
): Promise<void> {
  const state = options.confirmationState ?? "CONFIRMED";
  await client.query(
    `insert into public.chain_events
       (chain_id, contract_lower, event_name, tx_hash, log_index, block_number, block_hash, tx_index, args,
        canonical, confirmation_state, confirmed_at)
     values ($1, $2, 'CampaignCreated', $3, 0, 100, $4, 0, $5::jsonb, $6, $7::app.confirmation_state, $8)`,
    [
      options.chainId,
      hexAddr(0xcafe),
      options.txHash,
      hexHash(nextId()),
      JSON.stringify({
        campaignId: String(options.onchainCampaignId),
        beneficiary: options.beneficiary,
        orgHash: hexHash(1),
        capRaw: options.capRaw,
      }),
      state !== "ORPHANED",
      state,
      state === "CONFIRMED" ? new Date().toISOString() : null,
    ],
  );
}

/** Pełna ścieżka publikacji: zatwierdzenie, PUBLISHING, potwierdzone zdarzenie CampaignCreated, PUBLISHED. */
export async function createPublishedCampaign(
  client: Client,
  options: {
    organization?: OrganizationFixture;
    onchainCampaignId?: number;
    chainId?: number;
    capRaw?: string;
  } = {},
): Promise<CampaignFixture & { onchainCampaignId: number; txHash: string }> {
  const organization =
    options.organization ??
    (await createOrganization(
      client,
      options.chainId === undefined ? {} : { chainId: options.chainId },
    ));
  const campaign = await createDraftCampaign(
    client,
    organization,
    options.capRaw === undefined ? {} : { capRaw: options.capRaw },
  );
  await approveCampaign(client, campaign);
  await client.query("update public.campaigns set status = 'PUBLISHING' where id = $1", [
    campaign.id,
  ]);
  const onchainCampaignId = options.onchainCampaignId ?? 1;
  const txHash = hexHash(nextId());
  await insertCampaignCreatedEvent(client, {
    chainId: organization.chainId,
    txHash,
    onchainCampaignId,
    beneficiary: organization.safe,
    capRaw: campaign.capRaw,
  });
  await client.query(
    `update public.campaigns
        set status = 'PUBLISHED', onchain_campaign_id = $2, published_tx_hash = $3
      where id = $1`,
    [campaign.id, onchainCampaignId, txHash],
  );
  return { ...campaign, onchainCampaignId, txHash };
}
