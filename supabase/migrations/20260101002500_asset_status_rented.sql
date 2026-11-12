-- =============================================================================
-- 25 · rented is derived from the book
-- =============================================================================
-- `assets.status` is what the fleet page shows and what `isAssetAvailable` reads,
-- and `rented` must never be typed in: it is a statement about today's bookings,
-- not a decision somebody makes. So it is written by a trigger and by nothing
-- else.
--
--   * `status_before_rent` remembers what the unit was before it went out, so a
--     bike that was out of action comes back out of action rather than becoming
--     available by accident.
--   * `refresh_asset_rented()` answers one question for one unit: is a blocking
--     line holding it **today**? If yes the unit is rented; if no it goes back to
--     what it was.
--   * the trigger fires from `booking_line_items`, which is where the answer
--     lives, and therefore also fires for a booking whose dates or status moved —
--     `bookings_propagate_dates` rewrites every line, and each rewrite lands here.
--
-- Windows are read half-open, `[starts_on, ends_on)`: a unit collected on the 4th
-- and due back on the 8th is rented on the 4th–7th and free on the morning of the
-- 8th. That is the same arithmetic as the exclusion constraint.
-- =============================================================================

alter table public.assets
  add column if not exists status_before_rent public.asset_status;

comment on column public.assets.status_before_rent is
  'What the unit was before a booking made it rented. Written by refresh_asset_rented().';

-- -----------------------------------------------------------------------------
-- refresh_asset_rented · one unit, one answer
-- -----------------------------------------------------------------------------
create or replace function public.refresh_asset_rented(
  target_company_id uuid,
  target_asset_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status public.asset_status;
  out_today boolean;
begin
  if target_asset_id is null then
    return;
  end if;

  select a.status
    into current_status
    from public.assets a
   where a.id = target_asset_id
     and a.company_id = target_company_id
     for update;

  if not found then
    return;
  end if;

  select exists (
    select 1
      from public.booking_line_items l
     where l.company_id = target_company_id
       and l.asset_id = target_asset_id
       and l.blocks_stock
       and l.starts_on <= current_date
       and l.ends_on > current_date
  )
  into out_today;

  if out_today and current_status <> 'rented' then
    update public.assets
       set status = 'rented',
           status_before_rent = current_status
     where id = target_asset_id
       and company_id = target_company_id;
  elsif not out_today and current_status = 'rented' then
    -- `coalesce` because a hand-written row or a pre-migration unit may have no
    -- remembered status; available is the safe reading of "back on the shelf".
    update public.assets
       set status = coalesce(status_before_rent, 'available'),
           status_before_rent = null
     where id = target_asset_id
       and company_id = target_company_id;
  end if;
end;
$$;

comment on function public.refresh_asset_rented(uuid, uuid) is
  'Marks a unit rented while a blocking booking line holds it today, and restores it afterwards.';

-- -----------------------------------------------------------------------------
-- booking_line_items_asset_status · the trigger that calls it
-- -----------------------------------------------------------------------------
-- Both sides of an edit are refreshed: an update that moves a unit off a line
-- has to release the unit it left *and* claim the one it arrived at.
create or replace function public.booking_line_items_asset_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or tg_op = 'UPDATE' then
    perform public.refresh_asset_rented(new.company_id, new.asset_id);

    if tg_op = 'UPDATE' and new.asset_id is distinct from old.asset_id then
      perform public.refresh_asset_rented(old.company_id, old.asset_id);
    end if;

    return null;
  end if;

  perform public.refresh_asset_rented(old.company_id, old.asset_id);
  return null;
end;
$$;

drop trigger if exists booking_line_items_asset_status on public.booking_line_items;
create trigger booking_line_items_asset_status
  after insert or update of asset_id, blocks_stock, starts_on, ends_on
  or delete on public.booking_line_items
  for each row execute function public.booking_line_items_asset_status();

-- -----------------------------------------------------------------------------
-- Backfill · a database that already has bookings
-- -----------------------------------------------------------------------------
-- The only unconditional write to `status` this project makes. It runs once, and
-- only for units a blocking line is holding today; afterwards the trigger owns it.
update public.assets a
   set status_before_rent = a.status,
       status = 'rented'
 where a.status in ('available', 'in_workshop')
   and exists (
     select 1
       from public.booking_line_items l
      where l.company_id = a.company_id
        and l.asset_id = a.id
        and l.blocks_stock
        and l.starts_on <= current_date
        and l.ends_on > current_date
   );

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
-- Trigger-only: a client role may not make a unit rented, nor make it available
-- again by calling the helper. Cancelling the booking is the way to release it,
-- which is the whole point of deriving the value.
revoke all on function public.refresh_asset_rented(uuid, uuid) from public, anon, authenticated;
grant execute on function public.refresh_asset_rented(uuid, uuid) to service_role;

revoke all on function public.booking_line_items_asset_status() from public, anon, authenticated;
grant execute on function public.booking_line_items_asset_status() to service_role;
