import type { ReactNode } from "react";

/**
 * Inline error block.
 *
 * Plain components with no directive on purpose: they render in a Server
 * Component and inside a Client Component form alike.
 */
export function AuthError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
    >
      {children}
    </p>
  );
}

/** Inline neutral notice, e.g. "check your email". */
export function AuthNotice({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="bg-muted text-muted-foreground rounded-md px-3 py-2 text-sm"
    >
      {children}
    </p>
  );
}
