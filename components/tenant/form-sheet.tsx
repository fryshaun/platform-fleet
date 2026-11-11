"use client";

import { PlusIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

/**
 * The "add new …" standard: a button in the page header that slides a sheet of
 * paper in from the right, holding the section's create form.
 *
 * The fields are rendered on the server and handed in as `children`, so the form
 * still posts to the same Server Action as everywhere else; only the opening and
 * closing of the panel is client-side. The submit button lives in the footer,
 * outside the form, and reaches it through `form={formId}` — that is what lets it
 * sit next to Cancel. Callers pass the id constant from their section's `lib`
 * module so the panel and the form cannot drift apart.
 *
 * A failed submit comes back to the page it was posted from with `?error=`, so
 * the panel can show the message next to the fields it belongs to.
 */
export function FormSheet({
  triggerLabel,
  title,
  description,
  formId,
  submitLabel,
  children,
}: {
  /** Text on the header button, e.g. "New product". */
  triggerLabel: string;
  title: string;
  description: string;
  /** Id of the `<form>` inside `children`; the footer button submits it. */
  formId: string;
  submitLabel: string;
  children: ReactNode;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button size="sm">
          <PlusIcon aria-hidden="true" />
          {triggerLabel}
        </Button>
      </SheetTrigger>

      <SheetContent className="gap-0">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {children}
        </div>

        <SheetFooter className="border-t">
          <SheetClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </SheetClose>
          <Button type="submit" form={formId}>
            {submitLabel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
