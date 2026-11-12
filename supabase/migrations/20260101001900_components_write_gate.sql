-- =============================================================================
-- 19 · Guard 5 · components need a live subscription
-- =============================================================================
-- The same rule as migrations 11, 14 and 16, stated once more for the two tables
-- migration 18 adds: a lapsed workspace still reads its components and its
-- taxonomy — a workshop that cannot see what is fitted cannot plan a service —
-- and cannot write either of them.
--
-- `service_role` bypasses RLS, so server-side work keeps going.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Guard 5: the taxonomy
-- -----------------------------------------------------------------------------
drop policy if exists "component_kinds_insert_live_subscription" on public.component_kinds;
create policy "component_kinds_insert_live_subscription"
  on public.component_kinds as restrictive for insert
  to authenticated
  with check (public.has_active_subscription(company_id));

drop policy if exists "component_kinds_update_live_subscription" on public.component_kinds;
create policy "component_kinds_update_live_subscription"
  on public.component_kinds as restrictive for update
  to authenticated
  using (public.has_active_subscription(company_id))
  with check (public.has_active_subscription(company_id));

drop policy if exists "component_kinds_delete_live_subscription" on public.component_kinds;
create policy "component_kinds_delete_live_subscription"
  on public.component_kinds as restrictive for delete
  to authenticated
  using (public.has_active_subscription(company_id));

-- -----------------------------------------------------------------------------
-- Guard 5: the components
-- -----------------------------------------------------------------------------
drop policy if exists "asset_components_insert_live_subscription" on public.asset_components;
create policy "asset_components_insert_live_subscription"
  on public.asset_components as restrictive for insert
  to authenticated
  with check (public.has_active_subscription(company_id));

drop policy if exists "asset_components_update_live_subscription" on public.asset_components;
create policy "asset_components_update_live_subscription"
  on public.asset_components as restrictive for update
  to authenticated
  using (public.has_active_subscription(company_id))
  with check (public.has_active_subscription(company_id));

drop policy if exists "asset_components_delete_live_subscription" on public.asset_components;
create policy "asset_components_delete_live_subscription"
  on public.asset_components as restrictive for delete
  to authenticated
  using (public.has_active_subscription(company_id));
