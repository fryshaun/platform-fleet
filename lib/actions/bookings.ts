"use server";

import { revalidatePath } from "next/cache";

import {
  getActionContext,
  readField,
  redirectWith,
  requireFrontDesk,
  requireManager,
  requireSection,
  requireWritableWorkspace,
  type ActionContext,
} from "@/lib/actions/support";
import {
  BOOKING_STATUS_LABELS,
  bookingReferenceFrom,
  canMoveBooking,
  customerHandleFrom,
  isBookingStatus,
  parseBookingDraft,
  parseLineItemDraft,
  type NewCustomerDraft,
} from "@/lib/bookings";

/**
 * Writes for the bookings section.
 *
 * Every action does the same five things, in this order: resolve the tenant,
 * check the section is switched on, check the tier, check the workspace may
 * still write, then write. The database repeats all of it through RLS — this is
 * what turns a refused write into a sentence a person can read.
 *
 * The tier is the front desk throughout. Taking a booking, moving it along and
 * allocating a unit is exactly the work `staff` exists for; only deleting a
 * booking is manager work, because it erases a reservation somebody may still be
 * honouring.
 *
 * Two SQLSTATEs mean different things and must not be confused: `23P01` is an
 * exclusion violation (that unit is already out on those dates) and `23505` is a
 * duplicate reference. Mapping the wrong one produces a confident, wrong answer.
 *
 * Results follow the pattern the rest of the app uses: a redirect back to the
 * page that owns the form with `?ok=` or `?error=`.
 */

/**
 * Refreshes everything under the workspace.
 *
 * The nearest layout is `app/[tenant]/layout.tsx`, so one call covers the board,
 * the detail page, and the availability figures the fleet shows.
 */
function revalidateBookings(slug: string) {
  revalidatePath(`/${slug}`, "layout");
}

/** Maps a Postgres error onto something worth showing in a form. */
function writeErrorMessage(error: { message: string; code?: string }): string {
  if (error.code === "23P01") {
    return "That unit is already out on those dates.";
  }
  if (error.code === "23505") {
    return "That booking reference is already in use. Try again.";
  }
  if (error.code === "23503") {
    return "That renter, product, unit or rider is no longer in this workspace.";
  }
  if (error.code === "23514") {
    return "Some of those values are out of range.";
  }
  return error.message;
}

/**
 * The page a booking form should return to, given the hidden reference field.
 *
 * Every action after creating takes `reference`, because the detail page is
 * addressed by it — the id stays server-side so a URL never carries two
 * spellings of the same booking.
 */
function bookingPath(formData: FormData): string {
  const reference = readField(formData, "reference");
  return reference ? `bookings/${reference}` : "bookings";
}

/** How many times a colliding generated reference is retried. */
const REFERENCE_ATTEMPTS = 3;

/** How many renter handles one creation may try. */
const HANDLE_ATTEMPTS = 3;

type RenterResult = { id: string } | { error: string };

/**
 * Records a renter typed in at the desk.
 *
 * There is no renter directory in this slice, so the booking form is where a
 * walk-in enters the system. Two unique indexes can refuse the row and they mean
 * different things: a handle collision is retried with the next number, while a
 * duplicate address is somebody already on file and is answered with a sentence
 * the desk can act on instead of a raw `23505`.
 */
async function createRenter(
  context: ActionContext,
  renter: NewCustomerDraft,
): Promise<RenterResult> {
  for (let attempt = 0; attempt < HANDLE_ATTEMPTS; attempt += 1) {
    const { data, error } = await context.supabase
      .from("customers")
      .insert({
        company_id: context.company.id,
        handle: customerHandleFrom(renter.full_name, attempt),
        full_name: renter.full_name,
        email: renter.email,
        phone: renter.phone,
      })
      .select("id")
      .single();

    if (!error) {
      return data
        ? { id: data.id }
        : { error: "Could not record that renter." };
    }

    if (error.code !== "23505") {
      return { error: writeErrorMessage(error) };
    }

    if (error.message.includes("customers_email")) {
      return {
        error: "That address is already one of this workspace's renters.",
      };
    }
  }

  return {
    error: "Could not find an address for that renter. Try another name.",
  };
}

/**
 * Takes a booking.
 *
 * The reference is generated here, never read from the form, and a collision is
 * retried rather than shown: the space is 32^6, so a second clash in a row means
 * something is wrong with the random source, not with the person at the desk.
 */
export async function createBooking(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireFrontDesk(context, slug);
  requireSection(context, slug, "bookings");
  requireWritableWorkspace(context, slug, "bookings");

  const parsed = parseBookingDraft(formData);
  if ("error" in parsed) {
    redirectWith(slug, "bookings", { error: parsed.error });
  }

  const draft = parsed.draft;

  // A walk-in has no row yet: record the renter first, then hang the booking on
  // it. The booking is never taken against a name nobody can look up later.
  let customerId = draft.customer_id;

  if (!customerId) {
    if (!draft.new_customer) {
      redirectWith(slug, "bookings", {
        error: "Choose a renter, or add a new one.",
      });
    }

    const renter = await createRenter(context, draft.new_customer);
    if ("error" in renter) {
      redirectWith(slug, "bookings", { error: renter.error });
    }

    customerId = renter.id;
  }

  let reference = bookingReferenceFrom(Math.random);
  let failure: { message: string; code?: string } | null = null;

  for (let attempt = 0; attempt < REFERENCE_ATTEMPTS; attempt += 1) {
    const { data, error } = await context.supabase
      .from("bookings")
      .insert({
        company_id: context.company.id,
        reference,
        customer_id: customerId,
        status: draft.status,
        // Only the desk writes here; the renter API is a later pass.
        channel: "staff",
        starts_on: draft.starts_on,
        ends_on: draft.ends_on,
        currency: context.company.currency,
        notes: draft.notes,
        created_by: context.user.id,
      })
      .select("reference")
      .single();

    if (!error) {
      revalidateBookings(slug);
      redirectWith(slug, `bookings/${data?.reference ?? reference}`, {
        ok: "Booking taken.",
      });
    }

    failure = error;
    if (error.code !== "23505") break;
    reference = bookingReferenceFrom(Math.random);
  }

  redirectWith(slug, "bookings", {
    error: writeErrorMessage(
      failure ?? { message: "Could not take the booking." },
    ),
  });
}

/**
 * Saves the renter, the window and the note.
 *
 * The status is deliberately not written: `setBookingStatus` owns it, and it
 * asks `canMoveBooking` first. Letting the edit form carry a status would make
 * the transition table advisory — a `returned` booking could be dragged back to
 * `pending` by editing its dates.
 */
export async function updateBooking(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireFrontDesk(context, slug);
  requireSection(context, slug, "bookings");
  requireWritableWorkspace(context, slug, "bookings");

  const bookingId = readField(formData, "booking_id");
  const back = bookingPath(formData);
  if (!bookingId) {
    redirectWith(slug, "bookings", { error: "Choose a booking first." });
  }

  const parsed = parseBookingDraft(formData);
  if ("error" in parsed) {
    redirectWith(slug, back, { error: parsed.error });
  }

  // The status is not written here: `setBookingStatus` owns it, and it asks
  // `canMoveBooking` first.
  const customerId = parsed.draft.customer_id;
  if (!customerId) {
    redirectWith(slug, back, { error: "Choose a renter." });
  }

  const { error } = await context.supabase
    .from("bookings")
    .update({
      customer_id: customerId,
      starts_on: parsed.draft.starts_on,
      ends_on: parsed.draft.ends_on,
      notes: parsed.draft.notes,
    })
    .eq("id", bookingId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, back, { error: writeErrorMessage(error) });
  }

  revalidateBookings(slug);
  redirectWith(slug, back, { ok: "Booking saved." });
}

/**
 * Moves a booking to its next status.
 *
 * Reads the current status first and checks the move against
 * `BOOKING_TRANSITIONS`, then scopes the update by the status it read: if
 * somebody else moved the booking in between, the write matches nothing instead
 * of silently skipping a step. A refused move answers with the two statuses
 * involved, because "you cannot do that" is not something a desk can act on.
 */
export async function setBookingStatus(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireFrontDesk(context, slug);
  requireSection(context, slug, "bookings");
  requireWritableWorkspace(context, slug, "bookings");

  const bookingId = readField(formData, "booking_id");
  const back = bookingPath(formData);
  if (!bookingId) {
    redirectWith(slug, "bookings", { error: "Choose a booking first." });
  }

  const next = readField(formData, "status");
  if (!isBookingStatus(next)) {
    redirectWith(slug, back, { error: "Choose a valid status." });
  }

  const { data: current } = await context.supabase
    .from("bookings")
    .select("status")
    .eq("id", bookingId)
    .eq("company_id", context.company.id)
    .maybeSingle();

  if (!current) {
    redirectWith(slug, back, { error: "That booking is no longer here." });
  }

  if (!canMoveBooking(current.status, next)) {
    redirectWith(slug, back, {
      error: `A ${BOOKING_STATUS_LABELS[
        current.status
      ].toLowerCase()} booking cannot be marked ${BOOKING_STATUS_LABELS[
        next
      ].toLowerCase()}.`,
    });
  }

  const { error } = await context.supabase
    .from("bookings")
    .update({ status: next })
    .eq("id", bookingId)
    .eq("company_id", context.company.id)
    .eq("status", current.status);

  if (error) {
    redirectWith(slug, back, { error: writeErrorMessage(error) });
  }

  revalidateBookings(slug);
  redirectWith(slug, back, {
    ok: `Marked ${BOOKING_STATUS_LABELS[next].toLowerCase()}.`,
  });
}

/**
 * Removes a booking and its lines.
 *
 * Manager work: cancelling is the reversible option and the one the desk owns.
 * The lines cascade with the booking, so there is nothing else to clean up.
 */
export async function deleteBooking(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireManager(context, slug);
  requireSection(context, slug, "bookings");
  requireWritableWorkspace(context, slug, "bookings");

  const bookingId = readField(formData, "booking_id");
  if (!bookingId) {
    redirectWith(slug, "bookings", { error: "Choose a booking first." });
  }

  const { error } = await context.supabase
    .from("bookings")
    .delete()
    .eq("id", bookingId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, bookingPath(formData), {
      error: writeErrorMessage(error),
    });
  }

  revalidateBookings(slug);
  redirectWith(slug, "bookings", { ok: "Booking deleted." });
}

/**
 * Adds a line to a booking.
 *
 * The window is not part of the payload: `booking_line_items_sync` copies it
 * from the parent, so a line cannot be given dates the booking never had. A
 * clash with another booking for the same unit is refused by the exclusion
 * constraint and arrives here as `23P01`.
 */
export async function addLineItem(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireFrontDesk(context, slug);
  requireSection(context, slug, "bookings");
  requireWritableWorkspace(context, slug, "bookings");

  const bookingId = readField(formData, "booking_id");
  const back = bookingPath(formData);
  if (!bookingId) {
    redirectWith(slug, "bookings", { error: "Choose a booking first." });
  }

  const parsed = parseLineItemDraft(formData);
  if ("error" in parsed) {
    redirectWith(slug, back, { error: parsed.error });
  }

  const { error } = await context.supabase
    .from("booking_line_items")
    .insert({
      company_id: context.company.id,
      booking_id: bookingId,
      ...parsed.draft,
    });

  if (error) {
    redirectWith(slug, back, { error: writeErrorMessage(error) });
  }

  revalidateBookings(slug);
  redirectWith(slug, back, { ok: "Line added." });
}

/** Changes what a line holds: the product, the quantity or the price. */
export async function updateLineItem(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireFrontDesk(context, slug);
  requireSection(context, slug, "bookings");
  requireWritableWorkspace(context, slug, "bookings");

  const lineItemId = readField(formData, "line_item_id");
  const back = bookingPath(formData);
  if (!lineItemId) {
    redirectWith(slug, back, { error: "Choose a line first." });
  }

  const parsed = parseLineItemDraft(formData);
  if ("error" in parsed) {
    redirectWith(slug, back, { error: parsed.error });
  }

  const { error } = await context.supabase
    .from("booking_line_items")
    .update(parsed.draft)
    .eq("id", lineItemId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, back, { error: writeErrorMessage(error) });
  }

  revalidateBookings(slug);
  redirectWith(slug, back, { ok: "Line saved." });
}

/** Takes a line off a booking. The rest of the booking stays as it was. */
export async function removeLineItem(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireFrontDesk(context, slug);
  requireSection(context, slug, "bookings");
  requireWritableWorkspace(context, slug, "bookings");

  const lineItemId = readField(formData, "line_item_id");
  const back = bookingPath(formData);
  if (!lineItemId) {
    redirectWith(slug, back, { error: "Choose a line first." });
  }

  const { error } = await context.supabase
    .from("booking_line_items")
    .delete()
    .eq("id", lineItemId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, back, { error: writeErrorMessage(error) });
  }

  revalidateBookings(slug);
  redirectWith(slug, back, { ok: "Line removed." });
}
/**
 * Puts a physical unit on a line, or takes it off with an empty value.
 *
 * `check_asset_availability()` is asked first so the desk gets a sentence
 * instead of a refusal from the constraint. It is advisory only — the constraint
 * is what holds under concurrency — and it is skipped when the line already
 * holds that unit, because the check counts the line itself.
 */
export async function assignAsset(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireFrontDesk(context, slug);
  requireSection(context, slug, "bookings");
  requireWritableWorkspace(context, slug, "bookings");

  const lineItemId = readField(formData, "line_item_id");
  const back = bookingPath(formData);
  if (!lineItemId) {
    redirectWith(slug, back, { error: "Choose a line first." });
  }

  const { data: line } = await context.supabase
    .from("booking_line_items")
    .select("id, asset_id, starts_on, ends_on")
    .eq("id", lineItemId)
    .eq("company_id", context.company.id)
    .maybeSingle();

  if (!line) {
    redirectWith(slug, back, { error: "That line is no longer here." });
  }

  const assetId = readField(formData, "asset_id");

  if (assetId && assetId !== line.asset_id) {
    const { data: clashes } = await context.supabase.rpc(
      "check_asset_availability",
      {
        target_company_id: context.company.id,
        target_asset_id: assetId,
        from_date: line.starts_on,
        to_date: line.ends_on,
      },
    );

    if (typeof clashes === "number" && clashes > 0) {
      redirectWith(slug, back, {
        error: "That unit is already out on those dates.",
      });
    }
  }

  const { error } = await context.supabase
    .from("booking_line_items")
    .update({ asset_id: assetId || null })
    .eq("id", lineItemId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, back, { error: writeErrorMessage(error) });
  }

  revalidateBookings(slug);
  redirectWith(slug, back, {
    ok: assetId ? "Unit assigned." : "Unit released.",
  });
}

/**
 * Books a single part on a line, or clears it with an empty value.
 *
 * A part is not capacity: two bookings may promise the same spare wheel, and the
 * schema says so — the exclusion constraint is on `asset_id`, not here. This is
 * therefore a naming write, like the rider, not a reservation.
 */
export async function assignComponent(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireFrontDesk(context, slug);
  requireSection(context, slug, "bookings");
  requireWritableWorkspace(context, slug, "bookings");

  const lineItemId = readField(formData, "line_item_id");
  const back = bookingPath(formData);
  if (!lineItemId) {
    redirectWith(slug, back, { error: "Choose a line first." });
  }

  const componentId = readField(formData, "component_id");

  const { error } = await context.supabase
    .from("booking_line_items")
    .update({ component_id: componentId || null })
    .eq("id", lineItemId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, back, { error: writeErrorMessage(error) });
  }

  revalidateBookings(slug);
  redirectWith(slug, back, {
    ok: componentId ? "Part assigned." : "Part released.",
  });
}

/** Names the person actually riding a line, or clears it with an empty value. */
export async function assignRider(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireFrontDesk(context, slug);
  requireSection(context, slug, "bookings");
  requireWritableWorkspace(context, slug, "bookings");

  const lineItemId = readField(formData, "line_item_id");
  const back = bookingPath(formData);
  if (!lineItemId) {
    redirectWith(slug, back, { error: "Choose a line first." });
  }

  const riderId = readField(formData, "rider_id");

  const { error } = await context.supabase
    .from("booking_line_items")
    .update({ rider_id: riderId || null })
    .eq("id", lineItemId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, back, { error: writeErrorMessage(error) });
  }

  revalidateBookings(slug);
  redirectWith(slug, back, {
    ok: riderId ? "Rider named." : "Rider cleared.",
  });
}


