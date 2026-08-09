-- Ernesto v14.5 — interactive action-plan progress and database hardening

create table if not exists public.ernesto_action_plan_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null,
  message_id text not null,
  plan_title text not null default 'Plan d’action',
  step_count integer not null default 0 check (step_count between 0 and 5),
  completed_count integer not null default 0 check (completed_count between 0 and 5),
  retry_count integer not null default 0 check (retry_count between 0 and 5),
  statuses jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, project_id, message_id),
  check (completed_count <= step_count),
  check (jsonb_typeof(statuses) = 'array')
);

create index if not exists ernesto_action_plan_progress_user_updated_idx
  on public.ernesto_action_plan_progress (user_id, updated_at desc);

alter table public.ernesto_action_plan_progress enable row level security;

drop policy if exists "action plan progress select own" on public.ernesto_action_plan_progress;
create policy "action plan progress select own"
  on public.ernesto_action_plan_progress for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "action plan progress insert own" on public.ernesto_action_plan_progress;
create policy "action plan progress insert own"
  on public.ernesto_action_plan_progress for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "action plan progress update own" on public.ernesto_action_plan_progress;
create policy "action plan progress update own"
  on public.ernesto_action_plan_progress for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "action plan progress delete own" on public.ernesto_action_plan_progress;
create policy "action plan progress delete own"
  on public.ernesto_action_plan_progress for delete
  to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.ernesto_action_plan_progress to authenticated;
grant all on public.ernesto_action_plan_progress to service_role;

-- Avoid per-row auth function evaluation on the existing ownership policies.
drop policy if exists "dossier memory select own" on public.ernesto_dossier_memory;
create policy "dossier memory select own"
  on public.ernesto_dossier_memory for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "dossier memory insert own" on public.ernesto_dossier_memory;
create policy "dossier memory insert own"
  on public.ernesto_dossier_memory for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "dossier memory update own" on public.ernesto_dossier_memory;
create policy "dossier memory update own"
  on public.ernesto_dossier_memory for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "dossier memory delete own" on public.ernesto_dossier_memory;
create policy "dossier memory delete own"
  on public.ernesto_dossier_memory for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "answer feedback select own" on public.ernesto_answer_feedback;
create policy "answer feedback select own"
  on public.ernesto_answer_feedback for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "answer feedback insert own" on public.ernesto_answer_feedback;
create policy "answer feedback insert own"
  on public.ernesto_answer_feedback for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "usage_select_own" on public.user_usage;
create policy "usage_select_own"
  on public.user_usage for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "entitlements_select_own" on public.user_entitlements;
create policy "entitlements_select_own"
  on public.user_entitlements for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Harden function name resolution while preserving the current vector schema.
alter function public.match_chunks(vector, integer)
  set search_path = pg_catalog, public;

alter function public.set_updated_at()
  set search_path = pg_catalog;

create index if not exists document_chunks_document_id_idx
  on public.document_chunks (document_id);

drop index if exists public.user_entitlements_user_id_idx;
