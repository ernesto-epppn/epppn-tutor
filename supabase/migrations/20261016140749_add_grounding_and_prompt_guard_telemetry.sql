alter table public.ernesto_runtime_events
  add column if not exists grounding_status text,
  add column if not exists grounding_source text,
  add column if not exists prompt_guard text,
  add column if not exists numeric_guard_triggered boolean not null default false;

alter table public.ernesto_runtime_events
  drop constraint if exists ernesto_runtime_events_grounding_status_check;

alter table public.ernesto_runtime_events
  add constraint ernesto_runtime_events_grounding_status_check
  check (grounding_status is null or grounding_status in ('documented','contextualize','insufficient'));
