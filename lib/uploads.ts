/**
 * The rules shared by every image this app stores in Supabase Storage.
 *
 * Accounts and workspaces both keep a picture in a public bucket, both cap it at
 * 2 MB, both accept the same four types, and both key objects by a folder in the
 * first path segment. Those rules live here once so the two modules cannot drift
 * apart, and so a rule change is a single edit.
 *
 * Framework-free and free of `server-only`, so an uploader in the browser can
 * validate a file with exactly the same code the Server Action re-checks it with.
 */

export type ImageType = {
  mime: string;
  extension: string;
};

/** Mirrors `allowed_mime_types` on the avatar and logo buckets. */
export const IMAGE_TYPES: readonly ImageType[] = [
  { mime: "image/png", extension: "png" },
  { mime: "image/jpeg", extension: "jpg" },
  { mime: "image/webp", extension: "webp" },
  { mime: "image/avif", extension: "avif" },
];

/** The `accept` attribute of an image input. */
export const IMAGE_ACCEPT = IMAGE_TYPES.map((type) => type.mime).join(",");

export function imageTypeFor(mime: string): ImageType | null {
  return IMAGE_TYPES.find((type) => type.mime === mime) ?? null;
}

/**
 * Whether a path is one this app could have built: `<folder>/<file>`, one file,
 * one of the accepted extensions.
 *
 * The actions re-check what they are handed, so a modified client cannot point a
 * column at an object outside the folder it is allowed to write to. A nested path
 * is refused as well — the storage policies read only the first segment, so
 * `<folder>/<nested>/<file>` would slip past them.
 */
export function isImagePathIn(
  path: string,
  folder: string,
  types: readonly ImageType[] = IMAGE_TYPES,
): boolean {
  const [head, file, ...extra] = path.split("/");

  if (head !== folder || file === undefined || extra.length > 0) {
    return false;
  }
  if (file.includes("..") || file === "") {
    return false;
  }

  const dot = file.lastIndexOf(".");
  if (dot <= 0) {
    return false;
  }

  const extension = file.slice(dot + 1);
  return types.some((type) => type.extension === extension);
}

/**
 * The object path behind one of our own public URLs, or `null`.
 *
 * Used to delete the picture that was just replaced. Anything else — a Gravatar
 * link, a paste from another host, an empty column — is left alone, because it is
 * not an object this app could remove.
 */
export function publicObjectPath(url: string | null, bucket: string): string | null {
  if (!url) {
    return null;
  }

  const marker = `/object/public/${bucket}/`;
  const index = url.indexOf(marker);
  if (index === -1) {
    return null;
  }

  const path = url.slice(index + marker.length);
  return path === "" || path.includes("..") ? null : path;
}
