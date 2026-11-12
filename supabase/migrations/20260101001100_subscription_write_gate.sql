-- =============================================================================
-- 11 · Writes need a live subscription
-- =============================================================================
-- The billing columns are owned by the webhook (migration 10), which is what
-- makes this file possible: a workspace cannot write `subscription_status`
-- itself, so what this migration reads is what Stripe said.
--
-- The rule is deliberately narrow. Reads are never gated — nothing a workspace
-- stored disappears because a card expired, and a page that cannot show a
-- product cannot explain why. What closes is writing the things a subscription
-- pays for: products, categories, gallery, dates, the fleet, the renters and the
-- booking book, plus the `product-media` bucket they live in.
--
-- Deliberately *not* gated, because they are how a workspace repairs itself or
-- leaves: `companies` (settings, extensions, logo, MFA), `profiles` (the
-- account), `company_members` (the team), the logo and avatar buckets, and
-- every route under Settings → Billing.
--
-- Which statuses may write:
--
--   active, trialing      settled, and what a paid workspace looks like.
--   past_due              Stripe is still retrying the card and can return the
--                         subscription to `active` on its own. Locking someone
--                         out mid-dunning punishes the customer for the bank.
--   everything else       `none` (never subscribed — onboarding ends at
--                         Checkout, so this is a workspace that cancelled it),
--                         `canceled`, `unpaid`, `incomplete`,
--                         `incomplete_expired`, `paused`.
--
-- That set is wider than `hasLiveSubscription()` in `lib/billing/sync.ts`,
-- which also treats `unpaid` and `paused` as live because Stripe still holds a
-- subscription the billing portal can repair. "Manageable" and "writable" are
-- different questions answered by different functions;
-- `tests/db/schema.test.ts` reads this file and `lib/billing/entitlements.ts`
-- and fails if the two lists drift.
--
-- Enforcement shape: a *restrictive* policy per command. Postgres ANDs those
-- onto every permissive policy for the same table and command, so the paywall
-- is one legible block per table instead of a clause appended to a dozen role
-- checks. `service_role` bypasses RLS, so the webhook and the reconciler keep
-- writing while a workspace is read-only.
--
-- One asymmetry to know about: a failed `with check` (insert) surfaces as a
-- 403, a failed `using` on update or delete is a silent zero-row success. That
-- is why `requireWritableWorkspace()` in `lib/actions/support.ts` asks the same
-- question first — RLS decides, the action explains.
--
-- One guard lives in a later file, because a policy cannot name a table that
-- does not exist yet: Guard 5 for the renters and the booking book in
-- `20260101001400_bookings_write_gate.sql`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The predicate
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER for the same reason as `has_company_section`: a policy on
-- `products` must not depend on the caller's own RLS grants on `companies`.
-- The body is fully qualified, so an empty `search_path` resolves all of it.
create or replace function public.has_active_subscription(
  target_company_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.companies c
    where c.id = target_company_id
      and c.subscription_status in ('active', 'trialing', 'past_due')
  );
$$;

comment on function public.has_active_subscription(uuid) is
  'True when the company subscription is settled or in dunning, and the company may write.';

revoke all on function public.has_active_subscription(uuid) from public, anon;
grant execute on function public.has_active_subscription(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Guard 1: the catalogue
-- -----------------------------------------------------------------------------
-- Insert, update and delete for each table the products section owns. Select is
-- left alone on purpose: a read-only workspace still shows its catalogue.
drop policy if exists "products_insert_live_subscription" on public.products;
create policy "products_insert_live_subscription"
  on public.products as restrictive for insert
  to authenticated
  with check (public.has_active_subscription(company_id));

drop policy if exists "products_update_live_subscription" on public.products;
create policy "products_update_live_subscription"
  on public.products as restrictive for update
  to authenticated
  using (public.has_active_subscription(company_id))
  with check (public.has_active_subscription(company_id));

drop policy if exists "products_delete_live_subscription" on public.products;
create policy "products_delete_live_subscription"
  on public.products as restrictive for delete
  to authenticated
  using (public.has_active_subscription(company_id));

drop policy if exists "product_categories_insert_live_subscription" on public.product_categories;
create policy "product_categories_insert_live_subscription"
  on public.product_categories as restrictive for insert
  to authenticated
  with check (public.has_active_subscription(company_id));

drop policy if exists "product_categories_update_live_subscription" on public.product_categories;
create policy "product_categories_update_live_subscription"
  on public.product_categories as restrictive for update
  to authenticated
  using (public.has_active_subscription(company_id))
  with check (public.has_active_subscription(company_id));

drop policy if exists "product_categories_delete_live_subscription" on public.product_categories;
create policy "product_categories_delete_live_subscription"
  on public.product_categories as restrictive for delete
  to authenticated
  using (public.has_active_subscription(company_id));

drop policy if exists "product_dates_insert_live_subscription" on public.product_dates;
create policy "product_dates_insert_live_subscription"
  on public.product_dates as restrictive for insert
  to authenticated
  with check (public.has_active_subscription(company_id));

drop policy if exists "product_dates_update_live_subscription" on public.product_dates;
create policy "product_dates_update_live_subscription"
  on public.product_dates as restrictive for update
  to authenticated
  using (public.has_active_subscription(company_id))
  with check (public.has_active_subscription(company_id));

drop policy if exists "product_dates_delete_live_subscription" on public.product_dates;
create policy "product_dates_delete_live_subscription"
  on public.product_dates as restrictive for delete
  to authenticated
  using (public.has_active_subscription(company_id));

-- -----------------------------------------------------------------------------
-- Guard 2: the gallery rows
-- -----------------------------------------------------------------------------
drop policy if exists "product_media_insert_live_subscription" on public.product_media;
create policy "product_media_insert_live_subscription"
  on public.product_media as restrictive for insert
  to authenticated
  with check (public.has_active_subscription(company_id));

drop policy if exists "product_media_update_live_subscription" on public.product_media;
create policy "product_media_update_live_subscription"
  on public.product_media as restrictive for update
  to authenticated
  using (public.has_active_subscription(company_id))
  with check (public.has_active_subscription(company_id));

drop policy if exists "product_media_delete_live_subscription" on public.product_media;
create policy "product_media_delete_live_subscription"
  on public.product_media as restrictive for delete
  to authenticated
  using (public.has_active_subscription(company_id));

-- -----------------------------------------------------------------------------
-- Guard 3: the fleet
-- -----------------------------------------------------------------------------
drop policy if exists "assets_insert_live_subscription" on public.assets;
create policy "assets_insert_live_subscription"
  on public.assets as restrictive for insert
  to authenticated
  with check (public.has_active_subscription(company_id));

drop policy if exists "assets_update_live_subscription" on public.assets;
create policy "assets_update_live_subscription"
  on public.assets as restrictive for update
  to authenticated
  using (public.has_active_subscription(company_id))
  with check (public.has_active_subscription(company_id));

drop policy if exists "assets_delete_live_subscription" on public.assets;
create policy "assets_delete_live_subscription"
  on public.assets as restrictive for delete
  to authenticated
  using (public.has_active_subscription(company_id));

-- -----------------------------------------------------------------------------
-- Guard 4: the gallery bucket
-- -----------------------------------------------------------------------------
-- These three are edited in place rather than restricted: a restrictive policy
-- on `storage.objects` applies to every bucket in that table, so it would also
-- freeze the logo and avatar uploads that settings still needs. `bucket_id`
-- already scopes these three, so the predicate goes beside it.
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
    and public.has_active_subscription(public.storage_company_id(name))
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
    and public.has_active_subscription(public.storage_company_id(name))
  )
  with check (
    bucket_id = 'product-media'
    and public.has_company_role(
      public.storage_company_id(name),
      array['owner', 'admin', 'manager']::public.member_role[]
    )
    and public.has_company_section(public.storage_company_id(name), 'products')
    and public.has_active_subscription(public.storage_company_id(name))
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
    and public.has_active_subscription(public.storage_company_id(name))
  );

