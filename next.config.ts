import type { NextConfig } from "next";

/**
 * Response headers applied to every route.
 *
 * A Content-Security-Policy is deliberately absent: a useful one needs a
 * per-request nonce, and a nonce cannot be attached to a response that is
 * cached (`'use cache: private'` here) without either serving one nonce to
 * several requests or giving up on caching. See the Security section of the
 * README for the reasoning and the alternatives.
 */
const SECURITY_HEADERS = [
  // Never let a browser guess a content type: a JSON error served as
  // `text/html` is how an XSS payload gets a foothold.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Nothing in this app is meant to be framed; denying it removes clickjacking
  // against the settings and billing forms.
  { key: "X-Frame-Options", value: "DENY" },
  // Tenant slugs are already in every URL, so do not hand the full path to
  // third-party sites on navigation.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // None of these capabilities are used; the browser refuses them outright
  // rather than prompting.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // Keeps the OAuth popup path from sharing a browsing context group with a
  // cross-origin opener.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

/**
 * HSTS is production-only on purpose: a browser that receives it over
 * `http://localhost:3000` pins `https` for that host, which breaks every other
 * project served from the same port. `preload` is omitted because submitting to
 * the preload list is effectively irreversible.
 */
const HSTS_HEADER = {
  key: "Strict-Transport-Security",
  value: "max-age=63072000; includeSubDomains",
};

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    const headers = [...SECURITY_HEADERS];

    if (process.env.NODE_ENV === "production") {
      headers.push(HSTS_HEADER);
    }

    return [{ source: "/:path*", headers }];
  },
};

export default nextConfig;
