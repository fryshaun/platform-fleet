import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getSupabasePublishableKey, getSupabaseUrl } from "./env";
import type { Database } from "./types";

/**
 * Server-side Supabase client bound to the current request's cookie jar.
 *
 * Reads and writes the auth cookies so that a refreshed session is persisted.
 * Because it reads `cookies()` it is request-scoped: call it inside a
 * `<Suspense>` boundary, a Server Action, or a Route Handler.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    getSupabaseUrl(),
    getSupabasePublishableKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot mutate cookies. The proxy refreshes the
            // session on every request, so this is safe to swallow here.
          }
        },
      },
    },
  );
}
