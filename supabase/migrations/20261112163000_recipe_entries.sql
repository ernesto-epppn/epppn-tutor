-- Versioned recipes: preserve the 19 EPPPN source formulas in code.
-- The API alone is allowed to create/update entries, after checking the session
-- and either the recipe owner or a verified administrator.
create table if not exists public.ernesto_recipe_entries (
  id text primary key check (char_length(id) between 1 and 100),
  scope text not null check (scope in ('personal','official')),
  owner_id uuid references auth.users(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recipe_scope_owner check (
    (scope='official' and owner_id is null) or
    (scope='personal' and owner_id is not null and id like 'personal:%')
  )
);
create index if not exists ernesto_recipe_owner_idx on public.ernesto_recipe_entries(owner_id);
alter table public.ernesto_recipe_entries enable row level security;
revoke all on public.ernesto_recipe_entries from anon, authenticated;
grant select, insert, update, delete on public.ernesto_recipe_entries to service_role;
comment on table public.ernesto_recipe_entries is 'Admin-managed official recipe overrides and private student recipes. Access via authenticated server API only.';