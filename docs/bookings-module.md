# Bookings module — build sheet

This file is the contract for the bookings slice, written before any of it
exists, so the work cannot quietly drift. Every decision below was made against
what is already here: migrations 00–11, `lib/actions/assets.ts`, `lib/features.ts`
and the assertions in `tests/db/schema.test.ts`. If a step turns out to be wrong,
change this file in the same commit as the code — a plan that disagrees with the
migrations is worse than no plan.

The slice is the **staff** surface only. The renter-facing API is a later pass and
is listed under *Not in this slice*.

## Decisions

**Variants are `products` rows with a `parent_id`.** A second table would need its
own policies, its own write gate and its own place in the schema test to express
what a self-reference already says. `stock_quantity` becomes `inventory_quantity`
in the same change, because "stock" and "quantity" say the same thing twice.

**The category tree is `product_categories.parent_id`,** not a new `categories`
table. Cycle and depth checks go in a trigger, since a `check` cannot see the
tree.

**Renters are a new `customers` table**, tenant-scoped, with a nullable
`profile_id → profiles`. `profiles` stays the staff/auth table. A renter is
usually not a user of this app, and should not need an account to be booked.

**`assets.status` is not touched in this slice.** Renaming `maintenance` to
`in_service` and adding `rented` needs its own migration, because
`alter type … add value` cannot be used in the transaction that adds it. When it
does land, `rented` is written only by a booking trigger — availability stays
derived, never copied, the same rule migration 04 already states for counts.

**Overlap is guarded by an exclusion constraint on `booking_line_items`.** A
`uuid[]` of assets on `bookings` cannot take a GiST `&&` operator, so the
constraint has to sit where the single asset is:

```sql
exclude using gist (
  company_id with =,
  asset_id with =,
  daterange(starts_on, ends_on, '[)') with &&
) where (asset_id is not null and blocks_stock)
```

**…which is why lines carry `blocks_stock`.** A cancelled booking must stop
reserving its unit while its rows stay for history. The column is written only by
triggers — from the parent booking's status — and `lib/bookings.ts` keeps the same
list of blocking statuses so the UI and the database agree. The schema test
asserts the two lists match, the way it already checks the write-gate list against
`lib/billing/entitlements.ts`.

**Ranges are half-open, `[starts_on, ends_on)`.** A booking that ends on the 5th
does not include the 5th, so a same-day handover is legal and `ends_on >
starts_on` is the only date check needed. Every helper in `lib/bookings.ts`
(`rangesOverlap`, `bookingDays`) must use the same convention or the UI will
disagree with the constraint.

**Two migrations, one concern each:** `20260101001200_renters.sql` for
`customers` and `rider_preferences`, `20260101001300_bookings.sql` for the enum,
`bookings`, `booking_line_items`, the triggers and `asset_availability`.

## In this slice

- Migrations 12, 13 and 14 (Guard 5), the last because a policy cannot name a
  table that does not exist yet.
- `lib/supabase/types.ts`: `BookingStatus`, `BookingChannel`, four tables,
  `check_asset_availability`, and the first real entry in `Views`.
- `lib/bookings.ts` — client-safe: statuses, labels and channels, the transition
  table, `BLOCKING_BOOKING_STATUSES`, `BOOKING_SORT_OPTIONS` / `readBookingSort`,
  `bookingReferenceProblem`, `bookingReferenceFrom(random)`,
  `customerHandleFrom`, `dateRangeProblem`, `bookingDays`, `rangesOverlap`,
  `formatBookingWindow`, `lineItemTotal`, `bookingTotals`, `formatBookingPrice`,
  `parseBookingDraft`, `parseLineItemDraft`.
- `lib/actions/bookings.ts` — `createBooking`, `updateBooking`,
  `setBookingStatus`, `deleteBooking`, `addLineItem`, `updateLineItem`,
  `removeLineItem`, `assignAsset`, `assignRider`.
- `app/[tenant]/bookings/page.tsx` (board), `[reference]/page.tsx` (detail), and
  their local form/badge/section components.
- `"bookings"` in `lib/features.ts` (`SECTION_KEYS` appended last, `SECTIONS`),
  `CalendarCheckIcon` in `components/tenant/sidebar-nav.tsx`.
- Tests: `tests/db/schema.test.ts`, `tests/unit/bookings.test.ts`,
  `tests/actions/bookings.test.ts`, `tests/helpers/fixtures.ts`.

## Not in this slice

`app/api/v1/**`, `api_clients`, `customer_access_tokens`, `api_rate_limits`,
`bookings.idempotency_key`; a full `/renters` directory (the booking form creates
a renter inline instead); deposits and Stripe payment for a booking; renter email.

Catalog add-ons, asset components, usage logs and service state, and the
`asset_status` enum change are **no longer out of scope** — they have their own
sheet in `docs/extras-and-components.md`, with extras hanging off a line rather
than off the booking. One rule from that sheet belongs here, because it is about
this slice's money: **a booking-wide charge — delivery, setup, a waiver for the
whole hire — is an ordinary product line**, not an extras row and not a new
column. A simple ecommerce product with no `parent_id` is added as a line, which
keeps one shape for money on a booking.

## Order of work

Each step ends green before the next starts.

1. **`20260101001200_renters.sql`** — `customers` (`handle`, `full_name`,
   nullable `profile_id`, `email`, `phone`, `notes`, timestamps) and
   `rider_preferences` (`customer_id` primary key, `height_cm`, `weight_kg`,
   `inseam_cm`, `riding_level`, `disciplines text[]`, `notes`, `metadata`).
   Four policies each, all asking `has_company_section(company_id, 'bookings')`.
   Reads are member work; writes are front-desk work, because the desk creates
   walk-ins; deletes are manager work.
2. **`20260101001300_bookings.sql`** — `create extension if not exists
   btree_gist`; `booking_status` (`pending`, `confirmed`, `out`, `returned`,
   `cancelled`) and `booking_channel` (`staff`, `api`), both complete on
   creation; `bookings`; `booking_line_items` with the constraint above;
   `booking_line_items_sync` and `bookings_propagate_dates`; and
   `asset_availability` as a view with `security_invoker = true`.
3. **Guard 5** in `20260101001400_bookings_write_gate.sql` — its own migration,
   because migration 11 runs before the tables exist — and the four tables added
   to `GATED_TABLES` in the schema test. A lapsed workspace must not take new
   reservations.
4. **`lib/supabase/types.ts`.**
5. **`lib/bookings.ts`**, then `tests/unit/bookings.test.ts`.
6. **`lib/actions/bookings.ts`**, then `tests/actions/bookings.test.ts`.
7. **Pages and components.** The create panel resolves the renter, because there
   is no renter directory in this slice: either an existing row or a walk-in that
   `createBooking` records before it writes the booking.
8. **`lib/features.ts` and the sidebar icon.**
9. **Fixtures.**
10. **Validation:** `pnpm supabase db reset` (the CLI is a devDependency now, so
    the constraint, the triggers and the view get exercised against real
    Postgres), then `pnpm verify`.

    Done, and the live run proved: a line copies its window and `blocks_stock`
    from the booking; an overlapping allocation is refused with `23P01`; an
    unallocated line never conflicts; a same-day handover is legal; moving a
    booking onto another fails through `bookings_propagate_dates`; cancelling
    releases the unit and empties the view; `check_asset_availability()` answers
    `0` afterwards; a zero-day window is refused by `bookings_window`; and a
    renter with history cannot be deleted.

## Rules the new code must keep

- Every table: RLS enabled, four policies, each one asking both
  `is_company_member`/`has_company_role` **and** `has_company_section(company_id,
  'bookings')`.
- Every new table appears in `GATED_TABLES` in the write-gate migration **and** in
  `_TablesCovered` in the schema test. That compile check exists so a new table
  cannot be forgotten, and it fails loudly if one is.
- Server Actions are the only mutation surface for staff. Each one runs
  `getActionContext` → `requireSection` → role check → `requireWritableWorkspace`
  → write → `revalidatePath` → `redirectWith`, exactly like
  `lib/actions/assets.ts`.
- Composite foreign keys everywhere a row names another tenant's row:
  `(company_id, booking_id) → bookings (company_id, id)`, and the same for
  `customer_id`, `asset_id`, `rider_id`. Each target needs `unique (company_id,
  id)` — the columns in that order, or the positional match compares the wrong
  pair.
- Cross-tenant assignment must be impossible at the database level, not only in
  the action.
- Availability is read, never stored: no booking write touches
  `products.inventory_quantity` or `assets.status`.
- `customers`, not `profiles`, is what a booking points at.

## Gotchas worth remembering

- A double-booking raises SQLSTATE **`23P01`** (`exclusion_violation`), not
  `23505`. `23505` is a duplicate booking reference. Mapping the wrong one
  produces a confident, wrong message.
- `check_asset_availability()` is advisory and exists so `assignAsset` can say
  *"That unit is already out on those dates."* The exclusion constraint is the
  guarantee. Keep both.
- Unallocated lines (`asset_id is null`) are legal and never conflict — a booking
  can be taken before the shop decides which unit goes out.
- `PageProps<"/[tenant]/bookings/[reference]">` comes from the generated route
  manifest. `pnpm typecheck` is `next typegen && tsc --noEmit`, so it is already
  covered; a bare `tsc --noEmit` on a brand-new route is not, and fails on a type
  that does not exist yet.
- Trigger functions are revoked from `public, anon, authenticated` and granted to
  `service_role` only, per migration 04 — Supabase grants EXECUTE on new `public`
  functions to `anon` explicitly.
- `pnpm test` covers SQL statically. A migration that parses is not a migration
  that runs; `db reset` is the only check that proves it.
