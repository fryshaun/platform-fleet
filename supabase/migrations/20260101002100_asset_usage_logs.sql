-- =============================================================================
-- 21 · Usage logs
-- =============================================================================
-- How much a unit has actually been used, written by whoever hands it back:
-- "four hours, 38 km, rear brake rubbing". One row per reading, against the
-- unit rather than against a booking — a shop also rides its own fleet, and a
-- reading belongs to the machine either way.
--
-- Readings are **incremental**, not a cumulative odometer. A running total has
-- to be monotonically increasing across every row ever entered, and one typo
-- breaks it forever; "since the last reading" is also what the mechanic writes
-- on the worksheet. Two consequences worth knowing:
--
--   * no ordering constraint is needed, so a missing week can be filled in late;
--   * the sum is the only total, and it is computed when it is read.
--
-- A component's usage is *derived* from its unit's readings inside the fitted
-- window — `[fitted_on, removed_on)` — which is why migration 22's service view
-- joins the two. The half-open convention is what stops a reading logged on the
-- day a part came off being counted against the replacement as well.
-- =============================================================================

create table if not exists public.asset_usage_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  asset_id uuid not null,
  -- The day the use happened, not the day it was typed in. Back-dating a
  -- worksheet is normal, so this is deliberately not `default now()` alone.
  logged_on date not null default current_date,
  -- Hours to two decimals: `4.25` is four hours fifteen. Distance in kilometres.
  hours numeric(8, 2) not null default 0 check (hours >= 0),
  distance_km numeric(10, 2) not null default 0 check (distance_km >= 0),
  notes text,
  created_at timestamptz not null default now(),
  -- A reading that says nothing is not a reading. Zero of one and some of the
  -- other is fine — an hour of coaching covers no distance.
  constraint asset_usage_logs_reading check (hours > 0 or distance_km > 0),
  constraint asset_usage_logs_asset_fk
    foreign key (company_id, asset_id)
    references public.assets (company_id, id)
    on delete cascade
);

comment on column public.asset_usage_logs.hours is
  'Hours since the previous reading, not a cumulative total.';
comment on column public.asset_usage_logs.distance_km is
  'Kilometres since the previous reading, not an odometer.';

create index if not exists asset_usage_logs_company_asset_idx
  on public.asset_usage_logs (company_id, asset_id, logged_on desc);

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
-- The assets section owns the fleet's history. Reading it is open to every
-- member; writing a reading is the workshop's work, and deleting one is manager
-- work because it changes what a service interval has seen.
alter table public.asset_usage_logs enable row level security;

drop policy if exists "asset_usage_logs_select_member" on public.asset_usage_logs;
create policy "asset_usage_logs_select_member"
  on public.asset_usage_logs for select
  to authenticated
  using (
    public.is_company_member(company_id)
    and public.has_company_section(company_id, 'assets')
  );

drop policy if exists "asset_usage_logs_insert_frontdesk" on public.asset_usage_logs;
create policy "asset_usage_logs_insert_frontdesk"
  on public.asset_usage_logs for insert
  to authenticated
  with check (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager', 'staff']::public.member_role[]
    )
    and public.has_company_section(company_id, 'assets')
  );

drop policy if exists "asset_usage_logs_update_frontdesk" on public.asset_usage_logs;
create policy "asset_usage_logs_update_frontdesk"
  on public.asset_usage_logs for update
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

drop policy if exists "asset_usage_logs_delete_manager" on public.asset_usage_logs;
create policy "asset_usage_logs_delete_manager"
  on public.asset_usage_logs for delete
  to authenticated
  using (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager']::public.member_role[]
    )
    and public.has_company_section(company_id, 'assets')
  );
