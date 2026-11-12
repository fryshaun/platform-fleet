import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { ReadOnlyNotice } from "@/components/billing/read-only-notice";
import { FormMessage } from "@/components/form-message";
import { FormSheet } from "@/components/tenant/form-sheet";
import { PageHeader, PageSkeleton } from "@/components/tenant/page-header";
import { Button } from "@/components/ui/button";
import { getTenantContext } from "@/lib/auth";
import { isWorkspaceWritable } from "@/lib/billing/entitlements";
import {
  BOOKING_SORT_OPTIONS,
  BOOKING_STATUS_OPTIONS,
  bookingTotals,
  holdsUnit,
  isBookingStatus,
  NEW_BOOKING_FORM_ID,
  readBookingSort,
  type Booking,
  type BookingLineItem,
} from "@/lib/bookings";
import { isSectionEnabled } from "@/lib/features";
import { canAdminister, canFrontDesk } from "@/lib/roles";
import { readParam } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";

import { SELECT_CLASSES } from "../fields";
import { BookingDeck } from "./booking-deck";
import { BookingFields } from "./booking-fields";

export const metadata: Metadata = {
  title: "Bookings",
};

/** The default order, and the one the Reset link returns to. */
const DEFAULT_BOOKING_SORT = BOOKING_SORT_OPTIONS[0].value;

export default function BookingsPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/bookings">) {
  return (
    <main className="flex-1">
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <BookingsContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function BookingsContent({
  params,
  searchParams,
}: {
  params: PageProps<"/[tenant]/bookings">["params"];
  searchParams: PageProps<"/[tenant]/bookings">["searchParams"];
}) {
  // Creating the client starts `auth-js`' session recovery, which reads the
  // current time. Render at request time so that read does not happen while
  // prerendering, where it is reported as an unstable value.
  await connection();

  const [{ tenant }, query] = await Promise.all([params, searchParams]);
  const { company, role } = await getTenantContext(tenant);

  // A section that is switched off does not exist for this workspace — not even
  // its URL. RLS enforces the same thing on the data itself.
  if (!isSectionEnabled(company, "bookings")) {
    notFound();
  }

  const statusParam = readParam(query.status);
  const status =
    statusParam && isBookingStatus(statusParam) ? statusParam : null;
  const sort = readBookingSort(readParam(query.sort));

  const supabase = await createClient();

  let bookingQuery = supabase
    .from("bookings")
    .select("*")
    .eq("company_id", company.id);

  if (status) {
    bookingQuery = bookingQuery.eq("status", status);
  }

  switch (sort) {
    case "latest":
      bookingQuery = bookingQuery.order("starts_on", { ascending: false });
      break;
    case "newest":
      bookingQuery = bookingQuery.order("created_at", { ascending: false });
      break;
    case "status":
      bookingQuery = bookingQuery
        .order("status", { ascending: true })
        .order("starts_on", { ascending: true });
      break;
    default:
      bookingQuery = bookingQuery.order("starts_on", { ascending: true });
  }

  // The renter picker is read in the same round trip as the board: a booking
  // cannot be taken without somebody to take it for.
  const [bookingsResult, customersResult] = await Promise.all([
    bookingQuery,
    supabase
      .from("customers")
      .select("id, full_name, email")
      .eq("company_id", company.id)
      .order("full_name", { ascending: true }),
  ]);

  const bookings: Booking[] = bookingsResult.data ?? [];
  const customers = customersResult.data ?? [];

  // What each booking is worth, read from its lines rather than stored.
  const bookingIds = bookings.map((booking) => booking.id);
  const lines: Pick<
    BookingLineItem,
    "booking_id" | "quantity" | "unit_price_cents"
  >[] =
    bookingIds.length > 0
      ? ((await supabase
          .from("booking_line_items")
          .select("booking_id, quantity, unit_price_cents")
          .in("booking_id", bookingIds)).data ?? [])
      : [];

  const totals = new Map<string, number>();
  for (const booking of bookings) {
    totals.set(
      booking.id,
      bookingTotals(lines.filter((line) => line.booking_id === booking.id))
        .totalCents,
    );
  }

  const customerNames = new Map(
    customers.map((customer) => [customer.id, customer.full_name]),
  );

  const writable = isWorkspaceWritable(company.subscription_status);
  const canEdit = canFrontDesk(role) && writable;
  const filtered = Boolean(status);
  const holding = bookings.filter((booking) => holdsUnit(booking.status)).length;
  const summary =
    bookings.length === 0
      ? "Nothing in the book"
      : `${bookings.length} ${bookings.length === 1 ? "booking" : "bookings"} · ${holding} holding units`;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6 lg:p-10">
      <PageHeader
        title="Bookings"
        description="Every reservation, the renter it is for and the units it holds."
        actions={
          canEdit ? (
            <FormSheet
              triggerLabel="New booking"
              title="Take a booking"
              description="Pick a renter or record a walk-in, then choose the days the unit is out."
              formId={NEW_BOOKING_FORM_ID}
              submitLabel="Take booking"
            >
              <BookingFields
                slug={company.slug}
                customers={customers}
                layout="panel"
                formId={NEW_BOOKING_FORM_ID}
                showSubmit={false}
              />
            </FormSheet>
          ) : undefined
        }
      />

      {writable ? null : (
        <ReadOnlyNotice
          slug={company.slug}
          canManageBilling={canAdminister(role)}
        />
      )}

      <FormMessage
        error={readParam(query.error)}
        success={readParam(query.ok)}
      />

      <form
        method="get"
        aria-label="Filter and sort the book"
        className="grid gap-3 sm:grid-cols-[minmax(0,13rem)_minmax(0,13rem)_auto] sm:items-end"
      >
        <label className="space-y-2 text-sm">
          <span className="font-medium">Status</span>
          <select
            name="status"
            defaultValue={status ?? ""}
            className={SELECT_CLASSES}
          >
            <option value="">Any status</option>
            {BOOKING_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2 text-sm">
          <span className="font-medium">Sort</span>
          <select name="sort" defaultValue={sort} className={SELECT_CLASSES}>
            {BOOKING_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-2">
          <Button type="submit" variant="outline">
            Apply
          </Button>
          {status || sort !== DEFAULT_BOOKING_SORT ? (
            <Button type="button" variant="ghost" asChild>
              <Link href={`/${company.slug}/bookings`}>Reset</Link>
            </Button>
          ) : null}
        </div>
      </form>

      <section aria-labelledby="book-heading" className="space-y-4">
        <div className="space-y-1">
          <h2
            id="book-heading"
            className="text-lg font-semibold tracking-tight"
          >
            The book
          </h2>
          <p className="text-muted-foreground text-sm">{summary}</p>
        </div>

        {bookings.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center text-sm">
            <p>
              {filtered
                ? "Nothing matches this filter."
                : canEdit
                  ? "No bookings yet. Use “New booking” at the top of the page to take the first one — a walk-in can be recorded without leaving the form."
                  : "No bookings yet. The front desk can take the first one."}
            </p>
            {filtered ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/${company.slug}/bookings`}>Clear filter</Link>
              </Button>
            ) : null}
          </div>
        ) : (
          <BookingDeck
            slug={company.slug}
            bookings={bookings}
            customerNames={customerNames}
            totals={totals}
            currency={company.currency}
          />
        )}
      </section>
    </div>
  );
}
