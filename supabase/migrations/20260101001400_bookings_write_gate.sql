-- =============================================================================
-- 14 · Guard 5 · the booking book needs a live subscription
-- =============================================================================
-- Migration 11 states the rule and enforces it for every table that existed
-- then. The booking tables arrive in migration 13, *after* that file has already
-- run, and a policy cannot be created before the table it belongs to — so the
-- fifth guard lives here, in the same shape, rather than being appended to
-- migration 11 and failing on a fresh database.
--
-- Same rule, four tables: a lapsed workspace still reads its renters, its
-- bookings and its calendar — a shop that cannot see what it promised cannot
-- plan the handovers — and cannot write any of them. Cancelling a booking is a
-- write, which is intended: that is what the `past_due` dunning window is for.
--
-- `service_role` bypasses RLS, so the renter API's service-role work and the
-- reconciler keep writing while a workspace is read-only.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Guard 5: the renters
-- -----------------------------------------------------------------------------
drop policy if exists "customers_insert_live_subscription" on public.customers;
create policy "customers_insert_live_subscription"
  on public.customers as restrictive for insert
  to authenticated
  with check (public.has_active_subscription(company_id));

drop policy if exists "customers_update_live_subscription" on public.customers;
create policy "customers_update_live_subscription"
  on public.customers as restrictive for update
  to authenticated
  using (public.has_active_subscription(company_id))
  with check (public.has_active_subscription(company_id));

drop policy if exists "customers_delete_live_subscription" on public.customers;
create policy "customers_delete_live_subscription"
  on public.customers as restrictive for delete
  to authenticated
  using (public.has_active_subscription(company_id));

drop policy if exists "rider_preferences_insert_live_subscription" on public.rider_preferences;
create policy "rider_preferences_insert_live_subscription"
  on public.rider_preferences as restrictive for insert
  to authenticated
  with check (public.has_active_subscription(company_id));

drop policy if exists "rider_preferences_update_live_subscription" on public.rider_preferences;
create policy "rider_preferences_update_live_subscription"
  on public.rider_preferences as restrictive for update
  to authenticated
  using (public.has_active_subscription(company_id))
  with check (public.has_active_subscription(company_id));

drop policy if exists "rider_preferences_delete_live_subscription" on public.rider_preferences;
create policy "rider_preferences_delete_live_subscription"
  on public.rider_preferences as restrictive for delete
  to authenticated
  using (public.has_active_subscription(company_id));

-- -----------------------------------------------------------------------------
-- Guard 5: the book
-- -----------------------------------------------------------------------------
drop policy if exists "bookings_insert_live_subscription" on public.bookings;
create policy "bookings_insert_live_subscription"
  on public.bookings as restrictive for insert
  to authenticated
  with check (public.has_active_subscription(company_id));

drop policy if exists "bookings_update_live_subscription" on public.bookings;
create policy "bookings_update_live_subscription"
  on public.bookings as restrictive for update
  to authenticated
  using (public.has_active_subscription(company_id))
  with check (public.has_active_subscription(company_id));

drop policy if exists "bookings_delete_live_subscription" on public.bookings;
create policy "bookings_delete_live_subscription"
  on public.bookings as restrictive for delete
  to authenticated
  using (public.has_active_subscription(company_id));

drop policy if exists "booking_line_items_insert_live_subscription" on public.booking_line_items;
create policy "booking_line_items_insert_live_subscription"
  on public.booking_line_items as restrictive for insert
  to authenticated
  with check (public.has_active_subscription(company_id));

drop policy if exists "booking_line_items_update_live_subscription" on public.booking_line_items;
create policy "booking_line_items_update_live_subscription"
  on public.booking_line_items as restrictive for update
  to authenticated
  using (public.has_active_subscription(company_id))
  with check (public.has_active_subscription(company_id));

drop policy if exists "booking_line_items_delete_live_subscription" on public.booking_line_items;
create policy "booking_line_items_delete_live_subscription"
  on public.booking_line_items as restrictive for delete
  to authenticated
  using (public.has_active_subscription(company_id));
