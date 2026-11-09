/**
 * Stand-in for the `server-only` / `client-only` marker packages.
 *
 * Their real `index.js` throws on import, which is the desired behaviour inside
 * a bundler and fatal inside a Node test runner. Vitest aliases both packages
 * here (see `vitest.config.mts`).
 */
export {};
