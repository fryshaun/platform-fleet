import "server-only";

import { warnDeprecated } from "./env";

/**
 * Server-only Supabase configuration.
 *
 * The secret key (`sb_secret_…`) replaces the legacy `service_role` key. It
 * bypasses Row Level Security, so it must never be reachable from client code —
 * the `server-only` import turns that into a build error rather than a runtime
 * leak.
 */
export function getSupabaseSecretKey(): string {
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() || readLegacyServiceRoleKey();

  if (!key) {
    throw new Error(
      "Missing required environment variable: SUPABASE_SECRET_KEY " +
        "(previously SUPABASE_SERVICE_ROLE_KEY)",
    );
  }

  // A publishable key here does not error at the API boundary; it just silently
  // fails every write that the service role existed to perform.
  if (key.startsWith("sb_publishable_")) {
    throw new Error(
      "SUPABASE_SECRET_KEY is set to a publishable key (sb_publishable_…). " +
        "Use the secret key (sb_secret_…) — a publishable key cannot bypass Row Level Security.",
    );
  }

  return key;
}

function readLegacyServiceRoleKey(): string | undefined {
  const legacy = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!legacy) {
    return undefined;
  }

  warnDeprecated(
    "SUPABASE_SERVICE_ROLE_KEY is deprecated and will stop working in 2027. " +
      "Rename it to SUPABASE_SECRET_KEY.",
  );

  return legacy;
}
