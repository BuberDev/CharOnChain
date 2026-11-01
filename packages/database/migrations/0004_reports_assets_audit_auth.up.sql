-- 0004_reports_assets_audit_auth (COC-022; docs/03 §2, §5, §7; AC-22..24, AC-26)
-- Raporty wpływu (+ recenzje), zasoby plików, zgłoszenia nadużyć, audyt (append-only), nonce SIWE
-- (jednorazowe, atomowe), sesje, flagi systemowe, profile darczyńców.
-- Konwencje `chain_events.args` (zapisuje indexer, COC-030): klucze jak w ABI, liczby jako ciągi dziesiętne,
-- adresy małymi literami. ReportPublished: {reportId, campaignId, contentSha256, publicUri, version};
-- ReportReviewed: {reportId, decision, reasonHash}.
-- RLS włączone, bez polityk (deny-by-default); polityki i role: COC-023.

create type app.asset_visibility as enum ('PUBLIC', 'PRIVATE');
create type app.report_status as enum (
  'DRAFT', 'SUBMITTED', 'REDACTING', 'PUBLISHED', 'VERIFIED', 'REJECTED', 'REVOKED'
);
create type app.report_decision as enum ('VERIFIED', 'REJECTED', 'REVOKED');
create type app.actor_type as enum ('USER', 'ADMIN', 'SYSTEM', 'INDEXER');
create type app.abuse_status as enum ('OPEN', 'TRIAGED', 'ACTION_TAKEN', 'DISMISSED');
create type app.abuse_category as enum ('FRAUD', 'IMPERSONATION', 'ILLEGAL_CONTENT', 'MISLEADING', 'OTHER');

-- ---------------------------------------------------------------------------------------------
-- assets (metadane plików; sam plik jest w Supabase Storage, COC-025)
-- ---------------------------------------------------------------------------------------------
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  bucket text not null check (bucket in (
    'public-campaign-assets', 'private-organization-docs', 'public-report-attachments', 'private-abuse-attachments'
  )),
  object_path text not null check (
    length(object_path) between 1 and 512 and object_path !~ '(^/|\.\.|//|\\)'
  ),
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520), -- 20 MB (dokument)
  sha256 app.hash32 not null,
  owner_org_id uuid references public.organizations (id) on delete restrict,
  visibility app.asset_visibility not null,
  scan_status text not null default 'PENDING' check (scan_status in ('PENDING', 'CLEAN', 'INFECTED', 'FAILED')),
  created_at timestamptz not null default now(),
  constraint assets_bucket_path_key unique (bucket, object_path),
  -- Widoczność wynika z koszyka: public-* to PUBLIC, private-* to PRIVATE (docs/03 §7).
  constraint assets_bucket_matches_visibility check ((bucket like 'public-%') = (visibility = 'PUBLIC')),
  -- Obraz do 10 MB (docs/03 §7).
  constraint assets_image_size check (mime = 'application/pdf' or size_bytes <= 10485760),
  -- Publiczny plik tylko po czystym skanie.
  constraint assets_public_is_clean check (visibility = 'PRIVATE' or scan_status = 'CLEAN')
);
create index assets_owner_idx on public.assets (owner_org_id);

-- Okładka kampanii: wyłącznie publiczny obraz.
create function app.campaigns_cover_guard() returns trigger
language plpgsql
as $$
declare
  asset public.assets%rowtype;
begin
  if new.cover_asset_id is not null then
    select * into asset from public.assets where id = new.cover_asset_id;
    if not found then
      raise exception 'Okładka wskazuje nieistniejący zasób' using errcode = '23503';
    end if;
    if asset.visibility <> 'PUBLIC' or asset.mime not like 'image/%' then
      raise exception 'Okładką może być tylko publiczny obraz' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger campaigns_cover_guard before insert or update of cover_asset_id on public.campaigns
  for each row execute function app.campaigns_cover_guard();

-- ---------------------------------------------------------------------------------------------
-- impact_reports / impact_report_reviews
-- ---------------------------------------------------------------------------------------------
create function app.report_transition_allowed(old_status app.report_status, new_status app.report_status)
returns boolean
language sql immutable parallel safe
as $$
  select old_status = new_status or (old_status, new_status) in (
    ('DRAFT', 'SUBMITTED'),
    ('SUBMITTED', 'DRAFT'),
    ('SUBMITTED', 'REDACTING'),
    ('SUBMITTED', 'REJECTED'),
    ('REDACTING', 'SUBMITTED'),
    ('REDACTING', 'PUBLISHED'),
    ('REDACTING', 'REJECTED'),
    ('PUBLISHED', 'VERIFIED'),
    ('PUBLISHED', 'REJECTED'),
    ('VERIFIED', 'REVOKED')
  )
$$;

create table public.impact_reports (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  version integer not null check (version >= 1),
  status app.report_status not null default 'DRAFT',
  public_json_storage_path text,
  public_uri text check (public_uri is null or length(public_uri) between 1 and 2048),
  content_sha256 app.hash32,
  onchain_report_id bigint check (onchain_report_id is null or onchain_report_id >= 1),
  publish_tx_hash app.hash32,
  review_tx_hash app.hash32,
  period_start date not null,
  period_end date not null,
  created_by app.evm_address not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint impact_reports_version_key unique (campaign_id, version),
  constraint impact_reports_onchain_key unique (campaign_id, onchain_report_id),
  constraint impact_reports_id_campaign_key unique (id, campaign_id),
  constraint impact_reports_period check (period_end >= period_start),
  -- Wersje publiczne mają treść i dowód on-chain; weryfikacja/odwołanie mają potwierdzoną decyzję.
  constraint impact_reports_published_has_proof check (
    status not in ('PUBLISHED', 'VERIFIED', 'REVOKED')
    or (public_uri is not null and content_sha256 is not null and onchain_report_id is not null and publish_tx_hash is not null)
  ),
  constraint impact_reports_decided_has_review_tx check (
    status not in ('VERIFIED', 'REVOKED') or review_tx_hash is not null
  )
);
create index impact_reports_campaign_version_idx on public.impact_reports (campaign_id, version desc);
create trigger impact_reports_touch_updated_at before update on public.impact_reports
  for each row execute function app.touch_updated_at();

create function app.impact_reports_guard() returns trigger
language plpgsql
as $$
declare
  camp public.campaigns%rowtype;
  expected_version integer;
  required_decision text;
begin
  select * into camp from public.campaigns where id = new.campaign_id;

  if tg_op = 'INSERT' then
    if new.status <> 'DRAFT' or new.onchain_report_id is not null or new.publish_tx_hash is not null
       or new.review_tx_hash is not null then
      raise exception 'Nowy raport musi być DRAFT bez danych z łańcucha' using errcode = '23514';
    end if;
    -- Raport dotyczy kampanii istniejącej on-chain (ImpactRegistry.publishReport wymaga istnienia kampanii).
    if camp.status not in ('PUBLISHED', 'PAUSED', 'CLOSED') then
      raise exception 'Raport można dodać tylko do opublikowanej kampanii' using errcode = '23514';
    end if;
    -- Wersje rosną o 1 bez luk (AC-22: korekta = następna wersja).
    select coalesce(max(version), 0) + 1 into expected_version
      from public.impact_reports where campaign_id = new.campaign_id;
    if new.version <> expected_version then
      raise exception 'Oczekiwana wersja raportu to %, otrzymano %', expected_version, new.version
        using errcode = '23514';
    end if;
    return new;
  end if;

  if not app.report_transition_allowed(old.status, new.status) then
    raise exception 'Niedozwolone przejście statusu raportu % -> %', old.status, new.status using errcode = '23514';
  end if;

  -- Tożsamość raportu jest niezmienna zawsze; treść publiczna i dowody — od momentu publikacji (INV-09, AC-22).
  if new.campaign_id <> old.campaign_id or new.version <> old.version or new.created_by <> old.created_by then
    raise exception 'campaign_id, version i created_by raportu są niezmienne' using errcode = '23514';
  end if;
  if old.status in ('PUBLISHED', 'VERIFIED', 'REVOKED') and (
       new.public_uri is distinct from old.public_uri
       or new.content_sha256 is distinct from old.content_sha256
       or new.public_json_storage_path is distinct from old.public_json_storage_path
       or new.onchain_report_id is distinct from old.onchain_report_id
       or new.publish_tx_hash is distinct from old.publish_tx_hash
       or new.period_start <> old.period_start or new.period_end <> old.period_end
     ) then
    raise exception 'Opublikowany raport jest niemutowalny — korekta to nowa wersja' using errcode = '23514';
  end if;
  if old.review_tx_hash is not null and new.review_tx_hash is distinct from old.review_tx_hash
     and old.status = 'REVOKED' then
    raise exception 'review_tx_hash odwołanego raportu jest niezmienny' using errcode = '23514';
  end if;

  -- Publikacja i decyzje wymagają potwierdzonego, kanonicznego zdarzenia z łańcucha o zgodnej treści.
  if new.status = 'PUBLISHED' and old.status <> 'PUBLISHED' then
    if not exists (
      select 1 from public.chain_events e
      where e.chain_id = camp.chain_id and e.tx_hash = new.publish_tx_hash
        and e.event_name = 'ReportPublished' and e.confirmation_state = 'CONFIRMED' and e.canonical
        and e.args ->> 'reportId' = new.onchain_report_id::text
        and e.args ->> 'campaignId' = camp.onchain_campaign_id::text
        and lower(e.args ->> 'contentSha256') = new.content_sha256
        and e.args ->> 'version' = new.version::text
    ) then
      raise exception 'Brak potwierdzonego zdarzenia ReportPublished zgodnego z raportem' using errcode = '23514';
    end if;
  end if;
  if new.status in ('VERIFIED', 'REVOKED') and old.status <> new.status then
    required_decision := case new.status when 'VERIFIED' then '1' else '3' end;
    if not exists (
      select 1 from public.chain_events e
      where e.chain_id = camp.chain_id and e.tx_hash = new.review_tx_hash
        and e.event_name = 'ReportReviewed' and e.confirmation_state = 'CONFIRMED' and e.canonical
        and e.args ->> 'reportId' = new.onchain_report_id::text
        and e.args ->> 'decision' = required_decision
    ) then
      raise exception 'Brak potwierdzonego zdarzenia ReportReviewed zgodnego z decyzją' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger impact_reports_guard before insert or update on public.impact_reports
  for each row execute function app.impact_reports_guard();
create trigger impact_reports_no_delete before delete on public.impact_reports
  for each row execute function app.forbid_delete();

create table public.impact_report_reviews (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.impact_reports (id) on delete restrict,
  reviewer app.evm_address not null,
  decision app.report_decision not null,
  reason_public text,
  reason_private text,
  created_at timestamptz not null default now(),
  constraint impact_report_reviews_reason_required check (
    decision = 'VERIFIED' or (reason_public is not null and length(btrim(reason_public)) > 0)
  )
);
create index impact_report_reviews_report_idx on public.impact_report_reviews (report_id, created_at desc);

-- Recenzent nie jest autorem raportu ani aktywnym członkiem organizacji kampanii (AC-23, rozdzielone role).
create function app.impact_report_reviews_guard() returns trigger
language plpgsql
as $$
declare
  report public.impact_reports%rowtype;
  camp public.campaigns%rowtype;
begin
  select * into report from public.impact_reports where id = new.report_id;
  select * into camp from public.campaigns where id = report.campaign_id;
  if new.reviewer = report.created_by then
    raise exception 'Autor raportu nie może go zrecenzować' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.organization_members m
    where m.organization_id = camp.organization_id and m.wallet_lower = new.reviewer and m.revoked_at is null
  ) then
    raise exception 'Członek organizacji nie może zrecenzować jej raportu' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger impact_report_reviews_guard before insert on public.impact_report_reviews
  for each row execute function app.impact_report_reviews_guard();
create trigger impact_report_reviews_append_only before update or delete on public.impact_report_reviews
  for each row execute function app.forbid_update_delete();

-- ---------------------------------------------------------------------------------------------
-- abuse_reports (zgłoszenia nadużyć; szczegóły prywatne; retencja ustawiana polityką prawną)
-- ---------------------------------------------------------------------------------------------
create table public.abuse_reports (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns (id) on delete restrict,
  reporter_wallet_lower app.evm_address,
  category app.abuse_category not null,
  details_private text not null check (length(btrim(details_private)) between 1 and 5000),
  attachment_asset_ids uuid[] not null default '{}' check (cardinality(attachment_asset_ids) <= 5),
  status app.abuse_status not null default 'OPEN',
  handled_by app.evm_address,
  handled_at timestamptz,
  retention_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint abuse_reports_handled_consistent check (
    (status in ('OPEN') and handled_by is null) or (status <> 'OPEN' and handled_by is not null and handled_at is not null)
  )
);
create index abuse_reports_status_idx on public.abuse_reports (status, created_at desc);
create index abuse_reports_campaign_idx on public.abuse_reports (campaign_id);
create trigger abuse_reports_touch_updated_at before update on public.abuse_reports
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------------------------
-- audit_logs — append-only (docs/03 §2); także TRUNCATE jest zabroniony
-- ---------------------------------------------------------------------------------------------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_wallet_lower app.evm_address,
  actor_type app.actor_type not null,
  action text not null check (action ~ '^[A-Z][A-Z0-9_]*(\.[A-Z0-9_]+)*$' and length(action) <= 100),
  entity_type text not null check (entity_type ~ '^[a-z][a-z0-9_]*$' and length(entity_type) <= 60),
  entity_id text not null check (length(entity_id) between 1 and 100),
  before_json jsonb,
  after_json jsonb,
  request_id text check (request_id is null or length(request_id) <= 100),
  created_at timestamptz not null default now(),
  -- Aktor ludzki ma adres; zdarzenia systemowe/indexera nie mają portfela.
  constraint audit_logs_actor_consistent check (
    (actor_type in ('USER', 'ADMIN') and actor_wallet_lower is not null) or actor_type in ('SYSTEM', 'INDEXER')
  )
);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);
create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function app.forbid_update_delete();

create function app.forbid_truncate() returns trigger
language plpgsql
as $$
begin
  raise exception '% nie można opróżnić (append-only)', tg_table_name using errcode = '23514';
end;
$$;
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function app.forbid_truncate();

-- ---------------------------------------------------------------------------------------------
-- SIWE: nonce jednorazowy i atomowy (docs/03 §5); sesje (token tylko jako hash)
-- ---------------------------------------------------------------------------------------------
create table public.siwe_nonces (
  nonce_hash text primary key check (nonce_hash ~ '^[0-9a-f]{64}$'),
  wallet_lower app.evm_address,
  domain text not null check (length(domain) between 1 and 253),
  chain_id integer not null check (chain_id in (42161, 421614)),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  constraint siwe_nonces_ttl check (expires_at > issued_at and expires_at <= issued_at + interval '15 minutes'),
  constraint siwe_nonces_used_after_issue check (used_at is null or used_at >= issued_at)
);
create index siwe_nonces_expires_idx on public.siwe_nonces (expires_at);

-- Atomowe zużycie: dokładnie jedno wywołanie dla danego nonce zwróci true (replay => false).
create function app.consume_siwe_nonce(
  p_nonce_hash text,
  p_domain text,
  p_chain_id integer,
  p_wallet app.evm_address
) returns boolean
language plpgsql
as $$
declare
  consumed boolean;
begin
  update public.siwe_nonces
     set used_at = now(), wallet_lower = coalesce(wallet_lower, p_wallet)
   where nonce_hash = p_nonce_hash
     and used_at is null
     and expires_at > now()
     and domain = p_domain
     and chain_id = p_chain_id
     and (wallet_lower is null or wallet_lower = p_wallet)
  returning true into consumed;
  return coalesce(consumed, false);
end;
$$;

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  wallet_lower app.evm_address not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  rotated_from uuid references public.sessions (id) on delete set null,
  constraint sessions_ttl check (expires_at > created_at and expires_at <= created_at + interval '30 days'),
  constraint sessions_revoked_after_created check (revoked_at is null or revoked_at >= created_at)
);
create index sessions_wallet_idx on public.sessions (wallet_lower, created_at desc);

-- Portfel aktywnej sesji dla hasha tokenu (null, gdy sesja nie istnieje, wygasła lub została odwołana).
create function app.session_wallet(p_token_hash text) returns app.evm_address
language sql stable
as $$
  select s.wallet_lower from public.sessions s
   where s.token_hash = p_token_hash and s.revoked_at is null and s.expires_at > now()
$$;

-- Sprzątanie wyłącznie nieaktualnych wpisów (operacyjne; nie dotyka audytu).
create function app.purge_expired_auth() returns integer
language plpgsql
as $$
declare
  removed integer := 0;
  n integer;
begin
  delete from public.siwe_nonces where expires_at < now() - interval '1 day';
  get diagnostics n = row_count;
  removed := removed + n;
  delete from public.sessions
   where (revoked_at is not null and revoked_at < now() - interval '30 days')
      or expires_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return removed + n;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- system_flags, donor_profiles
-- ---------------------------------------------------------------------------------------------
create table public.system_flags (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*$' and length(key) <= 60),
  enabled boolean not null default false,
  reason text,
  updated_by app.evm_address,
  updated_at timestamptz not null default now()
);
create trigger system_flags_touch_updated_at before update on public.system_flags
  for each row execute function app.touch_updated_at();
-- Awaryjne wyłączenie checkoutu w UI; NIE zastępuje pauzy on-chain (docs/03 §2).
insert into public.system_flags (key, enabled) values ('checkout_disabled', false);

create table public.donor_profiles (
  chain_id integer not null check (chain_id in (42161, 421614)),
  wallet_lower app.evm_address not null,
  display_name text check (display_name is null or (length(btrim(display_name)) between 1 and 60 and display_name !~ '[[:cntrl:]]')),
  avatar_asset_id uuid references public.assets (id) on delete set null,
  bio text check (bio is null or length(bio) <= 500),
  -- Prywatność domyślnie: profil i ranking wymagają jawnej zgody (docs/03 §3).
  leaderboard_opt_in boolean not null default false,
  profile_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (chain_id, wallet_lower)
);
create trigger donor_profiles_touch_updated_at before update on public.donor_profiles
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------------------------
-- RLS: deny-by-default; odebrane uprawnienia rolom klienckim (polityki: COC-023)
-- ---------------------------------------------------------------------------------------------
alter table public.assets enable row level security;
alter table public.impact_reports enable row level security;
alter table public.impact_report_reviews enable row level security;
alter table public.abuse_reports enable row level security;
alter table public.audit_logs enable row level security;
alter table public.siwe_nonces enable row level security;
alter table public.sessions enable row level security;
alter table public.system_flags enable row level security;
alter table public.donor_profiles enable row level security;

do $$
declare
  client_role text;
begin
  foreach client_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = client_role) then
      execute format(
        'revoke all on public.assets, public.impact_reports, public.impact_report_reviews, '
        'public.abuse_reports, public.audit_logs, public.siwe_nonces, public.sessions, '
        'public.system_flags, public.donor_profiles from %I',
        client_role
      );
    end if;
  end loop;
end;
$$;
