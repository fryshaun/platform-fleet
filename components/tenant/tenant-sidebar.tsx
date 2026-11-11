import Link from "next/link";
import { connection } from "next/server";

import { CompanyMark } from "@/components/tenant/company-mark";
import {
  SidebarNav,
  type NavItem,
} from "@/components/tenant/sidebar-nav";
import { SettingsLink } from "@/components/tenant/settings-link";
import { UserMenu } from "@/components/tenant/user-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { getTenantContext } from "@/lib/auth";
import { enabledSectionKeys, SECTIONS } from "@/lib/features";
import { canAdminister, canManage, roleLabel } from "@/lib/roles";

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

  const sections = enabledSectionKeys(company);
  const items: NavItem[] = [
    {
      href: `/${company.slug}/dashboard`,
      label: "Dashboard",
      icon: "dashboard",
    },
    ...sections.flatMap((key): NavItem[] => {
      const item: NavItem = {
        href: `/${company.slug}/${SECTIONS[key].path}`,
        label: SECTIONS[key].label,
        icon: key,
      };

      // Categories belong to the products section but are a screen of their
      // own, and a manager-only one: they sit next to Products in the rail
      // rather than behind a link on the catalogue page, and a role that cannot
      // open them does not see the icon.
      return key === "products" && canManage(role)
        ? [
            item,
            {
              href: `${item.href}/categories`,
              label: "Categories",
              icon: "categories",
            },
          ]
        : [item];
    }),
  ];

  return (
    <aside
      aria-label="Workspace navigation"
      className="bg-sidebar border-none flex w-14 shrink-0 flex-col items-center justify-between border-r py-3"
    >
      <div className="flex flex-col items-center gap-3">
        {/* The workspace mark: a logo, then the badge, then the initials of the
            name — the same order the settings screen describes. */}
        <Link
          href={`/${company.slug}/dashboard`}
          aria-label={`${company.name} dashboard`}
          className="rounded-md"
        >
          <CompanyMark
            name={company.name}
            logoUrl={company.logo_url}
            badge={company.badge}
            className="size-9"
          />
        </Link>

        <SidebarNav items={items} />
      </div>

      <div className="flex flex-col items-center gap-2">
        {/* Settings is a destination, so it sits an arm's length from the
            account menu rather than inside it — and only for the roles that can
            open it. */}
        {canAdminister(role) ? <SettingsLink slug={company.slug} /> : null}
        <ThemeToggle />
        <UserMenu
          name={user.fullName}
          email={user.email}
          avatarUrl={user.avatarUrl}
          hasPassword={user.hasPassword}
          mfa={user.mfa}
          workspaceName={company.name}
          roleLabel={roleLabel(role)}
        />
      </div>
    </aside>
  );
}
