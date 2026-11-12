# Extras and components — build sheet

This file is the contract for the second bookings pass, written before the work
so it cannot quietly drift. It follows `docs/bookings-module.md`: same headings,
same rules, and the same deal — if a step turns out to be wrong, change this file
in the same commit as the code.

Five slices, in order, each ending green:

| Stage | What it adds | Migrations |
| --- | --- | --- |
| 1 | The extras catalogue, its per-product scope, and the extras a line takes | 15, 16 |
| 2 | Stock: how many of an extra the shop actually has | 17 |
| 3 | Asset components and their taxonomy (`component_kinds`) | 18, 19 |
| 4 | A booking line that holds a component rather than a unit | 20 |
| 5 | Usage logs — hours and distance against a unit | 21 |
| 6 | Service intervals, service events and the derived service state | 22, 23 |
| 7 | `asset_status`: `in_workshop` and `rented` | 24, 25 |

## Decisions

**Extras are priced `per_booking` or `per_day`.** `per_day` multiplies by the
booking window, counted in whole days with a floor of one — a same-day collection
is a day's hire. Both live in `addon_price_kind`, and `addonChargeCents` is the
only place the arithmetic happens.

**An extra's scope is a per-product allowlist, and no rows means every product.**
`addon_products(company_id, addon_id, product_id)`. A workspace that never
switched the products section on has no products to scope to, and a line may name
no product at all; both cases have to keep working, which is what "unscoped"
buys. `set_addon_products(addon_id, product_ids)` replaces the whole list in one
statement, because two client writes could fail between each other and leave an
extra scoped to nothing — the one dangerous failure this design has.

**Extras hang off the line, never off the booking.** `booking_line_addons` has
`line_item_id` and no `booking_id`. The line is the only row that knows the
product, and the product is what decides the offer. A second column would let a
row claim a booking its line does not belong to, and the money column on the
board reads the line anyway.

**A line's product cannot change while it carries extras.**
`booking_line_items_product_guard` refuses it. The alternative — cascading the
extras away — deletes priced rows the renter already agreed to. One extra click
for the desk in a rare case is the cheaper mistake.

**A variant matches its parent, and only one level.** A helmet scoped to
"Mountain bike" covers the medium and the large; it does not cover a *sibling*
variant scoped elsewhere. `products.parent_id` is a variant pointer and migration
03 already refuses a second level.

**The price is snapshotted, and the window is not.** `booking_line_addons_snapshot`
copies `price_cents` and `price_kind` on insert and re-imposes them on update, so
raising the catalogue price never re-prices an agreed hire. `booking_line_items`
does the opposite with its window on purpose: the window is the booking's, and a
line whose dates drifted would break the exclusion constraint.

**Booking-wide charges are a product line, not a booking-level extras row.**
Delivery, setup, a damage waiver for the whole hire: these are simple ecommerce
products with no `parent_id`, added as an ordinary line. That keeps one shape for
money on a booking and needs no column that means "this line is not a thing".

**Stock is derived, then locked, never decremented.**
`check_addon_availability(addon_id, starts_on, ends_on, exclude_line_id)` counts
what other blocking lines took over the window; the insert trigger takes
`for update` on the add-on row and refuses an oversell. A stored counter would
have to be repaired after every cancellation, and the repair would be wrong
whenever two people booked at once.

**A component is bookable only while it is not fitted.** A fitted component is
already on a unit that goes out; booking it separately would promise the same
thing twice. Fitting a component into a unit is refused while the component is
booked, and booking a unit is refused while the unit is out with a booked
component — the same "one thing, one place" rule the exclusion constraint states
for units.

**Usage readings are incremental, not a cumulative odometer.** A cumulative
reading has to be monotonically increasing across every row ever entered, which
one typo breaks forever; "hours since the last reading" is what the mechanic
actually writes down.

**Service intervals hang off `component_kinds`, not off each component.** A shop
services every "full suspension" frame at the same interval; per-component
intervals would be copied wrongly once and never noticed.

**Taxonomy is a company-scoped table, mirroring `product_categories`.**
`component_kinds(company_id, name, handle, position)`, flat, `<select>`-picked.
The precedent is `20260101000200_products.sql`; a second taxonomy shape would be
a second set of policies for no gain.

**`in_workshop` is the label "In the workshop".** The existing `maintenance` value
is renamed so the enum and the UI say the same thing, and `rented` is written only
by a trigger from the bookings beneath it — availability stays derived, never
copied, the rule migration 04 already states for counts.

## In this slice

Stage 1 only. The later stages are under *Not yet* and land in their own commits.

- Migration 15: `addon_price_kind` and `addon_status`, `addons`,
  `addon_products`, `booking_line_addons`, `booking_line_items_company_id_unique`
  (the composite key the extras point at), the snapshot and product-guard
  triggers, `set_addon_products`, and the RLS policies — on the **bookings**
  section, not products.
- Migration 16: Guard 5 for the three new tables.
- `lib/supabase/types.ts`: `AddonPriceKind`, `AddonStatus`, three tables,
  `set_addon_products`.
- `lib/addons.ts` — client-safe: price kinds, statuses, handle and name rules,
  the quantity ceiling, `addonChargeCents`, `lineAddonsTotal`,
  `bookingAddonsTotal`, `addonPriceLabel`, `isAddonOfferedFor`,
  `addonScopeByAddon`, `addonsForLine`, `parseAddonDraft`.
- `lib/actions/addons.ts` — `createAddon`, `updateAddon`, `setAddonStatus`,
  `deleteAddon`, `addLineAddon`, `updateLineAddon`, `removeLineAddon`.
- `app/[tenant]/bookings/add-ons/{page,addon-deck,addon-fields}.tsx`, the extras
  block on `line-items-section.tsx`, the booking total including extras, and an
  **Extras** button on the board.
- Tests: the `extras` block in `tests/db/schema.test.ts`,
  `tests/unit/addons.test.ts`, and the `addonRow`/`lineAddonRow` fixtures.

## Not yet

Stage 2 onward: `addons.track_stock` and `quantity_on_hand`,
`check_addon_availability`, `bookings_addon_stock_guard`; `component_kinds`,
`asset_components`, component booking lines, `asset_usage_logs`,
`component_service_events` and `component_service_status`; the `asset_status`
enum change. Also still out: the renter-facing API, renter email, deposits.

## Order of work

Each step ends green — `pnpm verify` plus a transactional `psql` proof — before
the next starts.

1. **Migration 15** — enums, `addons`, `addon_products`, the composite key on
   `booking_line_items`, `booking_line_addons`, the two triggers,
   `set_addon_products`, RLS, grants.
2. **Migration 16** — Guard 5.
3. **Types and `lib/addons.ts`**, then **`lib/actions/addons.ts`**.
4. **Screens**, then the **tests**, then the `psql` proof.
5. **Stage 2** — `track_stock`, `quantity_on_hand`,
   `check_addon_availability(addon_id, starts_on, ends_on, exclude_line_id)` and
   `bookings_addon_stock_guard`; the snapshot trigger grows its `for update`
   count. Stop for review before stage 3.
6. **Stage 3** — `component_kinds`, `asset_components`, migration 19 (Guard 5).
7. **Stage 4** — `booking_line_items.component_id` and its partial exclusion
   constraint.
8. **Stage 5** — `asset_usage_logs`.
9. **Stage 6** — intervals on the kind, `component_service_events`,
   `component_service_status` (`ok` / `due_soon` at 80% / `overdue`).
10. **Stage 7** — the enum change, `status_before_rent`, `refresh_asset_rented`,
    the backfill, and `summariseAssets` learning `outOnHire`.

## Rules the new code must keep

- **Half-open windows, `[starts_on, ends_on)`, everywhere.** The stock check, the
  repo helpers and the exclusion constraint all read the same arithmetic.
- **The database has the last word.** Every action checks the section and the
  tier so a refusal arrives as a sentence, and RLS repeats it.
- **Money is derived per render.** `addonChargeCents` and `bookingAddonsTotal`
  are the only totals; nothing stores a sum.
- **A snapshot is copied once.** Never re-read the catalogue price for a row that
  already exists.
- **The catalogue asks about the `bookings` section.** A policy on `addons` that
  named `products` would hide the extras from every rental-only workspace.
- **`anon` gets nothing.** Every new function is revoked by name and granted to
  `authenticated` and `service_role`; trigger-only functions are granted to
  `service_role` alone.

## Gotchas worth remembering

- **`TG_OP` is uppercase in PL/pgSQL** — `'INSERT'`, `'UPDATE'`, not lowercase.
  A lowercase comparison silently skips the branch: the price is never copied and
  the scope is never checked, and every insert still succeeds. The first live run
  of stage 1 caught exactly this, which is why `tests/db/schema.test.ts` now pins
  the uppercase form and fails on the lowercase one.
- **`booking_line_items` had no `unique (company_id, id)`** until migration 15,
  so the composite foreign key could not exist before it. A new migration adds the
  constraint; editing an applied one would break every deployed database.
- **A blank-product line is not a bug.** `parseLineItemDraft` already accepts
  `product_id: null` — "any unit" — and only an *unscoped* extra may go on it.
- **`booking_line_addons` must never grow a `booking_id`.** The schema test reads
  the `create table` statement and fails if the column appears.
- **`updateAddon` sends the scope as a marker (`scope=1`).** Without the marker
  the list in the form is not the truth, and sending an empty list would widen a
  scoped extra to every product.
- **`23514` is not translated in `lib/actions/addons.ts`.** The trigger writes a
  sentence for a person; a generic "values out of range" would throw it away.
- **The editor writes in ~6 000-character chunks.** Long SQL and lib files are
  staged: the header first, then sections appended at a banner comment, then the
  file re-read to check the order. An `insert_line` at the wrong offset silently
  splits an object literal in half.
