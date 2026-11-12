import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createBooking, updateBooking } from "@/lib/actions/bookings";
import {
  BOOKING_STATUS_OPTIONS,
  type Booking,
  type Customer,
} from "@/lib/bookings";
import { cn } from "@/lib/utils";

import { SELECT_CLASSES, TEXTAREA_CLASSES } from "../fields";

/** The minimum a renter needs to be offered in the picker. */
export type BookingCustomerOption = Pick<
  Customer,
  "id" | "full_name" | "email"
>;

/**
 * The booking form's fields, shared by the edit card and the "new booking" panel.
 *
 * The two differ in width and in who owns the submit button: the panel keeps
 * "Take booking" in its footer (next to Cancel), so it passes `showSubmit={false}`
 * and an id the footer button targets with `form=`. Everything about the fields
 * lives here, once.
 *
 * Creating also offers a walk-in: this slice has no renter directory, so the desk
 * needs a way to put somebody new in the book. The hidden pairing — a chosen
 * `customer_id` *or* a typed name — is resolved by `createBooking`.
 *
 * Editing deliberately has no status control: `setBookingStatus` owns that, and
 * the transition table would stop meaning anything if an edit could set any
 * value.
 */
export function BookingFields({
  slug,
  customers,
  booking,
  layout = "card",
  formId,
  submitLabel,
  showSubmit = true,
}: {
  slug: string;
  customers: BookingCustomerOption[];
  booking?: Booking;
  /** `card` is a two-column grid; `panel` stacks the fields in the slideout. */
  layout?: "card" | "panel";
  /** Id of the `<form>`, so a button outside it can submit it with `form=`. */
  formId?: string;
  submitLabel?: string;
  showSubmit?: boolean;
}) {
  const isEdit = Boolean(booking);
  const twoColumn = layout === "card";
  const wide = twoColumn ? "sm:col-span-2" : undefined;
  // The panel and the edit card can both be on the page, so ids must not collide.
  const fieldId = (name: string) => `${formId ?? "booking"}-${name}`;

  return (
    <form
      id={formId}
      action={isEdit ? updateBooking : createBooking}
      className={cn("grid gap-4", twoColumn && "sm:grid-cols-2")}
    >
      <input type="hidden" name="slug" value={slug} />
      {booking ? (
        <>
          <input type="hidden" name="booking_id" value={booking.id} />
          <input type="hidden" name="reference" value={booking.reference} />
        </>
      ) : null}

      <div className={cn("space-y-2", wide)}>
        <Label htmlFor={fieldId("customer")}>Renter</Label>
        <select
          id={fieldId("customer")}
          name="customer_id"
          defaultValue={booking?.customer_id ?? ""}
          className={SELECT_CLASSES}
          required={isEdit}
        >
          <option value="">
            {isEdit ? "Choose a renter" : "Pick a renter, or add one below"}
          </option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.full_name}
              {customer.email ? ` · ${customer.email}` : ""}
            </option>
          ))}
        </select>
      </div>

      {isEdit ? null : (
        <fieldset
          className={cn("space-y-3 rounded-lg border border-dashed p-3", wide)}
        >
          <legend className="px-1 text-xs font-medium">
            Or record a new renter
          </legend>
          <div className={cn("grid gap-3", twoColumn && "sm:grid-cols-3")}>
            <div className="space-y-2">
              <Label htmlFor={fieldId("new-name")}>Name</Label>
              <Input
                id={fieldId("new-name")}
                name="new_customer_name"
                placeholder="Nadia Okafor"
                maxLength={120}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={fieldId("new-email")}>Email</Label>
              <Input
                id={fieldId("new-email")}
                name="new_customer_email"
                type="email"
                maxLength={254}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={fieldId("new-phone")}>Phone</Label>
              <Input
                id={fieldId("new-phone")}
                name="new_customer_phone"
                maxLength={40}
              />
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            The renter is created with the booking. An address already on file is
            reported instead of being duplicated.
          </p>
        </fieldset>
      )}

      <div className="space-y-2">
        <Label htmlFor={fieldId("starts")}>Collection</Label>
        <Input
          id={fieldId("starts")}
          name="starts_on"
          type="date"
          defaultValue={booking?.starts_on ?? ""}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={fieldId("ends")}>Return</Label>
        <Input
          id={fieldId("ends")}
          name="ends_on"
          type="date"
          defaultValue={booking?.ends_on ?? ""}
          required
        />
        <p className="text-muted-foreground text-xs">
          The unit is free again on this date, so a same-day handover is fine.
        </p>
      </div>

      {isEdit ? null : (
        <div className="space-y-2">
          <Label htmlFor={fieldId("status")}>Status</Label>
          <select
            id={fieldId("status")}
            name="status"
            defaultValue="pending"
            className={SELECT_CLASSES}
          >
            {BOOKING_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className={cn("space-y-2", wide)}>
        <Label htmlFor={fieldId("notes")}>Notes</Label>
        <textarea
          id={fieldId("notes")}
          name="notes"
          defaultValue={booking?.notes ?? ""}
          className={TEXTAREA_CLASSES}
        />
      </div>

      {showSubmit ? (
        <div className={wide}>
          <Button type="submit">
            {submitLabel ?? (isEdit ? "Save booking" : "Take booking")}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
