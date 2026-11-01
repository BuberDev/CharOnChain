/**
 * Projekcje z journala do tabel domenowych. Baza jest PROJEKCJĄ łańcucha (CLAUDE.md pkt 6): wszystko tu da się
 * odtworzyć z `chain_events`, a funkcje są idempotentne (można je wywoływać wielokrotnie).
 * Niejednoznaczne dopasowania (kampania/raport) NIE są zgadywane — trafiają do listy anomalii dla operatora.
 */
import type { ClientBase } from "pg";
import type { Address } from "viem";

import type { ChainRpc } from "./rpc.js";

export interface Anomaly {
  readonly kind:
    | "UNKNOWN_CAMPAIGN_FOR_DONATION"
    | "CAMPAIGN_NO_MATCH"
    | "CAMPAIGN_AMBIGUOUS"
    | "REPORT_NO_MATCH"
    | "PUBLISHED_ON_ORPHANED_EVENT";
  readonly detail: string;
}

export interface ProjectionResult {
  donationsUpserted: number;
  statsUpdated: number;
  campaignsPublished: number;
  campaignStatusUpdates: number;
  reportsUpdated: number;
  anomalies: Anomaly[];
}

const DONATION_STATUS = {
  OBSERVED: "PENDING",
  CONFIRMED: "CONFIRMED",
  ORPHANED: "ORPHANED",
} as const;

export async function projectAll(
  db: ClientBase,
  rpc: ChainRpc,
  args: { chainId: number; registry: Address; usdc: Address; confirmedHead: bigint },
): Promise<ProjectionResult> {
  const result: ProjectionResult = {
    donationsUpserted: 0,
    statsUpdated: 0,
    campaignsPublished: 0,
    campaignStatusUpdates: 0,
    reportsUpdated: 0,
    anomalies: [],
  };
  await publishCampaigns(db, rpc, args, result);
  await applyCampaignStatuses(db, args.chainId, result);
  const wallets = await projectDonations(db, rpc, args, result);
  await refreshStats(db, args.chainId, wallets, args.confirmedHead, result);
  await projectReports(db, args.chainId, result);
  await detectOrphanedPublications(db, args.chainId, result);
  return result;
}

// ------------------------------------------------------------------------------------ kampanie

async function publishCampaigns(
  db: ClientBase,
  rpc: ChainRpc,
  args: { chainId: number; registry: Address },
  out: ProjectionResult,
): Promise<void> {
  const events = await db.query<{
    tx_hash: string;
    block_number: string;
    args: Record<string, string>;
  }>(
    `select e.tx_hash, e.block_number::text, e.args from public.chain_events e
      where e.chain_id = $1 and e.event_name = 'CampaignCreated' and e.canonical and e.confirmation_state = 'CONFIRMED'
        and not exists (select 1 from public.campaigns c where c.chain_id = e.chain_id
                         and c.onchain_campaign_id = (e.args ->> 'campaignId')::bigint)
      order by e.block_number, e.log_index`,
    [args.chainId],
  );
  for (const event of events.rows) {
    const campaignId = event.args.campaignId ?? "";
    const onchain = await rpc.getCampaign(
      args.registry,
      BigInt(campaignId),
      BigInt(event.block_number),
    );
    const candidates = await db.query<{ id: string }>(
      `select id from public.campaigns
        where chain_id = $1 and status = 'PUBLISHING' and onchain_campaign_id is null
          and beneficiary_lower = $2 and cap_raw = $3::numeric
          and metadata_hash = $4
          and start_at = to_timestamp($5::bigint) and end_at = to_timestamp($6::bigint)`,
      [
        args.chainId,
        onchain.beneficiary.toLowerCase(),
        onchain.capRaw.toString(),
        onchain.metadataHash.toLowerCase(),
        onchain.startAt.toString(),
        onchain.endAt.toString(),
      ],
    );
    if (candidates.rowCount === 0) {
      out.anomalies.push({
        kind: "CAMPAIGN_NO_MATCH",
        detail: `onchain #${campaignId} tx ${event.tx_hash}`,
      });
      continue;
    }
    if ((candidates.rowCount ?? 0) > 1) {
      out.anomalies.push({
        kind: "CAMPAIGN_AMBIGUOUS",
        detail: `onchain #${campaignId} tx ${event.tx_hash}`,
      });
      continue;
    }
    // Wyzwalacz bazy dodatkowo sprawdza zgodność ze zdarzeniem (AC-01).
    await db.query(
      `update public.campaigns set status = 'PUBLISHED', onchain_campaign_id = $2, published_tx_hash = $3 where id = $1`,
      [candidates.rows[0]?.id, campaignId, event.tx_hash],
    );
    out.campaignsPublished += 1;
  }
}

const CAMPAIGN_STATUS: Readonly<Record<string, string | undefined>> = {
  "1": "PUBLISHED",
  "2": "PAUSED",
  "3": "CLOSED",
};

async function applyCampaignStatuses(
  db: ClientBase,
  chainId: number,
  out: ProjectionResult,
): Promise<void> {
  // Ostatnie POTWIERDZONE zdarzenie zmiany statusu per kampania (kolejność: blok, log_index).
  const latest = await db.query<{ onchain_id: string; new_status: string }>(
    `select distinct on (e.args ->> 'campaignId') e.args ->> 'campaignId' as onchain_id, e.args ->> 'newStatus' as new_status
       from public.chain_events e
      where e.chain_id = $1 and e.event_name = 'CampaignStatusChanged' and e.canonical and e.confirmation_state = 'CONFIRMED'
      order by e.args ->> 'campaignId', e.block_number desc, e.log_index desc`,
    [chainId],
  );
  for (const row of latest.rows) {
    const target = CAMPAIGN_STATUS[row.new_status];
    if (target === undefined) continue;
    const updated = await db.query(
      `update public.campaigns set status = $3::app.campaign_status
        where chain_id = $1 and onchain_campaign_id = $2::bigint and status <> $3::app.campaign_status
          and status in ('PUBLISHED', 'PAUSED', 'CLOSED')`,
      [chainId, row.onchain_id, target],
    );
    out.campaignStatusUpdates += updated.rowCount ?? 0;
  }
}

async function detectOrphanedPublications(
  db: ClientBase,
  chainId: number,
  out: ProjectionResult,
): Promise<void> {
  // Kampania pokazana jako opublikowana, ale zdarzenie CampaignCreated przestało być potwierdzone: NIE cofamy
  // widoczności automatycznie (decyzja operatora), tylko zgłaszamy.
  const rows = await db.query<{ id: string; published_tx_hash: string }>(
    `select c.id, c.published_tx_hash from public.campaigns c
      where c.chain_id = $1 and c.status in ('PUBLISHED', 'PAUSED', 'CLOSED')
        and not exists (select 1 from public.chain_events e where e.chain_id = c.chain_id and e.tx_hash = c.published_tx_hash
                         and e.event_name = 'CampaignCreated' and e.canonical and e.confirmation_state = 'CONFIRMED')`,
    [chainId],
  );
  for (const row of rows.rows) {
    out.anomalies.push({
      kind: "PUBLISHED_ON_ORPHANED_EVENT",
      detail: `campaign ${row.id} tx ${row.published_tx_hash}`,
    });
  }
}

// ------------------------------------------------------------------------------------ darowizny

async function projectDonations(
  db: ClientBase,
  rpc: ChainRpc,
  args: { chainId: number; usdc: Address },
  out: ProjectionResult,
): Promise<Set<string>> {
  const affected = new Set<string>();
  // Zdarzenia bez wiersza donations albo z niezgodnym statusem (reorg, potwierdzenie).
  const events = await db.query<{
    id: string;
    block_number: string;
    confirmation_state: "OBSERVED" | "CONFIRMED" | "ORPHANED";
    args: Record<string, string>;
  }>(
    `select e.id, e.block_number::text, e.confirmation_state, e.args from public.chain_events e
       left join public.donations d on d.chain_event_id = e.id
      where e.chain_id = $1 and e.event_name = 'DonationReceived'
        and (d.id is null or d.status::text <> case e.confirmation_state when 'OBSERVED' then 'PENDING' else e.confirmation_state::text end)
      order by e.block_number, e.log_index`,
    [args.chainId],
  );
  const blockTime = new Map<string, bigint>();
  for (const event of events.rows) {
    const onchainId = event.args.campaignId ?? "";
    const campaign = await db.query<{ id: string }>(
      "select id from public.campaigns where chain_id = $1 and onchain_campaign_id = $2::bigint",
      [args.chainId, onchainId],
    );
    const campaignRow = campaign.rows[0];
    if (campaignRow === undefined) {
      out.anomalies.push({
        kind: "UNKNOWN_CAMPAIGN_FOR_DONATION",
        detail: `onchain #${onchainId} event ${event.id}`,
      });
      continue;
    }
    let time = blockTime.get(event.block_number);
    if (time === undefined) {
      const block = await rpc.getBlock(BigInt(event.block_number));
      // Blok już niedostępny (np. po reorgu) — czas z poprzedniego zapisu albo bieżący; status zadecyduje ORPHANED.
      time = block?.timestamp ?? BigInt(Math.floor(Date.now() / 1000));
      blockTime.set(event.block_number, time);
    }
    const donor = event.args.donor ?? "";
    await db.query(
      `insert into public.donations
         (chain_event_id, campaign_id, chain_id, onchain_campaign_id, donor_wallet_lower, beneficiary_lower,
          token_address_lower, amount_raw, block_time, status)
       values ($1, $2, $3, $4::bigint, $5, $6, $7, $8::numeric, to_timestamp($9::bigint), $10::app.donation_status)
       on conflict (chain_event_id) do update set status = excluded.status, block_time = excluded.block_time`,
      [
        event.id,
        campaignRow.id,
        args.chainId,
        onchainId,
        donor,
        event.args.beneficiary ?? "",
        args.usdc.toLowerCase(),
        event.args.amountRaw ?? "0",
        time.toString(),
        DONATION_STATUS[event.confirmation_state],
      ],
    );
    out.donationsUpserted += 1;
    affected.add(donor);
  }
  return affected;
}

async function refreshStats(
  db: ClientBase,
  chainId: number,
  wallets: Set<string>,
  confirmedHead: bigint,
  out: ProjectionResult,
): Promise<void> {
  if (wallets.size === 0) return;
  // total = suma POTWIERDZONYCH darowizn; xp/tier liczą funkcje SQL (lustro reguł PRD, constraint w bazie).
  const result = await db.query(
    `insert into public.donor_stats (chain_id, wallet_lower, total_donated_raw, xp, tier, derived_at, source_block_number)
     select $1, w.wallet,
            coalesce(sum(d.amount_raw) filter (where d.status = 'CONFIRMED'), 0),
            app.xp_from_raw(coalesce(sum(d.amount_raw) filter (where d.status = 'CONFIRMED'), 0)),
            app.tier_from_raw(coalesce(sum(d.amount_raw) filter (where d.status = 'CONFIRMED'), 0)),
            now(), $3
       from unnest($2::text[]) as w(wallet)
       left join public.donations d on d.chain_id = $1 and d.donor_wallet_lower = w.wallet
      group by w.wallet
     on conflict (chain_id, wallet_lower) do update
        set total_donated_raw = excluded.total_donated_raw, xp = excluded.xp, tier = excluded.tier,
            derived_at = excluded.derived_at, source_block_number = excluded.source_block_number`,
    [chainId, [...wallets], confirmedHead.toString()],
  );
  out.statsUpdated += result.rowCount ?? 0;
}

// ------------------------------------------------------------------------------------ raporty

const REPORT_DECISION: Readonly<Record<string, string | undefined>> = {
  "1": "VERIFIED",
  "2": "REJECTED",
  "3": "REVOKED",
};

async function projectReports(
  db: ClientBase,
  chainId: number,
  out: ProjectionResult,
): Promise<void> {
  const published = await db.query<{ tx_hash: string; args: Record<string, string> }>(
    `select e.tx_hash, e.args from public.chain_events e
      where e.chain_id = $1 and e.event_name = 'ReportPublished' and e.canonical and e.confirmation_state = 'CONFIRMED'
        and not exists (select 1 from public.impact_reports r join public.campaigns c on c.id = r.campaign_id
                         where c.chain_id = e.chain_id and r.onchain_report_id = (e.args ->> 'reportId')::bigint)
      order by e.block_number, e.log_index`,
    [chainId],
  );
  for (const event of published.rows) {
    const a = event.args;
    const updated = await db.query(
      `update public.impact_reports r
          set status = 'PUBLISHED', onchain_report_id = $3::bigint, publish_tx_hash = $4,
              public_uri = $5, content_sha256 = $6
        from public.campaigns c
       where c.id = r.campaign_id and c.chain_id = $1 and c.onchain_campaign_id = $2::bigint
         and r.version = $7::int and r.status = 'REDACTING' and r.onchain_report_id is null
         and (r.content_sha256 is null or r.content_sha256 = $6)`,
      [chainId, a.campaignId, a.reportId, event.tx_hash, a.publicUri, a.contentSha256, a.version],
    );
    if ((updated.rowCount ?? 0) === 0) {
      out.anomalies.push({
        kind: "REPORT_NO_MATCH",
        detail: `onchain report #${a.reportId ?? "?"} tx ${event.tx_hash}`,
      });
    } else out.reportsUpdated += 1;
  }

  const latest = await db.query<{ report_id: string; decision: string; tx_hash: string }>(
    `select distinct on (e.args ->> 'reportId') e.args ->> 'reportId' as report_id, e.args ->> 'decision' as decision, e.tx_hash
       from public.chain_events e
      where e.chain_id = $1 and e.event_name = 'ReportReviewed' and e.canonical and e.confirmation_state = 'CONFIRMED'
      order by e.args ->> 'reportId', e.block_number desc, e.log_index desc`,
    [chainId],
  );
  for (const row of latest.rows) {
    const target = REPORT_DECISION[row.decision];
    if (target === undefined) continue;
    const updated = await db.query(
      `update public.impact_reports r set status = $3::app.report_status, review_tx_hash = $4
         from public.campaigns c
        where c.id = r.campaign_id and c.chain_id = $1 and r.onchain_report_id = $2::bigint
          and r.status <> $3::app.report_status and r.status in ('PUBLISHED', 'VERIFIED')
          and app.report_transition_allowed(r.status, $3::app.report_status)`,
      [chainId, row.report_id, target, row.tx_hash],
    );
    out.reportsUpdated += updated.rowCount ?? 0;
  }
}
