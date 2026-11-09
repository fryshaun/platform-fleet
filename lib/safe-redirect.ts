/**
 * Path validation for post-authentication redirects.
 *
 * `next` reaches us from a query string or a form field, so it is attacker
 * controlled: the sign-in flow must never turn it into a redirect off-site.
 * Only a same-origin relative path is accepted, and anything else falls back to
 * the caller's default.
 *
 * The cases that matter:
 *
 *   `//evil.example.com`      protocol-relative; browsers read it as a host
 *   `/\evil.example.com`      browsers normalise the backslash to `/`
 *   `/a\b`                    ambiguous once normalised, so refused outright
 *   `https://evil.example.com` absolute
 *   `javascript:alert(1)`     no leading slash
 *   leading/trailing whitespace and control characters, which can split a
 *   header or be trimmed into a different URL than the one we validated
 *
 * A path that merely *contains* `//` (such as `/a?next=//evil.example.com`) is
 * fine: it is still a path on this origin.
 */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function safeNextPath(value: unknown, fallback = "/workspaces"): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const next = value.trim();
  if (!next.startsWith("/")) {
    return fallback;
  }
  if (next.startsWith("//") || next.includes("\\")) {
    return fallback;
  }
  if (CONTROL_CHARACTERS.test(next)) {
    return fallback;
  }

  return next;
}
