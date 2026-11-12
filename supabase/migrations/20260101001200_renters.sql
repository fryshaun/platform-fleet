-- =============================================================================
-- 12 · Renters
-- =============================================================================
-- The people a booking is for, kept apart from the staff who take it:
--
--   customers          · one row per renter, scoped to the workspace
--   rider_preferences  · what the shop needs to fit a bike to that renter
--
-- `profiles` is the auth table: one row per signed-in user of this app. A renter
-- is usually not a user at all — they call, they walk in, they book from a
-- phone — so minting them a profile would mean an account nobody asked for and a
-- membership the workspace would then have to manage. `profile_id` is nullable
-- for the one case where the two do overlap: a member of staff who also rents.
--
-- Both tables are gated twice, like every module table: membership decides
-- *who*, and `has_company_section(company_id, 'bookings')` decides whether the
-- section exists for the workspace at all. Reads are member work. Writes are
-- front-desk work, because the desk is what puts a walk-in into the book;
-- deleting a renter is manager work, because it takes their history with it.
--
-- Nothing here knows about bookings yet. Migration 13 points at these rows, and
-- the composite keys below are what let it do that without a cross-tenant
-- reference being expressible.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- customers
-- -----------------------------------------------------------------------------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  -- Set only when the renter also has an account here. Deleting that account
  -- keeps the renter: the shop still has a booking to honour.
  profile_id uuid references public.profiles (id) on delete set null,
  handle text not null check (handle ~ '^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])$'),
  full_name text not null check (length(trim(full_name)) between 1 and 120),
  email text check (email is null or length(trim(email)) between 3 and 254),
  phone text check (phone is null or length(trim(phone)) between 3 and 40),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, handle),
  -- The target of every composite key that names a renter. A booking can only
  -- point at a renter of its own company, which is what makes the foreign keys
  -- in migration 13 a tenancy guard rather than just a shape.
  unique (company_id, id)
);

comment on column public.customers.profile_id is
  'The account this renter signs in with, when they have one. NULL for a walk-in.';

-- Phone numbers and names are how the desk searches this table, and a renter is
-- often recorded before they book anything.
create index if not exists customers_company_name_idx
  on public.customers (company_id, full_name);

-- One renter per address inside a workspace. Case-insensitive, because the same
-- person types their address both ways; partial, because a walk-in may give only
-- a name and a phone number.
create unique index if not exists customers_email_idx
  on public.customers (company_id, lower(email))
  where email is not null;

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- rider_preferences
-- -----------------------------------------------------------------------------
-- One row per renter, created when the shop first fits something to them. The
-- measurements are what a bike shop actually asks for; `disciplines` is an array
-- for the same reason a renter can want both a commuter and a gravel bike.
create table if not exists public.rider_preferences (
  customer_id uuid primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  height_cm integer check (height_cm is null or height_cm between 50 and 260),
  weight_kg integer check (weight_kg is null or weight_kg between 10 and 300),
  inseam_cm integer check (inseam_cm is null or inseam_cm between 30 and 150),
  -- Free text rather than an enum: shops word this differently ("never ridden",
  -- "races crits") and a ladder would need a migration every time one adds a
  -- word. The form suggests, the column stores what was typed.
  riding_level text
    check (riding_level is null or length(trim(riding_level)) between 1 and 40),
  disciplines text[] not null default '{}',
  notes text,
  -- The extension point a later module may need without a new migration.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rider_preferences_customer_fk
    foreign key (company_id, customer_id)
    references public.customers (company_id, id)
    on delete cascade
);

comment on column public.rider_preferences.disciplines is
  'Free-form labels such as gravel or commuting. Empty when nobody asked.';

create index if not exists rider_preferences_company_idx
  on public.rider_preferences (company_id);

drop trigger if exists rider_preferences_set_updated_at on public.rider_preferences;
create trigger rider_preferences_set_updated_at
  before update on public.rider_preferences
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.customers enable row level security;
alter table public.rider_preferences enable row level security;

-- Reads: every member of the workspace, while the section is on. The desk needs
-- the renter's name and phone before it can take a booking, and a colleague
-- reading over their shoulder is not a leak worth blocking.
drop policy if exists "customers_select_member" on public.customers;
create policy "customers_select_member"
  on public.customers for select
  to authenticated
  using (
    public.is_company_member(company_id)
    and public.has_company_section(company_id, 'bookings')
  );

-- Writes: the front desk. A walk-in has no account, so the person taking the
-- booking is the only one who can create their record.
drop policy if exists "customers_insert_frontdesk" on public.customers;
create policy "customers_insert_frontdesk"
  on public.customers for insert
  to authenticated
  with check (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager', 'staff']::public.member_role[]
    )
    and public.has_company_section(company_id, 'bookings')
  );

drop policy if exists "customers_update_frontdesk" on public.customers;
create policy "customers_update_frontdesk"
  on public.customers for update
  to authenticated
  using (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager', 'staff']::public.member_role[]
    )
    and public.has_company_section(company_id, 'bookings')
  )
  with check (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager', 'staff']::public.member_role[]
    )
    and public.has_company_section(company_id, 'bookings')
  );

-- Removal is manager work: a renter that has bookings cannot be deleted at all
-- (migration 13 restricts the foreign key), so this only ever removes someone
-- the shop never actually served.
drop policy if exists "customers_delete_manager" on public.customers;
create policy "customers_delete_manager"
  on public.customers for delete
  to authenticated
  using (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager']::public.member_role[]
    )
    and public.has_company_section(company_id, 'bookings')
  );

-- `rider_preferences` follows the renter it belongs to. A row exists only for a
-- customer of this company — the composite key says so — so the same four
-- policies describe the whole rule.
drop policy if exists "rider_preferences_select_member" on public.rider_preferences;
create policy "rider_preferences_select_member"
  on public.rider_preferences for select
  to authenticated
  using (
    public.is_company_member(company_id)
    and public.has_company_section(company_id, 'bookings')
  );

drop policy if exists "rider_preferences_insert_frontdesk" on public.rider_preferences;
create policy "rider_preferences_insert_frontdesk"
  on public.rider_preferences for insert
  to authenticated
  with check (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager', 'staff']::public.member_role[]
    )
    and public.has_company_section(company_id, 'bookings')
  );

drop policy if exists "rider_preferences_update_frontdesk" on public.rider_preferences;
create policy "rider_preferences_update_frontdesk"
  on public.rider_preferences for update
  to authenticated
  using (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager', 'staff']::public.member_role[]
    )
    and public.has_company_section(company_id, 'bookings')
  )
  with check (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager', 'staff']::public.member_role[]
    )
    and public.has_company_section(company_id, 'bookings')
  );

drop policy if exists "rider_preferences_delete_manager" on public.rider_preferences;
create policy "rider_preferences_delete_manager"
  on public.rider_preferences for delete
  to authenticated
  using (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager']::public.member_role[]
    )
    and public.has_company_section(company_id, 'bookings')
  );
