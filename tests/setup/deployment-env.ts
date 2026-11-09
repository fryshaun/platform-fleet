/**
 * Strips the variables a hosting platform injects into the build that also runs
 * the suite.
 *
 * Both `lib/site.ts` and the Stripe webhook read them to decide how to behave
 * *while deployed*, so inheriting them turns the tests into a different suite:
 * on Vercel the origin guard would answer with the deployment URL, and a
 * production deployment would reject every test-mode webhook. Locally neither
 * is set, which is why this only ever failed in CI.
 *
 * Tests that exercise this behaviour stub their own values with `vi.stubEnv`,
 * which is unaffected by the deletions below.
 */
const DEPLOYMENT_ONLY_VARIABLES = [
  // `lib/site.ts` — refuses a localhost origin when deployed.
  "NEXT_PUBLIC_SITE_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
  // Webhook route — refuses test-mode events on a production deployment.
  "VERCEL_ENV",
] as const;

for (const name of DEPLOYMENT_ONLY_VARIABLES) {
  delete process.env[name];
}
