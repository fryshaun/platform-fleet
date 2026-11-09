import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("./", import.meta.url)).replace(/\/$/, "");
const serverOnlyStub = fileURLToPath(new URL("./tests/stubs/empty.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // `@/...` must be matched with the trailing slash, otherwise the prefix
      // rule would also swallow `@radix-ui/*` and `@supabase/*`.
      { find: /^@\//, replacement: `${root}/` },
      // `server-only` / `client-only` are build-time markers that resolve to a
      // module which throws outside a React Server Component graph.
      { find: /^server-only$/, replacement: serverOnlyStub },
      { find: /^client-only$/, replacement: serverOnlyStub },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The suite runs on build machines too, where the platform has already set
    // the deployment variables the app branches on. Clear them so a test sees
    // the same environment everywhere; see the file for details.
    setupFiles: ["./tests/setup/deployment-env.ts"],
    // Every test file must mock its own I/O; a leaked mock between tests hides
    // ordering bugs, so reset aggressively.
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
