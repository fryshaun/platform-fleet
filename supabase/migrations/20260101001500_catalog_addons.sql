-- =============================================================================
-- 15 · Extras
-- =============================================================================
-- The things a hire can add on top of the unit itself: a helmet, a lock, a
-- damage waiver, a child seat. Three tables, and one rule that shapes all three:
--
--   addons              · the catalogue: what this workspace offers, and at
--                         what price
--   addon_products      · which products an extra is offered with. **No rows
--                         means every product**, which is what lets a shop that
--                         never switches the products section on still use the
--                         catalogue.
--   booking_line_addons · the extras a booking actually took, anchored on the
--                         *line* rather than on the booking
--
-- Extras hang off `booking_line_items`, not off `bookings`, because that is the
-- only row that knows which product was hired — and the product is what decides
-- which extras are on offer. A line's product therefore cannot change while the
-- line carries extras: `booking_line_items_product_guard` refuses it, and the
-- desk removes the extras first. That is one extra click in a rare case, in
-- exchange for never silently re-pricing a line somebody already agreed to.
--
-- The price is **snapshotted**, not followed. `booking_line_addons_snapshot`
-- copies `price_cents` and `price_kind` on insert only, so raising the catalogue
-- price next month cannot re-price last month's hire. `booking_line_items` does
-- the opposite with its window on purpose — the window is the booking's, and a
-- line whose dates drifted would break the exclusion constraint.
--
-- Extras hold no stock *in this file*. The count and the check that goes with it
-- arrive in migration 17, which extends the same trigger.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
-- Complete on creation, like every other ladder in this schema: PostgreSQL
-- requires a new tick to commit before another statement may use it, so a new
-- member costs a migration of its own.
--
--   per_booking · charged once, however long the hire runs
--   per_day     · charged for each day of the booking window
do $$
begin
  if not exists (select 1 from pg_type where typname = 'addon_price_kind') then
    create type public.addon_price_kind as enum ('per_booking', 'per_day');
  end if;
end
$$;

-- `archived` hides an extra from the picker without touching the bookings that
-- already took it. Deleting a used extra is refused by a foreign key, so
-- archiving is the verb the catalogue page offers.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'addon_status') then
    create type public.addon_status as enum ('active', 'archived');
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- addons
-- -----------------------------------------------------------------------------
-- A catalogue row, not a stock item. `max_quantity` is what one booking line may
-- take of it, and it lives here rather than in a trigger because it is a
-- property of the offer: "two helmets per hire" is a shop policy, not a booking
-- detail.
create table if not exists public.addons (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  -- The address the catalogue page uses. Unique inside the workspace, like a
  -- product's, so two shops may both offer a "helmet".
  handle text not null
    check (handle ~ '^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])$'),
  description text,
  -- Money in the currency's minor unit, like every other price in the schema.
  price_cents integer not null default 0 check (price_cents >= 0),
  price_kind public.addon_price_kind not null default 'per_booking',
  -- A ceiling rather than a default: the form starts at one and the action
  -- refuses more.
  max_quantity integer not null default 1
    check (max_quantity between 1 and 99),
  status public.addon_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, handle),
  -- The target of the composite keys below. An extra can only ever be
  -- referenced together with its own company, which makes tenancy a shape
  -- rather than a policy.
  unique (company_id, id)
);

comment on column public.addons.price_kind is
  'per_booking charges once; per_day multiplies by the booking window.';
comment on column public.addons.max_quantity is
  'The most one booking line may take of this extra.';

create index if not exists addons_company_status_idx
  on public.addons (company_id, status, name);

drop trigger if exists addons_set_updated_at on public.addons;
create trigger addons_set_updated_at
  before update on public.addons
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- addon_products
-- -----------------------------------------------------------------------------
-- The scope. Read it as an allowlist that only exists once somebody wrote one:
--
--   no rows for an extra · offered with every product
--   one or more rows      · offered with those products, and no others
--
-- A join row means nothing without either side, so both foreign keys cascade.
-- The composite keys mean a row cannot point at another workspace's product even
-- if a policy were wrong.
create table if not exists public.addon_products (
  company_id uuid not null references public.companies (id) on delete cascade,
  addon_id uuid not null,
  product_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (company_id, addon_id, product_id),
  constraint addon_products_addon_fk
    foreign key (company_id, addon_id)
    references public.addons (company_id, id)
    on delete cascade,
  constraint addon_products_product_fk
    foreign key (company_id, product_id)
    references public.products (company_id, id)
    on delete cascade
);

-- The other direction of the same question: "which extras does this product
-- offer?" — the one the booking page asks.
create index if not exists addon_products_product_idx
  on public.addon_products (company_id, product_id);

-- -----------------------------------------------------------------------------
-- booking_line_items · the key the extras point at
-- -----------------------------------------------------------------------------
-- `booking_line_items` was created without `unique (company_id, id)`: nothing
-- pointed at it until now. Adding it here rather than editing migration 13 keeps
-- an applied migration untouched, and it is the only way to give the table below
-- a composite foreign key — which is what stops a line in one workspace carrying
-- an extra from another.
--
-- Guarded so the file is re-runnable; PostgreSQL has no `add constraint if not
-- exists`.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'booking_line_items_company_id_unique'
       and conrelid = 'public.booking_line_items'::regclass
  ) then
    alter table public.booking_line_items
      add constraint booking_line_items_company_id_unique
      unique (company_id, id);
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- booking_line_addons
-- -----------------------------------------------------------------------------
-- One row per extra a line took. There is deliberately **no** `booking_id`
-- column: the booking is reached through the line, and storing it twice would
-- let the two disagree — a row claiming a booking the line does not belong to.
-- `tests/db/schema.test.ts` asserts the column's absence so nobody "helpfully"
-- adds it back.
--
-- `price_kind` and `unit_price_cents` are copies, taken once when the extra is
-- added (see the trigger below). A catalogue price is an offer; what the renter
-- owes is what the desk agreed to on the day.
create table if not exists public.booking_line_addons (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  line_item_id uuid not null,
  addon_id uuid not null,
  quantity integer not null default 1 check (quantity between 1 and 99),
  unit_price_cents integer not null default 0 check (unit_price_cents >= 0),
  price_kind public.addon_price_kind not null default 'per_booking',
  created_at timestamptz not null default now(),
  -- One row per extra per line: taking two helmets is `quantity = 2`, not two
  -- rows, which is what makes the stock check in migration 17 a single read.
  unique (company_id, line_item_id, addon_id),
  -- Deleting the line takes its extras with it: they are part of that line, and
  -- a line without its extras would silently re-price the hire.
  constraint booking_line_addons_line_fk
    foreign key (company_id, line_item_id)
    references public.booking_line_items (company_id, id)
    on delete cascade,
  -- The catalogue row stays while any booking uses it. `23503` from here is what
  -- turns "Delete" into "Archive" on the catalogue page.
  constraint booking_line_addons_addon_fk
    foreign key (company_id, addon_id)
    references public.addons (company_id, id)
    on delete restrict
);

comment on column public.booking_line_addons.unit_price_cents is
  'Copied from the catalogue when the extra was added. Never re-priced.';
comment on column public.booking_line_addons.price_kind is
  'Copied with the price, so a later change of offer cannot rewrite history.';

-- "Which extras are on this booking?" — the board's money column and the line
-- list both ask it, and both are scoped by company.
create index if not exists booking_line_addons_line_idx
  on public.booking_line_addons (company_id, line_item_id);
create index if not exists booking_line_addons_addon_idx
  on public.booking_line_addons (company_id, addon_id);

-- -----------------------------------------------------------------------------
-- booking_line_addons_snapshot · price, scope, ceiling
-- -----------------------------------------------------------------------------
-- Three jobs in one `before` trigger, because all three need to read rows the
-- caller may not be allowed to see:
--
--   1. copy the catalogue price and kind onto the row, on insert only
--   2. refuse an extra that this line's product does not offer
--   3. refuse more of one extra than the catalogue allows on a line
--
-- SECURITY DEFINER with an empty `search_path`: the answer must not change
-- because the caller's RLS happens to hide a row the trigger reads. Every table
-- is therefore schema-qualified.
create or replace function public.booking_line_addons_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  catalogue_price integer;
  catalogue_kind public.addon_price_kind;
  catalogue_status public.addon_status;
  catalogue_max integer;
  line_product uuid;
  parent_product uuid;
begin
  -- `TG_OP` is uppercase in PL/pgSQL; a lowercase comparison here would skip
  -- this branch entirely and let the trigger copy nothing.
  if tg_op = 'UPDATE' then
    -- The anchor and the price are what the row *is*: neither moves once the
    -- extra is on the line. Quantity may change, so a desk can add a second
    -- helmet without re-adding the row.
    if new.line_item_id is distinct from old.line_item_id
       or new.addon_id is distinct from old.addon_id then
      raise exception 'An extra cannot be moved to another line or offer'
        using errcode = 'check_violation';
    end if;

    new.unit_price_cents := old.unit_price_cents;
    new.price_kind := old.price_kind;
  end if;

  select a.price_cents, a.price_kind, a.status, a.max_quantity
    into catalogue_price, catalogue_kind, catalogue_status, catalogue_max
    from public.addons a
   where a.id = new.addon_id
     and a.company_id = new.company_id;

  if not found then
    raise exception 'That extra is not in this workspace'
      using errcode = 'foreign_key_violation';
  end if;

  if new.quantity > catalogue_max then
    raise exception 'This extra allows at most % per line', catalogue_max
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    if catalogue_status <> 'active' then
      raise exception 'That extra is archived and cannot be added'
        using errcode = 'check_violation';
    end if;

    new.unit_price_cents := catalogue_price;
    new.price_kind := catalogue_kind;

    select l.product_id, p.parent_id
      into line_product, parent_product
      from public.booking_line_items l
      left join public.products p
        on p.company_id = l.company_id
       and p.id = l.product_id
     where l.id = new.line_item_id
       and l.company_id = new.company_id;

    if not found then
      raise exception 'An extra must belong to a line of the same company'
        using errcode = 'foreign_key_violation';
    end if;

    -- No rows in `addon_products` means the extra is offered with everything,
    -- which is what a workspace without the products section relies on. When
    -- there are rows, the line's product *or its parent* must be one of them:
    -- scoping to "Mountain bike" has to cover the medium and the large.
    if exists (
      select 1 from public.addon_products ap
       where ap.company_id = new.company_id
         and ap.addon_id = new.addon_id
    ) and not exists (
      select 1 from public.addon_products ap
       where ap.company_id = new.company_id
         and ap.addon_id = new.addon_id
         and ap.product_id in (line_product, parent_product)
    ) then
      raise exception 'That extra is not offered with the product on this line'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists booking_line_addons_snapshot on public.booking_line_addons;
create trigger booking_line_addons_snapshot
  before insert or update on public.booking_line_addons
  for each row execute function public.booking_line_addons_snapshot();

-- -----------------------------------------------------------------------------
-- booking_line_items_product_guard · a line with extras keeps its product
-- -----------------------------------------------------------------------------
-- The extras were chosen *because of* the product on the line, and their prices
-- are snapshots of offers scoped to it. Swapping the product underneath would
-- leave a helmet attached to a kayak, at a price nobody quoted for one.
--
-- One extra click for the desk (remove the extras, change the product, add them
-- back) instead of a cascade that quietly deletes priced rows. Note the trigger
-- is `before update of product_id` *and* compares old with new: the edit form
-- always sends the product, and a line whose product did not change must not be
-- refused.
create or replace function public.booking_line_items_product_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.product_id is not distinct from old.product_id then
    return new;
  end if;

  if exists (
    select 1
      from public.booking_line_addons a
     where a.company_id = new.company_id
       and a.line_item_id = new.id
  ) then
    raise exception 'Remove the extras from this line before changing its product'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists booking_line_items_product_guard on public.booking_line_items;
create trigger booking_line_items_product_guard
  before update of product_id on public.booking_line_items
  for each row execute function public.booking_line_items_product_guard();

-- -----------------------------------------------------------------------------
-- set_addon_products · replace an extra's scope in one statement
-- -----------------------------------------------------------------------------
-- "Offered with these products, and no others" is a replace, not a diff: the
-- form sends the whole list. Doing it from the client would be two writes that
-- can fail between each other, leaving an extra scoped to nothing — which the
-- schema reads as *every* product. That is the dangerous failure, so the delete
-- and the inserts happen together or not at all.
--
-- An empty array clears the scope, which is exactly "offered with everything".
create or replace function public.set_addon_products(
  target_addon_id uuid,
  product_ids uuid[] default '{}'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_company uuid;
begin
  select a.company_id
    into target_company
    from public.addons a
   where a.id = target_addon_id;

  if target_company is null then
    raise exception 'That extra is no longer here'
      using errcode = 'no_data_found';
  end if;

  -- The function writes as its owner, so the tenancy check is the whole of its
  -- authorization. Manager, because the scope is part of what the shop offers.
  if not public.is_company_member(target_company)
     or not public.has_company_role(
       target_company,
       array['owner', 'admin', 'manager']::public.member_role[]
     ) then
    raise exception 'You do not have permission to do that'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.addon_products ap
   where ap.company_id = target_company
     and ap.addon_id = target_addon_id;

  insert into public.addon_products (company_id, addon_id, product_id)
  select target_company, target_addon_id, p.id
    from public.products p
   where p.company_id = target_company
     and p.id = any(coalesce(product_ids, '{}'::uuid[]))
  on conflict do nothing;

  return (
    select count(*)::integer
      from public.addon_products ap
     where ap.company_id = target_company
       and ap.addon_id = target_addon_id
  );
end;
$$;

comment on function public.set_addon_products(uuid, uuid[]) is
  'Replaces an extra''s product scope atomically. An empty array means every product.';

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.addons enable row level security;
alter table public.addon_products enable row level security;
alter table public.booking_line_addons enable row level security;

-- The catalogue belongs to the bookings section, not to products: it is the
-- desk's offer list, and a workspace that switched bookings off has no use for
-- it. `tests/db/schema.test.ts` asserts this, because "it looked like a product
-- table" is the obvious wrong guess.
--
-- Reads are open to every member — a viewer pricing up a hire needs to see the
-- helmet — and writes are manager work, like a product's.
drop policy if exists "addons_select_member" on public.addons;
create policy "addons_select_member"
  on public.addons for select
  to authenticated
  using (
    public.is_company_member(company_id)
    and public.has_company_section(company_id, 'bookings')
  );

drop policy if exists "addons_insert_manager" on public.addons;
create policy "addons_insert_manager"
  on public.addons for insert
  to authenticated
  with check (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager']::public.member_role[]
    )
    and public.has_company_section(company_id, 'bookings')
  );

drop policy if exists "addons_update_manager" on public.addons;
create policy "addons_update_manager"
  on public.addons for update
  to authenticated
  using (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager']::public.member_role[]
    )
    and public.has_company_section(company_id, 'bookings')
  )
  with check (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager']::public.member_role[]
    )
    and public.has_company_section(company_id, 'bookings')
  );

drop policy if exists "addons_delete_manager" on public.addons;
create policy "addons_delete_manager"
  on public.addons for delete
  to authenticated
  using (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager']::public.member_role[]
    )
    and public.has_company_section(company_id, 'bookings')
  );

-- The scope rows are part of the catalogue row, so they carry the same four
-- policies rather than a policy of their own shape. The form writes them through
-- `set_addon_products`, which asks the same questions again in SQL.
drop policy if exists "addon_products_select_member" on public.addon_products;
create policy "addon_products_select_member"
  on public.addon_products for select
  to authenticated
  using (
    public.is_company_member(company_id)
    and public.has_company_section(company_id, 'bookings')
  );

drop policy if exists "addon_products_insert_manager" on public.addon_products;
create policy "addon_products_insert_manager"
  on public.addon_products for insert
  to authenticated
  with check (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager']::public.member_role[]
    )
    and public.has_company_section(company_id, 'bookings')
  );

drop policy if exists "addon_products_update_manager" on public.addon_products;
create policy "addon_products_update_manager"
  on public.addon_products for update
  to authenticated
  using (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager']::public.member_role[]
    )
    and public.has_company_section(company_id, 'bookings')
  )
  with check (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager']::public.member_role[]
    )
    and public.has_company_section(company_id, 'bookings')
  );

drop policy if exists "addon_products_delete_manager" on public.addon_products;
create policy "addon_products_delete_manager"
  on public.addon_products for delete
  to authenticated
  using (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager']::public.member_role[]
    )
    and public.has_company_section(company_id, 'bookings')
  );

-- The extras on a line are part of editing a booking, so they are front-desk
-- work: a staff member adding a helmet at collection must not need a manager.
drop policy if exists "booking_line_addons_select_member" on public.booking_line_addons;
create policy "booking_line_addons_select_member"
  on public.booking_line_addons for select
  to authenticated
  using (
    public.is_company_member(company_id)
    and public.has_company_section(company_id, 'bookings')
  );

drop policy if exists "booking_line_addons_insert_frontdesk" on public.booking_line_addons;
create policy "booking_line_addons_insert_frontdesk"
  on public.booking_line_addons for insert
  to authenticated
  with check (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager', 'staff']::public.member_role[]
    )
    and public.has_company_section(company_id, 'bookings')
  );

drop policy if exists "booking_line_addons_update_frontdesk" on public.booking_line_addons;
create policy "booking_line_addons_update_frontdesk"
  on public.booking_line_addons for update
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

drop policy if exists "booking_line_addons_delete_frontdesk" on public.booking_line_addons;
create policy "booking_line_addons_delete_frontdesk"
  on public.booking_line_addons for delete
  to authenticated
  using (
    public.has_company_role(
      company_id,
      array['owner', 'admin', 'manager', 'staff']::public.member_role[]
    )
    and public.has_company_section(company_id, 'bookings')
  );

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
-- Supabase grants EXECUTE on new `public` functions to `anon` explicitly, so
-- every helper is revoked from it by name — the rule migrations 01–04 follow.

-- A scope replace is a session's call, once the section and the tier check out.
revoke all on function public.set_addon_products(uuid, uuid[]) from public, anon;
grant execute on function public.set_addon_products(uuid, uuid[]) to authenticated, service_role;

-- Trigger-only functions: no client role may execute these. PostgreSQL does not
-- check EXECUTE when firing a trigger, so this changes nothing for the triggers.
revoke all on function public.booking_line_addons_snapshot() from public, anon, authenticated;
revoke all on function public.booking_line_items_product_guard() from public, anon, authenticated;

grant execute on function public.booking_line_addons_snapshot() to service_role;
grant execute on function public.booking_line_items_product_guard() to service_role;

