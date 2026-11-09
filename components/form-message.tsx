import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Renders the `?error=` / `?ok=` message a Server Action leaves behind.
 *
 * Keeping feedback in the URL means the forms stay server-rendered and the
 * message survives the redirect that follows a mutation.
 */
export function FormMessage({
  error,
  success,
}: {
  error?: string;
  success?: string;
}) {
  if (!error && !success) {
    return null;
  }

  const isError = Boolean(error);

  return (
    <div
      role={isError ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
        isError
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      )}
    >
      {isError ? (
        <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      ) : (
        <CircleCheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      )}
      <span>{error ?? success}</span>
    </div>
  );
}
