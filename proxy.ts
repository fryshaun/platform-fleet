import { NextResponse, type NextRequest } from "next/server";

import { RESERVED_SEGMENTS } from "@/lib/slug";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * The proxy only performs optimistic auth gating so unauthenticated visitors are
 * bounced before a tenant layout renders. Real authorization happens in the data
 * access layer (`lib/auth.ts`) and in Postgres via RLS.
 */

/**
 * Routes that require a signed-in user but are not tenant-scoped.
 *
 * `/mfa` and `/mfa/setup` belong here for the same reason `/workspaces` does: a
 * session at aal1 is still a session, and the pages that raise it to aal2 must
 * be reachable *by* that session. The gate that sends people to them lives in
 * the data access layer, not here — see `lib/mfa-server.ts`.
 */
const PROTECTED_ROOT_ROUTES = new Set([
  "/onboarding",
  "/workspaces",
  "/mfa",
  "/mfa/setup",
]);

/** Auth entry points that a signed-in user should never see. */
const AUTH_ROUTES = new Set(["/login", "/signup"]);

export default async function proxy(request: NextRequest) {
  const { response, userId } = await updateSession(request);

  const { pathname, search } = request.nextUrl;

  const firstSegment = pathname.split("/")[1] ?? "";
  const isTenantPath = firstSegment !== "" && !RESERVED_SEGMENTS.has(firstSegment);
  const needsAuth = isTenantPath || PROTECTED_ROOT_ROUTES.has(pathname);

  if (pathname === "/" && carriesAuthResult(request.nextUrl.searchParams)) {
    return forwardToCallback(request, response);
  }

  if (!userId && needsAuth) {
    return redirectTo(request, "/login", { next: `${pathname}${search}` }, response);
  }

  if (userId && AUTH_ROUTES.has(pathname)) {
    return redirectTo(request, "/workspaces", undefined, response);
  }

  return response;
}

/** Query keys Supabase appends when it redirects back to the app. */
const AUTH_RESULT_PARAMS = ["code", "token_hash", "error", "error_description"];

function carriesAuthResult(params: URLSearchParams): boolean {
  return AUTH_RESULT_PARAMS.some((key) => params.has(key));
}

/**
 * Forwards a result that landed on the marketing page to the callback.
 *
 * Supabase falls back to the project's **Site URL** whenever a `redirect_to` is
 * missing from its allow-list, and the Site URL is usually the bare origin. The
 * result arrives as `/?code=…`, where nothing would consume it and the visitor
 * would look signed out. Handled here rather than in `app/page.tsx` so the
 * marketing page stays static.
 */
function forwardToCallback(
  request: NextRequest,
  sessionResponse: NextResponse,
) {
  const url = request.nextUrl.clone();
  url.pathname = "/auth/callback";

  // The query is kept as-is: `next`, `type` and the code all have to survive.
  return copySessionCookies(NextResponse.redirect(url), sessionResponse);
}

/**
 * Builds a redirect that still carries any auth cookies rotated during
 * `updateSession`. Dropping them would silently invalidate the session.
 */
function redirectTo(
  request: NextRequest,
  pathname: string,
  query: Record<string, string> | undefined,
  sessionResponse: NextResponse,
) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }

  return copySessionCookies(NextResponse.redirect(url), sessionResponse);
}

function copySessionCookies(target: NextResponse, sessionResponse: NextResponse) {
  for (const cookie of sessionResponse.cookies.getAll()) {
    target.cookies.set(cookie);
  }
  return target;
}

export const config = {
  matcher: [
    // Everything except Next internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|map|txt|woff|woff2)$).*)",
  ],
};
