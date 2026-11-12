-- =============================================================================
-- 18 · Components
-- =============================================================================
-- The parts a unit is made of, and the kinds that group them: a fork, a shock, a
-- wheelset, a battery. Two tables:
--
--   component_kinds   · the taxonomy: "Fork", "Rear shock", "Wheelset". Company
--                       scoped and flat, mirroring `product_categories` — the
--                       precedent migration 02 set.
--   asset_components  · the parts themselves: a name, a serial, and the unit they
--                       are fitted to while `removed_on` is null.
--
-- A component is a *thing*, not a field on an asset. That is what lets it keep a
-- service history (migrations 22–23) and be booked on its own (migration 20),
-- and it is why removing one is a date rather than a delete: the history is the
-- reason the row exists.
--
-- The one rule enforced here: a unit may not hold two components of the same
-- kind at once. A partial unique index rather than a trigger, because it is a
-- statement about the rows and holds under concurrent writes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- component_kinds
-- -----------------------------------------------------------------------------
create table if not exists public.component_kinds (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  handle text not null
    check (handle ~ '^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])$'),
  -- Reading order on the picker; ties fall back to the name.
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, handle),
  -- The target of `asset_components`' composite key.
  unique (company_id, id)
);

comment on table public.component_kinds is
  'What kinds of part this workspace recognises, e.g. Fork, Rear shock.';

create index if not exists component_kinds_company_position_idx
  on public.component_kinds (company_id, position, name);

drop trigger if exists component_kinds_set_updated_at on public.component_kinds;
create trigger component_kinds_set_updated_at
  before update on public.component_kinds
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- asset_components
-- -----------------------------------------------------------------------------
-- `asset_id` is nullable on purpose: a component in the parts bin is not fitted
-- to anything yet, and it must be storable before somebody decides where it
-- goes. `removed_on` null means "fitted now"; a date means "came off then", and
-- the row stays for the service history.
create table if not exists public.asset_components (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  -- The kind is optional: a one-off part does not need a taxonomy row before it
  -- can be recorded.
  kind_id uuid,
  asset_id uuid,
  name text not null check (length(trim(name)) between 1 and 120),
  serial text,
  -- The fitted window, half-open like every other window in this schema:
  -- `[fitted_on, removed_on)`. `removed_on` null reads as "still fitted".
  fitted_on date not null default current_date,
  removed_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_components_window check (
    removed_on is null or removed_on > fitted_on
  ),
  constraint asset_components_serial_length check (
    serial is null or length(trim(serial)) between 1 and 120
  ),
  -- The target of `booking_line_items.component_id` (migration 20) and of the
  -- service events (migration 22).
  unique (company_id, id),
  -- A component whose unit is deleted stays in the parts bin rather than
  -- vanishing with it: the part still exists and still needs servicing.
  constraint asset_components_asset_fk
    foreign key (company_id, asset_id)
    references public.assets (company_id, id)
    on delete set null (asset_id),
  constraint asset_components_kind_fk
    foreign key (company_id, kind_id)
    references public.component_kinds (company_id, id)
    on delete set null (kind_id)
);

comment on column public.asset_components.removed_on is
  'When the part came off the unit. NULL means it is fitted now.';

create index if not exists asset_components_company_asset_idx
  on public.asset_components (company_id, asset_id);
create index if not exists asset_components_company_kind_idx
  on public.asset_components (company_id, kind_id);

-- One of each kind per unit. Two forks on one bike is a typo, not a fitting.
create unique index if not exists asset_components_fitted_kind_idx
  on public.asset_components (company_id, asset_id, kind_id)
  where asset_id is not null and kind_id is not null and removed_on is null;

drop trigger if exists asset_components_set_updated_at on public.asset_components;
create trigger asset_components_set_updated_at
  before update on public.asset_components
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
-- Both tables belong to the **assets** section: components are the internals of
-- a unit, and a workspace that switched the fleet off has no units to hang them
-- on. Reads are open to every member; the taxonomy is manager work like a
-- category, while fitting and removing a part is front-desk work — it happens in
-- the workshop, not in a planning meeting.
alter table public.component_kinds enable row level security;
alter table public.asset_components enable row level security;

drop policy if exists "component_kinds_select_member" on public.component_kinds;
create policy "component_kinds_select_member"
  on public.component_kinds for select
  to authenticated
  using (
    public.is_company_member(company_id)
    and public.has_company_section(company_id, 'assets')
  );

drop policy if exists "component_kinds_insert_manager" on public.component_kinds;
create policy "component_kinds_insert_manager"
  on public.component_kinds for insert
  to authenticated
  with check (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager']::public.member_role[]
    )
    and public.has_company_section(company_id, 'assets')
  );

drop policy if exists "component_kinds_update_manager" on public.component_kinds;
create policy "component_kinds_update_manager"
  on public.component_kinds for update
  to authenticated
  using (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager']::public.member_role[]
    )
    and public.has_company_section(company_id, 'assets')
  )
  with check (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager']::public.member_role[]
    )
    and public.has_company_section(company_id, 'assets')
  );

drop policy if exists "component_kinds_delete_manager" on public.component_kinds;
create policy "component_kinds_delete_manager"
  on public.component_kinds for delete
  to authenticated
  using (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager']::public.member_role[]
    )
    and public.has_company_section(company_id, 'assets')
  );

drop policy if exists "asset_components_select_member" on public.asset_components;
create policy "asset_components_select_member"
  on public.asset_components for select
  to authenticated
  using (
    public.is_company_member(company_id)
    and public.has_company_section(company_id, 'assets')
  );

drop policy if exists "asset_components_insert_frontdesk" on public.asset_components;
create policy "asset_components_insert_frontdesk"
  on public.asset_components for insert
  to authenticated
  with check (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager', 'staff']::public.member_role[]
    )
    and public.has_company_section(company_id, 'assets')
  );

drop policy if exists "asset_components_update_frontdesk" on public.asset_components;
create policy "asset_components_update_frontdesk"
  on public.asset_components for update
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

drop policy if exists "asset_components_delete_manager" on public.asset_components;
create policy "asset_components_delete_manager"
  on public.asset_components for delete
  to authenticated
  using (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager']::public.member_role[]
    )
    and public.has_company_section(company_id, 'assets')
  );
