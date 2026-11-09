/**
 * Public Supabase configuration.
 *
 * Supabase is retiring the legacy `anon` key in favour of a publishable key
 * (`sb_publishable_…`); both are safe to ship to the browser and are only
 * allowed to reach what Row Level Security permits for the `anon` role.
 *
 * The publishable name wins when both are set. The legacy name is still read so
 * that this code can ship before every environment has been rotated, and using
 * it logs a warning so the fallback does not quietly outlive the migration.
 *
 * Every value is read with static `process.env.NEXT_PUBLIC_*` property access
 * on purpose: Next inlines those exact expressions into the browser bundle,
 * whereas a computed `process.env[name]` lookup is left untouched and evaluates
 * to `undefined` in client code.
 */

export function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();

  if (!url) {
    throw new Error(
      "Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL",
    );
  }

  return url;
}

export function getSupabasePublishableKey(): string {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    readLegacyAnonKey();

  if (!key) {
    throw new Error(
      "Missing required environment variable: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY " +
        "(previously NEXT_PUBLIC_SUPABASE_ANON_KEY)",
    );
  }

  // A secret key in a `NEXT_PUBLIC_` variable is inlined into the browser
  // bundle, where it bypasses Row Level Security for anyone who opens dev
  // tools. Refusing to start is far better than shipping it.
  if (key.startsWith("sb_secret_")) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is set to a secret key (sb_secret_…). " +
        "Use the publishable key (sb_publishable_…) — a secret key must never reach the browser.",
    );
  }

  return key;
}

function readLegacyAnonKey(): string | undefined {
  const legacy = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!legacy) {
    return undefined;
  }

  warnDeprecated(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY is deprecated and will stop working in 2027. " +
      "Rename it to NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
  );

  return legacy;
}

const warned = new Set<string>();

/**
 * Logs a migration warning once per key, so a fallback that fires on every
 * request does not flood the logs. Shared with `env.server.ts`.
 */
export function warnDeprecated(message: string) {
  if (warned.has(message)) {
    return;
  }

  warned.add(message);
  console.warn(`[supabase] ${message}`);
}
