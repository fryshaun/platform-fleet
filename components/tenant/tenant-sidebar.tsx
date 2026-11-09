import Link from "next/link";
import { connection } from "next/server";

import { SidebarNav } from "@/components/tenant/sidebar-nav";
import { UserMenu } from "@/components/tenant/user-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { getTenantContext } from "@/lib/auth";
import { enabledSectionKeys } from "@/lib/features";
import { canAdminister, roleLabel } from "@/lib/roles";

/**
 * Icon rail for a single tenant.
 *
 * This reads the session and membership, so it must be rendered inside a
 * `<Suspense>` boundary by the layout — reading cookies in a layout's top level
 * would block the whole segment.
 */
export async function TenantSidebar({ slug }: { slug: string }) {
  // Creating the client starts `auth-js`' session recovery, which reads the
  // current time. Render at request time so that read does not happen while
  // prerendering, where it is reported as an unstable value.
  await connection();

  const { company, role, user } = await getTenantContext(slug);

  return (
    <aside
      aria-label="Workspace navigation"
      className="bg-sidebar border-border flex w-14 shrink-0 flex-col items-center justify-between border-r py-3"
    >
      <div className="flex flex-col items-center gap-3">
        <Link
          href={`/${company.slug}/dashboard`}
          aria-label={`${company.name} dashboard`}
          className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-md text-xs font-semibold"
        >
          {initials(company.name)}
        </Link>

        <SidebarNav
          tenantSlug={company.slug}
          sections={enabledSectionKeys(company)}
        />
      </div>

      <div className="flex flex-col items-center gap-2">
        <ThemeToggle />
        <UserMenu
          name={user.fullName}
          email={user.email}
          avatarUrl={user.avatarUrl}
          tenantSlug={company.slug}
          workspaceName={company.name}
          roleLabel={roleLabel(role)}
          canAdminister={canAdminister(role)}
        />
      </div>
    </aside>
  );
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}
