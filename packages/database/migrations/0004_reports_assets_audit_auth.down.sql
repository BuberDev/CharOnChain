-- Rollback 0004_reports_assets_audit_auth.
drop trigger if exists campaigns_cover_guard on public.campaigns;

drop table if exists public.donor_profiles;
drop table if exists public.system_flags;
drop table if exists public.sessions;
drop table if exists public.siwe_nonces;
drop table if exists public.audit_logs;
drop table if exists public.abuse_reports;
drop table if exists public.impact_report_reviews;
drop table if exists public.impact_reports;
drop table if exists public.assets;

drop function if exists app.purge_expired_auth();
drop function if exists app.session_wallet(text);
drop function if exists app.consume_siwe_nonce(text, integer, integer, app.evm_address);
drop function if exists app.consume_siwe_nonce(text, text, integer, app.evm_address);
drop function if exists app.forbid_truncate();
drop function if exists app.impact_report_reviews_guard();
drop function if exists app.impact_reports_guard();
drop function if exists app.report_transition_allowed(app.report_status, app.report_status);
drop function if exists app.campaigns_cover_guard();

drop type if exists app.abuse_category;
drop type if exists app.abuse_status;
drop type if exists app.actor_type;
drop type if exists app.report_decision;
drop type if exists app.report_status;
drop type if exists app.asset_visibility;
