-- =============================================================================
-- 23 · Guard 5 · usage and services need a live subscription
-- =============================================================================
-- The same rule as migrations 11, 14, 16 and 19, for the two tables migrations
-- 21 and 22 add. A lapsed workshop still reads its hours and its service history
-- — that is how it plans the work that brings it back — and writes neither.
--
-- The view `component_service_status` needs no policy of its own: it is
-- `security_invoker`, so it is exactly as readable as the tables under it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Guard 5: the usage logs
-- -----------------------------------------------------------------------------
drop policy if exists "asset_usage_logs_insert_live_subscription" on public.asset_usage_logs;
create policy "asset_usage_logs_insert_live_subscription"
  on public.asset_usage_logs as restrictive for insert
  to authenticated
  with check (public.has_active_subscription(company_id));

drop policy if exists "asset_usage_logs_update_live_subscription" on public.asset_usage_logs;
create policy "asset_usage_logs_update_live_subscription"
  on public.asset_usage_logs as restrictive for update
  to authenticated
  using (public.has_active_subscription(company_id))
  with check (public.has_active_subscription(company_id));

drop policy if exists "asset_usage_logs_delete_live_subscription" on public.asset_usage_logs;
create policy "asset_usage_logs_delete_live_subscription"
  on public.asset_usage_logs as restrictive for delete
  to authenticated
  using (public.has_active_subscription(company_id));

-- -----------------------------------------------------------------------------
-- Guard 5: the service events
-- -----------------------------------------------------------------------------
drop policy if exists "component_service_events_insert_live_subscription" on public.component_service_events;
create policy "component_service_events_insert_live_subscription"
  on public.component_service_events as restrictive for insert
  to authenticated
  with check (public.has_active_subscription(company_id));

drop policy if exists "component_service_events_update_live_subscription" on public.component_service_events;
create policy "component_service_events_update_live_subscription"
  on public.component_service_events as restrictive for update
  to authenticated
  using (public.has_active_subscription(company_id))
  with check (public.has_active_subscription(company_id));

drop policy if exists "component_service_events_delete_live_subscription" on public.component_service_events;
create policy "component_service_events_delete_live_subscription"
  on public.component_service_events as restrictive for delete
  to authenticated
  using (public.has_active_subscription(company_id));
