import { createBrowserClient } from "@supabase/ssr";

import { getSupabasePublishableKey, getSupabaseUrl } from "./env";
import type { Database } from "./types";

/**
 * Browser-side Supabase client.
 *
 * Uses the publishable key, so every query is subject to Row Level Security.
 * Never import this from a Server Component or Server Action.
 */
export function createClient() {
  return createBrowserClient<Database>(
    getSupabaseUrl(),
    getSupabasePublishableKey(),
    {
      auth: {
        // `auth.mfa.recoveryCodes.*` is behind an opt-in flag: without it the
        // property is not built at all and calling it throws on `undefined`.
        // `@supabase/ssr` spreads these options into the GoTrue client, and the
        // server factory below passes the same flag so a code generated on the
        // server can be verified in the browser.
        experimental: { recoveryCodes: true },
      },
    },
  );
}
