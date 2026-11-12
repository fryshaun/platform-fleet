-- =============================================================================
-- 22 · Service intervals
-- =============================================================================
-- What a workshop needs next: which parts are due, and which are overdue.
--
-- Three pieces:
--
--   * the intervals, on `component_kinds` — a shop services every "full
--     suspension" frame at the same cadence, so the number belongs to the kind,
--     not to each part. Three units are offered and any of them may be left
--     empty; an interval of zero means "not measured that way".
--   * `component_service_events` — the services that happened, so the clock can
--     be reset without touching the part.
--   * `component_service_status` — a view that derives the answer every time it
--     is read. Nothing stores "due": a stored flag would have to be refreshed by
--     a scheduled job, and would be wrong between runs.
--
-- Usage comes from `asset_usage_logs` (migration 21), attributed to a component
-- through its unit and clipped to the fitted window *and* to the last service —
-- a part that came off in March was not worn by April's rides, and a part
-- serviced in March starts again from zero.
--
-- `due_soon` is 80% of an interval. A workshop that only hears about a service
-- when it is already overdue is a workshop that books it late.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- component_kinds · the intervals
-- -----------------------------------------------------------------------------
alter table public.component_kinds
  add column if not exists interval_days integer;
alter table public.component_kinds
  add column if not exists interval_km numeric(10, 2);
alter table public.component_kinds
  add column if not exists interval_hours numeric(8, 2);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'component_kinds_interval_check'
       and conrelid = 'public.component_kinds'::regclass
  ) then
    alter table public.component_kinds
      add constraint component_kinds_interval_check check (
        (interval_days is null or interval_days >= 0)
        and (interval_km is null or interval_km >= 0)
        and (interval_hours is null or interval_hours >= 0)
      );
  end if;
end
$$;

comment on column public.component_kinds.interval_days is
  'Days between services. NULL or 0 means the kind is not measured in days.';
comment on column public.component_kinds.interval_km is
  'Kilometres between services, from the usage logs of the unit it is fitted to.';
comment on column public.component_kinds.interval_hours is
  'Hours between services, from the same logs.';

-- -----------------------------------------------------------------------------
-- component_service_events
-- -----------------------------------------------------------------------------
-- One row per service. `serviced_on` is what resets the interval; the part, its
-- kind and its unit are untouched, so a service can never disturb what the part
-- is or where it is fitted.
create table if not exists public.component_service_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  component_id uuid not null,
  serviced_on date not null default current_date,
  notes text,
  created_at timestamptz not null default now(),
  constraint component_service_events_component_fk
    foreign key (company_id, component_id)
    references public.asset_components (company_id, id)
    on delete cascade
);

comment on column public.component_service_events.serviced_on is
  'The day the service happened. The interval counts from here.';

create index if not exists component_service_events_company_component_idx
  on public.component_service_events (company_id, component_id, serviced_on desc);

-- -----------------------------------------------------------------------------
-- component_service_status · derived, never stored
-- -----------------------------------------------------------------------------
-- One row per component. `counted_from` is the later of the fitting and the last
-- service, which is what makes the arithmetic mean "wear since it was last seen
-- to". Usage is summed from the unit's readings inside that window.
--
-- A component in the parts bin has no unit, so it has no mileage and only its
-- age counts — which is the honest answer for a part on a shelf.
--
-- `security_invoker = true`: the view runs on the caller's side of RLS, so one
-- workspace cannot read another's service state.
create or replace view public.component_service_status
with (security_invoker = true)
as
with parts as (
  select
    c.id as component_id,
    c.company_id,
    c.asset_id,
    c.name,
    c.fitted_on,
    c.removed_on,
    coalesce(k.interval_days, 0) as interval_days,
    coalesce(k.interval_km, 0)::numeric as interval_km,
    coalesce(k.interval_hours, 0)::numeric as interval_hours,
    greatest(
      c.fitted_on,
      coalesce(
        (
          select max(e.serviced_on)
            from public.component_service_events e
           where e.company_id = c.company_id
             and e.component_id = c.id
        ),
        c.fitted_on
      )
    ) as counted_from
  from public.asset_components c
  left join public.component_kinds k
    on k.company_id = c.company_id
   and k.id = c.kind_id
)
select
  p.company_id,
  p.component_id,
  p.asset_id,
  p.name,
  p.interval_days,
  p.interval_km,
  p.interval_hours,
  p.counted_from,
  greatest(current_date - p.counted_from, 0) as days_since,
  coalesce(
    (
      select sum(l.hours)
        from public.asset_usage_logs l
       where l.company_id = p.company_id
         and l.asset_id = p.asset_id
         and l.logged_on >= p.counted_from
         and (p.removed_on is null or l.logged_on < p.removed_on)
    ),
    0
  ) as hours_since,
  coalesce(
    (
      select sum(l.distance_km)
        from public.asset_usage_logs l
       where l.company_id = p.company_id
         and l.asset_id = p.asset_id
         and l.logged_on >= p.counted_from
         and (p.removed_on is null or l.logged_on < p.removed_on)
    ),
    0
  ) as km_since,
  case
    when (p.interval_days > 0
          and current_date - p.counted_from >= p.interval_days)
      or (p.interval_km > 0
          and coalesce((
            select sum(l.distance_km)
              from public.asset_usage_logs l
             where l.company_id = p.company_id
               and l.asset_id = p.asset_id
               and l.logged_on >= p.counted_from
               and (p.removed_on is null or l.logged_on < p.removed_on)
          ), 0) >= p.interval_km)
      or (p.interval_hours > 0
          and coalesce((
            select sum(l.hours)
              from public.asset_usage_logs l
             where l.company_id = p.company_id
               and l.asset_id = p.asset_id
               and l.logged_on >= p.counted_from
               and (p.removed_on is null or l.logged_on < p.removed_on)
          ), 0) >= p.interval_hours)
      then 'overdue'
    when (p.interval_days > 0
          and current_date - p.counted_from >= p.interval_days * 0.8)
      or (p.interval_km > 0
          and coalesce((
            select sum(l.distance_km)
              from public.asset_usage_logs l
             where l.company_id = p.company_id
               and l.asset_id = p.asset_id
               and l.logged_on >= p.counted_from
               and (p.removed_on is null or l.logged_on < p.removed_on)
          ), 0) >= p.interval_km * 0.8)
      or (p.interval_hours > 0
          and coalesce((
            select sum(l.hours)
              from public.asset_usage_logs l
             where l.company_id = p.company_id
               and l.asset_id = p.asset_id
               and l.logged_on >= p.counted_from
               and (p.removed_on is null or l.logged_on < p.removed_on)
          ), 0) >= p.interval_hours * 0.8)
      then 'due_soon'
    else 'ok'
  end as status
from parts p;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
-- A service event is workshop bookkeeping: the front desk records one, and a
-- manager is who removes one, because deleting a service moves the interval
-- back to "overdue" for everybody reading it.
alter table public.component_service_events enable row level security;

drop policy if exists "component_service_events_select_member" on public.component_service_events;
create policy "component_service_events_select_member"
  on public.component_service_events for select
  to authenticated
  using (
    public.is_company_member(company_id)
    and public.has_company_section(company_id, 'assets')
  );

drop policy if exists "component_service_events_insert_frontdesk" on public.component_service_events;
create policy "component_service_events_insert_frontdesk"
  on public.component_service_events for insert
  to authenticated
  with check (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager', 'staff']::public.member_role[]
    )
    and public.has_company_section(company_id, 'assets')
  );

drop policy if exists "component_service_events_update_frontdesk" on public.component_service_events;
create policy "component_service_events_update_frontdesk"
  on public.component_service_events for update
  to authenticated
  using (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager', 'staff']::public.member_role[]
    )
    and public.has_company_section(company_id, 'assets')
  )
  with check (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager', 'staff']::public.member_role[]
    )
    and public.has_company_section(company_id, 'assets')
  );

drop policy if exists "component_service_events_delete_manager" on public.component_service_events;
create policy "component_service_events_delete_manager"
  on public.component_service_events for delete
  to authenticated
  using (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager']::public.member_role[]
    )
    and public.has_company_section(company_id, 'assets')
  );

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
-- The view is read through RLS on the tables underneath (security_invoker), but
-- nothing anonymous has any business reading a workshop's service state.
revoke all on public.component_service_status from anon;
grant select on public.component_service_status to authenticated, service_role;
