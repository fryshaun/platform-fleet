-- =============================================================================
-- 16 · Guard 5 · the extras need a live subscription
-- =============================================================================
-- Migration 11 states the rule for every table that existed then, migration 14
-- states it for the booking book, and the extras arrive after both. The same
-- reasoning applies once more: a policy cannot name a table that does not exist
-- yet, so this file repeats the shape rather than editing an applied migration.
--
-- Three tables, three commands each. A lapsed workspace still *reads* its
-- catalogue — a shop that cannot price a hire cannot trade out its diary — and
-- cannot write to it. `service_role` bypasses RLS, so server-side work and the
-- reconciler keep going.
--
-- `tests/db/schema.test.ts` reads this file through `allGateSql`; the policy
-- names are what it looks for, and they are unique across the three gate files.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Guard 5: the catalogue
-- -----------------------------------------------------------------------------
drop policy if exists "addons_insert_live_subscription" on public.addons;
create policy "addons_insert_live_subscription"
  on public.addons as restrictive for insert
  to authenticated
  with check (public.has_active_subscription(company_id));

drop policy if exists "addons_update_live_subscription" on public.addons;
create policy "addons_update_live_subscription"
  on public.addons as restrictive for update
  to authenticated
  using (public.has_active_subscription(company_id))
  with check (public.has_active_subscription(company_id));

drop policy if exists "addons_delete_live_subscription" on public.addons;
create policy "addons_delete_live_subscription"
  on public.addons as restrictive for delete
  to authenticated
  using (public.has_active_subscription(company_id));

-- -----------------------------------------------------------------------------
-- Guard 5: the scope rows
-- -----------------------------------------------------------------------------
drop policy if exists "addon_products_insert_live_subscription" on public.addon_products;
create policy "addon_products_insert_live_subscription"
  on public.addon_products as restrictive for insert
  to authenticated
  with check (public.has_active_subscription(company_id));

drop policy if exists "addon_products_update_live_subscription" on public.addon_products;
create policy "addon_products_update_live_subscription"
  on public.addon_products as restrictive for update
  to authenticated
  using (public.has_active_subscription(company_id))
  with check (public.has_active_subscription(company_id));

drop policy if exists "addon_products_delete_live_subscription" on public.addon_products;
create policy "addon_products_delete_live_subscription"
  on public.addon_products as restrictive for delete
  to authenticated
  using (public.has_active_subscription(company_id));

-- -----------------------------------------------------------------------------
-- Guard 5: the extras on a line
-- -----------------------------------------------------------------------------
drop policy if exists "booking_line_addons_insert_live_subscription" on public.booking_line_addons;
create policy "booking_line_addons_insert_live_subscription"
  on public.booking_line_addons as restrictive for insert
  to authenticated
  with check (public.has_active_subscription(company_id));

drop policy if exists "booking_line_addons_update_live_subscription" on public.booking_line_addons;
create policy "booking_line_addons_update_live_subscription"
  on public.booking_line_addons as restrictive for update
  to authenticated
  using (public.has_active_subscription(company_id))
  with check (public.has_active_subscription(company_id));

drop policy if exists "booking_line_addons_delete_live_subscription" on public.booking_line_addons;
create policy "booking_line_addons_delete_live_subscription"
  on public.booking_line_addons as restrictive for delete
  to authenticated
  using (public.has_active_subscription(company_id));
