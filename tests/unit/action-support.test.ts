import { describe, expect, it, vi } from "vitest";

import { READ_ONLY_MESSAGE } from "@/lib/billing/entitlements";
import type { SubscriptionStatus } from "@/lib/supabase/types";

import { companyRow } from "../helpers/fixtures";
import {
  captureRedirect,
  redirectParams,
  redirectPath,
} from "../helpers/redirect";
import {
  createSupabaseMock,
  signedInUser,
  signedOutUser,
} from "../helpers/supabase";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("__NOT_FOUND__");
  }),
}));

const serverMock = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: serverMock.createClient,
}));

const {
  getActionContext,
  readField,
  readInt,
  redirectWith,
  requireAdministrator,
  requireFrontDesk,
  requireManager,
  requireWritableWorkspace,
} = await import("@/lib/actions/support");

describe("readField", () => {
  const formData = () => {
    const data = new FormData();
    data.set("name", "  Acme Studio  ");
    data.set("blank", "   ");
    data.set("inner", "a  b");
    return data;
  };

  it("trims surrounding whitespace", () => {
    expect(readField(formData(), "name")).toBe("Acme Studio");
  });

  it("returns an empty string for a missing field", () => {
    expect(readField(formData(), "nope")).toBe("");
  });

  it("returns an empty string for a whitespace-only field", () => {
    expect(readField(formData(), "blank")).toBe("");
  });

  it("preserves interior whitespace", () => {
    expect(readField(formData(), "inner")).toBe("a  b");
  });

  it("returns an empty string for a non-string entry (file upload)", () => {
    const data = new FormData();
    data.set("upload", new Blob(["x"]), "x.txt");
    expect(readField(data, "upload")).toBe("");
  });
});

describe("readInt", () => {
  const withValue = (raw: string) => {
    const data = new FormData();
    data.set("n", raw);
    return data;
  };

  it("parses a plain integer", () => {
    expect(readInt(withValue("5"), "n")).toBe(5);
  });

  it("trims before parsing", () => {
    expect(readInt(withValue("  5  "), "n")).toBe(5);
  });

  it("parses negatives and zero", () => {
    expect(readInt(withValue("-3"), "n")).toBe(-3);
    expect(readInt(withValue("0"), "n")).toBe(0);
  });

  it("returns null for an absent or empty field", () => {
    expect(readInt(new FormData(), "n")).toBeNull();
    expect(readInt(withValue(""), "n")).toBeNull();
  });

  it("returns null for non-numeric input", () => {
    expect(readInt(withValue("abc"), "n")).toBeNull();
    expect(readInt(withValue("--5"), "n")).toBeNull();
  });

  it("truncates at the first non-digit, like parseInt", () => {
    expect(readInt(withValue("5.9"), "n")).toBe(5);
    expect(readInt(withValue("12abc"), "n")).toBe(12);
  });
});

describe("redirectWith", () => {
  it("builds a tenant path", async () => {
    const url = await captureRedirect(() =>
      redirectWith("acme", "settings", { ok: "Company updated." }),
    );
    expect(redirectPath(url)).toBe("/acme/settings");
    expect(redirectParams(url).get("ok")).toBe("Company updated.");
  });

  it("omits the query string when there is nothing to add", async () => {
    const url = await captureRedirect(() =>
      redirectWith("acme", "dashboard", {}),
    );
    expect(url).toBe("/acme/dashboard");
  });

  it("URL-encodes values so messages cannot break the URL", async () => {
    const url = await captureRedirect(() =>
      redirectWith("acme", "settings", { ok: "Added “Hot Stone” & oil" }),
    );
    expect(url).not.toContain(" ");
    expect(url).not.toContain("&oil");
    expect(redirectParams(url).get("ok")).toBe("Added “Hot Stone” & oil");
  });

  it("carries multiple parameters", async () => {
    const url = await captureRedirect(() =>
      redirectWith("acme", "settings", { ok: "Saved", tab: "hours" }),
    );
    const params = redirectParams(url);
    expect(params.get("ok")).toBe("Saved");
    expect(params.get("tab")).toBe("hours");
  });
});

describe("getActionContext", () => {
  it("redirects an anonymous caller to the login page", async () => {
    const mock = createSupabaseMock({
      auth: { getUser: vi.fn(async () => signedOutUser()) },
    });
    serverMock.createClient.mockResolvedValue(mock.client);

    const url = await captureRedirect(() => getActionContext("acme"));
    expect(redirectPath(url)).toBe("/login");
    expect(redirectParams(url).get("next")).toBe("/acme/dashboard");
  });

  it("sends the caller to the workspace picker when the slug is unknown", async () => {
    const mock = createSupabaseMock({
      auth: { getUser: vi.fn(async () => signedInUser()) },
    });
    serverMock.createClient.mockResolvedValue(mock.client);

    const url = await captureRedirect(() => getActionContext("ghost"));
    expect(url).toBe("/workspaces");
  });

  it("sends a non-member to the workspace picker", async () => {
    const mock = createSupabaseMock({
      auth: { getUser: vi.fn(async () => signedInUser()) },
      tables: {
        companies: () => ({ data: companyRow(), error: null }),
        // RLS hides company_members rows for non-members, so a non-member sees
        // exactly this: a company plus no membership.
        company_members: () => ({ data: null, error: null }),
      },
    });
    serverMock.createClient.mockResolvedValue(mock.client);

    const url = await captureRedirect(() => getActionContext("acme"));
    expect(url).toBe("/workspaces");
  });

  it("returns the resolved tenant for a member", async () => {
    const mock = createSupabaseMock({
      auth: { getUser: vi.fn(async () => signedInUser("user-9", "a@b.co")) },
      tables: {
        companies: () => ({ data: companyRow(), error: null }),
        company_members: () => ({ data: { role: "admin" }, error: null }),
      },
    });
    serverMock.createClient.mockResolvedValue(mock.client);

    const context = await getActionContext("acme");
    expect(context.role).toBe("admin");
    expect(context.company.slug).toBe("acme");
    expect(context.user).toEqual({ id: "user-9", email: "a@b.co" });
  });

  it("re-reads the session rather than trusting the submitted slug", async () => {
    const mock = createSupabaseMock({
      auth: { getUser: vi.fn(async () => signedInUser()) },
      tables: {
        companies: () => ({ data: companyRow(), error: null }),
        company_members: () => ({ data: { role: "owner" }, error: null }),
      },
    });
    serverMock.createClient.mockResolvedValue(mock.client);

    await getActionContext("acme");

    expect(mock.argsFor("companies", "eq")).toEqual([["slug", "acme"]]);
    expect(mock.argsFor("company_members", "eq")).toEqual([
      ["company_id", companyRow().id],
      ["user_id", "user-1"],
    ]);
  });
});

describe("permission gates", () => {
  type Context = Parameters<typeof requireManager>[0];
  const context = (role: "owner" | "admin" | "manager" | "staff" | "member") =>
    ({ role }) as unknown as Context;

  it.each(["owner", "admin", "manager"] as const)(
    "requireManager allows %s",
    (role) => {
      expect(() => requireManager(context(role), "acme")).not.toThrow();
    },
  );

  it.each(["staff", "member"] as const)(
    "requireManager bounces %s",
    async (role) => {
      const url = await captureRedirect(() => {
        requireManager(context(role), "acme");
      });

      expect(redirectPath(url)).toBe("/acme/dashboard");
      expect(redirectParams(url).get("error")).toBe(
        "You do not have permission to do that.",
      );
    },
  );

  it.each(["owner", "admin"] as const)(
    "requireAdministrator allows %s",
    (role) => {
      expect(() => requireAdministrator(context(role), "acme")).not.toThrow();
    },
  );

  it.each(["manager", "staff", "member"] as const)(
    "requireAdministrator bounces %s",
    async (role) => {
      const url = await captureRedirect(() => {
        requireAdministrator(context(role), "acme");
      });

      expect(redirectPath(url)).toBe("/acme/dashboard");
      expect(redirectParams(url).get("error")).toBe(
        "You do not have permission to do that.",
      );
    },
  );

  it.each(["owner", "admin", "manager", "staff"] as const)(
    "requireFrontDesk allows %s",
    (role) => {
      expect(() => requireFrontDesk(context(role), "acme")).not.toThrow();
    },
  );

  it("requireFrontDesk bounces a viewer", async () => {
    const url = await captureRedirect(() => {
      requireFrontDesk(context("member"), "acme");
    });

    expect(redirectPath(url)).toBe("/acme/dashboard");
    expect(redirectParams(url).get("error")).toBe(
      "You do not have permission to do that.",
    );
  });
});


describe("requireWritableWorkspace", () => {
  type Context = Parameters<typeof requireWritableWorkspace>[0];
  const context = (status: SubscriptionStatus) =>
    ({ company: { subscription_status: status } }) as unknown as Context;

  it.each(["active", "trialing", "past_due"] as const)(
    "lets a %s workspace write",
    (status) => {
      expect(() =>
        requireWritableWorkspace(context(status), "acme", "products"),
      ).not.toThrow();
    },
  );

  it.each([
    "none",
    "canceled",
    "unpaid",
    "incomplete",
    "incomplete_expired",
    "paused",
  ] as const)("sends a %s workspace back to the form's own page", async (status) => {
    const url = await captureRedirect(() => {
      requireWritableWorkspace(context(status), "acme", "assets");
    });

    // The page that owns the form, not the dashboard: the read-only banner lives
    // there, so the sentence lands next to the rule it explains.
    expect(redirectPath(url)).toBe("/acme/assets");
    expect(redirectParams(url).get("error")).toBe(READ_ONLY_MESSAGE);
  });
});

