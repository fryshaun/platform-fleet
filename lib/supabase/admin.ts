import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getSupabaseUrl } from "./env";
import { getSupabaseSecretKey } from "./env.server";
import type { Database } from "./types";

/**
 * Secret-key Supabase client.
 *
 * This client bypasses Row Level Security. It is only ever constructed on the
 * server and must never be reachable from client code. Use it exclusively for
 * privileged operations such as provisioning a company during signup or
 * reconciling Stripe webhooks.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    getSupabaseUrl(),
    getSupabaseSecretKey(),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  );
}
