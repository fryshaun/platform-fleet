import { redirect } from "next/navigation";

/**
 * Reading `params` to build the redirect target is request data, so this route
 * opts out of the static shell and resolves on the server. It only ever emits a
 * redirect, so there is nothing to stream.
 */
export const instant = false;

/** `/acme` is not a page of its own — send it to the dashboard. */
export default async function TenantIndexPage({
  params,
}: PageProps<"/[tenant]">) {
  const { tenant } = await params;
  redirect(`/${tenant}/dashboard`);
}
