-- 0002_chain_projection (COC-021; docs/03 §2, docs/01 §6, docs/05 §3)
-- Dziennik zdarzeń łańcucha + projekcje (donations, donor_stats) + kursory indexera.
-- ZASADY: źródłem prawdy jest łańcuch; baza to projekcja. Zapisy wyłącznie przez zaufanego indexera
-- (rola serwisowa / właściciel), nigdy z klienta. RLS włączone, bez polityk = deny-by-default.
-- Polityki odczytu i widoki publiczne powstają w COC-023/032.
-- FK donations.campaign_id -> campaigns zostanie dodany po utworzeniu tabeli campaigns (COC-020).

create type app.confirmation_state as enum ('OBSERVED', 'CONFIRMED', 'ORPHANED');
create type app.donation_status as enum ('PENDING', 'CONFIRMED', 'ORPHANED');
create type app.indexer_status as enum ('IDLE', 'SYNCING', 'RECONCILING', 'ERROR');

-- ---------------------------------------------------------------------------------------------
-- Reguły XP i lig (docs/01 §6) — lustro packages/shared/src/tiers.ts; zgodność sprawdza test.
-- 1 USDC = 1_000_000 raw; xp = floor(raw / 100000); progi: 1 / 100 / 1000 / 10000 / 25000 / 100000 USDC.
-- ---------------------------------------------------------------------------------------------
create function app.xp_from_raw(total numeric) returns numeric
language sql immutable parallel safe
as $$ select floor(total / 100000) $$;

create function app.tier_from_raw(total numeric) returns smallint
language sql immutable parallel safe
as $$
  select (case
    when total >= 100000000000 then 6
    when total >= 25000000000 then 5
    when total >= 10000000000 then 4
    when total >= 1000000000 then 3
    when total >= 100000000 then 2
    when total >= 1000000 then 1
    else 0
  end)::smallint
$$;

-- ---------------------------------------------------------------------------------------------
-- chain_events — kanoniczny journal (docs/03 §2)
-- ---------------------------------------------------------------------------------------------
create table public.chain_events (
  id uuid primary key default gen_random_uuid(),
  chain_id integer not null check (chain_id in (42161, 421614)),
  contract_lower app.evm_address not null,
  event_name text not null check (event_name ~ '^[A-Za-z][A-Za-z0-9]*$'),
  tx_hash app.hash32 not null,
  log_index integer not null check (log_index >= 0),
  block_number bigint not null check (block_number >= 0),
  block_hash app.hash32 not null,
  tx_index integer not null check (tx_index >= 0),
  args jsonb not null,
  canonical boolean not null default true,
  confirmation_state app.confirmation_state not null default 'OBSERVED',
  observed_at timestamptz not null default now(),
  confirmed_at timestamptz,
  -- Idempotencja (AC-13): jedno zdarzenie = jeden wiersz, niezależnie od liczby powtórnych przetworzeń.
  constraint chain_events_tx_log_key unique (chain_id, tx_hash, log_index),
  -- Cel dla złożonego FK z donations (gwarantuje zgodność chain_id).
  constraint chain_events_id_chain_key unique (id, chain_id),
  constraint chain_events_canonical_matches_state
    check ((confirmation_state = 'ORPHANED') = (not canonical)),
  constraint chain_events_confirmed_requires_timestamp
    check (confirmation_state <> 'CONFIRMED' or confirmed_at is not null),
  constraint chain_events_observed_has_no_confirmation
    check (confirmation_state <> 'OBSERVED' or confirmed_at is null)
);

create index chain_events_chain_block_log_idx
  on public.chain_events (chain_id, block_number, log_index);

-- Historia zmian stanu (reorg: „nie usuwać bez śladu”, wersjonowana historia).
create table public.chain_event_history (
  id bigint generated always as identity primary key,
  chain_event_id uuid not null references public.chain_events (id),
  changed_at timestamptz not null default now(),
  old_state app.confirmation_state not null,
  new_state app.confirmation_state not null,
  old_canonical boolean not null,
  new_canonical boolean not null,
  old_block_number bigint not null,
  new_block_number bigint not null,
  old_block_hash app.hash32 not null,
  new_block_hash app.hash32 not null
);

create index chain_event_history_event_idx on public.chain_event_history (chain_event_id, id);

-- Historia jest dopisywana tylko (append-only).
create function app.forbid_modification() returns trigger
language plpgsql
as $$
begin
  raise exception '% jest dopisywana tylko (append-only): % zabronione', tg_table_name, tg_op
    using errcode = '23001';
end;
$$;

create trigger chain_event_history_append_only
  before update or delete on public.chain_event_history
  for each row execute function app.forbid_modification();

-- Ochrona journala: brak DELETE (na reorg: ORPHANED zamiast usunięcia) oraz niemutowalna tożsamość
-- zdarzenia. Zmieniać wolno stan i miejsce w łańcuchu (zdarzenie może wrócić w innym bloku).
create function app.chain_events_guard() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'chain_events: usuwanie zabronione (oznacz zdarzenie jako ORPHANED)'
      using errcode = '23001';
  end if;
  if new.id is distinct from old.id
     or new.chain_id is distinct from old.chain_id
     or new.contract_lower is distinct from old.contract_lower
     or new.event_name is distinct from old.event_name
     or new.tx_hash is distinct from old.tx_hash
     or new.log_index is distinct from old.log_index
     or new.args is distinct from old.args then
    raise exception 'chain_events: tożsamość i treść zdarzenia są niezmienne'
      using errcode = '23001';
  end if;
  return new;
end;
$$;

create trigger chain_events_guard
  before update or delete on public.chain_events
  for each row execute function app.chain_events_guard();

create function app.chain_events_track_changes() returns trigger
language plpgsql
as $$
begin
  if (old.confirmation_state, old.canonical, old.block_number, old.block_hash)
     is distinct from (new.confirmation_state, new.canonical, new.block_number, new.block_hash) then
    insert into public.chain_event_history (
      chain_event_id, old_state, new_state, old_canonical, new_canonical,
      old_block_number, new_block_number, old_block_hash, new_block_hash
    ) values (
      new.id, old.confirmation_state, new.confirmation_state, old.canonical, new.canonical,
      old.block_number, new.block_number, old.block_hash, new.block_hash
    );
  end if;
  return null;
end;
$$;

create trigger chain_events_track_changes
  after update on public.chain_events
  for each row execute function app.chain_events_track_changes();

-- ---------------------------------------------------------------------------------------------
-- donations — projekcja DonationReceived (docs/03 §2)
-- amount_raw > 0 (ADR-112): minimum 1 USDC z wyjątkiem końcówki celu egzekwuje kontrakt.
-- ---------------------------------------------------------------------------------------------
create table public.donations (
  id uuid primary key default gen_random_uuid(),
  chain_event_id uuid not null unique,
  chain_id integer not null check (chain_id in (42161, 421614)),
  campaign_id uuid,
  onchain_campaign_id bigint not null check (onchain_campaign_id >= 0),
  donor_wallet_lower app.evm_address not null,
  beneficiary_lower app.evm_address not null,
  token_address_lower app.evm_address not null,
  amount_raw app.usdc_raw not null check (amount_raw > 0),
  block_time timestamptz not null,
  status app.donation_status not null,
  created_at timestamptz not null default now(),
  -- Złożony FK: chain_id donacji musi być zgodny z chain_id zdarzenia źródłowego.
  constraint donations_chain_event_fk foreign key (chain_event_id, chain_id)
    references public.chain_events (id, chain_id)
);

create index donations_campaign_time_idx on public.donations (campaign_id, block_time desc);
create index donations_onchain_campaign_time_idx
  on public.donations (chain_id, onchain_campaign_id, block_time desc);
create index donations_donor_time_idx on public.donations (donor_wallet_lower, block_time desc);

-- ---------------------------------------------------------------------------------------------
-- donor_stats — CACHE sum z kontraktu (docs/03 §2). Spójność xp/tier z sumą wymuszona w bazie.
-- ---------------------------------------------------------------------------------------------
create table public.donor_stats (
  chain_id integer not null check (chain_id in (42161, 421614)),
  wallet_lower app.evm_address not null,
  total_donated_raw app.usdc_raw not null default 0,
  xp numeric(78, 0) not null default 0,
  tier smallint not null default 0,
  derived_at timestamptz not null default now(),
  source_block_number bigint not null check (source_block_number >= 0),
  last_reconciliation_at timestamptz,
  primary key (chain_id, wallet_lower),
  constraint donor_stats_xp_matches_total check (xp = app.xp_from_raw(total_donated_raw)),
  constraint donor_stats_tier_matches_total check (tier = app.tier_from_raw(total_donated_raw))
);

-- ---------------------------------------------------------------------------------------------
-- indexer_cursors (docs/03 §2). last_scanned != last_confirmed; potwierdzony nie wyprzedza skanowanego.
-- ---------------------------------------------------------------------------------------------
create table public.indexer_cursors (
  chain_id integer not null check (chain_id in (42161, 421614)),
  contract_lower app.evm_address not null,
  last_scanned_block bigint not null default 0 check (last_scanned_block >= 0),
  last_confirmed_block bigint not null default 0 check (last_confirmed_block >= 0),
  last_block_hash app.hash32,
  updated_at timestamptz not null default now(),
  status app.indexer_status not null default 'IDLE',
  primary key (chain_id, contract_lower),
  constraint indexer_cursors_confirmed_not_ahead check (last_confirmed_block <= last_scanned_block)
);

create trigger indexer_cursors_touch_updated_at
  before update on public.indexer_cursors
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------------------------
-- RLS deny-by-default + brak zapisów z ról klienckich (docs/03 §3: chain_events, donations,
-- donor_stats — zapis tylko przez zaufanego indexera). Role Supabase istnieją tylko na platformie,
-- więc odebranie uprawnień jest warunkowe; RLS bez polityk blokuje dostęp tak czy inaczej.
-- ---------------------------------------------------------------------------------------------
alter table public.chain_events enable row level security;
alter table public.chain_event_history enable row level security;
alter table public.donations enable row level security;
alter table public.donor_stats enable row level security;
alter table public.indexer_cursors enable row level security;

do $$
declare
  client_role text;
begin
  foreach client_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = client_role) then
      execute format(
        'revoke all on public.chain_events, public.chain_event_history, public.donations, '
        'public.donor_stats, public.indexer_cursors from %I',
        client_role
      );
    end if;
  end loop;
end;
$$;
