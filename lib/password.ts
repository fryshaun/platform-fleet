import "server-only";

import { hasPasswordFromRpc } from "@/lib/account";
import type { createClient } from "@/lib/supabase/server";

/**
 * The truthful answer to "does this account have a password?".
 *
 * `public.has_password()` reads `auth.users.encrypted_password`, which no client
 * library exposes — not `User`, not the admin API. The RPC is therefore the only
 * source that gets invited users right: they sign in by email but have no
 * password until they set one, so `app_metadata.providers` says "email" while
 * `encrypted_password` is still null.
 *
 * Falls back to the provider list when the call fails, which in practice means
 * the migration has not been pushed yet. Asking a Google-only account for a
 * password it cannot have is a dead end, but *refusing* a password change
 * because a helper is missing would be worse — see `hasPasswordFromRpc`.
 */
export async function readHasPassword(
  supabase: Awaited<ReturnType<typeof createClient>>,
  providers: unknown,
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("has_password");

    if (error) {
      console.error(
        `[account] has_password() failed, falling back to the provider list: ${error.message}`,
      );
    } else if (typeof data === "boolean") {
      return data;
    }
  } catch (cause) {
    console.error(
      "[account] has_password() failed, falling back to the provider list:",
      cause,
    );
  }

  return hasPasswordFromRpc(null, providers);
}
