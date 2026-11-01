-- Rollback 0005_rls_policies. Role (app_api, app_indexer, app_auth) są obiektami KLASTRA — nie są usuwane
-- (mogą być współdzielone przez inne bazy); odbieramy im uprawnienia przez DROP POLICY/DROP OWNED w tej bazie.
drop view if exists public.campaign_review_feedback;
drop view if exists public.public_leaderboard;
drop view if exists public.public_donor_profiles;
drop view if exists public.public_reports;
drop view if exists public.public_donations;
drop view if exists public.public_campaigns;
drop view if exists public.public_organizations;

drop trigger if exists system_flags_authz on public.system_flags;
drop trigger if exists abuse_reports_authz on public.abuse_reports;
drop trigger if exists impact_reports_authz on public.impact_reports;
drop trigger if exists campaigns_authz on public.campaigns;
drop trigger if exists members_authz on public.organization_members;
drop trigger if exists organization_private_authz on public.organization_private;
drop trigger if exists organizations_authz on public.organizations;
drop function if exists app.system_flags_authz();
drop function if exists app.abuse_reports_authz();
drop function if exists app.impact_reports_authz();
drop function if exists app.campaigns_authz();
drop function if exists app.members_authz();
drop function if exists app.organization_private_authz();
drop function if exists app.organizations_authz();

-- Polityki i uprawnienia ról aplikacyjnych w tej bazie.
drop owned by app_api, app_indexer, app_auth;

drop table if exists public.staff_members;
drop function if exists app.report_org(uuid);
drop function if exists app.campaign_status_of(uuid);
drop function if exists app.org_has_members(uuid);
drop function if exists app.campaign_org(uuid);
drop function if exists app.my_org_ids();
drop function if exists app.is_org_member(uuid, app.member_role[]);
drop function if exists app.is_staff(app.staff_role);
drop function if exists app.current_wallet();
drop type if exists app.staff_role;

alter function app.campaigns_guard() security invoker reset search_path;
alter function app.campaign_reviews_guard() security invoker reset search_path;
alter function app.impact_reports_guard() security invoker reset search_path;
alter function app.impact_report_reviews_guard() security invoker reset search_path;
alter function app.campaigns_cover_guard() security invoker reset search_path;
