/**
 * Shared class strings for the section's native form controls.
 *
 * The UI kit ships Button, Input, Label and Badge but no select or textarea, so
 * the section styles the native elements directly — the same approach
 * `settings/members-section.tsx` takes for its role picker.
 */
export const SELECT_CLASSES =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px]";

export const TEXTAREA_CLASSES =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 min-h-24 w-full rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]";
