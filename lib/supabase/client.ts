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
  );
}
