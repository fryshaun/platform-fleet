"use server";

import { redirect } from "next/navigation";

import { MIN_PASSWORD_LENGTH, OTP_LENGTH } from "@/lib/auth-policy";
import { safeNextPath } from "@/lib/safe-redirect";
import { getOrigin } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";

/** Returned to the form when an auth action cannot continue. */
export type AuthFormState = {
  error: string | null;
  notice: string | null;
};

/** Reads a trimmed string field, treating a missing value as empty. */
function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Passwords are never trimmed: leading and trailing spaces are part of them. */
function readSecret(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Starts the Google OAuth handshake.
 *
 * The `next` value travels through the callback so the user lands where they
 * started, e.g. a deep link to `/{tenant}/dashboard`.
 */
export async function signInWithGoogle(formData: FormData) {
  const next = safeNextPath(formData.get("next"), "/workspaces");
  const origin = await getOrigin();
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  });

  if (error || !data.url) {
    redirect(
      `/login?error=${encodeURIComponent(error?.message ?? "Could not start sign in")}`,
    );
  }

  redirect(data.url);
}

/**
 * Signs in with an email and password.
 *
 * Errors are rephrased here rather than shown raw: GoTrue's wording ("Invalid
 * login credentials") is not something to put in front of a customer.
 */
export async function signInWithEmail(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = readField(formData, "email");
  const password = readSecret(formData, "password");
  const next = safeNextPath(formData.get("next"), "/workspaces");

  if (!email || !password) {
    return { error: "Enter your email and password.", notice: null };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: signInMessage(error.message), notice: null };
  }

  redirect(next);
}

/**
 * Creates an account, or asks an existing one to confirm its address.
 *
 * With email confirmation enabled Supabase answers with an obfuscated user and
 * no session, whether or not the address is already taken. The notice is
 * worded so that both cases read the same.
 */
export async function signUpWithEmail(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = readField(formData, "email");
  const password = readSecret(formData, "password");
  const next = safeNextPath(formData.get("next"), "/onboarding");

  if (!email || !password) {
    return { error: "Enter your email and choose a password.", notice: null };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      error: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
      notice: null,
    };
  }

  const origin = await getOrigin();
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Confirmation links come back through the callback so the session cookie
      // is set on this origin, then land on onboarding.
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) {
    return { error: signUpMessage(error.message), notice: null };
  }

  // Confirmation is off: Supabase already returned a usable session.
  if (data.session) {
    redirect(next);
  }

  return {
    error: null,
    notice: `Check ${email} for a confirmation link to finish creating your account.`,
  };
}

/**
 * Emails a magic link (and a one-time code, if the template includes one).
 *
 * `shouldCreateUser` is on because sign in and sign up share this card, and
 * because turning it off would let the response reveal which addresses exist.
 */
export async function sendMagicLink(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = readField(formData, "email");
  const next = safeNextPath(formData.get("next"), "/workspaces");

  if (!email) {
    return { error: "Enter your email address.", notice: null };
  }

  const origin = await getOrigin();
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      shouldCreateUser: true,
    },
  });

  if (error) {
    return { error: sendLinkMessage(error.message), notice: null };
  }

  return {
    error: null,
    notice: `Check ${email} for a sign-in link. It expires in an hour and works once.`,
  };
}

/**
 * Verifies the six-digit code from that email.
 *
 * This is the path that works when the link is opened on another device: the
 * code is typed into the browser that is signing in, so no PKCE cookie is
 * involved.
 */
export async function verifyEmailOtp(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = readField(formData, "email");
  const token = readField(formData, "token").replace(/\s+/g, "");
  const next = safeNextPath(formData.get("next"), "/workspaces");

  if (!email) {
    return {
      error: "Enter the email address the code was sent to.",
      notice: null,
    };
  }

  if (token.length !== OTP_LENGTH || !/^\d+$/.test(token)) {
    return {
      error: `Enter the ${OTP_LENGTH}-digit code from the email.`,
      notice: null,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  });

  if (error) {
    return { error: verifyCodeMessage(error.message), notice: null };
  }

  redirect(next);
}

/**
 * Emails a password-recovery link.
 *
 * The link goes through `/auth/callback` like every other email, so the token
 * is verified in whichever browser opens it and the resulting session is what
 * `/reset-password` changes the password on. No `next` is accepted: the point
 * of a reset is the new password, not returning to a deep link.
 *
 * The notice is worded conditionally because GoTrue answers the same way for an
 * address with no account — the response must not reveal which addresses exist.
 */
export async function requestPasswordReset(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = readField(formData, "email");

  if (!email) {
    return {
      error: "Enter the email address you signed up with.",
      notice: null,
    };
  }

  const origin = await getOrigin();
  const supabase = await createClient();

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    // `type=recovery` in the template decides that the callback marks the
    // browser; `next` is what that browser then lands on.
    redirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/reset-password")}`,
  });

  if (error) {
    return { error: sendLinkMessage(error.message), notice: null };
  }

  return {
    error: null,
    notice: `If ${email} has an account, a reset link is on its way. It expires in an hour and works once.`,
  };
}

function signInMessage(message: string): string {
  if (/invalid login credentials/i.test(message)) {
    return "Incorrect email or password.";
  }
  if (/email not confirmed/i.test(message)) {
    return "Confirm your email address before signing in.";
  }
  return message;
}

function signUpMessage(message: string): string {
  if (/user already registered/i.test(message)) {
    return "That email already has an account. Sign in instead.";
  }
  if (/password should be at least/i.test(message)) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return message;
}

function sendLinkMessage(message: string): string {
  if (/for security purposes|rate limit/i.test(message)) {
    return "Wait a minute before requesting another link.";
  }
  return message;
}

function verifyCodeMessage(message: string): string {
  if (/expired|invalid/i.test(message)) {
    return "That code is wrong or has expired. Request a new link.";
  }
  return message;
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
