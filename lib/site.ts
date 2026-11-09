import "server-only";

import { headers } from "next/headers";

const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1"] as const;

/**
 * A `Host`/`X-Forwarded-Host` value we are willing to build a URL from.
 *
 * The header is attacker-controlled whenever the deployment is reachable
 * directly (rather than through a proxy that overwrites it), and its value ends
 * up in Stripe `success_url`s and Supabase `redirectTo`s. Restricting it to
 * `hostname[:port]` characters keeps things like `evil.example.com/x`,
 * `user@evil.example.com` and embedded whitespace or newlines out of the URL,
 * where they would change its meaning instead of merely looking odd.
 */
function isUsableHost(host: string | null): host is string {
  return host !== null && /^[a-z0-9.-]+(:\d{1,5})?$/i.test(host);
}

/** Only the two schemes a browser will follow. */
function isUsableProto(proto: string | null): proto is "http" | "https" {
  return proto === "http" || proto === "https";
}

/** True when `origin` is an absolute URL pointing at this machine. */
function isLocalOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return LOCAL_HOSTNAMES.some((local) => hostname === local);
  } catch {
    return false;
  }
}

/**
 * Public URL of this deployment, if Vercel told us one.
 *
 * Both variables are injected by Vercel and absent elsewhere. The production
 * domain is preferred over the per-deployment URL because OAuth redirects and
 * Stripe return URLs are registered against the former.
 */
function deploymentOrigin(): string | null {
  const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const deploymentUrl = process.env.VERCEL_URL?.trim();
  const host = productionUrl || deploymentUrl;
  if (!host) return null;

  // Vercel injects a bare host; a value pasted with a scheme is tolerated.
  const bareHost = host.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${bareHost}`;
}

async function resolveOrigin(): Promise<string> {
  const headerList = await headers();

  const forwardedHost = headerList.get("x-forwarded-host");
  const host = forwardedHost ?? headerList.get("host");

  if (host !== null && !isUsableHost(host)) {
    // A rejected host falls through to the configured origin below rather than
    // being echoed back into a redirect URL.
    console.error(
      `[getOrigin] Ignoring a malformed Host header ("${host}"); falling back to the configured origin.`,
    );
  }

  if (isUsableHost(host)) {
    const isLocal =
      host.startsWith("localhost") || host.startsWith("127.0.0.1");
    const forwardedProto = headerList.get("x-forwarded-proto");
    const proto = isUsableProto(forwardedProto)
      ? forwardedProto
      : isLocal
        ? "http"
        : "https";

    return `${proto}://${host}`;
  }

  // A variable that is defined-but-empty is common on Vercel; treat it as
  // unset rather than producing an origin of "", which would turn return
  // URLs into relative paths and make Stripe reject the session.
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  return "http://localhost:3000";
}

/**
 * Absolute origin of the current request.
 *
 * Prefers the proxy headers Vercel sets so that Stripe return URLs and OAuth
 * redirects point at the host the user is actually on (including previews),
 * rather than a hard-coded environment variable.
 *
 * That header is only trusted as far as it looks like a hostname: a value with a
 * path, credentials, whitespace or two authorities is ignored in favour of the
 * configured origin, so a tampered `Host` cannot choose where a payment returns
 * to. See `isUsableHost`.
 *
 * A localhost origin is refused while deployed. That only happens when
 * `NEXT_PUBLIC_SITE_URL` still holds the value copied from `.env.example`, and
 * silently honouring it would send sign-in redirects to the developer's own
 * machine instead of back to the deployment.
 */
export async function getOrigin(): Promise<string> {
  const origin = await resolveOrigin();

  if (!isLocalOrigin(origin)) {
    return origin;
  }

  const deployed = deploymentOrigin();
  if (!deployed) {
    return origin;
  }

  console.error(
    `[getOrigin] Refusing local origin "${origin}" on a deployment; using "${deployed}". ` +
      "Set NEXT_PUBLIC_SITE_URL to the public origin and add it to Supabase's redirect URLs.",
  );

  return deployed;
}
