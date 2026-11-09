import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    getAll: () => [],
    set: vi.fn(),
  })),
}));

const SUPABASE_URL = "https://project.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_abc123";
const SECRET_KEY = "sb_secret_abc123";
const LEGACY_ANON_KEY = "anon-jwt";
const LEGACY_SERVICE_ROLE_KEY = "service-role-jwt";

/**
 * Supabase variable names, current and retired.
 *
 * Every test stubs all of them, so a value in the developer's own shell (or a
 * stray `.env.local`) can never decide the outcome of a run.
 */
const SUPABASE_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

function stubSupabaseEnv(overrides: Partial<Record<string, string>>) {
  for (const name of SUPABASE_VARS) {
    vi.stubEnv(name, overrides[name] ?? "");
  }
}

describe("Supabase environment resolution", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  describe("getSupabaseUrl", () => {
    it("fails loudly when the URL is unset", async () => {
      stubSupabaseEnv({});

      const { getSupabaseUrl } = await import("@/lib/supabase/env");
      expect(() => getSupabaseUrl()).toThrow(
        "Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL",
      );
    });

    it("trims padding copied from the dashboard", async () => {
      stubSupabaseEnv({ NEXT_PUBLIC_SUPABASE_URL: `  ${SUPABASE_URL}  ` });

      const { getSupabaseUrl } = await import("@/lib/supabase/env");
      expect(getSupabaseUrl()).toBe(SUPABASE_URL);
    });
  });

  describe("getSupabasePublishableKey", () => {
    it("returns the publishable key", async () => {
      stubSupabaseEnv({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY });

      const { getSupabasePublishableKey } = await import("@/lib/supabase/env");
      expect(getSupabasePublishableKey()).toBe(PUBLISHABLE_KEY);
    });

    it("prefers the publishable key over the retired anon key", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      stubSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: LEGACY_ANON_KEY,
      });

      const { getSupabasePublishableKey } = await import("@/lib/supabase/env");
      expect(getSupabasePublishableKey()).toBe(PUBLISHABLE_KEY);
      expect(warn).not.toHaveBeenCalled();
    });

    it("falls back to the retired anon key and warns once", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      stubSupabaseEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: LEGACY_ANON_KEY });

      const { getSupabasePublishableKey } = await import("@/lib/supabase/env");
      expect(getSupabasePublishableKey()).toBe(LEGACY_ANON_KEY);
      expect(getSupabasePublishableKey()).toBe(LEGACY_ANON_KEY);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(
        "NEXT_PUBLIC_SUPABASE_ANON_KEY is deprecated",
      );
    });

    it("names both variables when neither is set", async () => {
      stubSupabaseEnv({});

      const { getSupabasePublishableKey } = await import("@/lib/supabase/env");
      expect(() => getSupabasePublishableKey()).toThrow(
        "Missing required environment variable: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY " +
          "(previously NEXT_PUBLIC_SUPABASE_ANON_KEY)",
      );
    });

    it("refuses a secret key in the public variable", async () => {
      stubSupabaseEnv({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: SECRET_KEY });

      const { getSupabasePublishableKey } = await import("@/lib/supabase/env");
      expect(() => getSupabasePublishableKey()).toThrow(
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is set to a secret key",
      );
    });
  });
  describe("getSupabaseSecretKey", () => {
    it("returns the secret key", async () => {
      stubSupabaseEnv({ SUPABASE_SECRET_KEY: SECRET_KEY });

      const { getSupabaseSecretKey } = await import("@/lib/supabase/env.server");
      expect(getSupabaseSecretKey()).toBe(SECRET_KEY);
    });

    it("prefers the secret key over the retired service-role key", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      stubSupabaseEnv({
        SUPABASE_SECRET_KEY: SECRET_KEY,
        SUPABASE_SERVICE_ROLE_KEY: LEGACY_SERVICE_ROLE_KEY,
      });

      const { getSupabaseSecretKey } = await import("@/lib/supabase/env.server");
      expect(getSupabaseSecretKey()).toBe(SECRET_KEY);
      expect(warn).not.toHaveBeenCalled();
    });

    it("falls back to the retired service-role key and warns once", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      stubSupabaseEnv({ SUPABASE_SERVICE_ROLE_KEY: LEGACY_SERVICE_ROLE_KEY });

      const { getSupabaseSecretKey } = await import("@/lib/supabase/env.server");
      expect(getSupabaseSecretKey()).toBe(LEGACY_SERVICE_ROLE_KEY);
      expect(getSupabaseSecretKey()).toBe(LEGACY_SERVICE_ROLE_KEY);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(
        "SUPABASE_SERVICE_ROLE_KEY is deprecated",
      );
    });

    it("names both variables when neither is set", async () => {
      stubSupabaseEnv({});

      const { getSupabaseSecretKey } = await import("@/lib/supabase/env.server");
      expect(() => getSupabaseSecretKey()).toThrow(
        "Missing required environment variable: SUPABASE_SECRET_KEY " +
          "(previously SUPABASE_SERVICE_ROLE_KEY)",
      );
    });

    it("refuses a publishable key in the secret variable", async () => {
      stubSupabaseEnv({ SUPABASE_SECRET_KEY: PUBLISHABLE_KEY });

      const { getSupabaseSecretKey } = await import("@/lib/supabase/env.server");
      expect(() => getSupabaseSecretKey()).toThrow(
        "SUPABASE_SECRET_KEY is set to a publishable key",
      );
    });
  });
  describe("createAdminClient", () => {
    it("fails loudly when the URL is unset", async () => {
      stubSupabaseEnv({ SUPABASE_SECRET_KEY: SECRET_KEY });

      const { createAdminClient } = await import("@/lib/supabase/admin");
      expect(() => createAdminClient()).toThrow(
        "Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL",
      );
    });

    it("fails loudly when the secret key is unset", async () => {
      stubSupabaseEnv({ NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL });

      const { createAdminClient } = await import("@/lib/supabase/admin");
      expect(() => createAdminClient()).toThrow(
        "Missing required environment variable: SUPABASE_SECRET_KEY",
      );
    });

    it("builds a client when both values are present", async () => {
      stubSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
        SUPABASE_SECRET_KEY: SECRET_KEY,
      });

      const { createAdminClient } = await import("@/lib/supabase/admin");
      const client = createAdminClient();
      expect(client.from).toBeTypeOf("function");
      expect(client.auth).toBeDefined();
    });

    it("still builds from the retired service-role key", async () => {
      stubSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: LEGACY_SERVICE_ROLE_KEY,
      });

      const { createAdminClient } = await import("@/lib/supabase/admin");
      expect(createAdminClient().from).toBeTypeOf("function");
    });
  });

  describe("browser createClient", () => {
    it("fails loudly when the publishable key is unset", async () => {
      stubSupabaseEnv({ NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL });

      const { createClient } = await import("@/lib/supabase/client");
      expect(() => createClient()).toThrow(
        "Missing required environment variable: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      );
    });

    it("builds a client from the publishable key", async () => {
      stubSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
      });

      const { createClient } = await import("@/lib/supabase/client");
      expect(createClient().from).toBeTypeOf("function");
    });

    it("still builds from the retired anon key", async () => {
      stubSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: LEGACY_ANON_KEY,
      });

      const { createClient } = await import("@/lib/supabase/client");
      expect(createClient().from).toBeTypeOf("function");
    });
  });

  describe("server createClient", () => {
    it("fails loudly when the publishable key is unset", async () => {
      stubSupabaseEnv({ NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL });

      const { createClient } = await import("@/lib/supabase/server");
      await expect(createClient()).rejects.toThrow(
        "Missing required environment variable: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      );
    });

    it("builds a cookie-bound client when configured", async () => {
      stubSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
      });

      const { createClient } = await import("@/lib/supabase/server");
      const client = await createClient();
      expect(client.from).toBeTypeOf("function");
    });
  });
});
