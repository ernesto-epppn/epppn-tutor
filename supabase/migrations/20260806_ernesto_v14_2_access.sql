-- Ernesto v14.2 — pilot access control
-- Apply in Supabase SQL Editor before deploying the v14.2 branch.

alter table if exists public.epppn_allowed_emails
  add column if not exists full_name text,
  add column if not exists invited_at timestamptz,
  add column if not exists invited_by uuid,
  add column if not exists last_login_at timestamptz,
  add column if not exists last_security_event_at timestamptz,
  add column if not exists last_security_event text;

create unique index if not exists epppn_allowed_emails_email_lower_idx
  on public.epppn_allowed_emails (lower(email));

create index if not exists epppn_allowed_emails_active_idx
  on public.epppn_allowed_emails (active, access_ends_at);

create index if not exists epppn_allowed_emails_bound_user_idx
  on public.epppn_allowed_emails (activated_user_id)
  where activated_user_id is not null;

-- Prevent two allowlist entries from being bound to the same Auth user.
create unique index if not exists epppn_allowed_emails_one_user_idx
  on public.epppn_allowed_emails (activated_user_id)
  where activated_user_id is not null;

-- Recommended pilot default: four months, never more than six.
alter table if exists public.epppn_allowed_emails
  alter column access_months set default 4;

alter table if exists public.epppn_allowed_emails
  drop constraint if exists epppn_allowed_emails_access_months_check;

alter table if exists public.epppn_allowed_emails
  add constraint epppn_allowed_emails_access_months_check
  check (access_months between 1 and 6);

-- The table must remain server-only. The service role bypasses RLS.
alter table if exists public.epppn_allowed_emails enable row level security;

revoke all on table public.epppn_allowed_emails from anon, authenticated;

grant all on table public.epppn_allowed_emails to service_role;
