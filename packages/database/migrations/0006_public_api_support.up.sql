-- COC-032 / AC-33: dowód transakcji w widoku wpłat oraz publiczny, zgrubny status projekcji indexera.
-- Widoki działają z uprawnieniami właściciela (tabele źródłowe pozostają niedostępne dla ról aplikacyjnych).

-- 1) public_donations: dopisujemy (na końcu — wymóg CREATE OR REPLACE VIEW) hash transakcji, indeks logu i numer
--    bloku zdarzenia źródłowego. Każda potwierdzona wpłata ma zdarzenie (klucz obcy NOT NULL), więc złączenie
--    nie zmienia zbioru wierszy. Pozwala to wskazać publicznie sprawdzalny dowód (link do eksploratora).
create or replace view public.public_donations with (security_barrier = true) as
  select d.id, d.campaign_id, d.chain_id, d.onchain_campaign_id, d.donor_wallet_lower, d.amount_raw, d.block_time,
         e.tx_hash, e.log_index, e.block_number
    from public.donations d
    join public.chain_events e on e.id = d.chain_event_id
   where d.status = 'CONFIRMED';

-- 2) Status projekcji: najsłabszy kursor wśród kontraktów sieci. Pozwala API oznaczyć sumy jako niefinalne, gdy
--    indexer stoi, ma błąd albo uzgadnianie z kontraktem się nie powiodło (AC-33). Brak wiersza = brak danych.
create view public.public_indexer_status with (security_barrier = true) as
  select chain_id,
         count(*)::int as cursors,
         min(last_scanned_block) as scanned_block,
         min(last_confirmed_block) as confirmed_block,
         bool_or(status = 'ERROR') as has_error,
         extract(epoch from (now() - min(updated_at)))::float8 as age_seconds
    from public.indexer_cursors
   group by chain_id;

do $$
declare
  grantee text;
begin
  foreach grantee in array array['anon', 'authenticated', 'app_api'] loop
    if exists (select 1 from pg_roles where rolname = grantee) then
      execute format('grant select on public.public_donations, public.public_indexer_status to %I', grantee);
    end if;
  end loop;
end;
$$;
