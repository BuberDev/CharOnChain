/**
 * Testy integracyjne migracji 0004_reports_assets_audit_auth (COC-022) na PRAWDZIWYM Postgresie.
 * Pokrywają: AC-22..24 (raporty: wersje, niemutowalność, dowód z łańcucha), AC-23 (rozdzielone role),
 * AC-26 (nonce SIWE jednorazowy i atomowy, sesje), audyt append-only, walidację zasobów, prywatność profili,
 * RLS deny-by-default i rollback migracji.
 */
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadMigrations } from "./migrations.js";
import { findTablesWithoutRls, migrateDown, migrateUp } from "./runner.js";
import {
  adminUrl,
  catalogSnapshot,
  createTempDatabase,
  ensureRole,
  type TempDatabase,
  withDatabase,
} from "./testing/db.js";
import {
  createOrganization,
  createPublishedCampaign,
  hexAddr,
  hexHash,
  nextId,
} from "./testing/fixtures.js";

const MIGRATIONS_DIR = new URL("../migrations", import.meta.url).pathname;
const SHA_A = `0x${"a".repeat(64)}`;

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

// ------------------------------------------------------------------------------------------------ assets

async function insertAsset(
  overrides: Record<string, string | number | null> = {},
): Promise<string> {
  const row = {
    bucket: "public-campaign-assets",
    object_path: `img/${String(nextId())}.png`,
    mime: "image/png",
    size_bytes: 1000,
    visibility: "PUBLIC",
    scan_status: "CLEAN",
    ...overrides,
  };
  const result = await client.query<{ id: string }>(
    `insert into public.assets (bucket, object_path, mime, size_bytes, sha256, visibility, scan_status)
     values ($1, $2, $3, $4, $5, $6::app.asset_visibility, $7) returning id`,
    [
      row.bucket,
      row.object_path,
      row.mime,
      row.size_bytes,
      hexHash(nextId()),
      row.visibility,
      row.scan_status,
    ],
  );
  return result.rows[0]?.id ?? "";
}

describe("assets", () => {
  it("widoczność wynika z koszyka; publiczny plik wymaga czystego skanu", async () => {
    await insertAsset();
    await insertAsset({
      bucket: "private-organization-docs",
      visibility: "PRIVATE",
      mime: "application/pdf",
      scan_status: "PENDING",
    });
    await expectPgError(() => insertAsset({ visibility: "PRIVATE" }), "23514"); // public-* jako PRIVATE
    await expectPgError(() => insertAsset({ bucket: "private-organization-docs" }), "23514"); // private-* jako PUBLIC
    await expectPgError(() => insertAsset({ scan_status: "PENDING" }), "23514");
    await expectPgError(() => insertAsset({ scan_status: "INFECTED" }), "23514");
    await expectPgError(() => insertAsset({ bucket: "inny-koszyk" }), "23514");
  });

  it("odrzuca ścieżki z traversal, bezwzględne i puste oraz duplikaty (bucket, path)", async () => {
    for (const path of ["../x.png", "a/../b.png", "/abs.png", "a//b.png", "a\\b.png", ""]) {
      await expectPgError(() => insertAsset({ object_path: path }), "23514");
    }
    await insertAsset({ object_path: "stala/sciezka.png" });
    await expectPgError(() => insertAsset({ object_path: "stala/sciezka.png" }), "23505");
  });

  it("limity rozmiaru (obraz 10 MB, dokument 20 MB) i dozwolone typy MIME", async () => {
    await insertAsset({ size_bytes: 10485760 });
    await expectPgError(() => insertAsset({ size_bytes: 10485761 }), "23514");
    await insertAsset({
      bucket: "public-report-attachments",
      mime: "application/pdf",
      size_bytes: 20971520,
    });
    await expectPgError(
      () =>
        insertAsset({
          bucket: "public-report-attachments",
          mime: "application/pdf",
          size_bytes: 20971521,
        }),
      "23514",
    );
    await expectPgError(() => insertAsset({ size_bytes: 0 }), "23514");
    await expectPgError(() => insertAsset({ mime: "image/svg+xml" }), "23514"); // SVG może zawierać skrypty
    await expectPgError(() => insertAsset({ mime: "text/html" }), "23514");
  });

  it("okładką kampanii może być tylko publiczny obraz", async () => {
    const org = await createOrganization(client);
    const campaign = await createPublishedCampaign(client, {
      organization: org,
      onchainCampaignId: 601,
    });
    const image = await insertAsset();
    const privateDoc = await insertAsset({
      bucket: "private-organization-docs",
      visibility: "PRIVATE",
      mime: "application/pdf",
      scan_status: "CLEAN",
    });
    const publicPdf = await insertAsset({
      bucket: "public-report-attachments",
      mime: "application/pdf",
    });

    await client.query("update public.campaigns set cover_asset_id = $2 where id = $1", [
      campaign.id,
      image,
    ]);
    await expectPgError(
      () =>
        client.query("update public.campaigns set cover_asset_id = $2 where id = $1", [
          campaign.id,
          privateDoc,
        ]),
      "23514",
    );
    await expectPgError(
      () =>
        client.query("update public.campaigns set cover_asset_id = $2 where id = $1", [
          campaign.id,
          publicPdf,
        ]),
      "23514",
    );
    await expectPgError(
      () =>
        client.query(
          "update public.campaigns set cover_asset_id = '00000000-0000-0000-0000-000000000000' where id = $1",
          [campaign.id],
        ),
      "23503",
    );
  });
});

// ------------------------------------------------------------------------------------------------ reports

async function insertReport(
  campaignId: string,
  version: number,
  createdBy = hexAddr(0x7e57),
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into public.impact_reports (campaign_id, version, period_start, period_end, created_by)
     values ($1, $2, '2026-11-01', '2027-02-28', $3) returning id`,
    [campaignId, version, createdBy],
  );
  return result.rows[0]?.id ?? "";
}

async function insertEvent(
  args: Record<string, string>,
  name: string,
  chainId: number,
  state: "OBSERVED" | "CONFIRMED" | "ORPHANED" = "CONFIRMED",
): Promise<string> {
  const tx = hexHash(nextId());
  await client.query(
    `insert into public.chain_events
       (chain_id, contract_lower, event_name, tx_hash, log_index, block_number, block_hash, tx_index, args,
        canonical, confirmation_state, confirmed_at)
     values ($1, $2, $3, $4, 0, 200, $5, 0, $6::jsonb, $7, $8::app.confirmation_state, $9)`,
    [
      chainId,
      hexAddr(0x1ac7),
      name,
      tx,
      hexHash(nextId()),
      JSON.stringify(args),
      state !== "ORPHANED",
      state,
      state === "CONFIRMED" ? new Date().toISOString() : null,
    ],
  );
  return tx;
}

async function reportReadyToPublish(onchainReportId: number, onchainCampaignId: number) {
  const campaign = await createPublishedCampaign(client, { onchainCampaignId });
  const reportId = await insertReport(campaign.id, 1);
  await client.query("update public.impact_reports set status = 'SUBMITTED' where id = $1", [
    reportId,
  ]);
  await client.query("update public.impact_reports set status = 'REDACTING' where id = $1", [
    reportId,
  ]);
  const publishTx = await insertEvent(
    {
      reportId: String(onchainReportId),
      campaignId: String(onchainCampaignId),
      contentSha256: SHA_A,
      publicUri: "ipfs://x",
      version: "1",
    },
    "ReportPublished",
    campaign.organization.chainId,
  );
  return { campaign, reportId, publishTx, onchainReportId };
}

const publish = (reportId: string, onchainReportId: number, tx: string, sha = SHA_A) =>
  client.query(
    `update public.impact_reports
        set status = 'PUBLISHED', public_uri = 'ipfs://x', content_sha256 = $4, onchain_report_id = $2, publish_tx_hash = $3
      where id = $1`,
    [reportId, onchainReportId, tx, sha],
  );

describe("impact_reports (AC-22, AC-24, INV-09)", () => {
  it("raport tylko do opublikowanej kampanii; startuje jako DRAFT bez faktów z łańcucha", async () => {
    const org = await createOrganization(client);
    const draftCampaign = await client.query<{ id: string }>(
      `insert into public.campaigns (organization_id, chain_id, slug, title, cap_raw, start_at, end_at, beneficiary_lower, created_by_wallet_lower)
       values ($1, 421614, $2, 'T', 1, now(), now() + interval '1 day', $3, $4) returning id`,
      [org.id, `r-${String(nextId())}`, org.safe, hexAddr(0xc0de)],
    );
    await expectPgError(
      () => insertReport(draftCampaign.rows[0]?.id ?? "", 1),
      "23514",
      /opublikowanej kampanii/,
    );

    const campaign = await createPublishedCampaign(client, { onchainCampaignId: 611 });
    await expectPgError(
      () =>
        client.query(
          `insert into public.impact_reports (campaign_id, version, status, period_start, period_end, created_by)
           values ($1, 1, 'PUBLISHED', '2026-11-01', '2027-01-01', $2)`,
          [campaign.id, hexAddr(0x1)],
        ),
      "23514",
    );
    await insertReport(campaign.id, 1);
  });

  it("wersje rosną o 1 bez luk i powtórzeń; okres końcowy nie przed początkowym", async () => {
    const campaign = await createPublishedCampaign(client, { onchainCampaignId: 612 });
    await expectPgError(() => insertReport(campaign.id, 2), "23514", /Oczekiwana wersja/);
    await insertReport(campaign.id, 1);
    await expectPgError(() => insertReport(campaign.id, 1), "23514");
    await expectPgError(() => insertReport(campaign.id, 3), "23514");
    await insertReport(campaign.id, 2);
    await expectPgError(
      () =>
        client.query(
          `insert into public.impact_reports (campaign_id, version, period_start, period_end, created_by)
           values ($1, 3, '2027-03-01', '2027-02-01', $2)`,
          [campaign.id, hexAddr(0x1)],
        ),
      "23514",
    );
  });

  it("dozwolone przejścia statusu; REJECTED i REVOKED są ostateczne", async () => {
    const campaign = await createPublishedCampaign(client, { onchainCampaignId: 613 });
    const id = await insertReport(campaign.id, 1);
    const set = (status: string) =>
      client.query(
        "update public.impact_reports set status = $2::app.report_status where id = $1",
        [id, status],
      );
    await expectPgError(() => set("PUBLISHED"), "23514", /Niedozwolone przej/); // DRAFT -> PUBLISHED
    await expectPgError(() => set("VERIFIED"), "23514", /Niedozwolone przej/);
    await set("SUBMITTED");
    await set("DRAFT");
    await set("SUBMITTED");
    await set("REJECTED");
    for (const to of ["DRAFT", "SUBMITTED", "REDACTING", "PUBLISHED", "VERIFIED"]) {
      await expectPgError(() => set(to), "23514", /Niedozwolone przej/);
    }
  });

  it("PUBLISHED wymaga dowodu: pól publicznych, potwierdzonego zdarzenia i zgodnych danych (AC-24)", async () => {
    const ready = await reportReadyToPublish(21, 614);
    // brak pól dowodowych
    await expectPgError(
      () =>
        client.query("update public.impact_reports set status = 'PUBLISHED' where id = $1", [
          ready.reportId,
        ]),
      "23514",
    );
    // hash niezgodny ze zdarzeniem (modyfikacja 1 bajtu => mismatch)
    await expectPgError(
      () => publish(ready.reportId, 21, ready.publishTx, `0x${"a".repeat(63)}b`),
      "23514",
      /ReportPublished/,
    );
    // niezgodny identyfikator raportu
    await expectPgError(() => publish(ready.reportId, 22, ready.publishTx), "23514");
    // zdarzenie nieistniejące
    await expectPgError(() => publish(ready.reportId, 21, hexHash(nextId())), "23514");
    // poprawne
    await publish(ready.reportId, 21, ready.publishTx);
  });

  it("zdarzenie OBSERVED albo ORPHANED nie wystarcza do publikacji", async () => {
    for (const state of ["OBSERVED", "ORPHANED"] as const) {
      const n = 700 + nextId();
      const campaign = await createPublishedCampaign(client, { onchainCampaignId: n });
      const reportId = await insertReport(campaign.id, 1);
      await client.query("update public.impact_reports set status = 'SUBMITTED' where id = $1", [
        reportId,
      ]);
      await client.query("update public.impact_reports set status = 'REDACTING' where id = $1", [
        reportId,
      ]);
      const tx = await insertEvent(
        {
          reportId: "30",
          campaignId: String(n),
          contentSha256: SHA_A,
          publicUri: "ipfs://x",
          version: "1",
        },
        "ReportPublished",
        campaign.organization.chainId,
        state,
      );
      await expectPgError(() => publish(reportId, 30, tx), "23514");
    }
  });

  it("opublikowany raport jest niemutowalny (hash, URI, wersja, okres); korekta to nowa wersja (AC-22)", async () => {
    const ready = await reportReadyToPublish(23, 615);
    await publish(ready.reportId, 23, ready.publishTx);
    const updates: [string, unknown[]][] = [
      ["content_sha256 = $2", [`0x${"b".repeat(64)}`]],
      ["public_uri = $2", ["ipfs://inny"]],
      ["public_json_storage_path = $2", ["reports/inny.json"]],
      ["onchain_report_id = $2", [99]],
      ["publish_tx_hash = $2", [hexHash(5)]],
      ["version = $2", [9]],
      ["campaign_id = $2", ["00000000-0000-0000-0000-000000000000"]],
      ["created_by = $2", [hexAddr(0xbad)]],
      ["period_end = period_end + 1", []],
    ];
    for (const [setClause, params] of updates) {
      await expectPgError(
        () =>
          client.query(`update public.impact_reports set ${setClause} where id = $1`, [
            ready.reportId,
            ...params,
          ]),
        "23514",
      );
    }
    // korekta = następna wersja, stary hash i URI zostają
    await insertReport(ready.campaign.id, 2);
    const old = await client.query<{ content_sha256: string; public_uri: string }>(
      "select content_sha256, public_uri from public.impact_reports where id = $1",
      [ready.reportId],
    );
    expect(old.rows[0]).toEqual({ content_sha256: SHA_A, public_uri: "ipfs://x" });
  });

  it("VERIFIED i REVOKED wymagają potwierdzonego ReportReviewed z właściwą decyzją", async () => {
    const ready = await reportReadyToPublish(24, 616);
    await publish(ready.reportId, 24, ready.publishTx);
    const chainId = ready.campaign.organization.chainId;
    const verify = (tx: string) =>
      client.query(
        "update public.impact_reports set status = 'VERIFIED', review_tx_hash = $2 where id = $1",
        [ready.reportId, tx],
      );
    await expectPgError(
      () =>
        client.query("update public.impact_reports set status = 'VERIFIED' where id = $1", [
          ready.reportId,
        ]),
      "23514",
    ); // brak review_tx_hash
    const wrongDecision = await insertEvent(
      { reportId: "24", decision: "2", reasonHash: hexHash(1) },
      "ReportReviewed",
      chainId,
    );
    await expectPgError(() => verify(wrongDecision), "23514");
    const verified = await insertEvent(
      { reportId: "24", decision: "1", reasonHash: hexHash(0) },
      "ReportReviewed",
      chainId,
    );
    await verify(verified);

    const revokeTx = await insertEvent(
      { reportId: "24", decision: "3", reasonHash: hexHash(2) },
      "ReportReviewed",
      chainId,
    );
    await expectPgError(
      () =>
        client.query(
          "update public.impact_reports set status = 'REVOKED', review_tx_hash = $2 where id = $1",
          [ready.reportId, verified],
        ),
      "23514",
    ); // zdarzenie VERIFIED nie odwołuje
    await client.query(
      "update public.impact_reports set status = 'REVOKED', review_tx_hash = $2 where id = $1",
      [ready.reportId, revokeTx],
    );
    await expectPgError(
      () =>
        client.query("update public.impact_reports set review_tx_hash = $2 where id = $1", [
          ready.reportId,
          verified,
        ]),
      "23514",
    );
  });

  it("raportów nie można usunąć", async () => {
    const campaign = await createPublishedCampaign(client, { onchainCampaignId: 617 });
    const id = await insertReport(campaign.id, 1);
    await expectPgError(
      () => client.query("delete from public.impact_reports where id = $1", [id]),
      "23514",
      /Usuwanie/,
    );
  });
});

describe("impact_report_reviews (AC-23)", () => {
  it("recenzent nie jest autorem ani aktywnym członkiem organizacji; powód wymagany przy odrzuceniu; append-only", async () => {
    const campaign = await createPublishedCampaign(client, { onchainCampaignId: 618 });
    const author = hexAddr(0xa07);
    const reportId = await insertReport(campaign.id, 1, author);
    const member = hexAddr(0xfeed02);
    await client.query(
      "insert into public.organization_members (organization_id, wallet_lower, role) values ($1, $2, 'REPORTER')",
      [campaign.organization.id, member],
    );
    const review = (reviewer: string, decision: string, reason: string | null) =>
      client.query(
        `insert into public.impact_report_reviews (report_id, reviewer, decision, reason_public)
         values ($1, $2, $3::app.report_decision, $4) returning id`,
        [reportId, reviewer, decision, reason],
      );
    await expectPgError(() => review(author, "VERIFIED", null), "23514", /Autor raportu/);
    await expectPgError(() => review(member, "VERIFIED", null), "23514", /Członek organizacji/);
    await expectPgError(() => review(hexAddr(0xe1), "REJECTED", null), "23514");
    await expectPgError(() => review(hexAddr(0xe1), "REVOKED", "   "), "23514");
    const ok = await review(hexAddr(0xe1), "REJECTED", "Brak dokumentów");
    const id = (ok.rows[0] as { id: string }).id;
    await expectPgError(
      () =>
        client.query(
          "update public.impact_report_reviews set decision = 'VERIFIED' where id = $1",
          [id],
        ),
      "23514",
      /append-only/,
    );
    await expectPgError(
      () => client.query("delete from public.impact_report_reviews where id = $1", [id]),
      "23514",
      /append-only/,
    );
  });
});

// ------------------------------------------------------------------------------------------------ abuse / audit

describe("abuse_reports", () => {
  it("zgłoszenie może być anonimowe; obsłużone wymaga obsługującego i czasu; limit załączników", async () => {
    const ins = () =>
      client.query(
        `insert into public.abuse_reports (category, details_private) values ('FRAUD', 'Szczegóły') returning id`,
      );
    const created = await ins();
    const id = (created.rows[0] as { id: string }).id;
    await expectPgError(
      () => client.query("update public.abuse_reports set status = 'TRIAGED' where id = $1", [id]),
      "23514",
    );
    await client.query(
      "update public.abuse_reports set status = 'TRIAGED', handled_by = $2, handled_at = now() where id = $1",
      [id, hexAddr(0xad)],
    );
    await expectPgError(
      () => client.query("update public.abuse_reports set status = 'OPEN' where id = $1", [id]),
      "23514",
    ); // OPEN z handled_by
    const six = Array.from({ length: 6 }, () => "00000000-0000-0000-0000-000000000001");
    await expectPgError(
      () =>
        client.query(
          "insert into public.abuse_reports (category, details_private, attachment_asset_ids) values ('OTHER', 'x', $1::uuid[])",
          [six],
        ),
      "23514",
    );
    await expectPgError(
      () =>
        client.query(
          "insert into public.abuse_reports (category, details_private) values ('OTHER', '   ')",
        ),
      "23514",
    );
  });
});

describe("audit_logs — append-only", () => {
  const insert = (actorType: string, wallet: string | null) =>
    client.query(
      `insert into public.audit_logs (actor_wallet_lower, actor_type, action, entity_type, entity_id, after_json, request_id)
       values ($1, $2::app.actor_type, 'CAMPAIGN.REVIEWED', 'campaigns', 'abc', '{"x":1}'::jsonb, 'req_1') returning id`,
      [wallet, actorType],
    );

  it("zapis ludzki wymaga adresu aktora; SYSTEM/INDEXER bez adresu", async () => {
    await insert("ADMIN", hexAddr(0xa1));
    await insert("SYSTEM", null);
    await insert("INDEXER", null);
    await expectPgError(() => insert("ADMIN", null), "23514");
    await expectPgError(() => insert("USER", null), "23514");
  });

  it("format akcji i typu encji; UPDATE, DELETE i TRUNCATE są zabronione", async () => {
    const result = await insert("ADMIN", hexAddr(0xa1));
    const id = (result.rows[0] as { id: string }).id;
    await expectPgError(
      () => client.query("update public.audit_logs set action = 'X' where id = $1", [id]),
      "23514",
      /append-only/,
    );
    await expectPgError(
      () => client.query("delete from public.audit_logs where id = $1", [id]),
      "23514",
      /append-only/,
    );
    await expectPgError(() => client.query("truncate public.audit_logs"), "23514", /append-only/);
    await expectPgError(
      () =>
        client.query(
          `insert into public.audit_logs (actor_type, action, entity_type, entity_id) values ('SYSTEM', 'zla akcja', 'campaigns', '1')`,
        ),
      "23514",
    );
    await expectPgError(
      () =>
        client.query(
          `insert into public.audit_logs (actor_type, action, entity_type, entity_id) values ('SYSTEM', 'A', 'Bad-Type', '1')`,
        ),
      "23514",
    );
  });
});

// ------------------------------------------------------------------------------------------------ SIWE / sesje

const nonceHash = (): string => nextId().toString(16).padStart(64, "0");

async function insertNonce(
  overrides: {
    hash?: string;
    ttlMinutes?: number;
    domain?: string;
    chainId?: number;
    wallet?: string | null;
  } = {},
): Promise<string> {
  const hash = overrides.hash ?? nonceHash();
  await client.query(
    `insert into public.siwe_nonces (nonce_hash, wallet_lower, domain, chain_id, issued_at, expires_at)
     values ($1, $2, $3, $4, now(), now() + make_interval(mins => $5))`,
    [
      hash,
      overrides.wallet ?? null,
      overrides.domain ?? "charonchain.example",
      overrides.chainId ?? 421614,
      overrides.ttlMinutes ?? 5,
    ],
  );
  return hash;
}

const consume = (
  c: Client,
  hash: string,
  domain = "charonchain.example",
  chainId = 421614,
  wallet = hexAddr(0xa1),
): Promise<boolean> =>
  c
    .query<{ ok: boolean }>("select app.consume_siwe_nonce($1, $2, $3, $4) as ok", [
      hash,
      domain,
      chainId,
      wallet,
    ])
    .then((r) => r.rows[0]?.ok ?? false);

describe("siwe_nonces (AC-26)", () => {
  it("TTL do 15 minut, hash 64 znaki hex, sieć ograniczona", async () => {
    await insertNonce({ ttlMinutes: 5 });
    await insertNonce({ ttlMinutes: 15 });
    await expectPgError(() => insertNonce({ ttlMinutes: 16 }), "23514");
    await expectPgError(() => insertNonce({ ttlMinutes: 0 }), "23514");
    await expectPgError(() => insertNonce({ hash: "abc" }), "23514");
    await expectPgError(() => insertNonce({ hash: "G".repeat(64) }), "23514");
    await expectPgError(() => insertNonce({ chainId: 1 }), "23514");
    const dup = nonceHash();
    await insertNonce({ hash: dup });
    await expectPgError(() => insertNonce({ hash: dup }), "23505");
  });

  it("nonce zużywa się dokładnie raz; replay zwraca false", async () => {
    const hash = await insertNonce();
    expect(await consume(client, hash)).toBe(true);
    expect(await consume(client, hash)).toBe(false);
    expect(await consume(client, hash)).toBe(false);
  });

  it("zła domena, sieć, portfel powiązany z nonce albo wygasły nonce nie są zużywane", async () => {
    const hash = await insertNonce({ wallet: hexAddr(0xa1) });
    expect(await consume(client, hash, "zla-domena.example")).toBe(false);
    expect(await consume(client, hash, "charonchain.example", 42161)).toBe(false);
    expect(await consume(client, hash, "charonchain.example", 421614, hexAddr(0xb2))).toBe(false);
    expect(await consume(client, hash)).toBe(true); // nadal ważny: nieudane próby go nie spalają
    const expired = nonceHash();
    await client.query(
      `insert into public.siwe_nonces (nonce_hash, domain, chain_id, issued_at, expires_at)
       values ($1, 'charonchain.example', 421614, now() - interval '10 minutes', now() - interval '5 minutes')`,
      [expired],
    );
    expect(await consume(client, expired)).toBe(false);
  });

  it("równoległe zużycie: z 10 prób dokładnie jedna się udaje (atomowość)", async () => {
    const hash = await insertNonce();
    const clients = await Promise.all(
      Array.from({ length: 10 }, async () => {
        const c = new Client({ connectionString: withDatabase(adminUrl(), temp.name) });
        await c.connect();
        return c;
      }),
    );
    try {
      const results = await Promise.all(clients.map((c) => consume(c, hash)));
      expect(results.filter(Boolean)).toHaveLength(1);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });
});

describe("sessions", () => {
  const insertSession = (tokenHash: string, ttl: string, extra = ""): Promise<unknown> =>
    client.query(
      `insert into public.sessions (token_hash, wallet_lower, expires_at ${extra}) values ($1, $2, now() + $3::interval)`,
      [tokenHash, hexAddr(0xa1), ttl],
    );

  it("token tylko jako hash, TTL do 30 dni, unikalność", async () => {
    const hash = nonceHash();
    await insertSession(hash, "7 days");
    await expectPgError(() => insertSession(hash, "7 days"), "23505");
    await expectPgError(() => insertSession(nonceHash(), "31 days"), "23514");
    await expectPgError(() => insertSession(nonceHash(), "-1 hour"), "23514");
    await expectPgError(() => insertSession("surowy-token", "1 day"), "23514");
  });

  it("session_wallet zwraca portfel tylko dla aktywnej sesji (nie wygasłej ani odwołanej)", async () => {
    const active = nonceHash();
    await insertSession(active, "1 day");
    const wallet = async (h: string) =>
      (await client.query<{ w: string | null }>("select app.session_wallet($1) as w", [h])).rows[0]
        ?.w;
    expect(await wallet(active)).toBe(hexAddr(0xa1));
    await client.query("update public.sessions set revoked_at = now() where token_hash = $1", [
      active,
    ]);
    expect(await wallet(active)).toBeNull();
    expect(await wallet(nonceHash())).toBeNull();
    const expiring = nonceHash();
    await client.query(
      `insert into public.sessions (token_hash, wallet_lower, created_at, expires_at)
       values ($1, $2, now() - interval '2 days', now() - interval '1 day')`,
      [expiring, hexAddr(0xa1)],
    );
    expect(await wallet(expiring)).toBeNull();
  });

  it("purge_expired_auth usuwa tylko dawno nieaktualne nonce i sesje, nie dotyka audytu", async () => {
    const oldNonce = nonceHash();
    await client.query(
      `insert into public.siwe_nonces (nonce_hash, domain, chain_id, issued_at, expires_at)
       values ($1, 'd', 421614, now() - interval '2 days 5 minutes', now() - interval '2 days')`,
      [oldNonce],
    );
    const freshNonce = await insertNonce();
    const oldSession = nonceHash();
    await client.query(
      `insert into public.sessions (token_hash, wallet_lower, created_at, expires_at)
       values ($1, $2, now() - interval '90 days', now() - interval '60 days')`,
      [oldSession, hexAddr(0xa1)],
    );
    const liveSession = nonceHash();
    await insertSession(liveSession, "1 day");
    const auditBefore = await client.query<{ c: string }>(
      "select count(*)::text as c from public.audit_logs",
    );
    const removed = await client.query<{ n: number }>("select app.purge_expired_auth() as n");
    expect(removed.rows[0]?.n).toBeGreaterThanOrEqual(2);
    expect(
      (await client.query("select 1 from public.siwe_nonces where nonce_hash = $1", [oldNonce]))
        .rowCount,
    ).toBe(0);
    expect(
      (await client.query("select 1 from public.siwe_nonces where nonce_hash = $1", [freshNonce]))
        .rowCount,
    ).toBe(1);
    expect(
      (await client.query("select 1 from public.sessions where token_hash = $1", [oldSession]))
        .rowCount,
    ).toBe(0);
    expect(
      (await client.query("select 1 from public.sessions where token_hash = $1", [liveSession]))
        .rowCount,
    ).toBe(1);
    const auditAfter = await client.query<{ c: string }>(
      "select count(*)::text as c from public.audit_logs",
    );
    expect(auditAfter.rows[0]?.c).toBe(auditBefore.rows[0]?.c);
  });
});

// ------------------------------------------------------------------------------------------------ flagi, profile

describe("system_flags i donor_profiles", () => {
  it("flaga checkout_disabled istnieje i domyślnie jest wyłączona; format klucza", async () => {
    const row = await client.query<{ enabled: boolean }>(
      "select enabled from public.system_flags where key = 'checkout_disabled'",
    );
    expect(row.rows[0]?.enabled).toBe(false);
    await expectPgError(
      () => client.query("insert into public.system_flags (key) values ('Zly Klucz')"),
      "23514",
    );
  });

  it("profil domyślnie prywatny i poza rankingiem; walidacja nazwy i bio", async () => {
    await client.query(
      "insert into public.donor_profiles (chain_id, wallet_lower) values (421614, $1)",
      [hexAddr(0x9f)],
    );
    const row = await client.query<{ profile_public: boolean; leaderboard_opt_in: boolean }>(
      "select profile_public, leaderboard_opt_in from public.donor_profiles where wallet_lower = $1",
      [hexAddr(0x9f)],
    );
    expect(row.rows[0]).toEqual({ profile_public: false, leaderboard_opt_in: false });
    await expectPgError(
      () =>
        client.query(
          "insert into public.donor_profiles (chain_id, wallet_lower) values (421614, $1)",
          [hexAddr(0x9f)],
        ),
      "23505",
    );
    // ten sam portfel na innej sieci to osobna tożsamość (jeden portfel = jedna tożsamość NFT, ale per sieć)
    await client.query(
      "insert into public.donor_profiles (chain_id, wallet_lower) values (42161, $1)",
      [hexAddr(0x9f)],
    );
    await expectPgError(
      () =>
        client.query(
          "insert into public.donor_profiles (chain_id, wallet_lower, display_name) values (421614, $1, E'Zl\\x01y')",
          [hexAddr(0xa0)],
        ),
      "23514",
    );
    await expectPgError(
      () =>
        client.query(
          "insert into public.donor_profiles (chain_id, wallet_lower, display_name) values (421614, $1, '   ')",
          [hexAddr(0xa0)],
        ),
      "23514",
    );
    await expectPgError(
      () =>
        client.query(
          "insert into public.donor_profiles (chain_id, wallet_lower, bio) values (421614, $1, $2)",
          [hexAddr(0xa0), "x".repeat(501)],
        ),
      "23514",
    );
  });
});

// ------------------------------------------------------------------------------------------------ RLS

describe("brak publicznego dostępu — RLS deny-by-default", () => {
  const TABLES = [
    "assets",
    "impact_reports",
    "impact_report_reviews",
    "abuse_reports",
    "audit_logs",
    "siwe_nonces",
    "sessions",
    "system_flags",
    "donor_profiles",
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
    "nawet po nadaniu uprawnień %s nie czyta wrażliwych tabel (RLS)",
    async (role) => {
      await client.query("begin");
      try {
        await client.query(
          `grant select on ${TABLES.map((t) => `public.${t}`).join(", ")} to ${role}`,
        );
        await client.query(`set local role ${role}`);
        for (const table of TABLES) {
          const rows = await client.query(`select 1 from public.${table}`);
          expect(rows.rowCount, `${role} czyta ${table}`).toBe(0);
        }
      } finally {
        await client.query("rollback");
      }
    },
  );
});

describe("rollback migracji 0004", () => {
  it("down przywraca dokładnie stan po 0003; ponowne up działa", async () => {
    const migrations = loadMigrations(MIGRATIONS_DIR);
    const second = await createTempDatabase();
    const probe = new Client({ connectionString: second.url });
    await probe.connect();
    try {
      await ensureRole(probe, "anon");
      await ensureRole(probe, "authenticated");
      await migrateUp(probe, migrations.slice(0, 3));
      const afterThird = await catalogSnapshot(probe);
      await migrateUp(probe, migrations);
      const afterFourth = await catalogSnapshot(probe);
      expect(afterFourth).not.toEqual(afterThird);
      await migrateDown(probe, migrations, 1);
      expect(await catalogSnapshot(probe)).toEqual(afterThird);
      await migrateUp(probe, migrations);
      expect(await catalogSnapshot(probe)).toEqual(afterFourth);
    } finally {
      await probe.end();
      await second.drop();
    }
  });
});
