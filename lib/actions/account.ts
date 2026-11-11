"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import {
  AVATARS_BUCKET,
  AVATAR_MAX_BYTES,
  avatarPath,
  avatarStoragePath,
  avatarTypeFor,
  fullNameProblem,
  isOwnAvatarPath,
  normaliseFullName,
  passwordChangeProblem,
} from "@/lib/account";
import {
  getSessionContext,
  readField,
  readSecret,
  type ServerSupabase,
} from "@/lib/actions/support";

/**
 * Server Actions for the signed-in person's own account.
 *
 * These are the only actions in the app with no workspace in their life: the row
 * they write is keyed by `auth.uid()` and RLS stops them touching anything else,
 * so `getSessionContext` is the whole authorization check.
 *
 * Unlike the tenant actions they *answer* instead of redirecting. They are called
 * from a sheet in the rail, and a redirect would close the sheet and reload the
 * page underneath — which is exactly what the sheet exists to avoid.
 */

/** What the account forms render: an error, a notice, or neither. */
export type AccountFormState = {
  error: string | null;
  notice: string | null;
};

function failure(message: string): AccountFormState {
  return { error: message, notice: null };
}

function success(message: string): AccountFormState {
  return { error: null, notice: message };
}

/**
 * Saves the name shown in the rail, the team list and the account menu.
 *
 * An empty name is stored as `null`, which every reader already treats as "use
 * the email address" — so clearing the field is a supported answer, not an error.
 */
export async function updateProfile(
  _previousState: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const { supabase, user } = await getSessionContext();

  const name = normaliseFullName(readField(formData, "full_name"));
  const problem = fullNameProblem(name);
  if (problem) {
    return failure(problem);
  }

  const { error } = await supabase
    .from("profiles")
    .update({ full_name: name })
    .eq("id", user.id);

  if (error) {
    return failure(error.message);
  }

  // `getCurrentUser()` is cached for the tree and feeds the rail, the team list
  // and every menu, so the name is invalidated from the root layout down.
  revalidatePath("/", "layout");
  return success("Name updated.");
}

/**
 * Changes the password, after proving the caller knows the current one.
 *
 * `updateUser` only needs a valid session, so on its own it would let anyone
 * holding a borrowed browser change the password that protects the account. A
 * re-authentication in front of it makes the change something the owner asked
 * for. An account that signs in through Google has no password to prove, so it
 * is offered the chance to set one instead.
 *
 * Note: with Supabase's **Secure password change** setting switched on, GoTrue
 * requires a nonce from `reauthenticate()` and rejects `updateUser` with a
 * "needs reauthentication" error. Leave that setting off, or extend this action
 * to fetch and use the nonce.
 */
export async function changePassword(
  _previousState: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const { supabase, user } = await getSessionContext();

  const currentPassword = readSecret(formData, "current_password");
  const password = readSecret(formData, "password");
  const confirmation = readSecret(formData, "confirmation");

  const problem = passwordChangeProblem({
    hasPassword: user.hasPassword,
    currentPassword,
    password,
    confirmation,
  });
  if (problem) {
    return failure(problem);
  }

  if (user.hasPassword) {
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });

    if (verifyError) {
      return failure("That is not your current password.");
    }
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return failure(passwordErrorMessage(error.message));
  }

  return success("Password updated. Use it the next time you sign in.");
}

function passwordErrorMessage(message: string): string {
  if (/should be different|same password/i.test(message)) {
    return "Choose a password you have not used here before.";
  }
  return message;
}

// -----------------------------------------------------------------------------
// Photo
// -----------------------------------------------------------------------------
export type AvatarUploadTarget =
  | { ok: true; path: string; token: string; publicUrl: string }
  | { ok: false; message: string };

export type AvatarResult =
  | { ok: true; message: string; url: string | null }
  | { ok: false; message: string };

/**
 * Reserves a place in the bucket for one photo and hands back a signed upload
 * URL — the same three-step flow as the product gallery.
 *
 * The browser PUTs the bytes straight to Storage, because a Server Action would
 * have to carry them and those bodies are capped well below a phone photo. The
 * URL is minted with the caller's own client, so the bucket's insert policy
 * (`<user-id>/<file>`) is applied before a token exists at all.
 */
export async function createAvatarUploadUrl(input: {
  contentType: string;
  size: number;
}): Promise<AvatarUploadTarget> {
  const { supabase, user } = await getSessionContext();

  const type = avatarTypeFor(input.contentType);
  if (!type) {
    return { ok: false, message: "Upload a PNG, JPEG, WebP or AVIF image." };
  }
  if (!Number.isFinite(input.size) || input.size <= 0) {
    return { ok: false, message: "That file is empty." };
  }
  if (input.size > AVATAR_MAX_BYTES) {
    return { ok: false, message: "Keep photos under 2 MB." };
  }

  const path = avatarPath(user.id, `${randomUUID()}.${type.extension}`);

  const { data, error } = await supabase.storage
    .from(AVATARS_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    return {
      ok: false,
      message: error?.message ?? "Could not start the upload.",
    };
  }

  return {
    ok: true,
    path: data.path,
    token: data.token,
    publicUrl: supabase.storage
      .from(AVATARS_BUCKET)
      .getPublicUrl(data.path).data.publicUrl,
  };
}

/**
 * Records an upload that has already landed, by writing the URL into the profile.
 *
 * Called by the uploader after a successful PUT, so it re-checks the path: only
 * this user's own folder is accepted, whatever a modified client might send.
 */
export async function setAvatar(input: {
  path: string;
  contentType: string;
}): Promise<AvatarResult> {
  const { supabase, user } = await getSessionContext();

  if (
    !avatarTypeFor(input.contentType) ||
    !isOwnAvatarPath(input.path, user.id)
  ) {
    return { ok: false, message: "That upload does not belong to you." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  const publicUrl = supabase.storage
    .from(AVATARS_BUCKET)
    .getPublicUrl(input.path).data.publicUrl;

  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: publicUrl })
    .eq("id", user.id);

  if (error) {
    return { ok: false, message: error.message };
  }

  await removeStoredAvatar(supabase, profile?.avatar_url ?? null);

  revalidatePath("/", "layout");
  return { ok: true, message: "Photo updated.", url: publicUrl };
}

/** Clears the photo and forgets the object behind it. */
export async function removeAvatar(): Promise<AvatarResult> {
  const { supabase, user } = await getSessionContext();

  const { data: profile } = await supabase
    .from("profiles")
    .select("avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: null })
    .eq("id", user.id);

  if (error) {
    return { ok: false, message: error.message };
  }

  await removeStoredAvatar(supabase, profile?.avatar_url ?? null);

  revalidatePath("/", "layout");
  return { ok: true, message: "Photo removed.", url: null };
}

/**
 * Deletes the object behind a URL this app wrote.
 *
 * A URL that is not ours — an empty column, or a link somebody pasted in —
 * resolves to `null` and is left alone. A failed delete is logged rather than
 * raised: the profile already points at the new photo, and an orphan object is
 * cheaper than an error in the person's face.
 */
async function removeStoredAvatar(
  supabase: ServerSupabase,
  url: string | null,
): Promise<void> {
  const path = avatarStoragePath(url);
  if (!path) {
    return;
  }

  const { error } = await supabase.storage.from(AVATARS_BUCKET).remove([path]);

  if (error) {
    console.error("Could not remove the previous avatar:", error.message);
  }
}
