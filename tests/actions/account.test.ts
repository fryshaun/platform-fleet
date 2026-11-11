import { beforeEach, describe, expect, it, vi } from "vitest";

import { formDataOf } from "../helpers/fixtures";
import { captureRedirect, redirectPath } from "../helpers/redirect";
import {
  createSupabaseMock,
  signedInUser,
  signedOutUser,
  type StorageBucketOverrides,
} from "../helpers/supabase";

const serverMock = vi.hoisted(() => ({ createClient: vi.fn() }));
const cacheMock = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
const recoveryMock = vi.hoisted(() => ({
  isRecoveryWindowOpen: vi.fn(),
  closeRecoveryWindow: vi.fn(),
}));

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

vi.mock("@/lib/recovery", () => ({
  isRecoveryWindowOpen: recoveryMock.isRecoveryWindowOpen,
  closeRecoveryWindow: recoveryMock.closeRecoveryWindow,
}));

const {
  changePassword,
  createAvatarUploadUrl,
  removeAvatar,
  setAvatar,
  setRecoveredPassword,
  updateProfile,
} = await import("@/lib/actions/account");

const EMPTY = { error: null, notice: null };

type SetupOptions = {
  signedIn?: boolean;
  /** `app_metadata.providers`; omitted means the field is absent. */
  providers?: string[];
  /** The row `profiles` answers with. */
  profile?: { avatar_url: string | null } | null;
  writeError?: { message: string } | null;
  signInError?: { message: string } | null;
  updateUserError?: { message: string } | null;
  storage?: Record<string, StorageBucketOverrides>;
};

/**
 * A signed-in session and nothing else: account actions take no slug and look up
 * no membership, so there is no tenant to wire up.
 */
function setup(options: SetupOptions = {}) {
  const signInWithPassword = vi.fn(async () => ({
    data: { session: null, user: null },
    error: options.signInError ?? null,
  }));
  const updateUser = vi.fn(async () => ({
    data: { user: null },
    error: options.updateUserError ?? null,
  }));

  const session = signedInUser("user-1", "ada@example.com");
  const mock = createSupabaseMock({
    auth: {
      getUser: vi.fn(async () => {
        if (options.signedIn === false) {
          return signedOutUser();
        }

        return {
          data: {
            user: {
              ...session.data.user,
              app_metadata:
                options.providers === undefined
                  ? {}
                  : { providers: options.providers },
            },
          },
          error: null,
        };
      }),
      signInWithPassword,
      updateUser,
    },
    tables: {
      profiles: () => ({
        data:
          options.profile === undefined
            ? { avatar_url: null }
            : options.profile,
        error: options.writeError ?? null,
      }),
    },
    storage: options.storage,
  });

  serverMock.createClient.mockResolvedValue(mock.client);
  return { mock, signInWithPassword, updateUser };
}

beforeEach(() => {
  cacheMock.revalidatePath.mockReset();
  serverMock.createClient.mockReset();
});

describe("updateProfile", () => {
  it("saves a tidied name and invalidates the tree", async () => {
    const { mock } = setup();

    const state = await updateProfile(
      EMPTY,
      formDataOf({ full_name: "  Ada   Lovelace " }),
    );

    expect(mock.argFor("profiles", "update")).toEqual({
      full_name: "Ada Lovelace",
    });
    // The name is in the rail, the team list and every menu, all of which render
    // from `getCurrentUser()` up the tree.
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(state).toEqual({ error: null, notice: "Name updated." });
  });

  it("stores an empty field as no name", async () => {
    const { mock } = setup();

    const state = await updateProfile(EMPTY, formDataOf({ full_name: "   " }));

    expect(mock.argFor("profiles", "update")).toEqual({ full_name: null });
    expect(state.notice).toBe("Name updated.");
  });

  it("refuses a name past the limit without writing", async () => {
    const { mock } = setup();

    const state = await updateProfile(
      EMPTY,
      formDataOf({ full_name: "a".repeat(121) }),
    );

    expect(state).toEqual({
      error: "Keep your name under 120 characters.",
      notice: null,
    });
    expect(mock.methodsFor("profiles")).not.toContain("update");
    expect(cacheMock.revalidatePath).not.toHaveBeenCalled();
  });

  it("reports a refused write", async () => {
    setup({ writeError: { message: "permission denied" } });

    const state = await updateProfile(
      EMPTY,
      formDataOf({ full_name: "Ada Lovelace" }),
    );

    expect(state).toEqual({ error: "permission denied", notice: null });
    expect(cacheMock.revalidatePath).not.toHaveBeenCalled();
  });

  it("sends a signed-out caller to the login page", async () => {
    setup({ signedIn: false });

    const url = await captureRedirect(() =>
      updateProfile(EMPTY, formDataOf({ full_name: "Ada Lovelace" })),
    );

    expect(redirectPath(url)).toBe("/login");
  });
});

describe("changePassword", () => {
  const CHANGE = {
    current_password: "old-password",
    password: "new-password",
    confirmation: "new-password",
  };

  it("proves the current password before changing it", async () => {
    const { signInWithPassword, updateUser } = setup();

    const state = await changePassword(EMPTY, formDataOf(CHANGE));

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "ada@example.com",
      password: "old-password",
    });
    expect(updateUser).toHaveBeenCalledWith({ password: "new-password" });
    expect(state).toEqual({
      error: null,
      notice: "Password updated. Use it the next time you sign in.",
    });
  });

  it("keeps the spaces at either end of a password", async () => {
    const { updateUser } = setup();

    await changePassword(
      EMPTY,
      formDataOf({
        ...CHANGE,
        password: "  secret1  ",
        confirmation: "  secret1  ",
      }),
    );

    // Trimming here would change the password the person typed.
    expect(updateUser).toHaveBeenCalledWith({ password: "  secret1  " });
  });

  it("stops when the current password is missing", async () => {
    const { signInWithPassword, updateUser } = setup();

    const state = await changePassword(
      EMPTY,
      formDataOf({ ...CHANGE, current_password: "" }),
    );

    expect(state.error).toBe("Enter your current password.");
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("stops when the current password is wrong", async () => {
    const { updateUser } = setup({
      signInError: { message: "Invalid login credentials" },
    });

    const state = await changePassword(EMPTY, formDataOf(CHANGE));

    expect(state).toEqual({
      error: "That is not your current password.",
      notice: null,
    });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("stops when the confirmation does not match", async () => {
    const { updateUser } = setup();

    const state = await changePassword(
      EMPTY,
      formDataOf({ ...CHANGE, confirmation: "new-passwerd" }),
    );

    expect(state.error).toBe("The two new passwords do not match.");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("sets a password for a Google-only account without asking for one", async () => {
    const { signInWithPassword, updateUser } = setup({ providers: ["google"] });

    const state = await changePassword(
      EMPTY,
      formDataOf({ password: "new-password", confirmation: "new-password" }),
    );

    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(updateUser).toHaveBeenCalledWith({ password: "new-password" });
    expect(state.error).toBeNull();
  });

  it("explains a password GoTrue refuses as unchanged", async () => {
    setup({
      updateUserError: {
        message: "New password should be different from the old password.",
      },
    });

    const state = await changePassword(EMPTY, formDataOf(CHANGE));

    expect(state.error).toBe("Choose a password you have not used here before.");
  });
});

describe("setRecoveredPassword", () => {
  const RESET = { password: "new-password", confirmation: "new-password" };

  beforeEach(() => {
    recoveryMock.isRecoveryWindowOpen.mockResolvedValue(true);
  });

  it("sets the password without asking for the current one", async () => {
    const { signInWithPassword, updateUser } = setup();

    const url = await captureRedirect(() =>
      setRecoveredPassword(EMPTY, formDataOf(RESET)),
    );

    // The recovery link is the proof; typing the old password is exactly what
    // somebody who forgot it cannot do.
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(updateUser).toHaveBeenCalledWith({ password: "new-password" });
    expect(url).toBe("/workspaces");
  });

  it("spends the window once the password is saved", async () => {
    setup();

    await captureRedirect(() => setRecoveredPassword(EMPTY, formDataOf(RESET)));

    // One link, one password: the same page must not be usable again.
    expect(recoveryMock.closeRecoveryWindow).toHaveBeenCalled();
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("refuses a browser that did not open a recovery link", async () => {
    recoveryMock.isRecoveryWindowOpen.mockResolvedValue(false);
    setup();

    const state = await setRecoveredPassword(EMPTY, formDataOf(RESET));

    // Otherwise any signed-in browser could replace the password that
    // `changePassword` makes people prove they know.
    expect(state.error).toBe(
      "Open the reset link from your email to choose a new password.",
    );
    expect(serverMock.createClient).not.toHaveBeenCalled();
  });

  it("still checks the confirmation", async () => {
    const { updateUser } = setup();

    const state = await setRecoveredPassword(
      EMPTY,
      formDataOf({ ...RESET, confirmation: "new-passwerd" }),
    );

    expect(state.error).toBe("The two new passwords do not match.");
    expect(updateUser).not.toHaveBeenCalled();
    expect(recoveryMock.closeRecoveryWindow).not.toHaveBeenCalled();
  });

  it("reports what GoTrue says about the new password", async () => {
    setup({
      updateUserError: { message: "Password should be at least 6 characters" },
    });

    const state = await setRecoveredPassword(EMPTY, formDataOf(RESET));

    expect(state.error).toBe("Password should be at least 6 characters");
    expect(recoveryMock.closeRecoveryWindow).not.toHaveBeenCalled();
  });
});

describe("createAvatarUploadUrl", () => {
  it("mints a URL in the caller's own folder", async () => {
    setup();

    const target = await createAvatarUploadUrl({
      contentType: "image/png",
      size: 1024,
    });

    expect(target.ok).toBe(true);
    if (!target.ok) return;

    expect(target.path).toMatch(/^user-1\/[0-9a-f-]{36}\.png$/);
    expect(target.token).toBe("test-upload-token");
    expect(target.publicUrl).toBe(`https://storage.test/avatars/${target.path}`);
  });

  it("lets the type pick the extension", async () => {
    setup();

    const target = await createAvatarUploadUrl({
      contentType: "image/jpeg",
      size: 10,
    });

    expect(target.ok && target.path.endsWith(".jpg")).toBe(true);
  });

  it("refuses a type the bucket would not accept", async () => {
    setup();

    expect(
      await createAvatarUploadUrl({ contentType: "image/gif", size: 10 }),
    ).toEqual({ ok: false, message: "Upload a PNG, JPEG, WebP or AVIF image." });
  });

  it("refuses an empty file and one past the ceiling", async () => {
    setup();

    expect(
      await createAvatarUploadUrl({ contentType: "image/png", size: 0 }),
    ).toEqual({ ok: false, message: "That file is empty." });

    expect(
      await createAvatarUploadUrl({ contentType: "image/png", size: 2_097_153 }),
    ).toEqual({ ok: false, message: "Keep photos under 2 MB." });
  });
});

describe("setAvatar", () => {
  it("records the public URL of an upload in the caller's folder", async () => {
    const { mock } = setup();

    const result = await setAvatar({
      path: "user-1/abc.png",
      contentType: "image/png",
    });

    expect(mock.argFor("profiles", "update")).toEqual({
      avatar_url: "https://storage.test/avatars/user-1/abc.png",
    });
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(result).toEqual({
      ok: true,
      message: "Photo updated.",
      url: "https://storage.test/avatars/user-1/abc.png",
    });
  });

  it("refuses a path in somebody else's folder", async () => {
    const { mock } = setup();

    const result = await setAvatar({
      path: "user-2/abc.png",
      contentType: "image/png",
    });

    expect(result.ok).toBe(false);
    expect(mock.methodsFor("profiles")).not.toContain("update");
  });

  it("refuses an extension the bucket does not allow", async () => {
    setup();

    expect(
      await setAvatar({ path: "user-1/abc.svg", contentType: "image/png" }),
    ).toEqual({ ok: false, message: "That upload does not belong to you." });
  });

  it("deletes the photo it replaced", async () => {
    const remove = vi.fn(async (paths: string[]) => ({
      data: paths,
      error: null,
    }));
    setup({
      profile: { avatar_url: "https://storage.test/storage/v1/object/public/avatars/user-1/old.png" },
      storage: { avatars: { remove } },
    });

    await setAvatar({ path: "user-1/new.png", contentType: "image/png" });

    expect(remove).toHaveBeenCalledWith(["user-1/old.png"]);
  });

  it("leaves a link it did not write alone", async () => {
    const remove = vi.fn(async (paths: string[]) => ({
      data: paths,
      error: null,
    }));
    setup({
      profile: { avatar_url: "https://gravatar.com/avatar/abc.png" },
      storage: { avatars: { remove } },
    });

    await setAvatar({ path: "user-1/new.png", contentType: "image/png" });

    expect(remove).not.toHaveBeenCalled();
  });
});

describe("removeAvatar", () => {
  it("clears the column and forgets the object", async () => {
    const remove = vi.fn(async (paths: string[]) => ({
      data: paths,
      error: null,
    }));
    const { mock } = setup({
      profile: { avatar_url: "https://storage.test/storage/v1/object/public/avatars/user-1/old.png" },
      storage: { avatars: { remove } },
    });

    const result = await removeAvatar();

    expect(mock.argFor("profiles", "update")).toEqual({ avatar_url: null });
    expect(remove).toHaveBeenCalledWith(["user-1/old.png"]);
    expect(result).toEqual({ ok: true, message: "Photo removed.", url: null });
  });
});
