-- 0003_organizations_campaigns (COC-020; docs/03 §2, §3; docs/02 §2; AC-01..03, AC-23)
-- Organizacje, dane prywatne KYB, członkowie, kampanie (draft -> publikacja), rewizje i recenzje.
-- ZASADY: źródłem prawdy o statusie on-chain jest łańcuch (chain_events); baza trzyma proces redakcyjny.
-- Zapisy z klienta tylko przez RLS w COC-023 (tu: RLS włączone, bez polityk = deny-by-default).
-- Konwencja `chain_events.args` dla CampaignCreated (zapisuje ją indexer, COC-030): klucze jak w ABI,
-- liczby jako ciągi dziesiętne, adresy małymi literami: {"campaignId":"7","beneficiary":"0x..","orgHash":"0x..","capRaw":"1000000"}.

create type app.org_status as enum ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'SUSPENDED', 'REJECTED');
create type app.member_role as enum ('OWNER', 'MANAGER', 'REPORTER');
create type app.campaign_status as enum (
  'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PUBLISHING', 'PUBLISHED', 'PAUSED', 'CLOSED', 'REJECTED'
);
create type app.review_decision as enum ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED');

-- ---------------------------------------------------------------------------------------------
-- organizations — dane PUBLICZNE (wybór kolumn udostępnia widok/RPC w COC-023/032, nie sama tabela)
-- ---------------------------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null check (length(btrim(legal_name)) between 1 and 300),
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  country_code char(2) not null check (country_code ~ '^[A-Z]{2}$'),
  registry_number text check (registry_number is null or length(btrim(registry_number)) between 1 and 100),
  status app.org_status not null default 'PENDING',
  safe_address_lower app.evm_address,
  safe_chain_id integer check (safe_chain_id in (42161, 421614)),
  verified_at timestamptz,
  verification_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Adres i sieć Safe idą parami.
  constraint organizations_safe_pair check ((safe_address_lower is null) = (safe_chain_id is null)),
  -- Zatwierdzona organizacja ma zweryfikowany Safe i datę weryfikacji (AC-02: tylko APPROVED publikuje).
  constraint organizations_approved_is_verified check (
    status <> 'APPROVED' or (safe_address_lower is not null and verified_at is not null)
  ),
  constraint organizations_verification_expiry check (
    verification_expires_at is null or (verified_at is not null and verification_expires_at > verified_at)
  ),
  -- Jeden Safe = jedna organizacja na danej sieci (zapobiega współdzieleniu odbiorcy).
  constraint organizations_safe_unique unique (safe_chain_id, safe_address_lower)
);
create index organizations_status_idx on public.organizations (status);
create trigger organizations_touch_updated_at before update on public.organizations
  for each row execute function app.touch_updated_at();

-- Dane prywatne: osoby, kontakt, dokumenty KYB, wynik przeglądu i retencja. NIGDY w publicznym API.
create table public.organization_private (
  organization_id uuid primary key references public.organizations (id) on delete restrict,
  contact_person text,
  contact_email text check (contact_email is null or contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  people_json jsonb not null default '[]'::jsonb check (jsonb_typeof(people_json) = 'array'),
  kyb_asset_ids uuid[] not null default '{}',
  kyb_result text check (kyb_result is null or kyb_result in ('PASSED', 'FAILED', 'NEEDS_INFO')),
  kyb_reviewed_by app.evm_address,
  kyb_reviewed_at timestamptz,
  retention_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organization_private_touch_updated_at before update on public.organization_private
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------------------------
-- organization_members — jedno aktywne członkostwo portfela w organizacji
-- ---------------------------------------------------------------------------------------------
create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  wallet_lower app.evm_address not null,
  role app.member_role not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint organization_members_revoked_after_created check (revoked_at is null or revoked_at >= created_at)
);
create unique index organization_members_active_key
  on public.organization_members (organization_id, wallet_lower) where revoked_at is null;
create index organization_members_wallet_active_idx
  on public.organization_members (wallet_lower) where revoked_at is null;

-- ---------------------------------------------------------------------------------------------
-- campaigns
-- ---------------------------------------------------------------------------------------------
-- Dozwolone przejścia statusu (obrona w głąb; backend i tak je wymusza). PAUSED/CLOSED pochodzą ze zdarzeń
-- łańcucha, nie z ręcznej edycji.
create function app.campaign_transition_allowed(old_status app.campaign_status, new_status app.campaign_status)
returns boolean
language sql immutable parallel safe
as $$
  select old_status = new_status or (old_status, new_status) in (
    ('DRAFT', 'SUBMITTED'),
    ('SUBMITTED', 'UNDER_REVIEW'),
    ('SUBMITTED', 'DRAFT'),
    ('UNDER_REVIEW', 'APPROVED'),
    ('UNDER_REVIEW', 'REJECTED'),
    ('UNDER_REVIEW', 'DRAFT'),
    ('APPROVED', 'PUBLISHING'),
    ('APPROVED', 'DRAFT'),
    ('PUBLISHING', 'PUBLISHED'),
    ('PUBLISHING', 'APPROVED'),
    ('PUBLISHED', 'PAUSED'),
    ('PAUSED', 'PUBLISHED'),
    ('PUBLISHED', 'CLOSED'),
    ('PAUSED', 'CLOSED')
  )
$$;

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  chain_id integer not null check (chain_id in (42161, 421614)),
  onchain_campaign_id bigint check (onchain_campaign_id is null or onchain_campaign_id >= 1),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  title text not null check (length(btrim(title)) between 1 and 200),
  summary text not null default '' check (length(summary) <= 500),
  description_md text not null default '',
  category text not null default 'other' check (length(btrim(category)) between 1 and 60),
  status app.campaign_status not null default 'DRAFT',
  cap_raw app.usdc_raw not null check (cap_raw > 0 and cap_raw <= 340282366920938463463374607431768211455), -- uint128
  start_at timestamptz not null,
  end_at timestamptz not null,
  beneficiary_lower app.evm_address not null,
  metadata_hash app.hash32,
  cover_asset_id uuid,
  created_by_wallet_lower app.evm_address not null,
  approved_by_wallet_lower app.evm_address,
  published_tx_hash app.hash32,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaigns_slug_key unique (slug),
  constraint campaigns_window check (end_at > start_at),
  -- Cel dla złożonego FK z donations (zgodność kampanii, sieci i identyfikatora on-chain).
  constraint campaigns_id_chain_onchain_key unique (id, chain_id, onchain_campaign_id),
  constraint campaigns_chain_onchain_key unique (chain_id, onchain_campaign_id),
  -- 4-eyes: autor nie jest zatwierdzającym; zatwierdzenie jest wymagane od APPROVED wzwyż.
  constraint campaigns_four_eyes check (approved_by_wallet_lower is null or approved_by_wallet_lower <> created_by_wallet_lower),
  constraint campaigns_approved_has_approver check (
    status not in ('APPROVED', 'PUBLISHING', 'PUBLISHED', 'PAUSED', 'CLOSED') or approved_by_wallet_lower is not null
  ),
  constraint campaigns_approved_has_metadata check (
    status not in ('APPROVED', 'PUBLISHING', 'PUBLISHED', 'PAUSED', 'CLOSED') or metadata_hash is not null
  ),
  -- Opublikowane rekordy mają identyfikator on-chain i hash transakcji (AC-01).
  constraint campaigns_published_has_chain_ids check (
    status not in ('PUBLISHED', 'PAUSED', 'CLOSED') or (onchain_campaign_id is not null and published_tx_hash is not null)
  )
);
create index campaigns_status_created_idx on public.campaigns (status, created_at desc);
create index campaigns_org_status_idx on public.campaigns (organization_id, status);

create function app.campaigns_guard() returns trigger
language plpgsql
as $$
declare
  org public.organizations%rowtype;
begin
  if tg_op = 'INSERT' then
    -- Nowa kampania zaczyna jako DRAFT i nie ma żadnych faktów z łańcucha.
    if new.status <> 'DRAFT' or new.onchain_campaign_id is not null or new.published_tx_hash is not null
       or new.approved_by_wallet_lower is not null then
      raise exception 'Nowa kampania musi być DRAFT bez danych z łańcucha i bez zatwierdzenia'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if not app.campaign_transition_allowed(old.status, new.status) then
    raise exception 'Niedozwolone przejście statusu kampanii % -> %', old.status, new.status
      using errcode = '23514';
  end if;

  -- Po przygotowaniu publikacji warunki są zamrożone (identyczne jak on-chain: INV-05, AC-03).
  if old.status in ('PUBLISHING', 'PUBLISHED', 'PAUSED', 'CLOSED') and (
       new.beneficiary_lower <> old.beneficiary_lower or new.cap_raw <> old.cap_raw
       or new.start_at <> old.start_at or new.end_at <> old.end_at or new.chain_id <> old.chain_id
       or new.organization_id <> old.organization_id
       or new.created_by_wallet_lower <> old.created_by_wallet_lower
     ) then
    raise exception 'Warunki kampanii (beneficjent, limit, okno, sieć, organizacja) są niezmienne od PUBLISHING'
      using errcode = '23514';
  end if;
  if old.onchain_campaign_id is not null and new.onchain_campaign_id is distinct from old.onchain_campaign_id then
    raise exception 'onchain_campaign_id jest niezmienny' using errcode = '23514';
  end if;
  if old.published_tx_hash is not null and new.published_tx_hash is distinct from old.published_tx_hash then
    raise exception 'published_tx_hash jest niezmienny' using errcode = '23514';
  end if;

  -- Zatwierdzenie i publikacja wymagają zatwierdzonej organizacji (AC-02).
  if new.status in ('APPROVED', 'PUBLISHING', 'PUBLISHED') and old.status is distinct from new.status then
    select * into org from public.organizations where id = new.organization_id;
    if org.status <> 'APPROVED' then
      raise exception 'Organizacja nie jest zatwierdzona (status %)', org.status using errcode = '23514';
    end if;
    -- Beneficjent kampanii to zweryfikowany Safe organizacji, na tej samej sieci.
    if new.status in ('PUBLISHING', 'PUBLISHED')
       and (org.safe_address_lower <> new.beneficiary_lower or org.safe_chain_id <> new.chain_id) then
      raise exception 'Beneficjent musi być zweryfikowanym Safe organizacji na tej samej sieci'
        using errcode = '23514';
    end if;
  end if;

  -- Publikacja tylko po potwierdzonym, kanonicznym evencie CampaignCreated z zgodnymi danymi (AC-01).
  if new.status = 'PUBLISHED' and old.status = 'PUBLISHING' then
    if new.onchain_campaign_id is null or new.published_tx_hash is null then
      raise exception 'PUBLISHED wymaga onchain_campaign_id i published_tx_hash' using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.chain_events e
      where e.chain_id = new.chain_id
        and e.tx_hash = new.published_tx_hash
        and e.event_name = 'CampaignCreated'
        and e.confirmation_state = 'CONFIRMED'
        and e.canonical
        and e.args ->> 'campaignId' = new.onchain_campaign_id::text
        and lower(e.args ->> 'beneficiary') = new.beneficiary_lower
        and e.args ->> 'capRaw' = new.cap_raw::text
    ) then
      raise exception 'Brak potwierdzonego zdarzenia CampaignCreated zgodnego z kampanią' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;
create trigger campaigns_guard before insert or update on public.campaigns
  for each row execute function app.campaigns_guard();
create trigger campaigns_touch_updated_at before update on public.campaigns
  for each row execute function app.touch_updated_at();

-- Kampanii się nie usuwa (ślad redakcyjny i powiązania z donacjami): status CLOSED/REJECTED zamiast DELETE.
create function app.forbid_delete() returns trigger
language plpgsql
as $$
begin
  raise exception 'Usuwanie z % jest zabronione (ślad audytowy)', tg_table_name using errcode = '23514';
end;
$$;
create trigger campaigns_no_delete before delete on public.campaigns
  for each row execute function app.forbid_delete();

-- ---------------------------------------------------------------------------------------------
-- campaign_revisions — niemutowalna historia treści (docs/03 §2)
-- ---------------------------------------------------------------------------------------------
create table public.campaign_revisions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  version integer not null check (version >= 1),
  content_json jsonb not null check (jsonb_typeof(content_json) = 'object'),
  content_sha256 app.hash32 not null,
  created_by app.evm_address not null,
  created_at timestamptz not null default now(),
  constraint campaign_revisions_version_key unique (campaign_id, version),
  -- Cel dla złożonego FK z campaign_reviews (rewizja musi należeć do tej samej kampanii).
  constraint campaign_revisions_id_campaign_key unique (id, campaign_id)
);

create function app.forbid_update_delete() returns trigger
language plpgsql
as $$
begin
  raise exception '% jest tylko do dopisywania (append-only)', tg_table_name using errcode = '23514';
end;
$$;
create trigger campaign_revisions_append_only before update or delete on public.campaign_revisions
  for each row execute function app.forbid_update_delete();

-- ---------------------------------------------------------------------------------------------
-- campaign_reviews — decyzje recenzentów (append-only; 4-eyes)
-- ---------------------------------------------------------------------------------------------
create table public.campaign_reviews (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  revision_id uuid not null,
  reviewer_wallet_lower app.evm_address not null,
  decision app.review_decision not null,
  reason_private text,
  reason_public text,
  created_at timestamptz not null default now(),
  constraint campaign_reviews_revision_fk foreign key (revision_id, campaign_id)
    references public.campaign_revisions (id, campaign_id) on delete restrict,
  -- Odrzucenie i prośba o zmiany wymagają publicznego powodu.
  constraint campaign_reviews_reason_required check (
    decision = 'APPROVED' or (reason_public is not null and length(btrim(reason_public)) > 0)
  )
);
create index campaign_reviews_campaign_idx on public.campaign_reviews (campaign_id, created_at desc);

create function app.campaign_reviews_guard() returns trigger
language plpgsql
as $$
declare
  camp public.campaigns%rowtype;
begin
  select * into camp from public.campaigns where id = new.campaign_id;
  -- 4-eyes: ani autor, ani aktywny członek organizacji kampanii nie zatwierdza jej (docs/03 §2–3, AC-23).
  if new.decision = 'APPROVED' then
    if new.reviewer_wallet_lower = camp.created_by_wallet_lower then
      raise exception 'Autor kampanii nie może jej zatwierdzić (4-eyes)' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.organization_members m
      where m.organization_id = camp.organization_id and m.wallet_lower = new.reviewer_wallet_lower
        and m.revoked_at is null
    ) then
      raise exception 'Członek organizacji nie może zatwierdzić jej kampanii (4-eyes)' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger campaign_reviews_guard before insert on public.campaign_reviews
  for each row execute function app.campaign_reviews_guard();
create trigger campaign_reviews_append_only before update or delete on public.campaign_reviews
  for each row execute function app.forbid_update_delete();

-- ---------------------------------------------------------------------------------------------
-- donations -> campaigns (uzupełnienie COC-021): kampania, sieć i identyfikator on-chain muszą się zgadzać
-- ---------------------------------------------------------------------------------------------
alter table public.donations alter column campaign_id set not null;
alter table public.donations
  add constraint donations_campaign_fk foreign key (campaign_id, chain_id, onchain_campaign_id)
  references public.campaigns (id, chain_id, onchain_campaign_id) on delete restrict;

-- ---------------------------------------------------------------------------------------------
-- RLS: deny-by-default. Polityki i widoki publiczne powstają w COC-023/032.
-- ---------------------------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.organization_private enable row level security;
alter table public.organization_members enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_revisions enable row level security;
alter table public.campaign_reviews enable row level security;

do $$
declare
  client_role text;
begin
  foreach client_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = client_role) then
      execute format(
        'revoke all on public.organizations, public.organization_private, public.organization_members, '
        'public.campaigns, public.campaign_revisions, public.campaign_reviews from %I',
        client_role
      );
    end if;
  end loop;
end;
$$;
