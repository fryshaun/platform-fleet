-- =============================================================================
-- 03 · Products and product categories
-- =============================================================================
-- The first domain module on top of the tenancy core:
--
--   product_categories  · the shop's aisles, flat and tenant-scoped
--   products            · a sellable item, or one of its variants
--   product_media       · a product's gallery: images and video
--   product_dates       · date-based inventory for bookable items
--
-- Three ideas shape the schema.
--
--   * A variant is a *row*, not a child table: `products.parent_id` points at
--     the parent product, so price, SKU, stock and gallery work the same way
--     whether or not a product has variants. One level of nesting is allowed
--     and a trigger refuses a variant of a variant.
--   * Inventory is either one number (`track_inventory` + `inventory_quantity`)
--     or one row per bookable window in `product_dates`. `kind` says which.
--   * Every child row is keyed on `(company_id, …)` rather than on an id alone.
--     A row therefore cannot reference another tenant's product even if a
--     policy were wrong: the composite foreign key refuses it.
--
-- The section is opt-in. `companies.enabled_sections` is the switch, an owner
-- or admin flips it on Settings, and every policy below *also* asks
-- `has_company_section()`. Switching a section off hides its rows; it never
-- deletes them.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The section switch
-- -----------------------------------------------------------------------------
-- Keys are listed in `lib/features.ts` and are deliberately not spelled out
-- here, so adding a section needs no migration. An unknown key enables nothing,
-- because every policy asks for one specific key.
alter table public.companies
  add column if not exists enabled_sections text[] not null default '{}'::text[];

comment on column public.companies.enabled_sections is
  'Optional sections this workspace has switched on. Keys live in lib/features.ts.';

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
-- Each ladder is complete on creation: PostgreSQL requires a new enum value to
-- commit before another statement may use it, so growing one later costs a
-- migration of its own.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'product_status') then
    create type public.product_status as enum ('draft', 'active', 'archived');
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'product_kind') then
    create type public.product_kind as enum ('item', 'dated');
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'product_media_kind') then
    create type public.product_media_kind as enum ('image', 'video');
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Section predicate
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER for the same reason as the membership helpers: a policy on
-- `products` must not depend on the caller's own RLS grants on `companies`.
create or replace function public.has_company_section(
  target_company_id uuid,
  section text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.companies c
    where c.id = target_company_id
      and section = any (c.enabled_sections)
  );
$$;

comment on function public.has_company_section(uuid, text) is
  'True when the company has switched the named optional section on.';

-- Gallery objects are keyed by company in their first path segment. Turning
-- that segment into a uuid needs a guard: a policy is evaluated for every
-- object name in the bucket, including ones this module did not write.
create or replace function public.storage_company_id(object_name text)
returns uuid
language sql
immutable
as $$
  select case
    when split_part(object_name, '/', 1)
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(object_name, '/', 1)::uuid
  end;
$$;

comment on function public.storage_company_id(text) is
  'The company id a storage object belongs to, read from its first path segment.';

-- -----------------------------------------------------------------------------
-- product_categories
-- -----------------------------------------------------------------------------
-- Flat on purpose: a shop with two levels of "aisles" is a different feature,
-- and a tree is trivial to add later (`parent_id` here) without moving products
-- that already point at a category.
create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  handle text not null check (handle ~ '^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])$'),
  description text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, handle),
  -- The target of `products.category_id`. A category can only ever be
  -- referenced together with its own company, which is what makes the
  -- composite foreign key below a tenancy guard and not just a shape.
  unique (company_id, id)
);

comment on column public.product_categories.position is
  'Display order inside the shop. Equal values fall back to the name.';

create index if not exists product_categories_company_idx
  on public.product_categories (company_id, position);

-- -----------------------------------------------------------------------------
-- products
-- -----------------------------------------------------------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  -- Set only on a variant. One level: enforced by a trigger below.
  parent_id uuid,
  -- Cleared when the category is deleted. PostgreSQL 15+ (Supabase's baseline)
  -- allows nulling the referencing column alone, which matters here: a plain
  -- `on delete set null` would also null the NOT NULL `company_id`.
  category_id uuid,
  title text not null check (length(trim(title)) between 1 and 160),
  handle text not null check (handle ~ '^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])$'),
  description text,
  status public.product_status not null default 'draft',
  -- `item` stocks one number; `dated` stocks `product_dates` rows.
  kind public.product_kind not null default 'item',
  sku text check (sku is null or length(trim(sku)) between 1 and 64),
  supplier text check (supplier is null or length(trim(supplier)) between 1 and 120),
  -- Money is stored in the currency's minor unit, matching `lib/plans.ts`.
  price_cents integer not null default 0 check (price_cents >= 0),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  compare_at_price_cents integer
    check (compare_at_price_cents is null or compare_at_price_cents >= 0),
  track_inventory boolean not null default true,
  inventory_quantity integer
    check (inventory_quantity is null or inventory_quantity >= 0),
  -- The extension point for a module that needs more attributes without a new
  -- migration. `not null` so a reader can always dereference it.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, handle),
  unique (company_id, id),
  constraint products_not_its_own_parent check (parent_id is null or parent_id <> id),
  constraint products_parent_fk
    foreign key (company_id, parent_id)
    references public.products (company_id, id)
    on delete cascade,
  constraint products_category_fk
    foreign key (company_id, category_id)
    references public.product_categories (company_id, id)
    on delete set null (category_id)
);

comment on column public.products.parent_id is
  'The product this row is a variant of. NULL for a stand-alone product.';
comment on column public.products.inventory_quantity is
  'Stock for a `kind = item` product. NULL means "not counted yet".';
comment on column public.products.metadata is
  'Free-form attributes a storefront may need (barcode, weight, …).';

create index if not exists products_company_idx
  on public.products (company_id, created_at desc);
create index if not exists products_parent_idx
  on public.products (company_id, parent_id);
create index if not exists products_category_idx
  on public.products (company_id, category_id);

-- A SKU identifies one sellable row inside a shop. Case-insensitive, because
-- suppliers are not careful about case, and partial because a product without a
-- SKU is normal.
create unique index if not exists products_sku_idx
  on public.products (company_id, lower(sku))
  where sku is not null;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

drop trigger if exists product_categories_set_updated_at on public.product_categories;
create trigger product_categories_set_updated_at
  before update on public.product_categories
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- One level of variants
-- -----------------------------------------------------------------------------
-- A `check` constraint sees one row, so the depth rule needs a trigger. Both
-- directions are refused: a variant of a variant, and a product that already
-- has variants turning into one itself.
create or replace function public.products_check_variant_depth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.parent_id is null then
    return new;
  end if;

  if exists (
    select 1
    from public.products parent
    where parent.company_id = new.company_id
      and parent.id = new.parent_id
      and parent.parent_id is not null
  ) then
    raise exception 'A product variant cannot itself have variants'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1
    from public.products child
    where child.company_id = new.company_id
      and child.parent_id = new.id
  ) then
    raise exception 'A product with variants cannot become a variant'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists products_check_variant_depth on public.products;
create trigger products_check_variant_depth
  before insert or update of parent_id on public.products
  for each row execute function public.products_check_variant_depth();

-- -----------------------------------------------------------------------------
-- product_media
-- -----------------------------------------------------------------------------
-- One row per gallery item. A row has exactly one source: an object this app
-- uploaded (`storage_path`) or a link to media hosted elsewhere (`url`).
create table if not exists public.product_media (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  product_id uuid not null,
  kind public.product_media_kind not null default 'image',
  storage_path text,
  url text,
  alt text check (alt is null or length(trim(alt)) between 1 and 200),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  constraint product_media_product_fk
    foreign key (company_id, product_id)
    references public.products (company_id, id)
    on delete cascade,
  constraint product_media_single_source
    check ((storage_path is null) <> (url is null))
);

comment on column public.product_media.storage_path is
  'Object key inside the `product-media` bucket, e.g. <company>/<product>/<uuid>.jpg.';

create index if not exists product_media_product_idx
  on public.product_media (company_id, product_id, position);

-- The same object may not be attached to two gallery slots.
create unique index if not exists product_media_path_idx
  on public.product_media (company_id, storage_path)
  where storage_path is not null;

-- -----------------------------------------------------------------------------
-- product_dates
-- -----------------------------------------------------------------------------
-- Date-based inventory: one row per bookable window (a course run, a seasonal
-- menu, a hire period) with its own stock and optional price override. Rows are
-- capped by a range check rather than a trigger, because "starts before it ends"
-- is a property of a single row.
create table if not exists public.product_dates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  product_id uuid not null,
  starts_on date not null,
  ends_on date not null,
  inventory_quantity integer not null default 0 check (inventory_quantity >= 0),
  price_cents integer check (price_cents is null or price_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_dates_product_fk
    foreign key (company_id, product_id)
    references public.products (company_id, id)
    on delete cascade,
  constraint product_dates_range check (ends_on >= starts_on),
  unique (company_id, product_id, starts_on, ends_on)
);

comment on column public.product_dates.price_cents is
  'Price for this window. NULL means the product price applies.';

create index if not exists product_dates_product_idx
  on public.product_dates (company_id, product_id, starts_on);

drop trigger if exists product_dates_set_updated_at on public.product_dates;
create trigger product_dates_set_updated_at
  before update on public.product_dates
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.product_categories enable row level security;
alter table public.products enable row level security;
alter table public.product_media enable row level security;
alter table public.product_dates enable row level security;

-- Two predicates decide everything below: membership says *who* may see the
-- rows, `has_company_section` says *whether the shop exists* for this workspace.
-- Switching the section off therefore hides every row without touching it.
--
-- Writing (price, stock, gallery, categories) is owner, admin and manager work.
-- `staff` and `member` stay read-only here: a front-desk tier that may book or
-- adjust stock is a decision for a module that knows what a booking is.

drop policy if exists "products_select_member" on public.products;
create policy "products_select_member"
  on public.products for select
  to authenticated
  using (
    public.is_company_member(company_id)
    and public.has_company_section(company_id, 'products')
  );

drop policy if exists "products_insert_manager" on public.products;
create policy "products_insert_manager"
  on public.products for insert
  to authenticated
  with check (
    public.has_company_role(company_id, array['owner', 'admin', 'manager']::public.member_role[])
    and public.has_company_section(company_id, 'products')
  );

drop policy if exists "products_update_manager" on public.products;
create policy "products_update_manager"
  on public.products for update
  to authenticated
  using (
    public.has_company_role(company_id, array['owner', 'admin', 'manager']::public.member_role[])
    and public.has_company_section(company_id, 'products')
  )
  with check (
    public.has_company_role(company_id, array['owner', 'admin', 'manager']::public.member_role[])
    and public.has_company_section(company_id, 'products')
  );

drop policy if exists "products_delete_manager" on public.products;
create policy "products_delete_manager"
  on public.products for delete
  to authenticated
  using (
    public.has_company_role(company_id, array['owner', 'admin', 'manager']::public.member_role[])
    and public.has_company_section(company_id, 'products')
  );

drop policy if exists "product_categories_select_member" on public.product_categories;
create policy "product_categories_select_member"
  on public.product_categories for select
  to authenticated
  using (
    public.is_company_member(company_id)
    and public.has_company_section(company_id, 'products')
  );

drop policy if exists "product_categories_insert_manager" on public.product_categories;
create policy "product_categories_insert_manager"
  on public.product_categories for insert
  to authenticated
  with check (
    public.has_company_role(company_id, array['owner', 'admin', 'manager']::public.member_role[])
    and public.has_company_section(company_id, 'products')
  );

drop policy if exists "product_categories_update_manager" on public.product_categories;
create policy "product_categories_update_manager"
  on public.product_categories for update
  to authenticated
  using (
    public.has_company_role(company_id, array['owner', 'admin', 'manager']::public.member_role[])
    and public.has_company_section(company_id, 'products')
  )
  with check (
    public.has_company_role(company_id, array['owner', 'admin', 'manager']::public.member_role[])
    and public.has_company_section(company_id, 'products')
  );

drop policy if exists "product_categories_delete_manager" on public.product_categories;
create policy "product_categories_delete_manager"
  on public.product_categories for delete
  to authenticated
  using (
    public.has_company_role(company_id, array['owner', 'admin', 'manager']::public.member_role[])
    and public.has_company_section(company_id, 'products')
  );

drop policy if exists "product_media_select_member" on public.product_media;
create policy "product_media_select_member"
  on public.product_media for select
  to authenticated
  using (
    public.is_company_member(company_id)
    and public.has_company_section(company_id, 'products')
  );

drop policy if exists "product_media_insert_manager" on public.product_media;
create policy "product_media_insert_manager"
  on public.product_media for insert
  to authenticated
  with check (
    public.has_company_role(company_id, array['owner', 'admin', 'manager']::public.member_role[])
    and public.has_company_section(company_id, 'products')
  );

drop policy if exists "product_media_update_manager" on public.product_media;
create policy "product_media_update_manager"
  on public.product_media for update
  to authenticated
  using (
    public.has_company_role(company_id, array['owner', 'admin', 'manager']::public.member_role[])
    and public.has_company_section(company_id, 'products')
  )
  with check (
    public.has_company_role(company_id, array['owner', 'admin', 'manager']::public.member_role[])
    and public.has_company_section(company_id, 'products')
  );

drop policy if exists "product_media_delete_manager" on public.product_media;
create policy "product_media_delete_manager"
  on public.product_media for delete
  to authenticated
  using (
    public.has_company_role(company_id, array['owner', 'admin', 'manager']::public.member_role[])
    and public.has_company_section(company_id, 'products')
  );

drop policy if exists "product_dates_select_member" on public.product_dates;
create policy "product_dates_select_member"
  on public.product_dates for select
  to authenticated
  using (
    public.is_company_member(company_id)
    and public.has_company_section(company_id, 'products')
  );

drop policy if exists "product_dates_insert_manager" on public.product_dates;
create policy "product_dates_insert_manager"
  on public.product_dates for insert
  to authenticated
  with check (
    public.has_company_role(company_id, array['owner', 'admin', 'manager']::public.member_role[])
    and public.has_company_section(company_id, 'products')
  );

drop policy if exists "product_dates_update_manager" on public.product_dates;
create policy "product_dates_update_manager"
  on public.product_dates for update
  to authenticated
  using (
    public.has_company_role(company_id, array['owner', 'admin', 'manager']::public.member_role[])
    and public.has_company_section(company_id, 'products')
  )
  with check (
    public.has_company_role(company_id, array['owner', 'admin', 'manager']::public.member_role[])
    and public.has_company_section(company_id, 'products')
  );

drop policy if exists "product_dates_delete_manager" on public.product_dates;
create policy "product_dates_delete_manager"
  on public.product_dates for delete
  to authenticated
  using (
    public.has_company_role(company_id, array['owner', 'admin', 'manager']::public.member_role[])
    and public.has_company_section(company_id, 'products')
  );

-- -----------------------------------------------------------------------------
-- Gallery storage
-- -----------------------------------------------------------------------------
-- Media goes from the browser straight to Storage through a signed upload URL.
-- A Server Action would have to carry the file, and those are capped at 1 MB by
-- default (`serverActions.bodySizeLimit`) and at roughly 4.5 MB by the
-- serverless request body in front of them — far too small for a video.
--
-- The bucket is public because a storefront renders these URLs for visitors
-- without a session; a signed *read* URL would expire out from under it. Writes
-- are what need guarding, so every write policy reads the company id from the
-- first path segment (`<company>/<product>/<uuid>.<ext>`).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-media',
  'product-media',
  true,
  52428800,
  array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/avif',
    'video/mp4',
    'video/webm'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "product_media_objects_select" on storage.objects;
create policy "product_media_objects_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'product-media'
    and public.is_company_member(public.storage_company_id(name))
    and public.has_company_section(public.storage_company_id(name), 'products')
  );

drop policy if exists "product_media_objects_insert" on storage.objects;
create policy "product_media_objects_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'product-media'
    and public.has_company_role(
      public.storage_company_id(name),
      array['owner', 'admin', 'manager']::public.member_role[]
    )
    and public.has_company_section(public.storage_company_id(name), 'products')
  );

drop policy if exists "product_media_objects_update" on storage.objects;
create policy "product_media_objects_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'product-media'
    and public.has_company_role(
      public.storage_company_id(name),
      array['owner', 'admin', 'manager']::public.member_role[]
    )
    and public.has_company_section(public.storage_company_id(name), 'products')
  )
  with check (
    bucket_id = 'product-media'
    and public.has_company_role(
      public.storage_company_id(name),
      array['owner', 'admin', 'manager']::public.member_role[]
    )
    and public.has_company_section(public.storage_company_id(name), 'products')
  );

drop policy if exists "product_media_objects_delete" on storage.objects;
create policy "product_media_objects_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'product-media'
    and public.has_company_role(
      public.storage_company_id(name),
      array['owner', 'admin', 'manager']::public.member_role[]
    )
    and public.has_company_section(public.storage_company_id(name), 'products')
  );

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
-- Same rule as migrations 01 and 02: Supabase grants EXECUTE on new `public`
-- functions to `anon` explicitly, so revoking from `public` alone leaves them
-- reachable by anonymous clients. The storage policies call both helpers as the
-- signed-in user, so `authenticated` keeps EXECUTE on them.
revoke all on function public.has_company_section(uuid, text) from public, anon;
revoke all on function public.storage_company_id(text) from public, anon;

grant execute on function public.has_company_section(uuid, text) to authenticated, service_role;
grant execute on function public.storage_company_id(text) to authenticated, service_role;

-- Trigger-only: no client role may execute this. PostgreSQL does not check
-- EXECUTE when firing a trigger, so this changes nothing for the trigger itself.
revoke all on function public.products_check_variant_depth() from public, anon, authenticated;
grant execute on function public.products_check_variant_depth() to service_role;
