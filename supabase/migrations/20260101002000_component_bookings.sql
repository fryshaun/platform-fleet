-- =============================================================================
-- 20 · Components on a booking line
-- =============================================================================
-- A line may hold a unit, or a component, or neither ("a gravel bike, to be
-- allocated") — never both, because they are two answers to the same question.
--
-- The rules, and why they are enough:
--
--   * A component is bookable while it is **not fitted**. A part inside a bike
--     that goes out is already promised; booking it separately would hand the
--     same fork to two renters.
--   * A booked part cannot be fitted to a unit while it appears on **any**
--     blocking line. A future hire of the part means it stays in the bin.
--
-- Those two are complements, so the third case the plan anticipated — booking a
-- unit that carries a booked component — cannot arise: the component could only
-- have been booked while un-fitted, and it cannot be fitted afterwards. A check
-- on `asset_id` for that case would be unreachable code pretending to be a
-- guarantee.
--
-- Overlap is again an exclusion constraint, this time on `component_id`. Its
-- `where` clause mirrors the one on `asset_id`: a cancelled booking keeps its
-- rows and releases the part.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- booking_line_items · one more thing a line may hold
-- -----------------------------------------------------------------------------
alter table public.booking_line_items
  add column if not exists component_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'booking_line_items_component_fk'
       and conrelid = 'public.booking_line_items'::regclass
  ) then
    alter table public.booking_line_items
      add constraint booking_line_items_component_fk
      foreign key (company_id, component_id)
      references public.asset_components (company_id, id)
      on delete set null (component_id);
  end if;

  -- A line holds a unit *or* a part. `not both` rather than `exactly one`:
  -- a line that names only a product is legal, and is how "any unit" is written.
  if not exists (
    select 1 from pg_constraint
     where conname = 'booking_line_items_one_holder'
       and conrelid = 'public.booking_line_items'::regclass
  ) then
    alter table public.booking_line_items
      add constraint booking_line_items_one_holder
      check (component_id is null or asset_id is null);
  end if;
end
$$;

comment on column public.booking_line_items.component_id is
  'The part this line books, when it is not booking a whole unit.';

create index if not exists booking_line_items_component_idx
  on public.booking_line_items (company_id, component_id);

-- The one-part-one-hire guard, beside the one-unit-one-hire guard migration 13
-- already states.
alter table public.booking_line_items
  drop constraint if exists booking_line_items_component_no_overlap;

alter table public.booking_line_items
  add constraint booking_line_items_component_no_overlap
  exclude using gist (
    company_id with =,
    component_id with =,
    daterange(starts_on, ends_on, '[)') with &&
  ) where (component_id is not null and blocks_stock);


-- -----------------------------------------------------------------------------
-- booking_line_items_component_guard · only an un-fitted part may be booked
-- -----------------------------------------------------------------------------
create or replace function public.booking_line_items_component_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  still_fitted boolean;
begin
  if new.component_id is null then
    return new;
  end if;

  -- The guard fires for a move onto a component, an edit of a component line,
  -- and a component swapped for another — but not for an unrelated edit that
  -- happens to send the column.
  if tg_op = 'UPDATE'
     and new.component_id is not distinct from old.component_id
     and new.asset_id is not distinct from old.asset_id then
    return new;
  end if;

  select c.asset_id is not null and c.removed_on is null
    into still_fitted
    from public.asset_components c
   where c.id = new.component_id
     and c.company_id = new.company_id;

  if not found then
    raise exception 'That component is not in this workspace'
      using errcode = 'foreign_key_violation';
  end if;

  if still_fitted then
    raise exception 'That component is fitted to a unit, so it cannot be booked on its own'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists booking_line_items_component_guard on public.booking_line_items;
create trigger booking_line_items_component_guard
  before insert or update of component_id, asset_id on public.booking_line_items
  for each row execute function public.booking_line_items_component_guard();

-- -----------------------------------------------------------------------------
-- asset_components_booking_guard · a booked part stays in the bin
-- -----------------------------------------------------------------------------
-- The other half of the same rule. Any blocking line, on any dates, keeps the
-- part out of a unit: a hire next month is a promise that the part will be there.
--
-- `removed_on` is watched as well as `asset_id`, because clearing a removal date
-- is the same act as fitting the part again.
create or replace function public.asset_components_booking_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.asset_id is null or new.removed_on is not null then
    return new;
  end if;

  if exists (
    select 1
      from public.booking_line_items l
     where l.company_id = new.company_id
       and l.component_id = new.id
       and l.blocks_stock
  ) then
    raise exception 'That component is on a booking, so it cannot be fitted to a unit'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists asset_components_booking_guard on public.asset_components;
create trigger asset_components_booking_guard
  before insert or update of asset_id, removed_on on public.asset_components
  for each row execute function public.asset_components_booking_guard();

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
-- Trigger-only functions: no client role may execute these.
revoke all on function public.booking_line_items_component_guard() from public, anon, authenticated;
revoke all on function public.asset_components_booking_guard() from public, anon, authenticated;

grant execute on function public.booking_line_items_component_guard() to service_role;
grant execute on function public.asset_components_booking_guard() to service_role;
