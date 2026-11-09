import { Suspense } from "react";

import { TenantSidebar } from "@/components/tenant/tenant-sidebar";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Tenant shell.
 *
 * Deliberately static: the document `<html>`/`<body>` already belongs to the root
 * layout, and the sidebar (which reads the session) is pushed behind its own
 * `<Suspense>` boundary so `{children}` is never blocked by a request read.
 */
export default function TenantLayout({
  children,
  params,
}: LayoutProps<"/[tenant]">) {
  return (
    <div className="flex min-h-svh">
      <Suspense fallback={<SidebarFallback />}>
        <TenantSidebarSlot params={params} />
      </Suspense>

      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

async function TenantSidebarSlot({
  params,
}: {
  params: LayoutProps<"/[tenant]">["params"];
}) {
  const { tenant } = await params;
  return <TenantSidebar slug={tenant} />;
}

function SidebarFallback() {
  return (
    <div className="border-border flex w-14 shrink-0 flex-col items-center gap-3 border-r py-3">
      <Skeleton className="size-9 rounded-md" />
      <Skeleton className="size-9 rounded-md" />
      <Skeleton className="size-9 rounded-md" />
      <Skeleton className="size-9 rounded-md" />
    </div>
  );
}
