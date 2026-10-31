-- Cofnięcie 0002_chain_projection. Uwaga: usuwa dane projekcji (można je odtworzyć z łańcucha, docs/03 §1).
-- Zabezpieczenia na produkcji: runner odmawia `down` w APP_ENV=production.
drop table if exists public.donations;
drop table if exists public.donor_stats;
drop table if exists public.indexer_cursors;
drop table if exists public.chain_event_history;
drop table if exists public.chain_events;
drop function if exists app.chain_events_track_changes();
drop function if exists app.chain_events_guard();
drop function if exists app.forbid_modification();
drop function if exists app.tier_from_raw(numeric);
drop function if exists app.xp_from_raw(numeric);
drop type if exists app.indexer_status;
drop type if exists app.donation_status;
drop type if exists app.confirmation_state;
