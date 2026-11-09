-- =============================================================================
-- 04 · Assets
-- =============================================================================
-- The second optional module, and the one that makes a catalogue physical:
--
--   assets · the individual units behind a product, one row per unit
--
-- Three ideas shape this table.
--
--   * An asset is a *specific* unit, not a quantity. `bike-1`, `bike-2` and
--     `bike-3` are three rows sold as the variant "SMALL mountain bike", which
--     itself may sit under "Mountain bikes" in "Rental bikes". Taking one out of
--     action therefore removes exactly one unit from what the shop can promise.
--   * Assets are staff-facing. There is no storefront surface here and no
--     customer-facing policy: an asset is inventory bookkeeping, not a
--     catalogue entry. The product stays the thing customers see.
--   * Availability is *derived*, never copied. The rows are the truth and the
--     UI counts them (`lib/assets.ts`); nothing writes a count back onto
--     `products.inventory_quantity` or `product_dates.inventory_quantity`, so
--     the two can never disagree.
--
-- The module is opt-in and self-contained. `companies.enabled_sections` is the
-- switch, and every policy below asks `has_company_section(company_id,
-- 'assets')` — the assets key, never the products one. A workspace may run this
-- section with the products section switched off, which is why `product_id` is
-- nullable and cleared rather than cascaded when a product is deleted: a
-- physical bike does not stop existing because a catalogue row was removed.
--
-- Servicing, repair records and usage hours/distance belong to the future
-- service module. `metadata` and `status_changed_at` are the seams it will use:
-- this migration deliberately does not grow a servicing table it cannot yet
-- describe.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enum
-- -----------------------------------------------------------------------------
-- Complete on creation, like the ladders in migration 03: PostgreSQL requires a
-- new enum value to commit before another statement may use it, so growing this
-- one later costs a migration of its own. `maintenance` is the "out of action"
-- state — the unit exists, is expected back, and must not be booked today.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'asset_status') then
    create type public.asset_status as enum ('available', 'maintenance', 'retired');
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- assets
-- -----------------------------------------------------------------------------
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  -- The sellable row this unit is sold as — usually a variant. Nullable, and
  -- cleared when the product is deleted: PostgreSQL 15+ (Supabase's baseline)
  -- allows nulling the referencing column alone, which matters because a plain
  -- `on delete set null` would also null the NOT NULL `company_id`. An
  -- unassigned asset is a real state ("bought, not yet in the catalogue").
  product_id uuid,
  name text not null check (length(trim(name)) between 1 and 80),
  handle text not null check (handle ~ '^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])$'),
  -- The manufacturer's number: unique in practice but not guaranteed, and often
  -- recorded late, so it is validated for length and indexed case-insensitively
  -- rather than assumed to be complete.
  serial text check (serial is null or length(trim(serial)) between 1 and 120),
  status public.asset_status not null default 'available',
  -- Kept by the trigger below, so it cannot drift from `status`.
  status_changed_at timestamptz not null default now(),
  notes text,
  -- The extension point a module can use without a migration.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, handle),
  -- The target of any child table a later module adds. A row can only ever be
  -- referenced together with its own company, which makes that key a tenancy
  -- guard and not just a shape.
  unique (company_id, id),
  constraint assets_product_fk
    foreign key (company_id, product_id)
    references public.products (company_id, id)
    on delete set null (product_id)
);

comment on column public.assets.name is
  'What staff call this unit, e.g. "bike-1". Shown on the asset pages, never to customers.';
comment on column public.assets.handle is
  'URL segment for this unit. Unique per workspace, and the key the asset pages route on.';
comment on column public.assets.product_id is
  'The sellable row this unit fulfils. NULL means the unit is not assigned yet.';
comment on column public.assets.status is
  'available books; maintenance is out of action; retired has left the fleet.';
comment on column public.assets.status_changed_at is
  'When `status` last moved. Kept by trigger, so it is never stale.';
comment on column public.assets.metadata is
  'Free-form attributes the service module will use (hours, distance, purchase date, …).';

create index if not exists assets_company_status_idx
  on public.assets (company_id, status);
create index if not exists assets_product_idx
  on public.assets (company_id, product_id);

-- A serial number identifies one unit inside a fleet. Case-insensitive, because
-- suppliers are not careful about case, and partial because plenty of units are
-- recorded before their number is.
create unique index if not exists assets_serial_idx
  on public.assets (company_id, lower(serial))
  where serial is not null;

drop trigger if exists assets_set_updated_at on public.assets;
create trigger assets_set_updated_at
  before update on public.assets
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- status_changed_at
-- -----------------------------------------------------------------------------
-- A `default` only runs on insert, so the timestamp has to be stamped by a
-- trigger. SECURITY DEFINER with a pinned `search_path` for the same reason as
-- the other helpers: the trigger must not resolve `now()` or anything else
-- through a caller-controlled path.
create or replace function public.assets_stamp_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at = now();
  end if;

  return new;
end;
$$;

comment on function public.assets_stamp_status_change() is
  'Stamps `status_changed_at` whenever an asset moves between statuses.';

drop trigger if exists assets_stamp_status_change on public.assets;
create trigger assets_stamp_status_change
  before update of status on public.assets
  for each row execute function public.assets_stamp_status_change();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.assets enable row level security;

-- Two predicates decide everything below: membership says *who* may see the
-- rows, `has_company_section(company_id, 'assets')` says *whether the fleet
-- exists* for this workspace. Switching the section off therefore hides every
-- row without touching it.
--
-- Reading is member work — the fleet is shop information, like the catalogue.
-- Creating and deleting units is owner, admin and manager work. Updating is the
-- one place `staff` appears, and deliberately so: taking a unit out of action is
-- front-desk work, and a front desk that has to fetch a manager will either not
-- do it or book a broken bike. The Server Action narrows that to the status
-- field (`setAssetStatus`); the policy is row-level, so a staff token could
-- still reach other columns over REST. Anything stricter needs a separate
-- `asset_status_events` table, which belongs to the service module.
drop policy if exists "assets_select_member" on public.assets;
create policy "assets_select_member"
  on public.assets for select
  to authenticated
  using (
    public.is_company_member(company_id)
    and public.has_company_section(company_id, 'assets')
  );

drop policy if exists "assets_insert_manager" on public.assets;
create policy "assets_insert_manager"
  on public.assets for insert
  to authenticated
  with check (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager']::public.member_role[]
    )
    and public.has_company_section(company_id, 'assets')
  );

drop policy if exists "assets_update_frontdesk" on public.assets;
create policy "assets_update_frontdesk"
  on public.assets for update
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

drop policy if exists "assets_delete_manager" on public.assets;
create policy "assets_delete_manager"
  on public.assets for delete
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
-- Same rule as the earlier migrations: Supabase grants EXECUTE on new `public`
-- functions to `anon` explicitly, so revoking from `public` alone leaves them
-- reachable by anonymous clients.
--
-- Trigger-only: no client role may execute this. PostgreSQL does not check
-- EXECUTE when firing a trigger, so this changes nothing for the trigger itself.
revoke all on function public.assets_stamp_status_change() from public, anon, authenticated;
grant execute on function public.assets_stamp_status_change() to service_role;

