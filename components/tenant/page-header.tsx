import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </div>
  );
}

/** Placeholder used while a tenant page streams its authenticated content. */
export function PageSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6 lg:p-10">
      <div className="space-y-2">
        <div className="bg-accent h-8 w-48 animate-pulse rounded-md" />
        <div className="bg-accent h-4 w-72 animate-pulse rounded-md" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className="bg-accent h-20 animate-pulse rounded-xl"
          />
        ))}
      </div>
    </div>
  );
}
