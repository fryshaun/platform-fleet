import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { ReadOnlyNotice } from "@/components/billing/read-only-notice";
import { FormMessage } from "@/components/form-message";
import { PageHeader, PageSkeleton } from "@/components/tenant/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { deleteBooking, setBookingStatus } from "@/lib/actions/bookings";
import {
  bookingAddonsTotal,
  type Addon,
  type AddonProduct,
  type BookingLineAddon,
} from "@/lib/addons";
import {
  BOOKING_STATUS_LABELS,
  bookingTotals,
  formatBookingPrice,
  formatBookingWindow,
  nextBookingStatuses,
  type Booking,
  type BookingLineItem,
  type Customer,
} from "@/lib/bookings";
import { getTenantContext } from "@/lib/auth";
import { isWorkspaceWritable } from "@/lib/billing/entitlements";
import { isSectionEnabled } from "@/lib/features";
import { canAdminister, canFrontDesk, canManage } from "@/lib/roles";
import { readParam } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";

import { BookingHoldBadge, BookingStatusBadge } from "../booking-badges";
import { BookingFields } from "../booking-fields";
import { LineItemsSection } from "./line-items-section";

export const metadata: Metadata = {
  title: "Booking",
};

export default function BookingPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/bookings/[reference]">) {
  return (
    <main className="flex-1">
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <BookingContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function BookingContent({
  params,
  searchParams,
}: {
  params: PageProps<"/[tenant]/bookings/[reference]">["params"];
  searchParams: PageProps<"/[tenant]/bookings/[reference]">["searchParams"];
}) {
  await connection();

  const [{ tenant, reference }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const { company, role } = await getTenantContext(tenant);

  if (!isSectionEnabled(company, "bookings")) {
    notFound();
  }

  const supabase = await createClient();

  // Scoped by company as well as by reference: a reference is only unique inside
  // a workspace, so this also keeps one tenant's booking out of another's URL.
  const { data: booking } = await supabase
    .from("bookings")
    .select("*")
    .eq("company_id", company.id)
    .eq("reference", reference)
    .maybeSingle();

  if (!booking) {
    notFound();
  }

  const [linesResult, customersResult] = await Promise.all([
    supabase
      .from("booking_line_items")
      .select("*")
      .eq("company_id", company.id)
      .eq("booking_id", booking.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("customers")
      .select("id, full_name, email")
      .eq("company_id", company.id)
      .order("full_name", { ascending: true }),
  ]);

  const lines: BookingLineItem[] = linesResult.data ?? [];
  const customers: Pick<Customer, "id" | "full_name" | "email">[] =
    customersResult.data ?? [];

  // Neither picker is read when its section is off: RLS would return nothing,
  // and the line still renders — it just cannot name what it holds.
  const products = isSectionEnabled(company, "products")
    ? ((await supabase
        .from("products")
        .select("id, title, parent_id")
        .eq("company_id", company.id)
        .order("title", { ascending: true })).data ?? [])
    : [];

  const assets = isSectionEnabled(company, "assets")
    ? ((await supabase
        .from("assets")
        .select("id, name, status")
        .eq("company_id", company.id)
        .order("name", { ascending: true })).data ?? [])
    : [];

  const writable = isWorkspaceWritable(company.subscription_status);
  const canEdit = canFrontDesk(role) && writable;
  const canRemove = canManage(role) && writable;
  const moves = nextBookingStatuses(booking.status);
  const totals = bookingTotals(lines);

  // The extras are read in the same request as the lines: a booking page that
  // showed its money without them would under-quote the hire.
  const lineIds = lines.map((line) => line.id);
  const [addonsResult, addonScopeResult, lineAddonsResult] = await Promise.all([
    supabase
      .from("addons")
      .select("*")
      .eq("company_id", company.id)
      .order("name", { ascending: true }),
    supabase
      .from("addon_products")
      .select("company_id, addon_id, product_id, created_at")
      .eq("company_id", company.id),
    lineIds.length === 0
      ? Promise.resolve({ data: [] as BookingLineAddon[] })
      : supabase
          .from("booking_line_addons")
          .select("*")
          .eq("company_id", company.id)
          .in("line_item_id", lineIds),
  ]);

  const addons: Addon[] = addonsResult.data ?? [];
  const addonScope: AddonProduct[] = addonScopeResult.data ?? [];
  const lineAddons: BookingLineAddon[] = lineAddonsResult.data ?? [];
  const extrasCents = bookingAddonsTotal(
    lineAddons,
    booking.starts_on,
    booking.ends_on,
  );

  const renter = customers.find(
    (customer) => customer.id === booking.customer_id,
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6 lg:p-10">
      <PageHeader
        title={booking.reference}
        description={
          <>
            {renter?.full_name ?? "Renter"} ·{" "}
            {formatBookingWindow(booking.starts_on, booking.ends_on)} ·{" "}
            {formatBookingPrice(totals.totalCents + extrasCents, booking.currency)}
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <BookingStatusBadge status={booking.status} />
            <BookingHoldBadge status={booking.status} />
          </div>
        }
      />

      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/${company.slug}/bookings`}>← All bookings</Link>
        </Button>
      </div>

      {writable ? null : (
        <ReadOnlyNotice
          slug={company.slug}
          canManageBilling={canAdminister(role)}
        />
      )}

      <FormMessage error={readParam(query.error)} success={readParam(query.ok)} />

      <StatusCard
        slug={company.slug}
        booking={booking}
        canEdit={canEdit && moves.length > 0}
      />

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>
            The renter and the window. Changing the days re-checks every unit on
            the booking against the new dates.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canEdit ? (
            <BookingFields
              slug={company.slug}
              customers={customers}
              booking={booking}
            />
          ) : (
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground text-xs">Renter</dt>
                <dd>{renter?.full_name ?? "Unknown renter"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Window</dt>
                <dd>
                  {formatBookingWindow(booking.starts_on, booking.ends_on)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Notes</dt>
                <dd>{booking.notes ?? "None"}</dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      <LineItemsSection
        slug={company.slug}
        booking={booking}
        lines={lines}
        customers={customers}
        products={products}
        assets={assets}
        addons={addons}
        addonScope={addonScope}
        lineAddons={lineAddons}
        canEdit={canEdit}
      />

      {canRemove ? (
        <Card>
          <CardHeader>
            <CardTitle>Removal</CardTitle>
            <CardDescription>
              Deleting removes the booking and its lines. Mark it cancelled
              instead if you may want to look back at it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={deleteBooking}>
              <input type="hidden" name="slug" value={company.slug} />
              <input type="hidden" name="booking_id" value={booking.id} />
              <input type="hidden" name="reference" value={booking.reference} />
              <Button type="submit" size="sm" variant="destructive">
                Delete booking
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * The moves the transition table allows.
 *
 * A button per move rather than a status picker: the desk is choosing an action
 * ("it came back"), not editing a field, and a picker would offer moves the
 * server refuses.
 */
function StatusCard({
  slug,
  booking,
  canEdit,
}: {
  slug: string;
  booking: Booking;
  canEdit: boolean;
}) {
  const moves = nextBookingStatuses(booking.status);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Move the booking</CardTitle>
        <CardDescription>
          {booking.status === "out"
            ? "Mark it returned when the unit comes back — that releases it on the same day."
            : booking.status === "returned" || booking.status === "cancelled"
              ? "This booking is finished. Take a new one if the renter books again."
              : "Confirm it, or mark it out when the renter collects."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-2">
        {canEdit ? (
          moves.map((next) => (
            <form key={next} action={setBookingStatus}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="booking_id" value={booking.id} />
              <input type="hidden" name="reference" value={booking.reference} />
              <input type="hidden" name="status" value={next} />
              <Button
                type="submit"
                size="sm"
                variant={next === "cancelled" ? "destructive" : "outline"}
              >
                Mark {BOOKING_STATUS_LABELS[next].toLowerCase()}
              </Button>
            </form>
          ))
        ) : (
          <p className="text-muted-foreground text-sm">
            A staff member, manager, admin or owner can move this booking.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
