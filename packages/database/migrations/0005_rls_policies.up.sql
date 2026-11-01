-- 0005_rls_policies (COC-023; docs/03 §3; AC-25, AC-26, AC-30; CLAUDE.md pkt 9)
-- Model dostępu (deny-by-default). Backend łączy się jako rola logowania będąca członkiem `app_api`
-- (albo wykonuje SET LOCAL ROLE app_api) i w KAŻDEJ transakcji ustawia tożsamość:
--     select set_config('app.wallet', '<adres małymi literami>', true);   -- tylko po weryfikacji SIWE
-- Rola `app_api` jest NOLOGIN: klient (przeglądarka) nigdy nie dostaje danych dostępowych do bazy.
-- Role: app_api (żądania użytkowników), app_indexer (zapisy z łańcucha), app_auth (nonce i sesje).
-- Właściciel/rola serwisowa omija RLS (migracje, operacje administracyjne bez kontekstu użytkownika).
-- Uprawnienia personelu (REVIEWER/ADMIN) pochodzą z tabeli staff_members, nigdy z flagi w kliencie.
-- Ograniczenia na poziomie kolumn i przejść statusów egzekwują wyzwalacze `*_authz` (RLS nie widzi OLD/NEW).

do $$
declare
  r text;
begin
  foreach r in array array['app_api', 'app_indexer', 'app_auth'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Guardy z 0003/0004 czytają INNE tabele: muszą działać niezależnie od RLS wywołującego (inaczej rola
-- bez wglądu w wiersz organizacji ominęłaby kontrolę przez „null <> 'APPROVED'”).
-- ---------------------------------------------------------------------------------------------
alter function app.campaigns_guard() security definer set search_path = public, app, pg_temp;
alter function app.campaign_reviews_guard() security definer set search_path = public, app, pg_temp;
alter function app.impact_reports_guard() security definer set search_path = public, app, pg_temp;
alter function app.impact_report_reviews_guard() security definer set search_path = public, app, pg_temp;
alter function app.campaigns_cover_guard() security definer set search_path = public, app, pg_temp;

-- ---------------------------------------------------------------------------------------------
-- staff_members — personel (REVIEWER, ADMIN); nadawany wyłącznie operacyjnie, z audytem
-- ---------------------------------------------------------------------------------------------
create type app.staff_role as enum ('ADMIN', 'REVIEWER');

create table public.staff_members (
  id uuid primary key default gen_random_uuid(),
  wallet_lower app.evm_address not null,
  role app.staff_role not null,
  granted_by app.evm_address,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint staff_members_revoked_after_created check (revoked_at is null or revoked_at >= created_at)
);
create unique index staff_members_active_key on public.staff_members (wallet_lower, role) where revoked_at is null;
alter table public.staff_members enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Funkcje tożsamości (SECURITY DEFINER: czytają staff/members mimo RLS; stały search_path)
-- ---------------------------------------------------------------------------------------------
create function app.current_wallet() returns app.evm_address
language sql stable
as $$ select nullif(current_setting('app.wallet', true), '')::app.evm_address $$;

create function app.is_staff(p_role app.staff_role default null) returns boolean
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select exists (
    select 1 from public.staff_members s
     where s.wallet_lower = app.current_wallet() and s.revoked_at is null
       and (p_role is null or s.role = p_role)
  )
$$;

create function app.is_org_member(p_org uuid, p_roles app.member_role[] default null) returns boolean
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select exists (
    select 1 from public.organization_members m
     where m.organization_id = p_org and m.wallet_lower = app.current_wallet() and m.revoked_at is null
       and (p_roles is null or m.role = any (p_roles))
  )
$$;

create function app.my_org_ids() returns setof uuid
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select m.organization_id from public.organization_members m
   where m.wallet_lower = app.current_wallet() and m.revoked_at is null
$$;

-- Odwołanie do organization_members z polityki TEJ SAMEJ tabeli powoduje „infinite recursion”: przez funkcję.
create function app.org_has_members(p_org uuid) returns boolean
language sql stable security definer set search_path = public, app, pg_temp
as $$ select exists (select 1 from public.organization_members m where m.organization_id = p_org) $$;

create function app.campaign_org(p_campaign uuid) returns uuid
language sql stable security definer set search_path = public, app, pg_temp
as $$ select organization_id from public.campaigns where id = p_campaign $$;

create function app.campaign_status_of(p_campaign uuid) returns app.campaign_status
language sql stable security definer set search_path = public, app, pg_temp
as $$ select status from public.campaigns where id = p_campaign $$;

create function app.report_org(p_report uuid) returns uuid
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select c.organization_id from public.impact_reports r join public.campaigns c on c.id = r.campaign_id
   where r.id = p_report
$$;

-- Wywołania funkcji pomocniczych tylko dla ról aplikacji (nie dla PUBLIC).
revoke all on function app.current_wallet(), app.is_staff(app.staff_role), app.is_org_member(uuid, app.member_role[]),
  app.my_org_ids(), app.org_has_members(uuid), app.campaign_org(uuid), app.campaign_status_of(uuid), app.report_org(uuid) from public;

-- ---------------------------------------------------------------------------------------------
-- Uprawnienia tabelowe (RLS zawęża wiersze; wyzwalacze zawężają kolumny/przejścia)
-- ---------------------------------------------------------------------------------------------
grant usage on schema app to app_api, app_indexer, app_auth;
grant usage on schema public to app_api, app_indexer, app_auth;
grant execute on function app.current_wallet(), app.is_staff(app.staff_role), app.is_org_member(uuid, app.member_role[]),
  app.my_org_ids(), app.org_has_members(uuid), app.campaign_org(uuid), app.campaign_status_of(uuid), app.report_org(uuid) to app_api, app_indexer;

grant select on public.staff_members to app_api;
grant select, insert, update on public.organizations to app_api;
grant select, insert, update on public.organization_private to app_api;
grant select, insert, update on public.organization_members to app_api;
grant select, insert, update on public.campaigns to app_api;
grant select, insert on public.campaign_revisions to app_api;
grant select, insert on public.campaign_reviews to app_api;
grant select, insert on public.assets to app_api;
grant select, insert, update on public.impact_reports to app_api;
grant select, insert on public.impact_report_reviews to app_api;
grant select, insert, update on public.abuse_reports to app_api;
grant select, insert on public.audit_logs to app_api;
grant select, insert, update on public.donor_profiles to app_api;
grant select on public.donor_stats to app_api;
grant select on public.system_flags to app_api;
grant update on public.system_flags to app_api; -- tylko ADMIN (polityka)

-- app_indexer: wyłącznie dane z łańcucha i pola łańcuchowe kampanii/raportów (kolumnowo).
grant select, insert, update on public.chain_events, public.chain_event_history, public.donations,
  public.donor_stats, public.indexer_cursors to app_indexer;
grant select on public.campaigns, public.impact_reports to app_indexer;
grant update (status, onchain_campaign_id, published_tx_hash) on public.campaigns to app_indexer;
grant update (status, onchain_report_id, publish_tx_hash, review_tx_hash, public_uri, content_sha256,
  public_json_storage_path) on public.impact_reports to app_indexer;
grant insert on public.audit_logs to app_indexer;

-- app_auth: tylko uwierzytelnianie (nonce, sesje).
grant select, insert, update on public.siwe_nonces to app_auth;
grant select, insert, update on public.sessions to app_auth;
grant execute on function app.consume_siwe_nonce(text, text, integer, app.evm_address),
  app.session_wallet(text), app.purge_expired_auth() to app_auth;

-- ---------------------------------------------------------------------------------------------
-- Polityki: app_api
-- ---------------------------------------------------------------------------------------------
create policy staff_self_or_staff_select on public.staff_members for select to app_api
  using (wallet_lower = app.current_wallet() or app.is_staff());

-- organizations: wiersze widzą personel i członkowie; publiczność przez widok `public_organizations`.
create policy org_select on public.organizations for select to app_api
  using (app.is_staff() or id in (select app.my_org_ids()));
create policy org_insert_pending on public.organizations for insert to app_api
  with check (
    app.current_wallet() is not null and status = 'PENDING' and verified_at is null
    and verification_expires_at is null
  );
create policy org_update on public.organizations for update to app_api
  using (app.is_staff('ADMIN') or app.is_org_member(id, array['OWNER']::app.member_role[]))
  with check (app.is_staff('ADMIN') or app.is_org_member(id, array['OWNER']::app.member_role[]));

create policy org_private_select on public.organization_private for select to app_api
  using (app.is_staff('ADMIN') or app.is_org_member(organization_id, array['OWNER']::app.member_role[]));
create policy org_private_insert on public.organization_private for insert to app_api
  with check (app.is_staff('ADMIN') or app.is_org_member(organization_id, array['OWNER']::app.member_role[]));
create policy org_private_update on public.organization_private for update to app_api
  using (app.is_staff('ADMIN') or app.is_org_member(organization_id, array['OWNER']::app.member_role[]))
  with check (app.is_staff('ADMIN') or app.is_org_member(organization_id, array['OWNER']::app.member_role[]));

create policy members_select on public.organization_members for select to app_api
  using (app.is_staff() or organization_id in (select app.my_org_ids()));
-- Dodanie: ADMIN albo samo-zgłoszenie pierwszego OWNER-a własnej, jeszcze pustej organizacji.
create policy members_insert on public.organization_members for insert to app_api
  with check (
    app.is_staff('ADMIN')
    or (
      wallet_lower = app.current_wallet() and role = 'OWNER'
      and not app.org_has_members(organization_id)
    )
  );
create policy members_update on public.organization_members for update to app_api
  using (app.is_staff('ADMIN') or app.is_org_member(organization_id, array['OWNER']::app.member_role[]))
  with check (app.is_staff('ADMIN') or app.is_org_member(organization_id, array['OWNER']::app.member_role[]));

-- campaigns
create policy campaigns_select on public.campaigns for select to app_api
  using (app.is_staff() or organization_id in (select app.my_org_ids()));
create policy campaigns_insert on public.campaigns for insert to app_api
  with check (
    app.is_org_member(organization_id, array['OWNER', 'MANAGER']::app.member_role[])
    and created_by_wallet_lower = app.current_wallet() and status = 'DRAFT'
  );
create policy campaigns_update on public.campaigns for update to app_api
  using (
    app.is_staff() or app.is_org_member(organization_id, array['OWNER', 'MANAGER']::app.member_role[])
  )
  with check (
    app.is_staff() or app.is_org_member(organization_id, array['OWNER', 'MANAGER']::app.member_role[])
  );

create policy revisions_select on public.campaign_revisions for select to app_api
  using (app.is_staff() or app.campaign_org(campaign_id) in (select app.my_org_ids()));
create policy revisions_insert on public.campaign_revisions for insert to app_api
  with check (
    created_by = app.current_wallet()
    and app.campaign_status_of(campaign_id) in ('DRAFT', 'SUBMITTED')
    and app.is_org_member(app.campaign_org(campaign_id), array['OWNER', 'MANAGER']::app.member_role[])
  );

-- Recenzje (z polem reason_private) widzi tylko personel; członkowie czytają widok campaign_review_feedback.
create policy reviews_select on public.campaign_reviews for select to app_api using (app.is_staff());
create policy reviews_insert on public.campaign_reviews for insert to app_api
  with check (app.is_staff() and reviewer_wallet_lower = app.current_wallet());

-- assets: publiczne wszyscy; prywatne personel i członkowie organizacji-właściciela.
create policy assets_select on public.assets for select to app_api
  using (
    (visibility = 'PUBLIC' and scan_status = 'CLEAN') or app.is_staff()
    or (owner_org_id is not null and owner_org_id in (select app.my_org_ids()))
  );
create policy assets_insert on public.assets for insert to app_api
  with check (
    scan_status = 'PENDING' and visibility = 'PRIVATE'
    and owner_org_id is not null and app.is_org_member(owner_org_id)
  );

-- impact_reports
create policy reports_select on public.impact_reports for select to app_api
  using (app.is_staff() or app.campaign_org(campaign_id) in (select app.my_org_ids()));
create policy reports_insert on public.impact_reports for insert to app_api
  with check (
    created_by = app.current_wallet()
    and app.is_org_member(app.campaign_org(campaign_id), array['OWNER', 'MANAGER', 'REPORTER']::app.member_role[])
  );
create policy reports_update on public.impact_reports for update to app_api
  using (app.is_staff() or app.is_org_member(app.campaign_org(campaign_id), array['OWNER', 'MANAGER', 'REPORTER']::app.member_role[]))
  with check (app.is_staff() or app.is_org_member(app.campaign_org(campaign_id), array['OWNER', 'MANAGER', 'REPORTER']::app.member_role[]));
create policy report_reviews_select on public.impact_report_reviews for select to app_api using (app.is_staff());
create policy report_reviews_insert on public.impact_report_reviews for insert to app_api
  with check (app.is_staff() and reviewer = app.current_wallet());

-- abuse_reports: zgłosić może każdy (także gość); czyta i obsługuje tylko personel.
create policy abuse_insert on public.abuse_reports for insert to app_api
  with check (
    status = 'OPEN' and handled_by is null and handled_at is null
    and (reporter_wallet_lower is null or reporter_wallet_lower = app.current_wallet())
  );
create policy abuse_select on public.abuse_reports for select to app_api using (app.is_staff());
create policy abuse_update on public.abuse_reports for update to app_api
  using (app.is_staff()) with check (app.is_staff());

-- audit_logs: dopisywanie (aktor = zalogowany portfel albo SYSTEM bez portfela); odczyt tylko ADMIN.
create policy audit_insert on public.audit_logs for insert to app_api
  with check (
    (actor_type = 'USER' and actor_wallet_lower = app.current_wallet())
    or (actor_type = 'ADMIN' and actor_wallet_lower = app.current_wallet() and app.is_staff())
  );
create policy audit_select on public.audit_logs for select to app_api using (app.is_staff('ADMIN'));
create policy audit_insert_indexer on public.audit_logs for insert to app_indexer
  with check (actor_type = 'INDEXER');

-- donor_profiles: tylko własny profil (publiczność przez widok).
create policy profiles_select_own on public.donor_profiles for select to app_api
  using (wallet_lower = app.current_wallet());
create policy profiles_insert_own on public.donor_profiles for insert to app_api
  with check (wallet_lower = app.current_wallet());
create policy profiles_update_own on public.donor_profiles for update to app_api
  using (wallet_lower = app.current_wallet()) with check (wallet_lower = app.current_wallet());

create policy stats_select_own on public.donor_stats for select to app_api
  using (wallet_lower = app.current_wallet());

-- system_flags: czytają wszyscy (UI musi znać stan awaryjnego wyłączenia), zapisuje ADMIN.
create policy flags_select on public.system_flags for select to app_api using (true);
create policy flags_update on public.system_flags for update to app_api
  using (app.is_staff('ADMIN')) with check (app.is_staff('ADMIN'));

-- ---------------------------------------------------------------------------------------------
-- Polityki: app_indexer i app_auth
-- ---------------------------------------------------------------------------------------------
create policy indexer_all on public.chain_events for all to app_indexer using (true) with check (true);
create policy indexer_all on public.chain_event_history for all to app_indexer using (true) with check (true);
create policy indexer_all on public.donations for all to app_indexer using (true) with check (true);
create policy indexer_all on public.donor_stats for all to app_indexer using (true) with check (true);
create policy indexer_all on public.indexer_cursors for all to app_indexer using (true) with check (true);
create policy indexer_campaigns_select on public.campaigns for select to app_indexer using (true);
create policy indexer_campaigns_update on public.campaigns for update to app_indexer using (true) with check (true);
create policy indexer_reports_select on public.impact_reports for select to app_indexer using (true);
create policy indexer_reports_update on public.impact_reports for update to app_indexer using (true) with check (true);

create policy auth_nonces on public.siwe_nonces for all to app_auth using (true) with check (true);
create policy auth_sessions on public.sessions for all to app_auth using (true) with check (true);

-- ---------------------------------------------------------------------------------------------
-- Wyzwalacze autoryzacji kolumn i przejść (tylko dla żądań użytkowników: current_user = app_api)
-- ---------------------------------------------------------------------------------------------
create function app.organizations_authz() returns trigger
language plpgsql
as $$
begin
  if current_user <> 'app_api' or app.is_staff('ADMIN') then
    return new;
  end if;
  if tg_op = 'UPDATE' and (
       new.status <> old.status or new.safe_address_lower is distinct from old.safe_address_lower
       or new.safe_chain_id is distinct from old.safe_chain_id or new.verified_at is distinct from old.verified_at
       or new.verification_expires_at is distinct from old.verification_expires_at
       or new.legal_name <> old.legal_name or new.country_code <> old.country_code
     ) then
    raise exception 'Status, Safe, weryfikacja i dane prawne organizacji zmienia tylko administrator'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger organizations_authz before insert or update on public.organizations
  for each row execute function app.organizations_authz();

create function app.organization_private_authz() returns trigger
language plpgsql
as $$
begin
  if current_user <> 'app_api' or app.is_staff('ADMIN') then
    return new;
  end if;
  if new.kyb_result is not null or new.kyb_reviewed_by is not null or new.kyb_reviewed_at is not null
     or new.retention_until is not null then
    raise exception 'Wynik KYB i retencję ustawia tylko administrator' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger organization_private_authz before insert or update on public.organization_private
  for each row execute function app.organization_private_authz();

create function app.members_authz() returns trigger
language plpgsql
as $$
begin
  if current_user <> 'app_api' or app.is_staff('ADMIN') then
    return new;
  end if;
  -- Właściciel zarządza członkami swojej organizacji, ale nie przenosi wierszy i nie nadaje OWNER-a.
  if tg_op = 'UPDATE' and (new.organization_id <> old.organization_id or new.wallet_lower <> old.wallet_lower) then
    raise exception 'Nie można przenieść członkostwa' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.role = 'OWNER' and old.role <> 'OWNER' then
    raise exception 'Rolę OWNER nadaje tylko administrator' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger members_authz before update on public.organization_members
  for each row execute function app.members_authz();

-- Kampania: kto może wykonać które przejście i które pola.
create function app.campaigns_authz() returns trigger
language plpgsql
as $$
begin
  if current_user <> 'app_api' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    -- Fakty z łańcucha ustawia wyłącznie indexer (app_indexer), nigdy żądanie użytkownika.
    if new.onchain_campaign_id is distinct from old.onchain_campaign_id
       or new.published_tx_hash is distinct from old.published_tx_hash
       or new.status in ('PUBLISHED', 'PAUSED', 'CLOSED') and new.status is distinct from old.status then
      raise exception 'Dane i statusy z łańcucha ustawia tylko indexer' using errcode = '42501';
    end if;
    if new.status is distinct from old.status then
      if app.is_staff('ADMIN') then
        null; -- ADMIN: przejścia redakcyjne i przygotowanie publikacji
      elsif app.is_staff('REVIEWER') then
        if not ((old.status, new.status) in (
             ('SUBMITTED', 'UNDER_REVIEW'), ('UNDER_REVIEW', 'APPROVED'), ('UNDER_REVIEW', 'REJECTED'), ('UNDER_REVIEW', 'DRAFT')
           )) then
          raise exception 'Recenzent nie może wykonać przejścia % -> %', old.status, new.status using errcode = '42501';
        end if;
      else
        -- Członek organizacji: tylko DRAFT -> SUBMITTED (i powrót SUBMITTED -> DRAFT przed rozpoczęciem przeglądu).
        if not ((old.status, new.status) in (('DRAFT', 'SUBMITTED'), ('SUBMITTED', 'DRAFT'))) then
          raise exception 'Członek organizacji nie może wykonać przejścia % -> %', old.status, new.status
            using errcode = '42501';
        end if;
      end if;
    end if;
    -- Zatwierdzenie i pola decyzji: tylko personel; zatwierdzającym jest wywołujący (nie podszywanie się).
    if (new.approved_by_wallet_lower is distinct from old.approved_by_wallet_lower
        or new.metadata_hash is distinct from old.metadata_hash) and not app.is_staff() then
      raise exception 'Zatwierdzenie i hash metadanych ustawia tylko personel' using errcode = '42501';
    end if;
    if new.approved_by_wallet_lower is distinct from old.approved_by_wallet_lower
       and new.approved_by_wallet_lower is not null and new.approved_by_wallet_lower <> app.current_wallet() then
      raise exception 'Zatwierdzającym może być tylko zalogowany recenzent' using errcode = '42501';
    end if;
    -- Treść i warunki może edytować członek organizacji wyłącznie w DRAFT; personel nie edytuje treści autora.
    if old.status <> 'DRAFT' and not app.is_staff() and (
         new.title <> old.title or new.summary <> old.summary or new.description_md <> old.description_md
         or new.category <> old.category or new.cap_raw <> old.cap_raw or new.start_at <> old.start_at
         or new.end_at <> old.end_at or new.beneficiary_lower <> old.beneficiary_lower
         or new.slug <> old.slug or new.cover_asset_id is distinct from old.cover_asset_id
       ) then
      raise exception 'Treść kampanii można edytować tylko w DRAFT' using errcode = '42501';
    end if;
    if app.is_staff() and not app.is_org_member(old.organization_id) and old.status <> 'DRAFT' and (
         new.title <> old.title or new.summary <> old.summary or new.description_md <> old.description_md
         or new.category <> old.category or new.cap_raw <> old.cap_raw or new.start_at <> old.start_at
         or new.end_at <> old.end_at or new.beneficiary_lower <> old.beneficiary_lower or new.slug <> old.slug
       ) then
      raise exception 'Personel nie edytuje treści kampanii autora' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger campaigns_authz before update on public.campaigns
  for each row execute function app.campaigns_authz();

create function app.impact_reports_authz() returns trigger
language plpgsql
as $$
begin
  if current_user <> 'app_api' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    return new;
  end if;
  -- Pola łańcuchowe: tylko indexer.
  if new.onchain_report_id is distinct from old.onchain_report_id or new.publish_tx_hash is distinct from old.publish_tx_hash
     or new.review_tx_hash is distinct from old.review_tx_hash or new.content_sha256 is distinct from old.content_sha256
     or new.public_uri is distinct from old.public_uri
     or (new.status in ('PUBLISHED', 'VERIFIED', 'REVOKED') and new.status is distinct from old.status) then
    raise exception 'Dane i statusy z łańcucha ustawia tylko indexer' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if app.is_staff() then
      null;
    elsif not ((old.status, new.status) in (('DRAFT', 'SUBMITTED'), ('SUBMITTED', 'DRAFT'))) then
      raise exception 'Członek organizacji nie może wykonać przejścia raportu % -> %', old.status, new.status
        using errcode = '42501';
    end if;
  end if;
  if old.status <> 'DRAFT' and not app.is_staff() and (
       new.public_json_storage_path is distinct from old.public_json_storage_path
       or new.period_start <> old.period_start or new.period_end <> old.period_end
     ) then
    raise exception 'Treść raportu można edytować tylko w DRAFT' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger impact_reports_authz before update on public.impact_reports
  for each row execute function app.impact_reports_authz();

create function app.abuse_reports_authz() returns trigger
language plpgsql
as $$
begin
  if current_user = 'app_api' and tg_op = 'UPDATE' and app.is_staff() then
    if new.handled_by is not null and new.handled_by <> app.current_wallet() then
      raise exception 'Obsługującym może być tylko zalogowany członek personelu' using errcode = '42501';
    end if;
    if new.details_private <> old.details_private or new.reporter_wallet_lower is distinct from old.reporter_wallet_lower
       or new.category <> old.category or new.campaign_id is distinct from old.campaign_id then
      raise exception 'Treści zgłoszenia nie wolno zmieniać' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger abuse_reports_authz before update on public.abuse_reports
  for each row execute function app.abuse_reports_authz();

create function app.system_flags_authz() returns trigger
language plpgsql
as $$
begin
  if current_user = 'app_api' and new.updated_by is distinct from app.current_wallet() then
    raise exception 'updated_by musi wskazywać zalogowanego administratora' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger system_flags_authz before update on public.system_flags
  for each row execute function app.system_flags_authz();

-- ---------------------------------------------------------------------------------------------
-- Widoki publiczne (whitelist kolumn; bez danych prywatnych). Działają z uprawnieniami właściciela.
-- ---------------------------------------------------------------------------------------------
create view public.public_organizations with (security_barrier = true) as
  select id, display_name, country_code, safe_address_lower, safe_chain_id, verified_at
    from public.organizations where status = 'APPROVED';

create view public.public_campaigns with (security_barrier = true) as
  select id, organization_id, chain_id, onchain_campaign_id, slug, title, summary, description_md, category, status,
         cap_raw, start_at, end_at, beneficiary_lower, metadata_hash, cover_asset_id, published_tx_hash, created_at
    from public.campaigns where status in ('PUBLISHED', 'PAUSED', 'CLOSED');

create view public.public_donations with (security_barrier = true) as
  select id, campaign_id, chain_id, onchain_campaign_id, donor_wallet_lower, amount_raw, block_time
    from public.donations where status = 'CONFIRMED';

create view public.public_reports with (security_barrier = true) as
  select id, campaign_id, version, status, public_uri, content_sha256, onchain_report_id, publish_tx_hash,
         review_tx_hash, period_start, period_end, created_at
    from public.impact_reports where onchain_report_id is not null;

create view public.public_donor_profiles with (security_barrier = true) as
  select chain_id, wallet_lower, display_name, avatar_asset_id, bio
    from public.donor_profiles where profile_public;

create view public.public_leaderboard with (security_barrier = true) as
  select s.chain_id, s.wallet_lower, p.display_name, s.total_donated_raw, s.xp, s.tier
    from public.donor_stats s
    join public.donor_profiles p on p.chain_id = s.chain_id and p.wallet_lower = s.wallet_lower
   where p.profile_public and p.leaderboard_opt_in;

-- Informacja zwrotna dla organizacji: tylko decyzja i POWÓD PUBLICZNY, nigdy reason_private.
create view public.campaign_review_feedback with (security_barrier = true) as
  select r.campaign_id, r.decision, r.reason_public, r.created_at
    from public.campaign_reviews r
   where app.is_staff() or app.campaign_org(r.campaign_id) in (select app.my_org_ids());

do $$
declare
  grantee text;
begin
  foreach grantee in array array['anon', 'authenticated', 'app_api'] loop
    if exists (select 1 from pg_roles where rolname = grantee) then
      execute format(
        'grant select on public.public_organizations, public.public_campaigns, public.public_donations, '
        'public.public_reports, public.public_donor_profiles, public.public_leaderboard to %I',
        grantee
      );
    end if;
  end loop;
end;
$$;
grant select on public.campaign_review_feedback to app_api;
