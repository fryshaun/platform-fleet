import { Badge } from "@/components/ui/badge";
import {
  BOOKING_CHANNEL_LABELS,
  BOOKING_STATUS_LABELS,
  holdsUnit,
} from "@/lib/bookings";
import type { BookingChannel, BookingStatus } from "@/lib/supabase/types";

/**
 * The status pill shared by the board and the booking page.
 *
 * Only the states that need a decision are loud: `out` is the one a shop scans
 * for, `confirmed` is the normal working state, and a cancelled booking is
 * red because somebody has to be told.
 */
export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return (
    <Badge
      variant={
        status === "out"
          ? "success"
          : status === "confirmed"
            ? "brand"
            : status === "cancelled"
              ? "destructive"
              : "outline"
      }
    >
      {BOOKING_STATUS_LABELS[status]}
    </Badge>
  );
}

/** Where the booking came from. The renter API is the only `api` writer. */
export function BookingChannelBadge({ channel }: { channel: BookingChannel }) {
  return <Badge variant="secondary">{BOOKING_CHANNEL_LABELS[channel]}</Badge>;
}

/**
 * Whether the booking still holds its units.
 *
 * Read straight from `holdsUnit`, which mirrors `booking_blocks_stock()`: a
 * cancelled booking keeps its lines but releases the bike, and the page should
 * say so rather than leaving the desk to guess.
 */
export function BookingHoldBadge({ status }: { status: BookingStatus }) {
  return (
    <Badge variant="outline">
      {holdsUnit(status) ? "Units held" : "Units released"}
    </Badge>
  );
}
