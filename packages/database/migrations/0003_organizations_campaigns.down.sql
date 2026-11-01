-- Rollback 0003_organizations_campaigns. Kolejność odwrotna do tworzenia.
alter table public.donations drop constraint if exists donations_campaign_fk;
alter table public.donations alter column campaign_id drop not null;

drop table if exists public.campaign_reviews;
drop table if exists public.campaign_revisions;
drop table if exists public.campaigns;
drop table if exists public.organization_members;
drop table if exists public.organization_private;
drop table if exists public.organizations;

drop function if exists app.campaign_reviews_guard();
drop function if exists app.forbid_update_delete();
drop function if exists app.forbid_delete();
drop function if exists app.campaigns_guard();
drop function if exists app.campaign_transition_allowed(app.campaign_status, app.campaign_status);

drop type if exists app.review_decision;
drop type if exists app.campaign_status;
drop type if exists app.member_role;
drop type if exists app.org_status;
