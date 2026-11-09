import { beforeEach, describe, expect, it, vi } from "vitest";

import { formDataOf } from "../helpers/fixtures";
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

const serverMock = vi.hoisted(() => ({ createClient: vi.fn() }));
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

vi.mock("@/lib/supabase/server", () => ({
  createClient: serverMock.createClient,
}));

const { respondToInvitation } = await import("@/lib/actions/invitations");

type Setup = {
  signedIn?: boolean;
  rpcError?: { message: string } | null;
};

function setup(options: Setup = {}) {
  const rpc = vi.fn(async () =>
    options.rpcError
      ? { data: null, error: options.rpcError }
      : { data: true, error: null },
  );

  const mock = createSupabaseMock({
    auth: {
      getUser: vi.fn(async () =>
        options.signedIn === false ? signedOutUser() : signedInUser(),
      ),
    },
  });

  Object.assign(mock.client, { rpc });
  serverMock.createClient.mockResolvedValue(mock.client);

  return { rpc };
}

const invitationForm = (overrides: Record<string, string> = {}) =>
  formDataOf({
    membership_id: "membership-1",
    decision: "accept",
    ...overrides,
  });

describe("respondToInvitation", () => {
  beforeEach(() => {
    serverMock.createClient.mockReset();
    cacheMock.revalidatePath.mockReset();
  });

  it("accepts the invitation the user chose", async () => {
    const { rpc } = setup();

    const url = await captureRedirect(() =>
      respondToInvitation(invitationForm()),
    );

    expect(rpc).toHaveBeenCalledWith("respond_to_company_invitation", {
      target_membership_id: "membership-1",
      accept: true,
    });
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/workspaces");
    expect(redirectPath(url)).toBe("/workspaces");
    expect(redirectParams(url).get("ok")).toBe("Invitation accepted.");
  });

  it("declines the invitation when asked to", async () => {
    const { rpc } = setup();

    const url = await captureRedirect(() =>
      respondToInvitation(invitationForm({ decision: "decline" })),
    );

    expect(rpc).toHaveBeenCalledWith("respond_to_company_invitation", {
      target_membership_id: "membership-1",
      accept: false,
    });
    expect(redirectParams(url).get("ok")).toBe("Invitation declined.");
  });

  it("sends an anonymous visitor to sign in first", async () => {
    const { rpc } = setup({ signedIn: false });

    const url = await captureRedirect(() =>
      respondToInvitation(invitationForm()),
    );

    expect(redirectPath(url)).toBe("/login");
    expect(redirectParams(url).get("next")).toBe("/workspaces");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a form without a membership", async () => {
    const { rpc } = setup();

    const url = await captureRedirect(() =>
      respondToInvitation(invitationForm({ membership_id: "" })),
    );

    expect(redirectParams(url).get("error")).toBe(
      "That invitation is no longer available.",
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a decision it does not recognise", async () => {
    const { rpc } = setup();

    const url = await captureRedirect(() =>
      respondToInvitation(invitationForm({ decision: "approve" })),
    );

    expect(redirectParams(url).get("error")).toBe(
      "That invitation is no longer available.",
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports a failure from the database", async () => {
    setup({ rpcError: { message: "permission denied" } });

    const url = await captureRedirect(() =>
      respondToInvitation(invitationForm()),
    );

    expect(redirectParams(url).get("error")).toBe("permission denied");
    expect(cacheMock.revalidatePath).not.toHaveBeenCalled();
  });
});
