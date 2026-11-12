-- =============================================================================
-- 17 · Extras hold stock
-- =============================================================================
-- An extra may be something the shop owns a countable number of: six helmets,
-- two child seats, one trailer. The catalogue says how many; the bookings decide
-- how many are out and when.
--
-- The count is **derived and locked, never decremented**:
--
--   * `check_addon_availability()` answers "how many of this extra are already
--     out over these days", so the desk reads a number instead of a refusal.
--   * the trigger on `booking_line_addons` takes `for update` on the add-on row
--     before it counts, which serialises two people adding the last helmet at
--     the same moment. That lock is the guarantee; the count is the sentence.
--   * entering a blocking status re-checks the extras the booking already
--     carries, because a pending booking may have been taken against stock that
--     another booking has since used.
--
-- A stored `taken` counter would have to be repaired after every cancellation,
-- and the repair would be wrong whenever two writes happened at once. The same
-- reasoning is why migration 04 refuses to store a fleet count.
--
-- Windows are half-open here too — `[starts_on, ends_on)` — read from the *line*,
-- which `booking_line_items_sync` keeps equal to its booking's.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- addons · the two stock columns
-- -----------------------------------------------------------------------------
-- `track_stock` defaults to false: most extras are unlimited (a waiver, a map),
-- and a shop that never counts its helmets must not be told it has run out.
-- `quantity_on_hand` is meaningless while `track_stock` is false, and is left at
-- 0 rather than NULL so a report can sum it without a coalesce.
alter table public.addons
  add column if not exists track_stock boolean not null default false;

alter table public.addons
  add column if not exists quantity_on_hand integer not null default 0;

-- Guarded: PostgreSQL has no `add constraint if not exists`, and this file must
-- be re-runnable like every other migration here.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'addons_quantity_on_hand_check'
       and conrelid = 'public.addons'::regclass
  ) then
    alter table public.addons
      add constraint addons_quantity_on_hand_check
      check (quantity_on_hand between 0 and 9999);
  end if;
end
$$;

comment on column public.addons.track_stock is
  'When true, the bookings may not take more than quantity_on_hand of this extra.';
comment on column public.addons.quantity_on_hand is
  'How many the shop owns. Read only when track_stock is true.';

-- -----------------------------------------------------------------------------
-- check_addon_availability · the advisory answer
-- -----------------------------------------------------------------------------
-- Counts what *other* blocking lines already took of this extra over a window.
-- `exclude_line_item_id` lets an existing line ask the question about itself —
-- editing a quantity must not count the row being edited.
--
-- SECURITY DEFINER with an empty search_path, like `check_asset_availability`:
-- the answer must not vary with the RLS the caller happens to have.
create or replace function public.check_addon_availability(
  target_company_id uuid,
  target_addon_id uuid,
  from_date date,
  to_date date,
  exclude_line_item_id uuid default null
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(l_addon.quantity), 0)::integer
  from public.booking_line_addons l_addon
  join public.booking_line_items l
    on l.company_id = l_addon.company_id
   and l.id = l_addon.line_item_id
  where l_addon.company_id = target_company_id
    and l_addon.addon_id = target_addon_id
    and l.blocks_stock
    and (exclude_line_item_id is null
         or l_addon.line_item_id <> exclude_line_item_id)
    and daterange(l.starts_on, l.ends_on, '[)')
        && daterange(from_date, to_date, '[)');
$$;

comment on function public.check_addon_availability(uuid, uuid, date, date, uuid) is
  'How many of an extra other blocking lines already took over the window. Advisory: the trigger decides.';

-- -----------------------------------------------------------------------------
-- booking_line_addons_snapshot · price, scope, ceiling, stock
-- -----------------------------------------------------------------------------
-- Replaced whole rather than patched: this is the same function migration 15
-- created, with two additions — the `for update` lock and the stock count. The
-- price copy, the scope check and the ceiling are unchanged in behaviour, and
-- the schema test still pins them.
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
  catalogue_tracks boolean;
  catalogue_on_hand integer;
  line_product uuid;
  parent_product uuid;
  line_starts_on date;
  line_ends_on date;
  line_blocks_stock boolean;
  taken integer;
begin
  if tg_op = 'UPDATE' then
    -- The anchor and the price are what the row *is*. Quantity may change, so a
    -- desk can add a second helmet without re-adding the row.
    if new.line_item_id is distinct from old.line_item_id
       or new.addon_id is distinct from old.addon_id then
      raise exception 'An extra cannot be moved to another line or offer'
        using errcode = 'check_violation';
    end if;

    new.unit_price_cents := old.unit_price_cents;
    new.price_kind := old.price_kind;
  end if;

  -- `for update` is the oversell guard. Two desks adding the last helmet at the
  -- same moment queue on this row, so the second one counts the first one's row
  -- and is refused. Without it both would read the same free count.
  select a.price_cents, a.price_kind, a.status, a.max_quantity,
         a.track_stock, a.quantity_on_hand
    into catalogue_price, catalogue_kind, catalogue_status, catalogue_max,
         catalogue_tracks, catalogue_on_hand
    from public.addons a
   where a.id = new.addon_id
     and a.company_id = new.company_id
     for update;

  if not found then
    raise exception 'That extra is not in this workspace'
      using errcode = 'foreign_key_violation';
  end if;

  -- The line is read for every operation now: its window is what the stock
  -- count is measured over, and its product is what the scope is matched
  -- against.
  select l.product_id, p.parent_id, l.starts_on, l.ends_on, l.blocks_stock
    into line_product, parent_product, line_starts_on, line_ends_on,
         line_blocks_stock
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

  if new.quantity > catalogue_max then
    raise exception 'This extra allows at most % per line', catalogue_max
      using errcode = 'check_violation';
  end if;

  -- Stock is only claimed by a line that holds it. A cancelled or returned
  -- booking can be edited freely, and `bookings_addon_stock_guard` re-checks
  -- everything at the moment the booking starts holding stock again.
  if catalogue_tracks and line_blocks_stock then
    select coalesce(sum(la.quantity), 0)::integer
      into taken
      from public.booking_line_addons la
      join public.booking_line_items l
        on l.company_id = la.company_id
       and l.id = la.line_item_id
     where la.company_id = new.company_id
       and la.addon_id = new.addon_id
       -- The row being written must not count itself, or raising a quantity
       -- from one to two would need two free.
       and la.id <> new.id
       and l.blocks_stock
       and daterange(l.starts_on, l.ends_on, '[)')
           && daterange(line_starts_on, line_ends_on, '[)');

    if taken + new.quantity > catalogue_on_hand then
      raise exception 'Only % of this extra % free on those dates',
          greatest(catalogue_on_hand - taken, 0),
          case when greatest(catalogue_on_hand - taken, 0) = 1 then 'is' else 'are' end
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if catalogue_status <> 'active' then
      raise exception 'That extra is archived and cannot be added'
        using errcode = 'check_violation';
    end if;

    new.unit_price_cents := catalogue_price;
    new.price_kind := catalogue_kind;

    -- No rows in `addon_products` means the extra is offered with everything.
    -- When there are rows, the line's product *or its parent* must be one.
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
-- bookings_addon_stock_guard · entering a blocking status re-checks the extras
-- -----------------------------------------------------------------------------
-- A pending booking holds nothing but a promise. While it sits there another
-- booking may take the last helmet, so marking this one confirmed has to ask the
-- question again — the rows were written when stock was free, and the status
-- change is the moment the promise becomes a hold.
--
-- Only the move *into* a blocking status is checked. Coming out of one releases
-- stock and cannot oversell; a move between two blocking statuses changes
-- nothing about the window.
--
-- The loop locks each add-on it touches, in the order the lines were read. One
-- booking rarely carries two tracked extras, and a deadlock here would surface
-- as a retryable `40P01` rather than a wrong answer.
create or replace function public.bookings_addon_stock_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  wanted record;
  catalogue record;
  taken integer;
begin
  if new.status = old.status then
    return new;
  end if;

  if not public.booking_blocks_stock(new.status)
     or public.booking_blocks_stock(old.status) then
    return new;
  end if;

  for wanted in
    select la.addon_id, sum(la.quantity)::integer as needed
      from public.booking_line_addons la
      join public.booking_line_items l
        on l.company_id = la.company_id
       and l.id = la.line_item_id
     where l.company_id = new.company_id
       and l.booking_id = new.id
     group by la.addon_id
  loop
    select a.track_stock, a.quantity_on_hand
      into catalogue
      from public.addons a
     where a.id = wanted.addon_id
       and a.company_id = new.company_id
       for update;

    if not found or not catalogue.track_stock then
      continue;
    end if;

    select coalesce(sum(la.quantity), 0)::integer
      into taken
      from public.booking_line_addons la
      join public.booking_line_items l
        on l.company_id = la.company_id
       and l.id = la.line_item_id
     where la.company_id = new.company_id
       and la.addon_id = wanted.addon_id
       and l.blocks_stock
       and l.booking_id <> new.id
       and daterange(l.starts_on, l.ends_on, '[)')
           && daterange(new.starts_on, new.ends_on, '[)');

    if taken + wanted.needed > catalogue.quantity_on_hand then
      raise exception 'Only % of that extra % free on those dates',
          greatest(catalogue.quantity_on_hand - taken, 0),
          case
            when greatest(catalogue.quantity_on_hand - taken, 0) = 1 then 'is'
            else 'are'
          end
        using errcode = 'check_violation';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists bookings_addon_stock_guard on public.bookings;
create trigger bookings_addon_stock_guard
  before update of status on public.bookings
  for each row execute function public.bookings_addon_stock_guard();

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function public.check_addon_availability(uuid, uuid, date, date, uuid) from public, anon;
grant execute on function public.check_addon_availability(uuid, uuid, date, date, uuid) to authenticated, service_role;

-- Trigger-only: no client role may execute this. PostgreSQL does not check
-- EXECUTE when firing a trigger, so this changes nothing for the trigger.
revoke all on function public.bookings_addon_stock_guard() from public, anon, authenticated;
grant execute on function public.bookings_addon_stock_guard() to service_role;
