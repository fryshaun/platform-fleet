import { describe, expect, it } from "vitest";

import {
  IMAGE_ACCEPT,
  IMAGE_TYPES,
  imageTypeFor,
  isImagePathIn,
  publicObjectPath,
} from "@/lib/uploads";

/**
 * The image rules shared by the account photo and the workspace logo.
 *
 * These are the pieces `lib/account.ts` and `lib/company.ts` delegate to, so what
 * is exercised here is what both features get.
 */

describe("IMAGE_TYPES", () => {
  it("is the list the buckets allow", () => {
    expect(IMAGE_TYPES.map((type) => type.mime)).toEqual([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/avif",
    ]);
    expect(IMAGE_ACCEPT).toBe("image/png,image/jpeg,image/webp,image/avif");
  });
});

describe("imageTypeFor", () => {
  it("maps a mime type to the extension the object key uses", () => {
    expect(imageTypeFor("image/png")).toEqual({
      mime: "image/png",
      extension: "png",
    });
    expect(imageTypeFor("image/jpeg")?.extension).toBe("jpg");
    expect(imageTypeFor("image/webp")?.extension).toBe("webp");
    expect(imageTypeFor("image/avif")?.extension).toBe("avif");
  });

  it("answers null for anything else", () => {
    expect(imageTypeFor("image/gif")).toBeNull();
    expect(imageTypeFor("text/plain")).toBeNull();
    expect(imageTypeFor("")).toBeNull();
  });
});

describe("isImagePathIn", () => {
  it("accepts one file in the given folder", () => {
    expect(isImagePathIn("abc/file.png", "abc")).toBe(true);
    expect(isImagePathIn("abc/file.jpg", "abc")).toBe(true);
  });

  it("refuses a different folder", () => {
    expect(isImagePathIn("other/file.png", "abc")).toBe(false);
    expect(isImagePathIn("/abc/file.png", "abc")).toBe(false);
  });

  it("refuses a nested path, which the storage policies cannot see", () => {
    // The policies read only the first segment, so `abc/x/file.png` would be
    // judged by the folder alone and land somewhere it should not.
    expect(isImagePathIn("abc/x/file.png", "abc")).toBe(false);
  });

  it("refuses traversal, empty names and extensionless files", () => {
    expect(isImagePathIn("abc/../file.png", "abc")).toBe(false);
    expect(isImagePathIn("abc/", "abc")).toBe(false);
    expect(isImagePathIn("abc", "abc")).toBe(false);
    expect(isImagePathIn("abc/file", "abc")).toBe(false);
    expect(isImagePathIn("abc/.png", "abc")).toBe(false);
  });

  it("refuses an extension outside the list it is given", () => {
    expect(isImagePathIn("abc/file.svg", "abc")).toBe(false);
    expect(
      isImagePathIn("abc/file.svg", "abc", [
        { mime: "image/svg+xml", extension: "svg" },
      ]),
    ).toBe(true);
  });
});

describe("publicObjectPath", () => {
  const bucket = "https://example.supabase.co/storage/v1/object/public";

  it("returns the object path behind our own URL", () => {
    expect(publicObjectPath(`${bucket}/avatars/user-1/a.png`, "avatars")).toBe(
      "user-1/a.png",
    );
  });

  it("does not confuse a bucket whose name ends the same way", () => {
    expect(
      publicObjectPath(`${bucket}/product-avatars/a.png`, "avatars"),
    ).toBeNull();
  });

  it("answers null for a URL it did not write", () => {
    expect(publicObjectPath(null, "avatars")).toBeNull();
    expect(publicObjectPath("", "avatars")).toBeNull();
    expect(publicObjectPath("https://gravatar.com/avatar/abc.png", "avatars")).toBeNull();
  });

  it("answers null for another bucket", () => {
    expect(publicObjectPath(`${bucket}/product-media/a.png`, "avatars")).toBeNull();
  });

  it("answers null for an empty or climbing path", () => {
    expect(publicObjectPath(`${bucket}/avatars/`, "avatars")).toBeNull();
    expect(publicObjectPath(`${bucket}/avatars/../a.png`, "avatars")).toBeNull();
  });
});
