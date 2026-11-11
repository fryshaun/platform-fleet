import Link from "next/link";

import { BrandLink } from "@/components/brand/brand-link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <BrandLink logoClassName="text-lg" className="mb-2" />
      <p className="text-muted-foreground font-mono text-sm">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">
        This page does not exist
      </h1>
      <p className="text-muted-foreground max-w-sm text-sm">
        The workspace may have been renamed, or you may not have access to it.
      </p>
      <Button asChild>
        <Link href="/workspaces">Go to your workspaces</Link>
      </Button>
    </main>
  );
}
