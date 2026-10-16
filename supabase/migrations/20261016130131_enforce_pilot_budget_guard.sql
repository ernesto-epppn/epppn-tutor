create or replace function public.ernesto_current_month_tutor_cost_usd()
returns numeric
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select coalesce(sum(estimated_cost_usd), 0)::numeric
  from public.ernesto_runtime_events
  where route = '/api/tutor'
    and created_at >= (
      date_trunc('month', timezone('Europe/Paris', now()))
      at time zone 'Europe/Paris'
    );
$$;

revoke all on function public.ernesto_current_month_tutor_cost_usd()
  from public, anon, authenticated;
grant execute on function public.ernesto_current_month_tutor_cost_usd()
  to service_role;

insert into public.ernesto_daily_quotas (
  user_id, quota_date, request_count, image_request_count, last_request_at, updated_at
)
select
  user_id,
  (timezone('Europe/Paris', created_at))::date as quota_date,
  count(*)::integer as request_count,
  count(*) filter (where image_count > 0)::integer as image_request_count,
  max(created_at) as last_request_at,
  now()
from public.ernesto_runtime_events
where route = '/api/tutor'
  and user_id is not null
  and (timezone('Europe/Paris', created_at))::date = (timezone('Europe/Paris', now()))::date
group by user_id, (timezone('Europe/Paris', created_at))::date
on conflict (user_id, quota_date) do update
set request_count = greatest(public.ernesto_daily_quotas.request_count, excluded.request_count),
    image_request_count = greatest(public.ernesto_daily_quotas.image_request_count, excluded.image_request_count),
    last_request_at = greatest(public.ernesto_daily_quotas.last_request_at, excluded.last_request_at),
    updated_at = now();
