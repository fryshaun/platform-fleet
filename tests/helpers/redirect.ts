/**
 * `next/navigation`'s `redirect()` / `notFound()` signal by throwing. Tests
 * replace them with throwing stubs (see the `vi.mock("next/navigation", …)`
 * factory in each file) and use the helpers below to capture the destination.
 */
export const REDIRECT_TAG = "__REDIRECT__:";
export const NOT_FOUND_TAG = "__NOT_FOUND__";

/** Runs `fn`, expecting it to redirect, and returns the target URL. */
export async function captureRedirect(
  fn: () => Promise<unknown> | unknown,
): Promise<string> {
  try {
    await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith(REDIRECT_TAG)) {
      return message.slice(REDIRECT_TAG.length);
    }
    throw error;
  }

  throw new Error("Expected a redirect, but the function returned normally.");
}

/** Runs `fn`, expecting it to call `notFound()`. */
export async function captureNotFound(
  fn: () => Promise<unknown> | unknown,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === NOT_FOUND_TAG) return;
    throw error;
  }

  throw new Error("Expected notFound(), but the function returned normally.");
}

/** Parses the query string out of a captured redirect URL. */
export function redirectParams(url: string): URLSearchParams {
  const index = url.indexOf("?");
  return new URLSearchParams(index === -1 ? "" : url.slice(index + 1));
}

/** The pathname of a captured redirect URL, without query. */
export function redirectPath(url: string): string {
  const index = url.indexOf("?");
  return index === -1 ? url : url.slice(0, index);
}
