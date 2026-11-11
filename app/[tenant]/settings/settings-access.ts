import "server-only";

import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getTenantContext, type TenantContext } from "@/lib/auth";
import { canAdminister } from "@/lib/roles";

/**
 * Resolves the tenant for a settings screen, and refuses anybody below owner.
 *
 * Every tab is owner/admin work — company details, the extension switch, the
 * team and the subscription — so a manager, staff member or viewer gets a 404
 * rather than a page whose forms would all be rejected. The gate lives here,
 * once, so a new tab cannot forget it.
 */
export async function requireSettingsAccess(
  tenant: string,
): Promise<TenantContext> {
  // Creating the client starts `auth-js`' session recovery, which reads the
  // current time. Render at request time so that read does not happen while
  // prerendering, where it is reported as an unstable value.
  await connection();

  const context = await getTenantContext(tenant);

  if (!canAdminister(context.role)) {
    notFound();
  }

  return context;
}
