-- =============================================================================
-- 24 · asset_status gains in_workshop and rented
-- =============================================================================
-- Two changes to the fleet's ladder, in the order they have to happen:
--
--   * `maintenance` becomes `in_workshop`. The label the UI already draws is
--     "In the workshop", and an enum that disagrees with the words on screen is
--     a small, permanent tax on everybody reading both.
--   * `rented` arrives. It is written **only** by a trigger from the bookings
--     beneath it (migration 25) — availability stays derived, never copied,
--     which is the rule migration 04 states for counts and migration 13 repeats
--     for units.
--
-- This file only changes the type. PostgreSQL will not let a transaction use an
-- enum value it has just added, so everything that *reads* `rented` lives in
-- migration 25. Splitting them is not tidiness; it is the only way it compiles.
--
-- Note the ordering consequence: an enum's order is fixed at creation, so
-- `rented` sorts after `retired`. The fleet's `?status=` sort reads that order,
-- and `ASSET_STATUSES` in `lib/assets.ts` keeps the same list so the UI and the
-- database cannot disagree about it.
-- =============================================================================

do $$
begin
  if exists (
    select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'asset_status'
       and e.enumlabel = 'maintenance'
  ) then
    execute 'alter type public.asset_status rename value ''maintenance'' to ''in_workshop''';
  end if;
end
$$;

alter type public.asset_status add value if not exists 'rented';

comment on type public.asset_status is
  'available can be booked; in_workshop is out of action; retired has left the fleet; rented is written by a booking trigger.';
