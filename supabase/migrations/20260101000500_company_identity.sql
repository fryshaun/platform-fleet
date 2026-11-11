-- =============================================================================
-- 06 · Company identity
-- =============================================================================
-- What a workspace looks like, and what it sells in by default.
--
--   * `companies.currency` is the workspace default the product form pre-fills.
--     A product still stores its own `products.currency` — that column stays the
--     one every price is read against, so changing the default never re-prices
--     anything that already exists.
--   * `companies.logo_url` points at an object in the `company-logos` bucket.
--   * `companies.badge` is what the rail shows when there is no logo: one or two
--     characters, or an emoji. Null means "use the initials of the name", so a
--     workspace that never touches this field still looks finished.
--
-- Writes to all three go through `companies`, whose update policy is already
-- owner/admin only (migration 01) — no new grant is needed for the row itself.
--
-- The currency check deliberately mirrors `products.currency`: the database
-- accepts any three lowercase letters and the app decides which codes it offers,
-- so adding a currency later is a one-line change in `lib/products.ts` rather
-- than a migration.
alter table public.companies
  add column if not exists currency text not null default 'usd'
    check (currency ~ '^[a-z]{3}$'),
  add column if not exists logo_url text,
  add column if not exists badge text
    check (badge is null or length(badge) between 1 and 8);

comment on column public.companies.currency is
  'Default currency for new products. Each product still stores its own.';

comment on column public.companies.logo_url is
  'Public URL of the workspace mark in the `company-logos` bucket, or null.';

comment on column public.companies.badge is
  'One or two characters or an emoji shown when there is no logo; null means the initials of the name.';

-- -----------------------------------------------------------------------------
-- Logo storage
-- -----------------------------------------------------------------------------
-- The same arrangement as `avatars` and `product-media`: a public bucket, so the
-- rail and the workspace chooser can render the URL without a session, and write
-- policies that parse the company id out of the first path segment
-- (`<company>/<uuid>.<ext>`).
--
-- The read policy uses `is_company_member` rather than matching the folder
-- against `auth.uid()`: a logo belongs to the company, not to the person who
-- uploaded it, and every member of the company renders it. There is no section
-- check, unlike product media — identity is part of every workspace.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-logos',
  'company-logos',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp', 'image/avif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "company_logos_objects_select" on storage.objects;
create policy "company_logos_objects_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'company-logos'
    and public.is_company_member(public.storage_company_id(name))
  );

drop policy if exists "company_logos_objects_insert" on storage.objects;
create policy "company_logos_objects_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'company-logos'
    and public.has_company_role(
      public.storage_company_id(name),
      array['owner', 'admin']::public.member_role[]
    )
  );

drop policy if exists "company_logos_objects_update" on storage.objects;
create policy "company_logos_objects_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'company-logos'
    and public.has_company_role(
      public.storage_company_id(name),
      array['owner', 'admin']::public.member_role[]
    )
  )
  with check (
    bucket_id = 'company-logos'
    and public.has_company_role(
      public.storage_company_id(name),
      array['owner', 'admin']::public.member_role[]
    )
  );

drop policy if exists "company_logos_objects_delete" on storage.objects;
create policy "company_logos_objects_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'company-logos'
    and public.has_company_role(
      public.storage_company_id(name),
      array['owner', 'admin']::public.member_role[]
    )
  );
