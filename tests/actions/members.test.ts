import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MemberRole } from "@/lib/supabase/types";

import { COMPANY_ID, formDataOf } from "../helpers/fixtures";
import {
  captureRedirect,
  redirectParams,
  redirectPath,
} from "../helpers/redirect";
import { createSupabaseMock } from "../helpers/supabase";
import { tenantSetup } from "../helpers/tenant";

const serverMock = vi.hoisted(() => ({ createClient: vi.fn() }));
const adminMock = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
const cacheMock = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("__NOT_FOUND__");
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: cacheMock.revalidatePath,
  cacheLife: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/site", () => ({
  getOrigin: async () => "https://platform.example.com",
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: serverMock.createClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: adminMock.createAdminClient,
}));

const { inviteMember, removeMember, updateMemberRole } = await import(
  "@/lib/actions/members"
);

type Setup = {
  actorRole?: MemberRole;
  profile?: { id: string } | null;
  existingMembership?: { id: string } | null;
  membershipInsertError?: { message: string; code?: string } | null;
  target?: { id: string; role: MemberRole } | null;
  inviteError?: { message: string } | null;
  invitedUserId?: string;
  deleteError?: { message: string } | null;
};

function setup(options: Setup = {}) {
  const server = tenantSetup(serverMock.createClient, {
    company_members: (calls) => {
      if (calls.some((call) => call.method === "insert")) {
        return {
          data: null,
          error: options.membershipInsertError ?? null,
        };
      }

      const select = calls.find((call) => call.method === "select")?.args[0];

      if (select === "role") {
        return { data: { role: options.actorRole ?? "owner" }, error: null };
      }
      if (select === "id") {
        return { data: options.existingMembership ?? null, error: null };
      }
      if (select === "id, role") {
        return { data: options.target ?? null, error: null };
      }

      return { data: null, error: null };
    },
  });

  const adminClient = createSupabaseMock({
    tables: {
      profiles: () => ({ data: options.profile ?? null, error: null }),
    },
  });

  const inviteUserByEmail = vi.fn(async () =>
    options.inviteError
      ? { data: { user: null }, error: options.inviteError }
      : {
          data: { user: { id: options.invitedUserId ?? "invited-user" } },
          error: null,
        },
  );

  const deleteUser = vi.fn(async () => ({
    data: {},
    error: options.deleteError ?? null,
  }));

  Object.assign(adminClient.client.auth, {
    admin: { inviteUserByEmail, deleteUser },
  });

  adminMock.createAdminClient.mockReturnValue(adminClient.client);

  return { server, adminClient, inviteUserByEmail, deleteUser };
}

const inviteForm = (overrides: Record<string, string> = {}) =>
  formDataOf({
    slug: "acme",
    email: "New.Person@Example.com",
    role: "staff",
    ...overrides,
  });

beforeEach(() => {
  adminMock.createAdminClient.mockReset();
  cacheMock.revalidatePath.mockReset();
});

describe("inviteMember", () => {
  it("denies a viewer before creating an admin client", async () => {
    tenantSetup(serverMock.createClient, {}, "member");

    const url = await captureRedirect(() => inviteMember(inviteForm()));

    expect(redirectPath(url)).toBe("/acme/dashboard");
    expect(redirectParams(url).get("error")).toBe(
      "You do not have permission to do that.",
    );
    expect(adminMock.createAdminClient).not.toHaveBeenCalled();
  });

  it("denies a manager", async () => {
    tenantSetup(serverMock.createClient, {}, "manager");

    const url = await captureRedirect(() => inviteMember(inviteForm()));

    expect(redirectParams(url).get("error")).toBe(
      "You do not have permission to do that.",
    );
  });

  it("requires a valid email address", async () => {
    setup();

    const url = await captureRedirect(() =>
      inviteMember(inviteForm({ email: "not-an-email" })),
    );

    expect(redirectParams(url).get("error")).toBe(
      "Enter a valid email address.",
    );
  });

  it("refuses to hand out owner or admin rights", async () => {
    setup();

    const url = await captureRedirect(() =>
      inviteMember(inviteForm({ role: "owner" })),
    );

    expect(redirectParams(url).get("error")).toBe(
      "Choose a role for this person.",
    );
  });

  it("invites an existing account to accept, without emailing them", async () => {
    const { server, inviteUserByEmail } = setup({
      profile: { id: "existing-user" },
    });

    const url = await captureRedirect(() => inviteMember(inviteForm()));

    expect(inviteUserByEmail).not.toHaveBeenCalled();
    // Pending, not accepted: the workspace stays closed until they agree,
    // whatever the inviting admin does.
    expect(server.argFor("company_members", "insert")).toEqual({
      company_id: COMPANY_ID,
      user_id: "existing-user",
      role: "staff",
      invited_at: expect.any(String),
      accepted_at: null,
    });
    expect(redirectParams(url).get("ok")).toBe(
      "Invitation sent to new.person@example.com.",
    );
  });

  it("answers both invitation paths identically", async () => {
    // The response must not reveal whether an address already has an account,
    // or this form becomes an account-existence oracle for every admin.
    const existing = setup({ profile: { id: "existing-user" } });
    const existingUrl = await captureRedirect(() => inviteMember(inviteForm()));

    const invited = setup({ invitedUserId: "invited-user" });
    const invitedUrl = await captureRedirect(() => inviteMember(inviteForm()));

    expect(redirectParams(invitedUrl).get("ok")).toBe(
      redirectParams(existingUrl).get("ok"),
    );

    // They really did take different paths: one emailed, one did not.
    expect(existing.inviteUserByEmail).not.toHaveBeenCalled();
    expect(invited.inviteUserByEmail).toHaveBeenCalled();
  });

  it("refuses somebody who is already in the workspace", async () => {
    const { server } = setup({
      profile: { id: "existing-user" },
      existingMembership: { id: "membership-1" },
    });

    const url = await captureRedirect(() => inviteMember(inviteForm()));

    expect(redirectParams(url).get("error")).toBe(
      "new.person@example.com is already in this workspace.",
    );
    expect(server.methodsFor("company_members")).not.toContain("insert");
  });

  it("invites a new address and records a pending membership", async () => {
    const { server, inviteUserByEmail } = setup({
      invitedUserId: "invited-user",
    });

    const url = await captureRedirect(() => inviteMember(inviteForm()));

    expect(inviteUserByEmail).toHaveBeenCalledWith("new.person@example.com", {
      redirectTo:
        "https://platform.example.com/auth/callback?next=%2Facme%2Fdashboard",
    });
    expect(server.argFor("company_members", "insert")).toEqual({
      company_id: COMPANY_ID,
      user_id: "invited-user",
      role: "staff",
      invited_at: expect.any(String),
      accepted_at: null,
    });
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme/settings/team");
    expect(redirectParams(url).get("ok")).toBe(
      "Invitation sent to new.person@example.com.",
    );
  });


  it("explains a rate-limited invitation", async () => {
    const { server } = setup({
      inviteError: { message: "For security purposes, try again later" },
    });

    const url = await captureRedirect(() => inviteMember(inviteForm()));

    expect(redirectParams(url).get("error")).toBe(
      "Wait a minute before sending another invitation.",
    );
    expect(server.methodsFor("company_members")).not.toContain("insert");
  });

  it("does not confirm an account that appeared mid-request", async () => {
    // `inviteUserByEmail` answers "already registered" if the address signed up
    // between the profile lookup and the send; repeating that would leak the
    // same fact the two invitation paths are careful to hide.
    setup({
      inviteError: { message: "A user with this email address has already been registered" },
    });

    const url = await captureRedirect(() => inviteMember(inviteForm()));

    expect(redirectParams(url).get("error")).toBe(
      "Could not send the invitation. Try again.",
    );
  });

  it("rolls the auth user back when the membership cannot be stored", async () => {
    const { deleteUser } = setup({
      membershipInsertError: { message: "insert failed" },
    });

    const url = await captureRedirect(() => inviteMember(inviteForm()));

    expect(deleteUser).toHaveBeenCalledWith("invited-user");
    expect(redirectParams(url).get("error")).toBe("insert failed");
  });

  it("keeps the account when the duplicate is a race", async () => {
    const { deleteUser } = setup({
      membershipInsertError: { message: "duplicate key", code: "23505" },
    });

    const url = await captureRedirect(() => inviteMember(inviteForm()));

    expect(deleteUser).not.toHaveBeenCalled();
    expect(redirectParams(url).get("error")).toBe(
      "That person is already in this workspace.",
    );
  });
});

const roleForm = (overrides: Record<string, string> = {}) =>
  formDataOf({
    slug: "acme",
    membership_id: "membership-1",
    role: "manager",
    ...overrides,
  });

describe("updateMemberRole", () => {
  it("changes an assignable membership", async () => {
    const { server } = setup({
      target: { id: "membership-1", role: "staff" },
    });

    const url = await captureRedirect(() => updateMemberRole(roleForm()));

    expect(server.argFor("company_members", "update")).toEqual({
      role: "manager",
    });
    expect(server.argsFor("company_members", "eq")).toContainEqual([
      "company_id",
      COMPANY_ID,
    ]);
    expect(redirectParams(url).get("ok")).toBe("Role updated to Manager.");
  });

  it("refuses to change an owner or admin", async () => {
    const { server } = setup({
      target: { id: "membership-1", role: "owner" },
    });

    const url = await captureRedirect(() => updateMemberRole(roleForm()));

    expect(redirectParams(url).get("error")).toBe(
      "Owner and admin roles cannot be changed here.",
    );
    expect(server.methodsFor("company_members")).not.toContain("update");
  });

  it("refuses a missing target", async () => {
    setup({ target: null });

    const url = await captureRedirect(() => updateMemberRole(roleForm()));

    expect(redirectParams(url).get("error")).toBe(
      "That team member was not found.",
    );
  });

  it("refuses owner/admin as the new role", async () => {
    setup();

    const url = await captureRedirect(() =>
      updateMemberRole(roleForm({ role: "admin" })),
    );

    expect(redirectParams(url).get("error")).toBe("Choose a valid role.");
  });

  it("requires a membership id", async () => {
    setup();

    const url = await captureRedirect(() =>
      updateMemberRole(roleForm({ membership_id: "" })),
    );

    expect(redirectParams(url).get("error")).toBe("Missing team member.");
  });

  it("denies a manager", async () => {
    setup({ actorRole: "manager" });

    const url = await captureRedirect(() => updateMemberRole(roleForm()));

    expect(redirectParams(url).get("error")).toBe(
      "You do not have permission to do that.",
    );
  });
});

describe("removeMember", () => {
  it("removes an assignable membership", async () => {
    const { server } = setup({
      target: { id: "membership-1", role: "staff" },
    });

    const url = await captureRedirect(() =>
      removeMember(
        formDataOf({ slug: "acme", membership_id: "membership-1" }),
      ),
    );

    expect(server.methodsFor("company_members")).toContain("delete");
    expect(server.argsFor("company_members", "eq")).toContainEqual([
      "company_id",
      COMPANY_ID,
    ]);
    expect(redirectParams(url).get("ok")).toBe("Team member removed.");
  });

  it("refuses to remove an owner or admin", async () => {
    const { server } = setup({
      target: { id: "membership-1", role: "admin" },
    });

    const url = await captureRedirect(() =>
      removeMember(
        formDataOf({ slug: "acme", membership_id: "membership-1" }),
      ),
    );

    expect(redirectParams(url).get("error")).toBe(
      "Owner and admin roles cannot be removed here.",
    );
    expect(server.methodsFor("company_members")).not.toContain("delete");
  });

  it("denies a manager", async () => {
    setup({ actorRole: "manager" });

    const url = await captureRedirect(() =>
      removeMember(
        formDataOf({ slug: "acme", membership_id: "membership-1" }),
      ),
    );

    expect(redirectParams(url).get("error")).toBe(
      "You do not have permission to do that.",
    );
  });

  it("requires a membership id", async () => {
    setup();

    const url = await captureRedirect(() =>
      removeMember(formDataOf({ slug: "acme", membership_id: "" })),
    );

    expect(redirectParams(url).get("error")).toBe("Missing team member.");
  });
});

