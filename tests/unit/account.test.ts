import { describe, expect, it } from "vitest";

import {
  AVATARS_BUCKET,
  AVATAR_ACCEPT,
  AVATAR_MAX_BYTES,
  AVATAR_TYPES,
  avatarPath,
  avatarStoragePath,
  avatarTypeFor,
  fullNameProblem,
  FULL_NAME_MAX,
  hasPasswordProvider,
  initials,
  isOwnAvatarPath,
  normaliseFullName,
  passwordChangeProblem,
} from "@/lib/account";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-policy";

/** The account rules the sheet, the actions and the bucket have to agree on. */

describe("initials", () => {
  it("takes the first and last word", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("Ada Byron King Lovelace")).toBe("AL");
  });

  it("takes two letters of a single word", () => {
    expect(initials("acme")).toBe("AC");
  });

  it("never renders nothing", () => {
    expect(initials(null)).toBe("?");
    expect(initials("")).toBe("?");
    expect(initials("   ")).toBe("?");
  });
});

describe("normaliseFullName", () => {
  it("trims and collapses the spaces a paste brings along", () => {
    expect(normaliseFullName("  Ada   Lovelace ")).toBe("Ada Lovelace");
  });

  it("stores an empty field as no name at all", () => {
    expect(normaliseFullName("")).toBeNull();
    expect(normaliseFullName("   ")).toBeNull();
  });
});

describe("fullNameProblem", () => {
  it("accepts a name at the limit", () => {
    expect(fullNameProblem("a".repeat(FULL_NAME_MAX))).toBeNull();
  });

  it("refuses a name past it", () => {
    expect(fullNameProblem("a".repeat(FULL_NAME_MAX + 1))).toBe(
      `Keep your name under ${FULL_NAME_MAX} characters.`,
    );
  });

  it("has nothing to say about no name", () => {
    expect(fullNameProblem(null)).toBeNull();
  });
});

describe("passwordChangeProblem", () => {
  const valid = {
    hasPassword: true,
    currentPassword: "old-password",
    password: "new-password",
    confirmation: "new-password",
  };

  it("accepts a proper change", () => {
    expect(passwordChangeProblem(valid)).toBeNull();
  });

  it("asks for the current password when there is one", () => {
    expect(passwordChangeProblem({ ...valid, currentPassword: "" })).toBe(
      "Enter your current password.",
    );
  });

  it("enforces the shared minimum length", () => {
    const short = "a".repeat(MIN_PASSWORD_LENGTH - 1);

    expect(
      passwordChangeProblem({ ...valid, password: short, confirmation: short }),
    ).toBe(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  });

  it("catches a typo in the confirmation", () => {
    expect(passwordChangeProblem({ ...valid, confirmation: "other" })).toBe(
      "The two new passwords do not match.",
    );
  });

  it("refuses the password that is already in use", () => {
    expect(
      passwordChangeProblem({
        ...valid,
        password: "old-password",
        confirmation: "old-password",
      }),
    ).toBe("That is already your password. Choose a new one.");
  });

  it("asks a Google-only account for no current password", () => {
    expect(
      passwordChangeProblem({
        hasPassword: false,
        currentPassword: "",
        password: "new-password",
        confirmation: "new-password",
      }),
    ).toBeNull();
  });
});

describe("hasPasswordProvider", () => {
  it("reads the provider list", () => {
    expect(hasPasswordProvider(["email"])).toBe(true);
    expect(hasPasswordProvider(["google"])).toBe(false);
    expect(hasPasswordProvider(["google", "email"])).toBe(true);
  });

  it("assumes a password when the list is missing", () => {
    // The safe direction: asking for a confirmation that turns out to be
    // unnecessary beats letting a session change a password unconfirmed.
    expect(hasPasswordProvider(undefined)).toBe(true);
    expect(hasPasswordProvider([])).toBe(true);
    expect(hasPasswordProvider("email")).toBe(true);
  });
});

describe("avatar paths", () => {
  it("keeps the size ceiling and the MIME list in step with migration 05", () => {
    expect(AVATARS_BUCKET).toBe("avatars");
    expect(AVATAR_MAX_BYTES).toBe(2_097_152);
    expect(AVATAR_TYPES.map((type) => type.mime)).toEqual([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/avif",
    ]);
    expect(AVATAR_ACCEPT).toContain("image/avif");
  });

  it("builds a key in the caller's folder", () => {
    expect(avatarPath("user-1", "abc.png")).toBe("user-1/abc.png");
  });

  it("knows which MIME types have an extension", () => {
    expect(avatarTypeFor("image/jpeg")?.extension).toBe("jpg");
    expect(avatarTypeFor("image/gif")).toBeNull();
  });

  it("accepts only the caller's own folder and a known extension", () => {
    expect(isOwnAvatarPath("user-1/abc.png", "user-1")).toBe(true);
    expect(isOwnAvatarPath("user-2/abc.png", "user-1")).toBe(false);
    expect(isOwnAvatarPath("user-1/nested/abc.png", "user-1")).toBe(false);
    expect(isOwnAvatarPath("user-1/abc.svg", "user-1")).toBe(false);
    expect(isOwnAvatarPath("user-1/abc", "user-1")).toBe(false);
    expect(isOwnAvatarPath("user-1/.png", "user-1")).toBe(false);
    expect(isOwnAvatarPath("user-1/../user-2/abc.png", "user-1")).toBe(false);
  });

  it("finds the object behind a public URL it wrote", () => {
    expect(
      avatarStoragePath(
        "https://project.supabase.co/storage/v1/object/public/avatars/user-1/abc.png",
      ),
    ).toBe("user-1/abc.png");
  });

  it("leaves a URL it did not write alone", () => {
    expect(avatarStoragePath(null)).toBeNull();
    expect(avatarStoragePath("https://gravatar.com/avatar/abc.png")).toBeNull();
    expect(
      avatarStoragePath(
        "https://project.supabase.co/storage/v1/object/public/avatars/",
      ),
    ).toBeNull();
  });
});
