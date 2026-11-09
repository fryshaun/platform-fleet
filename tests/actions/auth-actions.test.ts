import { beforeEach, describe, expect, it, vi } from "vitest";

import { formDataOf } from "../helpers/fixtures";
import { captureRedirect, redirectParams, redirectPath } from "../helpers/redirect";
import { createSupabaseMock } from "../helpers/supabase";

const serverMock = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("__NOT_FOUND__");
  }),
}));

vi.mock("@/lib/site", () => ({
  getOrigin: async () => "https://platform.example.com",
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: serverMock.createClient,
}));

const {
  sendMagicLink,
  signInWithEmail,
  signInWithGoogle,
  signOut,
  signUpWithEmail,
  verifyEmailOtp,
} = await import("@/lib/actions/auth");

/** Installs a client whose `signInWithOAuth` records its arguments. */
function withOAuth(result: { data?: unknown; error?: unknown }) {
  const calls: unknown[] = [];

  const signInWithOAuth = vi.fn(async (args: unknown) => {
    calls.push(args);
    return {
      data: { url: "https://accounts.google.com/o/oauth2/auth" },
      error: null,
      ...result,
    };
  });
  const signOutFn = vi.fn(async () => ({ error: null }));

  const mock = createSupabaseMock({
    auth: { signInWithOAuth, signOut: signOutFn },
  });
  serverMock.createClient.mockResolvedValue(mock.client);
  return { calls, signInWithOAuth, signOutFn };
}

/** The `redirectTo` the action handed to Supabase. */
function redirectToOf(calls: unknown[]): string {
  const first = calls[0] as { options: { redirectTo: string } };
  return first.options.redirectTo;
}

describe("signInWithGoogle", () => {
  beforeEach(() => serverMock.createClient.mockReset());

  it("starts a Google handshake", async () => {
    const { signInWithOAuth } = withOAuth({});

    await captureRedirect(() => signInWithGoogle(formDataOf({ next: "/workspaces" })));

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo:
          "https://platform.example.com/auth/callback?next=%2Fworkspaces",
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
  });

  it("forwards the path the user wanted to return to", async () => {
    const { calls } = withOAuth({});

    await captureRedirect(() =>
      signInWithGoogle(formDataOf({ next: "/acme/dashboard" })),
    );

    expect(redirectToOf(calls)).toBe(
      "https://platform.example.com/auth/callback?next=%2Facme%2Fdashboard",
    );
  });

  it.each([
    ["//evil.example.com", "protocol-relative"],
    ["https://evil.example.com", "absolute"],
    ["javascript:alert(1)", "javascript scheme"],
    ["acme/dashboard", "missing leading slash"],
  ])("ignores next=%s (%s)", async (next) => {
    const { calls } = withOAuth({});

    await captureRedirect(() => signInWithGoogle(formDataOf({ next })));

    expect(redirectToOf(calls)).toBe(
      "https://platform.example.com/auth/callback?next=%2Fworkspaces",
    );
  });

  it("redirects the browser to the provider", async () => {
    withOAuth({});

    const url = await captureRedirect(() =>
      signInWithGoogle(formDataOf({ next: "/workspaces" })),
    );

    expect(url).toBe("https://accounts.google.com/o/oauth2/auth");
  });

  it("reports a provider error on the login page", async () => {
    withOAuth({ data: { url: null }, error: { message: "provider disabled" } });

    const url = await captureRedirect(() =>
      signInWithGoogle(formDataOf({ next: "/workspaces" })),
    );

    expect(redirectPath(url)).toBe("/login");
    expect(redirectParams(url).get("error")).toBe("provider disabled");
  });

  it("reports a missing URL even when there is no error object", async () => {
    withOAuth({ data: { url: null } });

    const url = await captureRedirect(() =>
      signInWithGoogle(formDataOf({ next: "/workspaces" })),
    );

    expect(redirectParams(url).get("error")).toBe("Could not start sign in");
  });
});

describe("signOut", () => {
  beforeEach(() => serverMock.createClient.mockReset());

  it("clears the session and returns home", async () => {
    const { signOutFn } = withOAuth({});

    const url = await captureRedirect(() => signOut());

    expect(signOutFn).toHaveBeenCalled();
    expect(url).toBe("/");
  });
});

/** The state every form starts from. */
const INITIAL_STATE = { error: null, notice: null };

type AuthResult = {
  data?: { session?: unknown; user?: unknown } | null;
  error?: { message: string } | null;
};

type PasswordArgs = { email: string; password: string };
type SignUpArgs = PasswordArgs & { options: { emailRedirectTo: string } };
type OtpArgs = {
  email: string;
  options: { emailRedirectTo: string; shouldCreateUser: boolean };
};
type VerifyCodeArgs = { email: string; token: string; type: string };

/** Installs a client whose email/password and OTP calls are observable. */
function withEmailAuth() {
  // Typed with `vi.fn<…>()` so the spies take no implementation parameter:
  // `mock.calls` still knows the shape of what the action passed.
  const signInWithPassword = vi.fn<(args: PasswordArgs) => Promise<AuthResult>>();
  signInWithPassword.mockResolvedValue({
    data: { session: {}, user: {} },
    error: null,
  });

  const signUp = vi.fn<(args: SignUpArgs) => Promise<AuthResult>>();
  signUp.mockResolvedValue({
    data: { session: null, user: { id: "user-1" } },
    error: null,
  });

  const signInWithOtp = vi.fn<(args: OtpArgs) => Promise<AuthResult>>();
  signInWithOtp.mockResolvedValue({ data: {}, error: null });

  const verifyOtp = vi.fn<(args: VerifyCodeArgs) => Promise<AuthResult>>();
  verifyOtp.mockResolvedValue({ data: {}, error: null });

  const mock = createSupabaseMock({
    auth: { signInWithPassword, signUp, signInWithOtp, verifyOtp },
  });
  serverMock.createClient.mockResolvedValue(mock.client);

  return { signInWithPassword, signUp, signInWithOtp, verifyOtp };
}

describe("signInWithEmail", () => {
  beforeEach(() => serverMock.createClient.mockReset());

  it("signs in and continues to the path the user wanted", async () => {
    const { signInWithPassword } = withEmailAuth();

    const url = await captureRedirect(() =>
      signInWithEmail(
        INITIAL_STATE,
        formDataOf({
          email: "ada@example.com",
          password: "correct horse",
          next: "/acme/dashboard",
        }),
      ),
    );

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "ada@example.com",
      password: "correct horse",
    });
    expect(url).toBe("/acme/dashboard");
  });

  it("trims the email but never the password", async () => {
    const { signInWithPassword } = withEmailAuth();

    await captureRedirect(() =>
      signInWithEmail(
        INITIAL_STATE,
        formDataOf({ email: "  ada@example.com ", password: "  spaced  " }),
      ),
    );

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "ada@example.com",
      password: "  spaced  ",
    });
  });

  it("ignores an unsafe next", async () => {
    withEmailAuth();

    const url = await captureRedirect(() =>
      signInWithEmail(
        INITIAL_STATE,
        formDataOf({
          email: "ada@example.com",
          password: "correct horse",
          next: "https://evil.example.com",
        }),
      ),
    );

    expect(url).toBe("/workspaces");
  });

  it("asks for both fields without calling Supabase", async () => {
    withEmailAuth();

    const state = await signInWithEmail(
      INITIAL_STATE,
      formDataOf({ email: "ada@example.com" }),
    );

    expect(state).toEqual({
      error: "Enter your email and password.",
      notice: null,
    });
    expect(serverMock.createClient).not.toHaveBeenCalled();
  });

  it("does not reveal whether the address exists", async () => {
    const { signInWithPassword } = withEmailAuth();
    signInWithPassword.mockResolvedValue({
      data: null,
      error: { message: "Invalid login credentials" },
    });

    const state = await signInWithEmail(
      INITIAL_STATE,
      formDataOf({ email: "ada@example.com", password: "wrong" }),
    );

    expect(state.error).toBe("Incorrect email or password.");
  });

  it("explains an unconfirmed address", async () => {
    const { signInWithPassword } = withEmailAuth();
    signInWithPassword.mockResolvedValue({
      data: null,
      error: { message: "Email not confirmed" },
    });

    const state = await signInWithEmail(
      INITIAL_STATE,
      formDataOf({ email: "ada@example.com", password: "correct horse" }),
    );

    expect(state.error).toBe("Confirm your email address before signing in.");
  });

  it("passes an unfamiliar message through", async () => {
    const { signInWithPassword } = withEmailAuth();
    signInWithPassword.mockResolvedValue({
      data: null,
      error: { message: "Database is unreachable" },
    });

    const state = await signInWithEmail(
      INITIAL_STATE,
      formDataOf({ email: "ada@example.com", password: "correct horse" }),
    );

    expect(state.error).toBe("Database is unreachable");
  });
});

describe("signUpWithEmail", () => {
  beforeEach(() => serverMock.createClient.mockReset());

  const FORM = {
    email: "ada@example.com",
    password: "correct horse",
    next: "/onboarding",
  };

  it("points the confirmation link at the callback", async () => {
    const { signUp } = withEmailAuth();

    await signUpWithEmail(INITIAL_STATE, formDataOf(FORM));

    expect(signUp).toHaveBeenCalledWith({
      email: "ada@example.com",
      password: "correct horse",
      options: {
        emailRedirectTo:
          "https://platform.example.com/auth/callback?next=%2Fonboarding",
      },
    });
  });

  it("asks the user to confirm the address", async () => {
    withEmailAuth();

    const state = await signUpWithEmail(INITIAL_STATE, formDataOf(FORM));

    expect(state.error).toBeNull();
    expect(state.notice).toContain("ada@example.com");
  });

  it("reads the same whether or not the address was taken", async () => {
    // Supabase answers an existing address with an obfuscated user and no
    // error, so the two responses have to be indistinguishable.
    withEmailAuth();
    const created = await signUpWithEmail(INITIAL_STATE, formDataOf(FORM));

    serverMock.createClient.mockReset();
    const { signUp } = withEmailAuth();
    signUp.mockResolvedValue({
      data: { session: null, user: { identities: [] } },
      error: null,
    });
    const existing = await signUpWithEmail(INITIAL_STATE, formDataOf(FORM));

    expect(existing).toEqual(created);
  });

  it("continues to onboarding when confirmation is disabled", async () => {
    const { signUp } = withEmailAuth();
    signUp.mockResolvedValue({
      data: { session: { access_token: "at" } },
      error: null,
    });

    const url = await captureRedirect(() =>
      signUpWithEmail(INITIAL_STATE, formDataOf(FORM)),
    );

    expect(url).toBe("/onboarding");
  });

  it("rejects a password that is too short", async () => {
    withEmailAuth();

    const state = await signUpWithEmail(
      INITIAL_STATE,
      formDataOf({ ...FORM, password: "short" }),
    );

    expect(state.error).toBe("Use at least 8 characters.");
    expect(serverMock.createClient).not.toHaveBeenCalled();
  });

  it("reports an address that already has an account", async () => {
    const { signUp } = withEmailAuth();
    signUp.mockResolvedValue({
      data: null,
      error: { message: "User already registered" },
    });

    const state = await signUpWithEmail(INITIAL_STATE, formDataOf(FORM));

    expect(state.error).toBe(
      "That email already has an account. Sign in instead.",
    );
  });

  it("ignores an unsafe next", async () => {
    const { signUp } = withEmailAuth();

    await signUpWithEmail(
      INITIAL_STATE,
      formDataOf({ ...FORM, next: "//evil.example.com" }),
    );

    expect(signUp.mock.calls[0][0].options.emailRedirectTo).toBe(
      "https://platform.example.com/auth/callback?next=%2Fonboarding",
    );
  });
});

describe("sendMagicLink", () => {
  beforeEach(() => serverMock.createClient.mockReset());

  it("emails a link that returns through the callback", async () => {
    const { signInWithOtp } = withEmailAuth();

    const state = await sendMagicLink(
      INITIAL_STATE,
      formDataOf({ email: "ada@example.com", next: "/acme/dashboard" }),
    );

    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "ada@example.com",
      options: {
        emailRedirectTo:
          "https://platform.example.com/auth/callback?next=%2Facme%2Fdashboard",
        // Sign in and sign up share this card, and an unknown address must not
        // produce a different response from a known one.
        shouldCreateUser: true,
      },
    });
    expect(state.error).toBeNull();
    expect(state.notice).toContain("ada@example.com");
  });

  it("asks for an email without calling Supabase", async () => {
    withEmailAuth();

    const state = await sendMagicLink(INITIAL_STATE, formDataOf({}));

    expect(state.error).toBe("Enter your email address.");
    expect(serverMock.createClient).not.toHaveBeenCalled();
  });

  it("explains the send rate limit", async () => {
    const { signInWithOtp } = withEmailAuth();
    signInWithOtp.mockResolvedValue({
      data: null,
      error: {
        message:
          "For security purposes, you can only request this after 37 seconds.",
      },
    });

    const state = await sendMagicLink(
      INITIAL_STATE,
      formDataOf({ email: "ada@example.com" }),
    );

    expect(state.error).toBe("Wait a minute before requesting another link.");
  });

  it("passes an unfamiliar message through", async () => {
    const { signInWithOtp } = withEmailAuth();
    signInWithOtp.mockResolvedValue({
      data: null,
      error: { message: "Email provider is down" },
    });

    const state = await sendMagicLink(
      INITIAL_STATE,
      formDataOf({ email: "ada@example.com" }),
    );

    expect(state.error).toBe("Email provider is down");
  });
});

describe("verifyEmailOtp", () => {
  beforeEach(() => serverMock.createClient.mockReset());

  it("verifies the code and continues", async () => {
    const { verifyOtp } = withEmailAuth();

    const url = await captureRedirect(() =>
      verifyEmailOtp(
        INITIAL_STATE,
        formDataOf({
          email: "ada@example.com",
          token: "123456",
          next: "/acme/dashboard",
        }),
      ),
    );

    expect(verifyOtp).toHaveBeenCalledWith({
      email: "ada@example.com",
      token: "123456",
      type: "email",
    });
    expect(url).toBe("/acme/dashboard");
  });

  it("tolerates spaces in the code", async () => {
    // People paste the code with whatever spacing their mail client added.
    const { verifyOtp } = withEmailAuth();

    await captureRedirect(() =>
      verifyEmailOtp(
        INITIAL_STATE,
        formDataOf({ email: "ada@example.com", token: " 123 456 " }),
      ),
    );

    expect(verifyOtp).toHaveBeenCalledWith({
      email: "ada@example.com",
      token: "123456",
      type: "email",
    });
  });

  it.each(["1234", "abcdef", "1234567"])(
    "rejects a malformed code: %s",
    async (token) => {
      withEmailAuth();

      const state = await verifyEmailOtp(
        INITIAL_STATE,
        formDataOf({ email: "ada@example.com", token }),
      );

      expect(state.error).toBe("Enter the 6-digit code from the email.");
      expect(serverMock.createClient).not.toHaveBeenCalled();
    },
  );

  it("asks for the address the code went to", async () => {
    withEmailAuth();

    const state = await verifyEmailOtp(
      INITIAL_STATE,
      formDataOf({ token: "123456" }),
    );

    expect(state.error).toBe("Enter the email address the code was sent to.");
    expect(serverMock.createClient).not.toHaveBeenCalled();
  });

  it("explains an expired code", async () => {
    const { verifyOtp } = withEmailAuth();
    verifyOtp.mockResolvedValue({
      data: null,
      error: { message: "Token has expired or is invalid" },
    });

    const state = await verifyEmailOtp(
      INITIAL_STATE,
      formDataOf({ email: "ada@example.com", token: "123456" }),
    );

    expect(state.error).toBe(
      "That code is wrong or has expired. Request a new link.",
    );
  });
});
