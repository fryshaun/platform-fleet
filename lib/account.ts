import { MIN_PASSWORD_LENGTH } from "@/lib/auth-policy";

/**
 * Rules for a person's own account — their name, their photo, their password.
 *
 * Framework-free and free of `server-only`, like `lib/auth-policy.ts`, so the
 * sheet in the rail can show the same limits the Server Actions enforce. The
 * action stays the authority; the browser copy is only there to fail fast.
 */

/** Longest name the profile form accepts. Matches `companies.name`. */
export const FULL_NAME_MAX = 120;

/**
 * Trims a name and collapses runs of whitespace: a form field is easy to paste
 * into, and "Ada  Lovelace " is the same person as "Ada Lovelace". An empty
 * result means "no name", which the UI falls back to the email address for.
 */
export function normaliseFullName(value: string): string | null {
  const collapsed = value.trim().replace(/\s+/g, " ");
  return collapsed === "" ? null : collapsed;
}

/** The problem with a name, or `null` when it is acceptable. */
export function fullNameProblem(value: string | null): string | null {
  if (value !== null && value.length > FULL_NAME_MAX) {
    return `Keep your name under ${FULL_NAME_MAX} characters.`;
  }
  return null;
}

export type PasswordChange = {
  /** Whether the account already has a password to confirm. */
  hasPassword: boolean;
  /** The password in use today; ignored when `hasPassword` is false. */
  currentPassword: string;
  password: string;
  confirmation: string;
};

/**
 * The problem with a password change, or `null` when it may go ahead.
 *
 * Passwords are never trimmed: leading and trailing spaces are part of them, and
 * a "helpful" trim would silently change one.
 */
export function passwordChangeProblem({
  hasPassword,
  currentPassword,
  password,
  confirmation,
}: PasswordChange): string | null {
  if (hasPassword && currentPassword === "") {
    return "Enter your current password.";
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (confirmation !== password) {
    return "The two new passwords do not match.";
  }
  if (hasPassword && password === currentPassword) {
    return "That is already your password. Choose a new one.";
  }
  return null;
}

/**
 * Whether the account has a password at all.
 *
 * `app_metadata.providers` lists the ways a user may sign in. An account created
 * by a Google sign-in lists only `google`, and asking it for a "current
 * password" would be a dead end — so the form offers to set one instead.
 *
 * A missing list answers `true`: asking for a confirmation that turns out to be
 * unnecessary is a smaller mistake than letting a session change a password
 * without one.
 */
export function hasPasswordProvider(providers: unknown): boolean {
  if (!Array.isArray(providers)) {
    return true;
  }
  return providers.length === 0 || providers.includes("email");
}

/**
 * The one or two letters an avatar shows when there is no photo.
 *
 * `null` (nobody has set a name yet) and an empty string both answer "?", so an
 * avatar is never blank. Two words contribute their initials; one word
 * contributes its first two letters.
 */
export function initials(value: string | null): string {
  const parts = (value ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

// -----------------------------------------------------------------------------
// Avatar storage
// -----------------------------------------------------------------------------
/** The Storage bucket every avatar object lives in. */
export const AVATARS_BUCKET = "avatars";

/** Mirrors `file_size_limit` on the bucket. */
export const AVATAR_MAX_BYTES = 2_097_152;

export type AvatarType = {
  mime: string;
  extension: string;
};

/** Mirrors `allowed_mime_types` on the bucket. */
export const AVATAR_TYPES: readonly AvatarType[] = [
  { mime: "image/png", extension: "png" },
  { mime: "image/jpeg", extension: "jpg" },
  { mime: "image/webp", extension: "webp" },
  { mime: "image/avif", extension: "avif" },
];

/** The `accept` attribute of the photo input. */
export const AVATAR_ACCEPT = AVATAR_TYPES.map((type) => type.mime).join(",");

export function avatarTypeFor(mime: string): AvatarType | null {
  return AVATAR_TYPES.find((type) => type.mime === mime) ?? null;
}

/**
 * `<user>/<file>` — the layout the storage policies in migration 05 parse to
 * decide who may write. Building a key anywhere else would drift from them.
 */
export function avatarPath(userId: string, file: string): string {
  return `${userId}/${file}`;
}

/**
 * Whether a path is one this user could have been handed: their own folder, one
 * file, one of the four extensions.
 *
 * `setAvatar` re-checks it, so a modified client cannot point
 * `profiles.avatar_url` at somebody else's object.
 */
export function isOwnAvatarPath(path: string, userId: string): boolean {
  const [folder, file, ...extra] = path.split("/");

  if (folder !== userId || file === undefined || extra.length > 0) {
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
  return AVATAR_TYPES.some((type) => type.extension === extension);
}

/** Where the public URLs for this bucket start. */
const PUBLIC_AVATAR_MARKER = `/object/public/${AVATARS_BUCKET}/`;

/**
 * The object path behind one of our own public URLs, or `null`.
 *
 * Used to delete the photo a person just replaced. Anything else — a Gravatar
 * link, an empty column — is left alone, because it is not an object this app
 * could remove.
 */
export function avatarStoragePath(url: string | null): string | null {
  if (!url) {
    return null;
  }

  const index = url.indexOf(PUBLIC_AVATAR_MARKER);
  if (index === -1) {
    return null;
  }

  const path = url.slice(index + PUBLIC_AVATAR_MARKER.length);
  return path === "" || path.includes("..") ? null : path;
}
