-- Ernesto pilot hardening: server-only corpus + per-student quotas/rate limits.

create table if not exists public.ernesto_daily_quotas (
  user_id uuid not null references auth.users(id) on delete cascade,
  quota_date date not null,
  request_count integer not null default 0 check (request_count >= 0),
  image_request_count integer not null default 0 check (image_request_count >= 0),
  violation_count integer not null default 0 check (violation_count >= 0),
  last_request_at timestamptz,
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, quota_date)
);

create index if not exists ernesto_daily_quotas_date_idx
  on public.ernesto_daily_quotas (quota_date desc);

alter table public.ernesto_daily_quotas enable row level security;
revoke all on table public.ernesto_daily_quotas from anon, authenticated;
grant all on table public.ernesto_daily_quotas to service_role;

create or replace function public.check_and_consume_ernesto_quota(
  p_user_id uuid,
  p_image_count integer default 0,
  p_request_limit integer default 40,
  p_image_limit integer default 10,
  p_min_interval_seconds integer default 4
)
returns table(
  allowed boolean,
  reason text,
  requests_used integer,
  requests_remaining integer,
  image_requests_used integer,
  image_requests_remaining integer,
  blocked_until timestamptz
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_today date := (timezone('Europe/Paris', now()))::date;
  v_row public.ernesto_daily_quotas%rowtype;
  v_now timestamptz := now();
  v_violations integer;
  v_blocked_until timestamptz;
begin
  insert into public.ernesto_daily_quotas(user_id, quota_date)
  values (p_user_id, v_today)
  on conflict (user_id, quota_date) do nothing;

  select *
  into v_row
  from public.ernesto_daily_quotas
  where user_id = p_user_id and quota_date = v_today
  for update;

  if v_row.blocked_until is not null and v_row.blocked_until > v_now then
    return query select false, 'temporary_block'::text,
      v_row.request_count, greatest(0, p_request_limit - v_row.request_count),
      v_row.image_request_count, greatest(0, p_image_limit - v_row.image_request_count),
      v_row.blocked_until;
    return;
  end if;

  if v_row.last_request_at is not null
     and v_now - v_row.last_request_at < make_interval(secs => greatest(1, p_min_interval_seconds)) then
    v_violations := v_row.violation_count + 1;
    v_blocked_until := case when v_violations >= 5 then v_now + interval '15 minutes' else null end;

    update public.ernesto_daily_quotas
    set violation_count = v_violations,
        blocked_until = v_blocked_until,
        updated_at = v_now
    where user_id = p_user_id and quota_date = v_today;

    return query select false,
      case when v_blocked_until is null then 'rate_limited'::text else 'temporary_block'::text end,
      v_row.request_count, greatest(0, p_request_limit - v_row.request_count),
      v_row.image_request_count, greatest(0, p_image_limit - v_row.image_request_count),
      v_blocked_until;
    return;
  end if;

  if v_row.request_count >= p_request_limit then
    return query select false, 'daily_query_limit'::text,
      v_row.request_count, 0,
      v_row.image_request_count, greatest(0, p_image_limit - v_row.image_request_count),
      null::timestamptz;
    return;
  end if;

  if greatest(0, p_image_count) > 0 and v_row.image_request_count >= p_image_limit then
    return query select false, 'daily_image_limit'::text,
      v_row.request_count, greatest(0, p_request_limit - v_row.request_count),
      v_row.image_request_count, 0,
      null::timestamptz;
    return;
  end if;

  update public.ernesto_daily_quotas
  set request_count = request_count + 1,
      image_request_count = image_request_count + case when greatest(0, p_image_count) > 0 then 1 else 0 end,
      violation_count = greatest(0, violation_count - 1),
      blocked_until = null,
      last_request_at = v_now,
      updated_at = v_now
  where user_id = p_user_id and quota_date = v_today
  returning * into v_row;

  return query select true, 'ok'::text,
    v_row.request_count, greatest(0, p_request_limit - v_row.request_count),
    v_row.image_request_count, greatest(0, p_image_limit - v_row.image_request_count),
    null::timestamptz;
end;
$$;

revoke all on function public.check_and_consume_ernesto_quota(uuid, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.check_and_consume_ernesto_quota(uuid, integer, integer, integer, integer)
  to service_role;

revoke all on table public.documents from anon, authenticated;
revoke all on table public.document_chunks from anon, authenticated;
grant all on table public.documents to service_role;
grant all on table public.document_chunks to service_role;

revoke all on function public.match_chunks(vector, integer) from public, anon, authenticated;
grant execute on function public.match_chunks(vector, integer) to service_role;
