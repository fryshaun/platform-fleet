import Link from "next/link";

import {
  formatBookingPrice,
  formatBookingWindow,
  type Booking,
} from "@/lib/bookings";

import { BookingStatusBadge } from "./booking-badges";

/**
 * The board, as a list of reservations.
 *
 * Each row is one booking: the reference the desk quotes, the renter, the window
 * and what the booking is worth. The reference carries
 * `after:absolute after:inset-0`, so the whole row is clickable without wrapping
 * the badge and the total in a link that screen readers would read as one label.
 */
export function BookingDeck({
  slug,
  bookings,
  customerNames,
  totals,
  currency,
}: {
  slug: string;
  bookings: Booking[];
  customerNames: Map<string, string>;
  /** Booking id → the value of its lines, in minor units. */
  totals: Map<string, number>;
  currency: string;
}) {
  return (
    <ul className="grid gap-3">
      {bookings.map((booking) => (
        <li
          key={booking.id}
          className="bg-card text-card-foreground group relative rounded-xl border p-4 shadow-sm transition-shadow focus-within:ring-ring/50 hover:shadow-md focus-within:ring-[3px]"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h2 className="font-mono text-sm font-semibold">
                <Link
                  href={`/${slug}/bookings/${booking.reference}`}
                  className="underline-offset-4 outline-none after:absolute after:inset-0 group-hover:underline focus-visible:underline"
                >
                  {booking.reference}
                </Link>
              </h2>
              <p className="truncate text-sm">
                {customerNames.get(booking.customer_id) ?? "Renter"}
              </p>
              <p className="text-muted-foreground text-xs">
                {formatBookingWindow(booking.starts_on, booking.ends_on)}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              <span className="text-sm tabular-nums">
                {formatBookingPrice(totals.get(booking.id) ?? 0, currency)}
              </span>
              <BookingStatusBadge status={booking.status} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
