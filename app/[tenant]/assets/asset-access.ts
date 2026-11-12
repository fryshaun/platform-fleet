import "server-only";

import { notFound } from "next/navigation";
import { connection } from "next/server";

import { type Asset } from "@/lib/assets";
import { getTenantContext, type TenantContext } from "@/lib/auth";
import { isWorkspaceWritable } from "@/lib/billing/entitlements";
import { isSectionEnabled } from "@/lib/features";
import { canFrontDesk, canManage } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

/**
 * What every tab of a unit page needs, resolved once.
 *
 * The four tabs are four pages, and each one has to answer the same questions
 * before it can render anything: does this workspace have the assets section,
 * does this unit exist in it, may the caller write, may they change the status,
 * may they edit the record. Answering them here means a new tab cannot forget
 * one — the same reason `requireSettingsAccess()` exists.
 *
 * `notFound()` rather than a redirect for both refusals: a unit that is not in
 * this workspace is not a permission problem, and neither is a section that is
 * switched off.
 */
export type AssetPage = TenantContext & {
  /** The request's client, so a tab does not build a second one. */
  supabase: Awaited<ReturnType<typeof createClient>>;
  asset: Asset;
  /** The workspace is paying, so forms may be shown. */
  writable: boolean;
  /** The caller may change availability — front desk and up. */
  canUpdateStatus: boolean;
  /**
   * The caller may fit and remove parts. The same tier as availability: a part
   * is workshop work, which is why `deleteComponent` is the manager-only one.
   */
  canFit: boolean;
  /** The caller may edit or delete the record — manager and up. */
  canEdit: boolean;
};

export async function requireAssetPage(
  tenant: string,
  handle: string,
): Promise<AssetPage> {
  // Creating the client starts `auth-js`' session recovery, which reads the
  // current time. Render at request time so that read does not happen while
  // prerendering, where it is reported as an unstable value.
  await connection();

  const context = await getTenantContext(tenant);
  const { company, role } = context;

  if (!isSectionEnabled(company, "assets")) {
    notFound();
  }

  const supabase = await createClient();

  // Scoped by company as well as by handle: a handle is only unique inside a
  // workspace, so this also keeps one tenant's unit out of another's URL.
  const { data: asset } = await supabase
    .from("assets")
    .select("*")
    .eq("company_id", company.id)
    .eq("handle", handle)
    .maybeSingle();

  if (!asset) {
    notFound();
  }

  // A lapsed subscription closes every write, and it closes them for everyone:
  // the front desk's status buttons go with the manager's edit form. Reads stay
  // open, so the record is still here — the banner explains why it is frozen.
  const writable = isWorkspaceWritable(company.subscription_status);

  return {
    ...context,
    supabase,
    asset,
    writable,
    canUpdateStatus: canFrontDesk(role) && writable,
    canFit: canFrontDesk(role) && writable,
    canEdit: canManage(role) && writable,
  };
}
