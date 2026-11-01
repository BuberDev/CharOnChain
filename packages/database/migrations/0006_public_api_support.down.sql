drop view if exists public.public_indexer_status;

-- CREATE OR REPLACE VIEW nie potrafi usuwać kolumn: odtwarzamy widok z migracji 0005.
drop view if exists public.public_donations;
create view public.public_donations with (security_barrier = true) as
  select id, campaign_id, chain_id, onchain_campaign_id, donor_wallet_lower, amount_raw, block_time
    from public.donations where status = 'CONFIRMED';

do $$
declare
  grantee text;
begin
  foreach grantee in array array['anon', 'authenticated', 'app_api'] loop
    if exists (select 1 from pg_roles where rolname = grantee) then
      execute format('grant select on public.public_donations to %I', grantee);
    end if;
  end loop;
end;
$$;
