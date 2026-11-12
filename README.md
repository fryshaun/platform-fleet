# Trackstand

Trackstand is a multi-tenant **base template** on Next.js 16 and Supabase:
sign-in, per-workspace membership and roles, RLS-scoped data and Stripe billing,
plus two worked domain modules — an optional **products** section with
categories, variants, stock, date-based inventory and a media gallery, and an
optional **assets** section that records the individual units behind a product.
Switch either off and you are back to the bare base; copy them for the next
section (see [Adding a new section](#adding-a-new-section)) and delete nothing.

Each company is a **tenant** addressed by a path segment: `/acme/dashboard`,
`/acme/settings`. The tenant slug lives in Postgres, not in a hard-coded map, and
every tenant-scoped table is protected by Row Level Security — including the
section switch itself, which lives in `companies.enabled_sections` and is
re-checked by every policy of the module it belongs to.

## Stack

| Concern     | Choice                                                                 |
| ----------- | ---------------------------------------------------------------------- |
| Framework   | Next.js 16 (App Router, Cache Components, Turbopack)                   |
| UI          | React 19, Tailwind v4, shadcn/ui, next-themes, lucide                  |
| Auth        | Supabase Auth (password, magic link, Google OAuth) via `@supabase/ssr` |
| Database    | Supabase Postgres with RLS                                            |
| Billing     | Stripe Checkout + Billing Portal + webhook sync                        |

## Brand

The identity is code, not a checked-in mockup. `components/brand/logo.tsx` draws
the mark and sets the wordmark live, so the lockup scales with the text around it
and flips with the theme. `app/icon.svg` is the favicon built from the same
geometry. The two JPEGs in `public/logos/` are for print and email, where a
raster is what the medium expects.

| Token           | Value      | Use                                                   |
| --------------- | ---------- | ----------------------------------------------------- |
| Trackstand Lime | `#B8F200`  | Primary actions, active nav, the top rule             |
| Emerald Core    | `#15803D`  | Links on light, success, the dark-mode bar            |
| Deep Forest     | `#0B2818`  | Text on light, and the ink the dark floor is cut from |
| Night Trail     | `#122119`  | Panels in print and email                             |
| Chalk White     | `#F6F7F4`  | Page floor in light                                   |
| Pure Off-White  | `#FAFAF8`  | Light-mode panels, print and email text               |

Dark mode sits one step below that palette, because a full page of Deep Forest
reads mid-green rather than dark. The floor drops to `#06120C`, the rail to
`#08160D`, cards and popovers to `#0D1F15`, and body text dims from Pure
Off-White to `#DFE5DB` (14.9:1 on the floor, 13.4:1 on a card — dimmer, never
lower contrast). Lime and emerald are unchanged; the darker ground is what lets
lime clear 15:1 and carry links there.

Three rules the tokens exist to enforce:

- **Lime is never text.** `--primary` is lime with `--primary-foreground` Deep
  Forest (13.8:1). A link needs its own colour, so `--link` is Emerald Core on
  light and lime on dark, and `Button variant="link"` reads `text-link` rather
  than `text-primary`.
- **Three families, three jobs.** Plus Jakarta Sans (`font-display`) for the
  wordmark and every heading, Inter (`font-sans`) for UI copy, JetBrains Mono
  (`font-mono`) for handles, serials and other machine-readable strings.
- **The mark is three bars, not an image.** `<TrackstandLogo className="text-xl" />`
  sizes the mark at 1.11em of the wordmark's font size — the artwork's own ratio
  — and `--logo-bar-center` lifts the centre bar from forest to emerald on dark
  surfaces so it stays legible.
- **The canvas carries the mark's gesture.** `BrandBackdrop` lays a 1px hatch at
  the bars' own 69° lean over two radial pools (lime into the top corner,
  emerald out of the bottom). It is CSS only — no image request, no animation —
  and the hatch is radially masked so it fades before the reading zone.

Use `BrandLink` for the brand link on any standalone page (landing, auth, 404),
`BrandBackdrop` as the first child of a `relative isolate` marketing page, and
`TrackstandStack` for an asset label that needs the mark, the wordmark and a
serial.

## Getting started

```bash
pnpm install
cp .env.example .env.local     # then fill in the values
pnpm dev
```

### 1. Supabase project

1. Create a project. **Authentication → Sign In / Providers**: **Email** is
   enabled by default and is what `/signup` and `/login` use; enable **Google**
   too if you want the OAuth button to work.

   Email links come back through `/auth/callback`, so both providers need that
   path allow-listed. Every template uses the `token_hash` form rather than the
   default `{{ .ConfirmationURL }}`: the default only works in the browser that
   requested the link, while the token works on any device. Under
   **Authentication → Emails**:

   - *Confirm signup*:
     `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup&next=%2Fonboarding`
   - *Magic Link*: the same form with
     `&type=magiclink&next=%2Fworkspaces`, and the body must include
     `{{ .Token }}` — that six-digit code is what the "Code from the email" field
     verifies when the mail is opened somewhere else.
   - *Invite user*:
     `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=%2Fworkspaces`
     so a teammate can accept the invitation in any browser. That `type=invite`
     is what makes the callback activate the pending membership.
   - *Reset password*:
     `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=%2Freset-password`.
     `type=recovery` is what marks the browser as having opened a recovery link,
     which is the only way `/reset-password` will replace a password.
   - Add `{origin}/auth/callback` to **URL Configuration → Redirect URLs**
     (`http://localhost:3000/**` for development). A target that is not listed
     makes GoTrue fall back to the bare Site URL, and the code lands on `/` —
     `proxy.ts` forwards those to `/auth/callback`, so the flow still completes.
   - Set **Email OTP length** to 6 (`OTP_LENGTH` is hard-coded), keep **Confirm
     email** on, and leave **Secure password change** off: `changePassword`
     re-authenticates with the old password rather than a nonce.

   `docs/supabase-email-templates.md` repeats this list, adds the project
   settings around it, and carries ready-to-paste HTML for each template.
2. Apply the migrations. Either link the CLI and push:

   ```bash
   supabase link --project-ref <ref>
   supabase db push --remote
   ```

   `--remote` matters: without it the CLI targets a local stack started by
   `supabase start` and fails with `connect ECONNREFUSED 127.0.0.1:54322`.

   or paste `supabase/migrations/*.sql` into the SQL editor in filename order.

   `20260101000000_accounts_and_companies.sql` creates the core: the
   `member_role` and `subscription_status` enums, `profiles`, `companies`,
   `company_members`, the RLS helpers, every policy, the grants, and the
   `auth.users` → `profiles` trigger.
   `20260101000100_team_invitations.sql` adds the invitation flow on top:
   `shares_company_with()` plus the colleague-profile policy,
   `accept_company_invitations()`, `my_pending_invitations()` and
   `respond_to_company_invitation(uuid, boolean)`. A pending membership grants
   nothing until it is accepted.
   `20260101000200_products.sql` adds the optional products section:
   `companies.enabled_sections`, the `product_*` enums, `product_categories`,
   `products` (variants are rows with `parent_id`), `product_media`,
   `product_dates`, `has_company_section()`, the single-level variant trigger, a
   policy per table per verb, and the public `product-media` bucket with its
   storage policies. It needs PostgreSQL 15 or newer, for
   `on delete set null (column)` — that is Supabase's baseline.
   `20260101000300_assets.sql` adds the optional assets section: the
   `asset_status` enum, `assets` (one row per physical unit), the composite key
   back to `products` that unassigns instead of deleting, the
   `status_changed_at` trigger, and a policy per verb. It asks
   `has_company_section(company_id, 'assets')`, never the products key, so the
   two sections switch independently.
   `20260101000400_account_avatars.sql` adds the public `avatars` bucket behind
   the account photo: 2 MB per object, four image types, and a policy per verb
   comparing the first path segment with `auth.uid()`. No company is consulted —
   a photo follows the person between workspaces.
   `20260101000500_company_identity.sql` adds what a workspace looks like and what
   it sells in: `companies.currency` (the default the product form pre-fills, with
   the same `^[a-z]{3}$` rule as `products.currency`), `companies.badge`, and
   `companies.logo_url` behind the public `company-logos` bucket. Writes are keyed
   `<company-id>/<uuid>.<ext>` and allowed to owners and admins only; every member
   can read the mark, and no section check is involved — identity is not optional.

   `20260101000900_two_factor.sql` adds the workspace policy and the answer the
   client libraries cannot give: `companies.require_mfa` (off by default) and
   `public.has_password()`, a `security definer` function that reports whether
   `auth.users.encrypted_password` is set. It needs the recovery-codes toggle in
   the dashboard too — see **Two-factor authentication** below.

   `20260101001000_company_billing_guard.sql` takes the columns that decide what
   a workspace pays off a signed-in session — `stripe_customer_id`,
   `stripe_subscription_id`, `subscription_status`, `trial_ends_at` on
   `companies`, and `email` on `profiles` — with a column-level grant plus a
   `before update` trigger, because a row-level policy cannot narrow a column.
   It also closes the neighbouring table-wide writes: `companies` loses `insert`
   and `delete`, `profiles` loses `delete`, and `company_members` keeps only
   `update (role)`. Each row-level policy in the first migration assumed those
   grants were narrower than they are; this file is the grant half.

   `20260101001100_subscription_write_gate.sql` is the paywall, and it is narrow
   on purpose. Reads are never gated — nothing a workspace stored disappears
   because a card expired — and the write gate covers only what a subscription
   pays for: `products`, `product_categories`, `product_media`, `product_dates`
   and `assets`, plus the `product-media` bucket the gallery lives in. Each of
   the five tables gains a *restrictive* `insert`/`update`/`delete` policy that
   ANDs `public.has_active_subscription(company_id)` onto the existing role
   checks; the bucket policies are re-created with the same predicate beside
   their `bucket_id` and role checks, because a restrictive policy on
   `storage.objects` would freeze every bucket in the table. `companies`,
   `profiles`, `company_members`, Settings → Billing, the logo and the avatar
   stay writable: fixing the card and leaving the workspace are exactly what a
   lapsed workspace must still be able to do. What counts as live here is
   `active`, `trialing` and `past_due` — see **Writes need a live subscription**
   under **Architecture notes**.

   A feature module adds its own numbered migration; it never edits the ones
   before it.

3. Copy the project URL, publishable key and secret key into `.env.local`. The
   keys are on **Project Settings → API Keys**: `sb_publishable_…` goes in
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `sb_secret_…` in `SUPABASE_SECRET_KEY`.
   The retired `anon` and `service_role` keys are still read as a fallback so an
   existing environment keeps working until it is rotated; using one logs a
   deprecation warning, and Supabase stops accepting them in 2027.

   The secret key is not optional for billing: the onboarding insert, the
   `stripe_customer_id` the checkout records, and both webhook writes all run as
   the service role, so a deployment without it takes no payments even though it
   boots and renders fine.

#### Google sign-ins and `431 Request Header Fields Too Large`

`@supabase/ssr` keeps the whole session in the auth cookie, chunked at ~3 KB, and
a Google session is the largest kind: `provider_token` and
`provider_refresh_token` add ~2.4 KB that nothing in this app reads.
`app/auth/callback/route.ts` re-stores the session from its two tokens right
after the exchange, which drops both fields and the extra chunk — 6.6 KB of
`Cookie` header per request instead of 10 KB.

A browser that still answers `431` has a jar past the 16 KB request-header limit
Node applies to `next dev`. Cookies ignore the port, so `localhost` also carries
whatever else runs on `localhost:3000`; clear the site data (**DevTools →
Application → Storage → Clear site data**) or raise the cap for the dev server:

```bash
node --max-http-header-size=32768 node_modules/next/dist/bin/next dev
```

To see what a jar is actually carrying, in the browser console:

```js
document.cookie
  .split("; ")
  .sort((a, b) => b.length - a.length)
  .slice(0, 10);
```

### 2. Stripe

1. Create a **Product** with one or more recurring **Prices**. The plans the app
   offers are read from the account — every active recurring price whose product
   is active — so a new plan is a Dashboard change, not a deploy. Set
   `STRIPE_PLAN_PRICE_IDS` only to hide prices that must stay active for
   existing customers.
2. Forward webhooks locally:

   ```bash
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```

   Copy the printed `whsec_…` into `STRIPE_WEBHOOK_SECRET`.
3. Enable the customer billing portal in the Stripe dashboard so
   **Settings → Billing → Manage subscription** works.

#### Stripe in production

The local `stripe listen` setup above is test-mode only. A deployed
environment needs its own endpoint and its own key.

- **Endpoint** — `https://<your-domain>/api/stripe/webhook`, created with the
  **snapshot** payload format. Thin events carry only a reference the handler
  would have to fetch, which also costs an `Events: Read` permission.
- **Events** — select exactly the types the handler switches on, not `*`:
  `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.paused`,
  `customer.subscription.resumed`, `customer.subscription.deleted`.
  Unhandled types are acknowledged with a `200`, so a wildcard subscription
  only burns invocations and widens the surface for no benefit.
- **API version** — pin it on the destination. Nothing the handler reads
  (`id`, `customer`, `status`, `trial_end`, `metadata.company_id`) moves
  between recent versions; `current_period_end` is deliberately unused.
- **Signing secret** — every endpoint has its own `whsec_…`, so the value
  printed by `stripe listen` must never be reused in a deployed environment.
  Rotating an endpoint's secret is safe here: Stripe re-signs each retry, so a
  delivery that fails mid-rotation verifies against the new value on the next
  attempt once the environment variable is updated.

The server-side key should be a **restricted** key (`rk_live_…`/`rk_test_…`),
not a secret key. The app makes six Stripe API calls, so six permissions cover
all of it:

| Resource                | Permission | Used by                                                        |
| ----------------------- | ---------- | -------------------------------------------------------------- |
| Customers               | Write      | `lib/actions/*.ts` — `customers.create`                        |
| Checkout Sessions       | Write      | `lib/actions/*.ts` — `checkout.sessions.create`                |
| Billing Portal Sessions | Write      | `lib/actions/billing.ts` — `billingPortal.sessions.create`     |
| Subscriptions           | Read       | `lib/billing/sync.ts` — `subscriptions.list`                   |
| Prices                  | Read       | `lib/subscriptions.ts` — `prices.list`                         |
| Products                | Read       | `lib/subscriptions.ts` — `prices.list` with `expand: product`  |

Write implies Read. Everything else — Payment Intents, Charges, Invoices,
Payouts, Events, Webhook Endpoints, Balance — should be **None**. Receiving
events needs no permission at all: `constructEventAsync` is a local HMAC check.
If a call unexpectedly returns `403`, add the permission named in that key's
request logs instead of granting it up front.

Set the values per environment, marked **sensitive** in Vercel so they are
write-only and never reach logs:

| Variable                 | Production          | Preview                    |
| ------------------------ | ------------------- | -------------------------- |
| `STRIPE_SECRET_KEY`      | `rk_live_…`         | `rk_test_…`                |
| `STRIPE_PLAN_PRICE_IDS`  | usually unset       | usually unset              |
| `STRIPE_WEBHOOK_SECRET`  | production endpoint | its own endpoint, or unset |

Two constraints are worth knowing:

- Stripe's published webhook IP ranges can't be enforced on Vercel, so
  signature verification is the control. In its place the route refuses a
  test-mode event when `VERCEL_ENV` is `production`, which stops a test
  endpoint's signing secret from writing test data into a shared live database.
  A self-hosted `next start` sets no `VERCEL_ENV` and keeps signature checks
  alone.
- Vercel functions have no static egress IPs, so an IP-restricted access policy
  on the key breaks deployments. Use least privilege plus rotation instead.
- **A stored customer id is auditable, not merely trusted.**
  `node scripts/audit-stripe-customers.mjs` reads every non-null
  `companies.stripe_customer_id` back from Stripe and prints the ones that are
  deleted, unreadable, or stamped for another workspace — exiting non-zero if
  there are any, and reading `.env.local` (or the exported variables) rather than
  taking arguments. It never writes, because a checkout now *self-heals* such a
  row by creating a fresh customer, and a silent repair is exactly how those rows
  become duplicates in the Dashboard nobody can explain.

### 3. Run

```bash
pnpm dev        # http://localhost:3000
pnpm build      # production build + full type check
pnpm lint
```

## Testing

```bash
pnpm test          # vitest run
pnpm test:watch    # watch mode
pnpm typecheck     # next typegen && tsc --noEmit
pnpm verify        # lint + typecheck + tests — run this before pushing
```

`typecheck` runs `next typegen` first on purpose. Next 16 declares the global
route-prop helpers (`PageProps`, `LayoutProps`, `RouteContext`) in generated
files — `next-env.d.ts` imports `./.next/types/routes.d.ts` — and both are
gitignored. Running bare `tsc --noEmit` on a clean checkout therefore fails with
`TS2304: Cannot find name 'PageProps'`. Locally it passes anyway, because
`next dev` has already written `.next/`, so the breakage only shows up on a
fresh CI runner or a Vercel build. `next typegen` writes exactly those files
without doing a full build, which keeps `typecheck` honest in both places.

The suite is fully mocked: no Supabase project, no Stripe keys and no network
access are required, so it behaves identically locally, in CI, and on a pull
request from a fork. `tests/setup/deployment-env.ts` — registered as
`setupFiles` in `vitest.config.mts` — deletes the variables a host injects into
the build (`VERCEL_ENV`, `VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL`,
`NEXT_PUBLIC_SITE_URL`). Without it, the deployment-only branches fire *during*
the Vercel build: the origin guard answers with the deployment URL where a test
expects localhost, and a production deployment drops every test-mode webhook
event. Tests that cover that behaviour stub the values themselves.

| Area            | Files                                                                          | Covers                                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure helpers    | `tests/unit/`                                                                  | slug generation against the `companies.slug` CHECK regex, query-param and class-name helpers, post-login redirect validation, the five-role hierarchy and assignable-role rules, plan filtering/formatting and `/100` price parity with the rest of the app, the section registry and its switch, product handles/money/stock/variant grouping/date windows/media limits, asset handles/names/serials and derived availability |
| Config guards   | `tests/unit/{stripe,site,supabase-env,security-headers}.test.ts`                | lazy Stripe client, origin resolution behind proxy headers (including malformed `Host`/`X-Forwarded-Proto`), named missing-env errors, the response header set and its production-only HSTS |
| Route handlers  | `tests/api/`                                                                   | Stripe webhook signature/secret checks, every status → enum mapping, idempotent replay, 5xx retry semantics, unmatched subscriptions, OAuth code exchange, email `token_hash` verification, open-redirect guards, invitation acceptance only for `type=invite` |
| Server Actions  | `tests/actions/`                                                               | tenant resolution, role gates, pending invitation creation (and identical wording for both paths), accepting/declining an invitation, validation messages, plan validation against Stripe, Postgres error codes (`23503`, `23505`), checkout rollback, product/category/variant/stock/date writes scoped by tenant, the section switch, gallery upload targets and path checks, asset writes scoped by tenant with the front-desk status gate |
| Routing         | `tests/integration/`                                                           | which paths require auth, cookie preservation across redirects, matcher exclusions            |
| Schema          | `tests/db/schema.test.ts`                                                      | RLS enabled on every table, slug regex parity with the client, `anon` grant revocation, invitation columns/policies, accepted-only membership predicates, enum parity, the section predicate in every products *and* assets policy, tenant-keyed foreign keys, the single-level variant trigger, the assets status trigger, no stored asset count, and the bucket limits |

`tests/helpers/` holds a thenable Supabase query-builder mock that records every
chained call, so assertions can check the filters that were applied
(`.eq("company_id", …)`) and not only the rows that came back.

### Deployment gate

Tests must pass before anything deploys:

- **GitHub Actions** (`.github/workflows/ci.yml`) runs audit → lint → typecheck →
  test → build on every push to `main` and every pull request.
- **Vercel** builds through `vercel.json` → `pnpm run vercel-build`, which is
  `vitest run && next build`. A failing test fails the build, so the deployment
  is never promoted and the previous production deployment keeps serving.
  `vercel.json` also pins `installCommand` to `pnpm install --frozen-lockfile
  --prod=false`: Vercel sets `NODE_ENV=production`, and a production-only install
  drops `vitest`, `typescript` and `@tailwindcss/turbopack`, which breaks the
  build before the tests ever run. `--prod=false` forces the dev dependencies in
  regardless of `NODE_ENV`.

## Walkthrough

1. `/signup` → email + password → the confirmation link → `/auth/callback` →
   `/onboarding`. Google and the magic-link form land on the same callback; a
   password reset goes through it too and finishes on `/reset-password`, where a
   new password is set without the old one.
2. `/onboarding` lists the plans Stripe sells, then names the company, reserves
   `companies.slug`, inserts the caller as `owner`, and redirects to Stripe
   Checkout for the plan they picked.
3. `/api/stripe/webhook` writes the subscription state back onto the company.
   That delivery is the fast path, not the only one: `lib/billing/sync.ts` also
   re-reads the subscription from Stripe on the billing page and on a dashboard
   visit whose stored status has not settled, so a missed webhook cannot leave a
   paying company looking unpaid.
4. `/{slug}/dashboard` is the workspace. At the top of the rail sits the
   workspace mark — the uploaded logo, or the badge, or the initials of the name
   (see *Workspace identity*). The rail carries the dashboard plus the
   optional sections the workspace has switched on; **Products** and **Assets**
   are off until an owner or admin enables them on `/{slug}/settings` →
   Extensions. Screens that belong to a section but are gated more tightly hang
   off it in the rail: **Categories** sits next to Products and is drawn only for
   managers and up, because that page is manager-only. Above the theme switch and
   the avatar sits a **gear** that opens `/{slug}/settings`, drawn only for owner
   and admin. The avatar menu itself holds only what belongs to the person: their
   own settings (a sheet with photo, name and password) and signing out.

## Team roles and invitations

`member` predates the team model and is labelled **Viewer**. It is not migrated
to another role: existing members become read-only, while managers and staff are
invited explicitly.

| Task                                | Owner | Admin | Manager | Staff | Viewer |
| ----------------------------------- | :---: | :---: | :-----: | :---: | :----: |
| Read every workspace page           |  yes  |  yes  |   yes   |  yes  |  yes   |
| Write in the products section       |  yes  |  yes  |   yes   |   —   |   —    |
| Add, edit and remove assets         |  yes  |  yes  |   yes   |   —   |   —    |
| Move an asset in or out of service  |  yes  |  yes  |   yes   |  yes  |   —    |
| Switch sections on and off          |  yes  |  yes  |    —    |   —   |   —    |
| Billing and company details         |  yes  |  yes  |    —    |   —   |   —    |
| Invite, re-role and remove the team |  yes  |  yes  |    —    |   —   |   —    |

`manager` is the write tier the products section uses; `staff` reads it, and the
assets section is where the front-desk tier finally writes something — its own
status field. Gate the UI with `canManage`/`canFrontDesk` and mirror the same role
lists in the RLS policy — the two are cheap to keep in step and expensive to
drift.

The application predicates live in `lib/roles.ts`
(`canAdminister` → `canManage` → `canFrontDesk`) and are re-checked by RLS.
Ownership and admin rights cannot be handed out from the team screen; an owner
or admin row is immutable from a client session.

Invitations are per membership, and a membership only counts once the invited
person accepts it:

1. An owner/admin submits an email and an assignable role on **Settings → Team**.
2. Both paths create a **pending** membership (`accepted_at = null`). If the
   address already has an account, only the row is inserted. Otherwise
   `inviteUserByEmail` creates the auth user (and their profile via the trigger)
   and sends the invitation. Both paths answer **"Invitation sent to …"**, so the
   form cannot be used to test whether an address has an account.
3. A pending membership grants nothing: the RLS helpers ignore it, so the
   workspace is absent from `/workspaces` and unreachable by slug.
4. It becomes real in one of two ways:
   - **Opening the invitation email.** The link lands on `/auth/callback` with
     `type=invite`, and only that type calls `accept_company_invitations()`.
     Signing in with Google, a magic link or a signup confirmation does _not_
     accept invitations — authenticating is not consent to join somebody's
     workspace.
   - **Accepting in the app.** `/workspaces` lists pending invitations from
     `my_pending_invitations()`, and its buttons call
     `respond_to_company_invitation()` to accept or decline.
5. The team list shows **Invitation sent** while `accepted_at` is null and
   **Registered** afterwards.

That badge means "Supabase accepted the send request" and "the person has
accepted", not "the email was delivered". Delivery confirmation would need an
email-provider webhook; the app deliberately does not pretend to have one.

## Your account

The avatar at the foot of the rail holds what belongs to the *person* rather than
to a workspace, and **User settings** opens a sheet — not a route. There is no
`/account` URL because there is nothing to link to: the sheet is one person's
business, and a page would mean losing your place on whatever you were doing.

- **Photo** — the browser uploads straight to the public `avatars` bucket through
  a signed URL (`createAvatarUploadUrl`), and `setAvatar` records the result in
  `profiles.avatar_url`. Objects are keyed `<user-id>/<uuid>.<ext>`, and every
  policy in migration 05 compares that first segment with `auth.uid()`, so a
  session can only write into its own folder. The object it replaces is deleted,
  so changing a photo ten times leaves one file. 2 MB, PNG/JPEG/WebP/AVIF.
- **Name** — `profiles.full_name`, trimmed and with runs of spaces collapsed; an
  empty field is stored as `null`, which every reader treats as "use the email
  address". The rail, the team list and the menus all read it through
  `getCurrentUser()`, so the action invalidates the tree from the root layout
  down (`revalidatePath("/", "layout")`).
- **Password** — `changePassword` asks for the current password and re-proves it
  with `signInWithPassword` before calling `auth.updateUser`. Without that step a
  borrowed browser could change the password that protects the account.
  `SessionUser.hasPassword` decides whether there is anything to confirm, and it
  comes from `public.has_password()` — the only truthful source. The provider
  list is misleading exactly where it matters: an invited account has
  `app_metadata.providers = ["email"]` from the moment the invitation is sent,
  but GoTrue stores no password until the person chooses one, so
  `encrypted_password` is null and asking for "your current password" was a dead
  end. Google-only accounts answer false for the same reason and get the same
  "set a password" form. When the RPC itself fails (a deployment without
  migration 09) the action falls back to the provider list rather than refusing
  the change.

Two limits are worth knowing before you change this:

- These actions **answer** (`useActionState`) instead of redirecting, because a
  redirect would close the sheet and navigate the page underneath. Every other
  action in the app redirects with `?error=`/`?ok=`.
- With Supabase's **Secure password change** setting switched on, GoTrue rejects
  `updateUser` without a nonce from `reauthenticate()`. Leave it off, or extend
  `changePassword` to fetch and use one. Changing the email address, and the
  forgot-password flow, deliberately stay in Supabase's own email templates.

## Two-factor authentication

A second factor is an authenticator app's six-digit code on top of the password.
The implementation is Supabase's own MFA — no factor table of ours, no secrets in
the database — plus two screens and a policy column.

**Where it lives.** `/mfa` asks for the code; `/mfa/setup` creates the factor. Both
are top-level routes, not tenant ones: a factor belongs to the *account*, and both
pages must render for a session at `aal1`, which is exactly the session every
tenant layout turns away. The account sheet (avatar → **User settings**) is where
a person turns it on by choice, prints backup codes and removes a factor.

**The policy.** `companies.require_mfa` is off by default. An owner or admin flips
it under **Settings → Security**; nothing else about the workspace changes.
Switching it on does not sign anyone out: the next request from a member without
an authenticator is answered with `/mfa/setup`, which they can complete. Switching
it off is how a member who lost their phone gets back in.

**The gate.** `lib/mfa.ts` sorts a request into three stages from two facts — does
the account have a confirmed `totp` factor, and what is the session's `aal`:

| stage | when | result |
| --- | --- | --- |
| `ok` | session already `aal2`, or no factor and nothing requires one | carry on |
| `challenge` | a factor exists and this session has not proved it | `/mfa?next=…` |
| `enroll` | the workspace requires a factor and the account has none | `/mfa/setup?next=…` |

That decision is made in the data access layer — `getTenantContext()`,
`getActionContext()` and `getSessionContext()` in `lib/auth.ts` and
`lib/actions/support.ts` — not in `proxy.ts`, which has the cookie and the URL but
not the company row. Every tenant screen resolves its context through
`getTenantContext`, so a new screen cannot forget it, and Server Actions
re-authorize themselves through `getActionContext`. The redirect never answers
`401`/`403`: a page that explains itself beats an error somebody cannot act on.

Signing in also goes through the factor: `signInWithEmail`, `verifyEmailOtp` and
`/auth/callback` all end at `signInLandingPath()`, so a password or a magic link
lands on `/mfa` when the account has an authenticator. A **recovery** link is the
one exception — that person is there because they lost their way in.

**Backup codes** are Supabase's, behind `auth.experimental.recoveryCodes: true` in
`lib/supabase/client.ts` and `lib/supabase/server.ts` (the proxy never calls them,
so it does not set the flag). They are generated once and shown once: GoTrue keeps
hashes, so a lost list means regenerating. Each code works once, case and dashes
are ignored, and codes can never be the only factor — `mfa_recovery_codes_sole_factor`
is why the card only appears after an authenticator is confirmed, and why removing
the last authenticator removes the codes with it.

### What the Supabase dashboard needs

1. **Authentication → Multi-Factor**: TOTP enabled, and **recovery codes**
   enabled. Without the second, every code action answers
   `mfa_recovery_codes_enroll_not_enabled` and the app says so in words instead of
   showing a stack trace.
2. **Authentication → URL Configuration**: the **Site URL** and every redirect
   origin you use (`http://localhost:3000`, the deployment URL). The same rule as
   the other email links — an unlisted `redirect_to` is silently replaced by the
   Site URL.
3. **SMTP** if the project is in production: invitations, recovery and
   confirmations all go through it (see **1. Supabase project** above).
4. Nothing else. There is no `config.toml` in this repository: the project is
   hosted, and these are project settings rather than files.

### Editing it

- One authenticator per account. `startTotpEnrollment` refuses when a confirmed
  one exists, and clears any **unverified** factor first: the friendly name is a
  constant (`TOTP_FACTOR_NAME`), so a half-finished attempt would otherwise block
  the next one with a name conflict.
- Verifying or removing a factor signs out **every other session** and promotes
  the current one to `aal2`; the copy in the sheet says so.
- GoTrue's error codes are mapped to sentences once, in
  `lib/actions/mfa.ts` (`insufficient_aal`, `mfa_verified_factor_exists`,
  `mfa_recovery_codes_enroll_not_enabled`, `mfa_recovery_codes_locked`, …). A
  message that is not in the map is shown as it came, like the account actions.
- Anything that changes factors calls `revalidatePath("/", "layout")`:
  `getCurrentUser()` caches the factor list, and the rail, the sheet and the gate
  all read it from there. The **assurance level** is deliberately not cached —
  it changes with every token refresh and is read live by `enforceMfa`.

### Lost device

In order: a backup code (`/mfa?mode=backup`), then the recovery email at
`/reset-password` — which is exempt from the gate precisely because the factor is
what went missing — and finally an owner or admin turning the workspace
requirement off so the person can sign in and add a new authenticator. Supabase's
dashboard can also remove a factor from a user, which is the last resort for a
sole owner with neither phone nor codes. Lost-device policy is a written decision
on purpose: the app cannot know which of those a given workspace wants.

## Workspace identity

A workspace is drawn as a square in two places — the top of the rail and each row
of `/workspaces` — and both use the same `CompanyMark` component, so they cannot
disagree about what it shows. Three sources, in this order:

1. **Logo** — `companies.logo_url`, uploaded from Settings → Company. The browser
   uploads straight to the public `company-logos` bucket through a signed URL
   (`createLogoUploadUrl`) and `setCompanyLogo` records the result. Objects are
   keyed `<company-id>/<uuid>.<ext>`, the object it replaces is deleted, and 2 MB /
   PNG / JPEG / WebP / AVIF are the limits. The folder check is repeated in the
   action, so a modified client cannot point the column at another workspace's
   file.
2. **Badge** — `companies.badge`: one or two characters, or a single emoji. This
   is the field a workspace that does not want to upload anything uses: `AB`, `A`,
   `🚀`, `🇬🇧`. It is counted in *graphemes* (`Intl.Segmenter`), so a flag or a
   family emoji is one character rather than the seven code points it is made of;
   internal whitespace is refused, because the square would collapse it.
3. **Initials** — `initials(companies.name)`, which is also what an empty badge
   means. A workspace that never opens this screen is therefore never blank.

Two consequences worth knowing:

- **Both `updateCompany` and the logo actions revalidate the root layout**
  (`revalidatePath("/", "layout")`), not the tenant. `/workspaces` lists every
  workspace a person belongs to, so a tenant-scoped invalidation would leave a
  renamed or re-badged company stale on the chooser. The extensions switch stays
  tenant-scoped, because nothing outside the tenant draws it.
- **The logo actions answer instead of redirecting**, like the account ones: they
  are called from a form on a settings page, and a redirect would throw away the
  message. The default currency and the badge are ordinary fields of the
  `updateCompany` form post.

Settings → Company is owner/admin only, which is the same gate the row's policy
already enforced: the update policy on `companies` is `has_company_role(owner,
admin)`, so no new grant was needed for the three columns.

## The products section

`app/[tenant]/products/` is the template's first domain module and the worked
example of a *switchable* section. It is off until an owner or admin turns it on
under **Settings → Extensions**; while it is off its routes `notFound()` and every
policy refuses the rows, so it behaves like a part of the app that does not
exist for that workspace. Switching it back on brings the same rows back —
nothing is deleted, ever.

### What it stores

| Table                | Holds                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `product_categories` | Flat aisles, ordered by `position`, unique per `(company_id, handle)`                                                        |
| `products`           | The sellable rows: price, SKU, supplier, status and stock — **and variants**, which are rows with `parent_id` set            |
| `product_media`      | The gallery: one row per image or video, from the bucket (`storage_path`) or a link elsewhere (`url`), never both            |
| `product_dates`      | Date-based inventory: one row per bookable window with its own stock and optional price override                             |

Three decisions are worth explaining, because they shape everything else:

- **A variant is a row, not a child table.** Price, SKU, stock and gallery then
  work identically whether or not a product has variants, and
  `groupVariants()` in `lib/products.ts` only groups them for display. One level
  is allowed and a trigger enforces it in both directions: a variant cannot have
  variants, and a product with variants cannot become one.
- **Stock is either one number or one row per window.** `products.kind` picks
  the model: `item` counts `inventory_quantity`, `dated` books
  `product_dates`. The product page renders exactly one of the two cards, so the
  two can never disagree about the same product.
- **Money is stored in the currency's minor unit** (`price_cents`), the same
  convention as `lib/plans.ts`, and formatted through `formatPlanPrice` so the
  catalogue and the billing page print prices the same way.
- **The currency defaults, it is not imposed.** `companies.currency` (Settings →
  Company) is only the value the create form pre-selects, and the fallback the
  action uses when a request arrives without the field. Every product keeps its
  own `products.currency`, so changing the workspace default re-prices nothing
  that already exists.

Every child row is keyed on `(company_id, …)` rather than on an id alone:
`foreign key (company_id, product_id) references products (company_id, id)`. A
row therefore cannot point at another tenant's row even if a policy were wrong,
because the key itself refuses it. Deleting a category leaves its products
behind, uncategorised (`on delete set null (category_id)`); deleting a product
cascades to its variants, dates and gallery rows.

### The catalogue index

`/products` is a deck of cards, one per product family, with a filter form above
it. Three decisions keep it from becoming a JavaScript page:

- **The filters are a plain `GET` form.** Status, category and order arrive as
  `?status=`, `?category=` and `?sort=` and are applied in SQL, so a long
  catalogue renders in one request and the page works with no JavaScript. An
  unknown value reads as "no filter" or "default order" rather than as an error
  (`readProductSort` in `lib/products.ts`), so a stale bookmark still renders.
- **Creating one happens in a slideout, not on its own page.** The header button
  is `components/tenant/form-sheet.tsx`, shared with the assets section; the
  fields inside it are the same `ProductFields` the edit card uses, rendered on
  the server and handed in as children. The footer's submit button sits outside
  the `<form>` and reaches it with `form={NEW_PRODUCT_FORM_ID}`, which is why the
  id is a constant in `lib/products.ts` rather than a literal in two files.
- **The cards lead with a picture.** `firstImagePerProduct()` in
  `lib/product-media.ts` reads the gallery once per page for every product on it
  and resolves `url` or the public `storage_path` into a plain URL, falling back
  to the first variant that has one.

A create that fails is redirected back with `?error=`, and to the surface the
form was posted from: a hidden `surface=panel` field sends it to the index, so
the panel reopens with the message instead of closing and landing the author on
a different page. `/products/new` is still there as the full-page form (and the
no-JavaScript path), and it posts `surface=page`.

`/products/categories` is built the same way, so the two screens read alike. The
search box and the order are `?q=` and `?sort=` and are applied in SQL — except
"most products", which needs the per-category counts the page derives, so that
one order is applied once the rows are in. `categorySearchTerm()` in
`lib/products.ts` is what keeps a typed query safe to splice into PostgREST's
`or()` filter. The header button opens the same `FormSheet` around
`CategoryFields`, and the footer submits through `NEW_CATEGORY_FORM_ID`.

One thing differs, because a category has no page of its own: a card *is* its
edit form. `CategoryFields` therefore owns the `<form>` and takes a slot for the
buttons that belong to it, and the card's Delete button posts `deleteCategory`
from inside that form with `formAction` — one row of fields and two buttons,
without nesting a `<form>` inside a `<form>`.

### Who may do what

- **Read**: any accepted member (`member` and up) — the catalogue is shop
  information, not confidential.
- **Write**: owner, admin and manager. `staff` and `member` are read-only here;
  a front-desk tier that may adjust stock is a module decision, and
  `has_company_role` in migration 03 is where it would change.

### Gallery media

Uploads go **from the browser straight to Storage** with a signed upload URL
(`createMediaUploadUrl` → `uploadToSignedUrl` → `recordMediaUpload`). A Server
Action would have to carry the file, and those are capped at 1 MB by default and
at a few megabytes by the platform in front of them — far too small for a phone
video.

- The bucket is `product-media`, public, 50 MB per object, and accepts PNG,
  JPEG, WebP, AVIF, MP4 and WebM. Public because a storefront renders these URLs
  for visitors without a session; a signed *read* URL would expire out from under
  it.
- Objects live at `<company>/<product>/<uuid>.<ext>`. The storage policies read
  the first segment back through `storage_company_id()` and then ask
  `has_company_role` and `has_company_section` — so writes are gated per tenant
  even though reads are not.
- `lib/products.ts` repeats the MIME list and the size ceiling, and
  `tests/db/schema.test.ts` asserts the two against the bucket declaration.

### Reading it from a website

A storefront needs no session and no API route of its own:

- rows: `https://<project>.supabase.co/rest/v1/products?select=*,product_media(*)&company_id=eq.<id>&status=eq.active`
  with the publishable key — RLS still applies, so the query only works for a
  member. For a public catalogue, serve it from a Server Component or route
  handler that uses `createAdminClient()` and filters on `status = 'active'`
  (never add a `to anon` policy: `tests/db/schema.test.ts` fails the build if
  one appears anywhere).
- media: `.../storage/v1/object/public/product-media/<path>`.
- everything else a shop needs that has no column yet: `products.metadata`
  (`jsonb`), which a module can extend without a migration.

## The assets section

`app/[tenant]/assets/` is the second worked module, and deliberately a different
shape from the first: it records *physical* things, it reads one column of another
module, and its day-to-day writer is the front desk rather than a manager.

It switches on the same way — an owner or admin ticks **Assets** under
**Settings → Extensions** — and while it is off its routes `notFound()` and every
policy refuses the rows. Nothing is deleted, ever.

### What it stores

| Table    | Holds                                                                                                       |
| -------- | ----------------------------------------------------------------------------------------------------------- |
| `assets` | One row per physical unit: `name`, `handle`, optional `serial`, a `status`, the product it fulfils, and notes |

Three decisions are worth explaining, because they shape everything else:

- **An asset is a unit, not a quantity.** `bike-1`, `bike-2` and `bike-3` are
  three rows against one sellable product. Taking one out of action removes
  exactly one unit from what the shop can promise, which a stock number cannot
  express.
- **Availability is derived, never copied.** `availabilityLabel()` in
  `lib/assets.ts` counts the rows on every render ("2 of 3 available"), and
  nothing writes a count back onto `products.inventory_quantity` or
  `product_dates.inventory_quantity`. The two cannot drift because there is only
  one truth — a status per unit. `tests/db/schema.test.ts` fails if the assets
  table ever grows a stock column.
- **The module stands alone.** `assets.product_id` is nullable and is *cleared*
  rather than cascaded when a product is deleted (`on delete set null
  (product_id)` on a composite key, so the tenant column survives), and every
  policy asks `has_company_section(company_id, 'assets')` — never the products
  key. A workspace can run a fleet with the catalogue switched off, and switching
  the products section off never takes the units with it.

### Who may do what

- **Read**: any accepted member (`member` and up) — the fleet is shop
  information, like the catalogue. It is never customer-facing: no policy reaches
  `anon` and there is no public surface.
- **Status**: owner, admin, manager and **staff**. `setAssetStatus` sends only the
  `status` field, so the front desk can take a unit out of action without holding
  the manager tier — and without being able to change anything else through that
  action. The policy is row-level, so a staff session could still reach other
  columns over REST; making that impossible needs a separate status-event table,
  which is the service module's job.
- **Everything else**: owner, admin and manager, for adding a unit, editing it and
  deleting it. Retiring is the reversible option and the page says so.

`status_changed_at` (kept by the `assets_stamp_status_change` trigger) and
`metadata` are the seams a future **service** module will use for hours, distance,
repairs and downtime. This section deliberately does not grow a servicing table it
cannot yet describe, and it does not reserve a unit for a date: availability here
is a display concern, not a booking.

A product page shows its units in an **Assets** card when both sections are on;
that card is one-directional — the assets section never renders anything from the
products module on its own pages beyond a link.

## Security

### Authorization is four layers, all server-side

1. **`proxy.ts`** refreshes the Supabase session cookie and redirects anonymous
   requests away from anything but the public pages.
2. **`getTenantContext(slug)`** (`lib/auth.ts`) resolves slug → company and
   asserts a membership. A missing company and a company the caller cannot see
   both produce `notFound()`, so slugs cannot be enumerated.
3. **`getActionContext(slug)`** (`lib/actions/support.ts`) repeats that check
   inside every Server Action. Actions do not render through the cached data
   access layer, so they authorize themselves rather than trusting the page that
   submitted the form.
4. **Postgres RLS** is the authority. Every policy routes through
   `is_company_member` / `has_company_role` / `current_member_role`, which are
   `SECURITY DEFINER` with a pinned `search_path` (without that pin, a caller
   could shadow `company_members` and defeat RLS) and are granted to
   `authenticated` only.

The browser holds the publishable key, so layers 1–3 are conveniences for
honest users and the database is what actually decides. There is no `use cache`
anywhere that holds tenant data; the identity reads use `'use cache: private'`,
which is request-scoped.

### Invariants the database enforces

- **A pending membership grants nothing.** The predicates require
  `accepted_at is not null`, and the only reads of a pending row are
  `my_pending_invitations()` (the caller's own) and the members list an admin
  sees through their accepted membership.
- **Owner and admin rows cannot be created or changed from a client session.**
  The membership policies admit `manager`, `staff` and `member` only.
- **A switched-off section grants nothing.** Every policy in the products module
  also asks `has_company_section(company_id, 'products')`, and every policy in the
  assets module asks the same about `'assets'` — a `SECURITY DEFINER` helper that
  reads `companies.enabled_sections` and is revoked from `anon`. The switch is
  data, not code: flipping it off hides rows and keeps them. The two keys are
  deliberately separate, so switching one section off cannot switch the other off
  with it.
- **A product variant is one level deep.** `products.parent_id` is a
  self-reference, and `products_check_variant_depth()` refuses a variant of a
  variant — and a product that has variants becoming one — in both directions.
- **A child row cannot point outside its tenant.** Every child key is composite
  (`(company_id, product_id)`, `(company_id, category_id)`,
  `(company_id, parent_id)`), so a row can only reference a parent of the same
  company. That holds even if a policy were written wrongly. `assets` uses the
  same shape with `on delete set null (product_id)`: deleting a product unassigns
  its units instead of destroying the record of a physical thing.
- **Money is a non-negative integer in minor units.** `price_cents`,
  `compare_at_price_cents` and `product_dates.price_cents` are `integer` with
  `check (>= 0)`, and `currency` is a three-letter lowercase code.
- **The billing columns belong to the webhook.** `subscription_status`,
  `stripe_customer_id`, `stripe_subscription_id` and `trial_ends_at` are revoked
  from `anon` and `authenticated`, so no client role is granted them, and
  `companies_guard_billing_columns()` refuses a signed-in session that tries to
  move them anyway. `companies_update_admin` is row-level only, so without that
  guard an owner or admin could point their workspace at another customer's id —
  one `openBillingPortal` would then open, and one
  `reconcileCompanySubscription()` would launder into a trusted
  `subscription_status`. The identity columns stay writable, because those are
  the workspace, not the money: `(name, currency, badge, logo_url,
  enabled_sections, require_mfa)`. Onboarding and checkout reach the billing
  columns through the service role instead.
- **A portal session proves the customer is yours.** `openBillingPortal` reads
  the customer from Stripe before it opens a session and refuses one whose
  `metadata.company_id` — or, for a customer created before that stamp existed,
  `metadata.company_slug` — is not this workspace's. Onboarding stamps
  `company_id` on the customer as soon as the company row has an id to carry it.
  `startSubscriptionCheckout` asks the same question through
  `lib/billing/customer.ts`, and differs only in what it does with a row that
  fails it: a checkout bound to a stranger's customer would offer *their* saved
  card, so the id is dropped, a customer of this workspace's own is created, and
  the new id is recorded with the service role. That self-heals a row a session
  repointed before the guard existed. A *read* that fails says nothing about
  ownership, so that case answers with an error instead of creating a second
  customer.
- **A workspace row cannot be created or deleted from a session.**
  `companies` loses `insert, delete` and `profiles` loses `delete` from `anon`
  and `authenticated`. The row that owns a subscription is not something a
  browser may remove — Stripe would keep charging a customer whose workspace no
  longer exists — and a profile is written by the `auth.users` trigger, so a
  client delete would strand every membership at it. Onboarding's insert and its
  rollback both run as the service role.
- **A membership row exposes only `role`.** `company_members` grants
  `update (role)` rather than the table-wide verb, so `user_id` and
  `accepted_at` cannot be rewritten by an owner or admin: accepting an
  invitation is the colleague's own act, and it happens inside
  `respond_to_company_invitation()` / `accept_company_invitations()`.
- **A user's own row exposes the display name and the photo.** `profiles` grants
  `(full_name, avatar_url)` and nothing else, so the address the team roster
  renders cannot be rewritten by the user it belongs to.

### Headers

`next.config.ts` sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy` that
disables the capabilities the app never uses, and
`Cross-Origin-Opener-Policy: same-origin`. HSTS is added in production only: a
browser that receives it over `http://localhost` pins HTTPS for that host and
breaks every other project on the same port.

### Dependency and supply-chain scanning

- `pnpm audit --audit-level high` runs in CI immediately after install, so a
  vulnerable transitive dependency fails the build rather than waiting to be
  noticed.
- `.github/dependabot.yml` opens grouped weekly PRs for npm and GitHub Actions,
  each of which runs the full gate.
- `pnpm.overrides` pins `minimatch` (`>=11.0.1`) for the one path that resolved a
  vulnerable copy. The override is scoped to that parent so ESLint keeps the
  `minimatch` major it was written against.

### What is deliberately not here

- **No Content-Security-Policy.** A useful policy needs a per-request nonce, and
  the pages that matter read the session through `'use cache: private'`. A nonce
  cannot be attached to a response that is cached without either serving the
  same nonce to several requests (which defeats it) or giving up on caching. The
  alternatives — a hash-based policy for a Next.js app with inline bootstrap
  scripts, or `'unsafe-inline'` — are respectively brittle and pointless.
- **No application-level rate limiting.** Sign-in, invitations and checkout rely
  on Supabase's and Stripe's own limits. Putting a limiter in front of them is
  the next step for a deployment that expects abuse; the Server Actions are the
  place to add it, because they are the only mutation surface.

### Known limitations

- **RLS is verified statically.** CI has no Postgres (`ci.yml`), so
  `tests/db/schema.test.ts` asserts the *SQL text*: which helpers a policy calls,
  which columns a key covers, which roles a policy admits. Behavioural tests —
  "can tenant A read tenant B with a real token?" — need a live database and
  belong in a separate job once one is available. The same goes for the
  migrations themselves: they are parsed and applied by hand (`supabase db reset`
  against a scratch project) rather than executed by the suite.
- **Older direct-add memberships are indistinguishable from founding owners.**
  Memberships created before consent existed were written with
  `accepted_at = now()`, so they look accepted. An owner row created by
  `/onboarding` is a legitimate one; anything else is worth a look:

  ```sql
  select c.slug, p.email, m.role, m.created_at
  from public.company_members m
  join public.companies c on c.id = m.company_id
  join public.profiles p on p.id = m.user_id
  where m.role <> 'owner'
    and m.invited_at is null
  order by m.created_at;
  ```

  Rows that should not be there can be removed with `removeMember` (or deleted
  directly); they are not repaired automatically, because guessing which ones
  were solicited is not something a migration can do.
- **Deleting a product leaves its uploaded objects in Storage.** The rows cascade
  (variants, dates, gallery), and removing a single gallery item does delete its
  object, but a product delete can only remove rows through the API — Storage has
  no cascading delete from Postgres. The objects stay reachable by URL until a
  housekeeping job sweeps paths with no `product_media` row. The bucket is public
  by design, so treat "delete the product" as "unlist it", not "erase it".
- **A public bucket is a decision, not an oversight.** Storefronts render these
  URLs without a session, so `product-media` is public and reads are not gated by
  RLS. Writes are. If a deployment needs gated media, make the bucket private and
  hand the storefront a signed read URL from the server — `product_media` already
  stores everything that requires.
- **Two-factor is a product rule, not an authorization boundary.** The gate reads
  the `aal` claim out of the JWT in the cookie, and that claim is decoded locally
  rather than verified. A session that bypasses `/mfa` by hand — a forged cookie,
  a scripted request — is still a session, and RLS is what it then runs into:
  every policy is written against `auth.uid()` and membership, never against the
  assurance level. The alternative, an `aal` check inside every policy, would lock
  a member out of reading even the workspace name they need in order to be told
  they must enrol. What the gate buys is that the ordinary path asks for the
  second factor, every time, before the app is usable.
- **`getOrigin()` validates, it does not allowlist.** The `Host` and
  `X-Forwarded-Host` headers are restricted to `hostname[:port]` characters and
  `X-Forwarded-Proto` to `http`/`https`, so a malformed value can no longer reach
  a Stripe `success_url` or an OAuth `redirectTo`. Behind a proxy that overwrites
  the header (Vercel) that is sufficient. Serving Node directly from the internet
  needs a hostname allowlist on top — the deployment knows its own domains via
  `NEXT_PUBLIC_SITE_URL` and `VERCEL_*`, and this is the point to add it.
- **A lapsed subscription is read-only, not a lockout.** `20260101001100` closes
  content writes for `none`, `canceled`, `unpaid`, `incomplete`,
  `incomplete_expired` and `paused`, and everything that repairs a workspace —
  Settings, billing, the team, the account — stays open. `past_due` keeps
  writing because Stripe can put the subscription back to `active` by itself.
  Three things follow. `none` is read-only because onboarding ends at Stripe
  Checkout, so a workspace cannot reach the app without paying first. The gate
  is enforced in Postgres *and* asked again by
  `requireWritableWorkspace()` — RLS decides, the action explains, because a
  failed `using` on update or delete is otherwise a silent zero rows. And it
  reads the status *stored* on `companies`: reconciliation only runs from the
  dashboard and the billing pages, so a webhook that never arrived can leave a
  workspace writable or read-only until somebody opens one of those pages.
  Nothing here gates *reads*: the catalogue and the fleet stay visible, which is
  why the pages show a banner rather than a redirect.

## Architecture notes

- **`proxy.ts`** replaces `middleware.ts` in Next 16. It refreshes the Supabase
  session and does *optimistic* redirects only; authorization is enforced again
  in `lib/auth.ts` and in Postgres.
- **`lib/auth.ts`** is the data access layer. Its reads use
  `'use cache: private'` because they touch the session cookie, so every caller
  must sit behind a `<Suspense>` boundary. `params`/`searchParams` are Promises;
  pages hand those promises to the boundary's child rather than awaiting them at
  the top level.
- **`app/layout.tsx`** is the only owner of `<html>`/`<body>`. `app/[tenant]/`
  wraps content only.
- **`app/globals.css`** owns the font stack. `--font-sans` and `--font-mono`
  splice next/font's generated families in front of Tailwind's generics, and
  `option` is given the stack by name. A `<select>`'s option list is drawn by the
  browser in a popup outside the page's inheritance chain, so a family list that
  ends at two `@font-face` names has nowhere to fall back to and the popup picks
  the browser default — a serif on Windows. Everything else inherits, which is why
  no individual control carries `font-sans`.
- **`lib/roles.ts`** holds `ROLE_LABELS`, the assignable role list and the
  `canAdminister`/`canManage`/`canFrontDesk` predicates. It is framework-free so
  the sidebar, pages and Server Actions share one hierarchy; Postgres RLS is the
  final authority, not these helpers.
- **`lib/features.ts`** is the section registry: `SECTION_KEYS`, the labels and
  paths the rail and Settings render, and `isSectionEnabled`. The stored switch is
  `companies.enabled_sections` (`text[]`), which an owner or admin edits on
  Settings → Extensions. The database repeats that check in
  `has_company_section()`, so the helper decides what the UI *offers* and RLS
  decides what is *reachable*. Adding a section is one entry here plus its routes
  and policies; nothing else enumerates sections. Tier gating, when it comes,
  belongs in `isSectionEnabled` **and** in `has_company_section`, never in the UI
  alone.
- **`lib/products.ts`** holds the catalogue rules the forms, actions and tests
  share — handle validation, money parsing and formatting, stock labels, variant
  grouping, date windows and the media MIME list. It is client-safe because the
  gallery uploader is a Client Component. `productHandleProblem` wraps
  `categoryHandleProblem` and adds the section's own route words (`new`,
  `categories`) to the reserved list, so a product can never sit on a page URL.
- **`lib/assets.ts`** holds the fleet rules the forms, actions and tests share —
  handle/name/serial limits that mirror the column checks, the status ladder, and
  the derived availability helpers (`summariseAssets`, `availabilityLabel`,
  `assetsForProduct`, `assetsByProduct`). Client-safe for the same reason as
  `lib/products.ts`. It does not import from the products module: the only link
  between the two is the `product_id` column and a route.
- **`lib/supabase/admin.ts`** is the only place the secret key is used. It is
  `server-only` and bypasses RLS, so it is reserved for provisioning a company,
  inviting a user (`inviteUserByEmail`), and reconciling Stripe webhooks. Key resolution lives in `lib/supabase/env.ts`
  (publishable, browser-safe) and `lib/supabase/env.server.ts` (secret); both
  reject a key pasted into the wrong variable, so a `sb_secret_…` value cannot
  reach the browser bundle.
- **`lib/subscriptions.ts`** reads the plan catalogue from Stripe rather than a
  configured price id, so a new plan is a Dashboard change. Pages call
  `listSubscriptionPlans()`, which is `'use cache: private'` — a plain
  `'use cache'` would run `prices.list` during `next build`, where there are no
  keys. Server Actions call the uncached `fetchSubscriptionPlans()` instead, so a
  price that was just archived cannot be bought.
- **`lib/billing/sync.ts`** is the only writer of `companies.subscription_*`.
  `syncSubscription` applies a webhook event; `reconcileCompanySubscription`
  re-reads Stripe from the pages that display the subscription. Both share
  `toSubscriptionPatch`, so the two paths cannot disagree about what a
  subscription means.
- **`lib/billing/entitlements.ts`** answers a third billing question, and it is
  neither of the other two: `hasLiveSubscription()` asks whether Stripe still
  holds a subscription the portal can repair, `isSectionEnabled()` asks whether
  the workspace bought an extension, and `isWorkspaceWritable()` asks whether it
  may change what it stores *right now*. The answer is
  `WRITABLE_STATUSES` — `active`, `trialing`, `past_due` — and the
  complement is read-only. `tests/db/schema.test.ts` reads the SQL and fails if
  the two lists drift, so the page banner, the action gate and the restrictive
  policies cannot disagree. `READ_ONLY_MESSAGE` lives here as well: the Server
  Action's error and `components/billing/read-only-notice.tsx` use the same
  sentence, because a reader should not meet two phrasings of one rule.
- **Tenancy and invitation helpers** (`is_company_member`, `has_company_role`,
  `current_member_role`, `shares_company_with`, `accept_company_invitations`,
  `my_pending_invitations`, `respond_to_company_invitation`)
  are `SECURITY DEFINER` with a pinned `search_path`, so a policy on
  `company_members` can consult `company_members` without recursing into its own
  table. Supabase grants `EXECUTE` on new `public` functions to `anon` through
  `alter default privileges`, so `revoke ... from public` alone leaves `anon`
  with access; that is why each migration that adds a helper revokes from `anon`
  explicitly. A new helper needs `grant execute ... to authenticated` only.
- **Invitation state lives on `company_members`**, not on the auth user: one
  person can be pending in one workspace and registered in another. A pending row
  is invisible to the membership predicates, so it grants nothing until it is
  accepted — either by opening the invitation email (`type=invite`) or through
  `respond_to_company_invitation()`. `accept_company_invitations()` only updates
  rows for `auth.uid()` whose `accepted_at` is still null, and the callback
  treats a failure there as non-fatal because the sign-in already succeeded.

## Layout

```
app/
  layout.tsx                     # <html>/<body>, fonts, ThemeProvider
  page.tsx                       # marketing
  login/ signup/                 # sign-in / sign-up (password, magic link, Google)
  reset-password/                # new password after a recovery link
  onboarding/                    # create company + start Stripe Checkout
  workspaces/                    # workspace picker + pending invitations
  mfa/                           # second factor: the code, or a backup code
  mfa/setup/                     # create the factor (forced by policy, or by choice)
  auth/callback/route.ts         # OAuth code exchange + email token verification
  api/stripe/webhook/route.ts    # subscription sync
  [tenant]/
    layout.tsx                   # icon rail shell + account menu
    page.tsx                     # redirects to the dashboard
    dashboard/                   # the workspace overview
    products/                    # catalogue deck, filters and the create panel
    products/new/                # the full-page create form (no-JS fallback)
    products/[handle]/           # details, stock, dates, variants, gallery
    products/categories/         # aisles: search, sorted deck of edit cards
    assets/                      # fleet deck, filters and the create panel
    assets/[handle]/             # status, product assignment, removal
    fields.ts                    # shared class strings for native form controls
    settings/                    # gear: company details (the index tab)
    settings/extensions/         # which optional parts of the app are switched on
    settings/security/           # the workspace's two-factor requirement
    settings/team/               # invitations and roles
    settings/billing/            # plan, portal, invoices
components/
  tenant/{sidebar-nav,tenant-sidebar,user-menu,page-header}.tsx
  tenant/tab-nav.tsx             # the settings tab strip: links, not local state
  tenant/settings-link.tsx       # the gear, drawn for owner and admin only
  tenant/user-settings-sheet.tsx # photo, name, password and two-factor, from the avatar menu
  tenant/two-factor-section.tsx  # the authenticator and backup-code cards in that sheet
  mfa/totp-enrollment.tsx        # QR, setup key and the code that proves it works
  mfa/totp-challenge.tsx         # the six-digit form on /mfa
  mfa/recovery-code-challenge.tsx # …and the backup-code one
  tenant/avatar-uploader.tsx     # signed upload straight to the avatars bucket
  tenant/company-mark.tsx        # logo → badge → initials, in the rail and the chooser
  tenant/company-logo-uploader.tsx # signed upload to the company-logos bucket
  tenant/form-sheet.tsx          # the shared "new …" slideout
  billing/read-only-notice.tsx   # the banner a lapsed workspace sees on content pages
lib/
  auth.ts                        # session + tenancy data access layer
  account.ts                     # name, password and avatar rules (client-safe)
  mfa.ts                         # two-factor stages, codes and display (client-safe)
  mfa-server.ts                  # the gate: assurance level, redirects, landing path
  password.ts                    # has_password(), with the provider list as fallback
  company.ts                     # badge, mark and logo rules (client-safe)
  uploads.ts                     # image types, path checks, public URL parsing
  settings.ts                    # settings tabs: labels and paths (client-safe)
  features.ts                    # optional-section registry + switch (client-safe)
  assets.ts                      # fleet rules + derived availability (client-safe)
  products.ts                    # catalogue rules, money, stock and media (client-safe)
  product-media.ts               # first image per product, one query per page
  roles.ts                       # labels + authorization predicates (client-safe)
  safe-redirect.ts               # post-login `next` validation (client-safe)
  billing/{checkout,customer,entitlements,sync}.ts # Checkout payloads, customer ownership, write gate, reconciliation
  plans.ts                       # plan shape, filters and formatting (client-safe)
  slug.ts                        # shared reserved segments and slug rules
  site.ts                        # request origin (validated Host + configured URL)
  subscriptions.ts               # plan catalogue, read from Stripe
  supabase/{client,server,admin,proxy,env,env.server}.ts
  actions/{account,auth,billing,company,members,mfa,products,settings,support}.ts
  actions/assets.ts              # asset writes, with the front-desk status gate
supabase/migrations/             # schema + RLS (nine files)
tests/                           # unit, actions, api, integration, db
scripts/                         # operator tools, read-only (Stripe customer audit)
```

## Adding a new section

The products module is the worked example, so copy it when you add the next one —
and read the assets module too, if your section has to point at another module's
rows or needs a role tier the products section does not use. Say the new section is
called `orders`. Six steps, in this order — each step ends with something
runnable:

1. **Schema** — `supabase/migrations/<timestamp>_orders.sql`. Copy the shape of
   `company_members`:

   ```sql
   create table if not exists public.orders (
     id uuid primary key default gen_random_uuid(),
     company_id uuid not null references public.companies (id) on delete cascade,
     ...
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now()
   );

   alter table public.orders enable row level security;

   -- Read: every accepted member. Write: the roles this section is for.
   create policy "orders_select_member"
     on public.orders for select to authenticated
     using (public.is_company_member(company_id));

   create policy "orders_insert_manager"
     on public.orders for insert to authenticated
     with check (public.has_company_role(
       company_id, array['owner', 'admin', 'manager']::public.member_role[]
     ));
   ```

   Three rules that are not optional:
   - Lead with `company_id` and cascade from `companies`, so deleting a tenant
     takes its data with it.
   - Enable RLS and add a policy per verb. A table with RLS and no policy is
     invisible to the client, which is the safe default but looks like a bug.
   - Route the policy through `is_company_member`/`has_company_role` rather than
     re-deriving membership: those helpers are the ones that ignore pending
     invitations.

   A fourth rule applies if the section is optional: add
   `public.has_company_section(company_id, 'orders')` to **every** policy as
   well. Migration 03 does this throughout, and the switch then hides rows
   instead of deleting them. `tests/db/schema.test.ts` fails if any policy in a
   module migration forgets it.

   A fifth rule applies if the section stores what a subscription pays for, as
   the catalogue and the fleet do: the table belongs in
   `20260101001100_subscription_write_gate.sql` too, with a *restrictive*
   `insert`, `update` and `delete` policy calling
   `public.has_active_subscription(company_id)`, and the section's write actions
   call `requireWritableWorkspace()`. That migration names its tables explicitly
   and `tests/db/schema.test.ts` checks that list, so a new module has to add
   itself — the point of the explicit list is that nobody's data goes read-only
   because a migration guessed. Leave reads and the carve-outs (`companies`,
   `profiles`, `company_members`, the avatar and logo buckets) alone.

   If one of your tables references another, key the reference on the tenant as
   well — `foreign key (company_id, customer_id) references ... (company_id, id)`
   — or a member of one company can point a row at another company's row.
   A policy only checks the row being written. Then decide what happens when the
   parent goes away: `assets` uses `on delete set null (product_id)` so a physical
   unit survives its catalogue row, and the section keeps working with the other
   module switched off.

2. **Types** — add the table to `lib/supabase/types.ts` (`Row`, `Insert`,
   `Update`, `Relationships: []`) and to `MODULE_TABLES` in
   `tests/db/schema.test.ts` — a module's tables go there, `CORE_TABLES` is what
   every deployment ships. Both arrays are `satisfies readonly TableName[]`, so
   the compiler tells you if the two disagree. The assets module keeps its own
   `ASSET_TABLES` and spreads it into `MODULE_TABLES`, so each migration can be
   asserted against its own file.

3. **Action** — `lib/actions/orders.ts`:

   ```ts
   "use server";

   import {
     getActionContext, readField, redirectWith, requireManager, requireSection,
   } from "@/lib/actions/support";

   export async function createOrder(formData: FormData) {
     const slug = readField(formData, "slug");
     const context = await getActionContext(slug);
     requireManager(context, slug); // the UI gate, repeated server-side
     requireSection(context, slug, "orders"); // and the section switch

     const { error } = await context.supabase.from("orders").insert({
       company_id: context.company.id,
       ...
     });

     if (error) redirectWith(slug, "orders", { error: error.message });

     redirectWith(slug, "orders", { ok: "Order created." });
   }
   ```

   `getActionContext` resolves the slug and asserts the membership; it is the
   same check the page makes, on purpose. Actions never trust the page that
   submitted the form.

4. **Page** — `app/[tenant]/orders/page.tsx`. Copy `settings/page.tsx`: call
   `requireSettingsAccess(tenant)` (its preamble: `await connection()`,
   `getTenantContext(tenant)`, a role gate), then query through `createClient()`.
   Wrap the authenticated subtree in `<Suspense>` because `getTenantContext`
   reads cookies. Read `PageProps<"/[tenant]/orders">` — the route types are
   generated, so the string is checked.

5. **Navigation and the switch** — add the key to `SECTION_KEYS` in
   `lib/features.ts` with a label, a path and a one-line description, then add an
   icon to `NAV_ICONS` in `components/tenant/sidebar-nav.tsx`. The rail itself is
   assembled in `components/tenant/tenant-sidebar.tsx`, which turns the enabled
   sections into `NavItem`s — that is also where a screen that hangs off a
   section (rather than being one) gets its entry, as Categories does next to
   Products. The Settings → Extensions checklist, the redirect target and the
   active state all follow from those lists. Gate the page with
   `isSectionEnabled(company, "orders")` and `notFound()` when it is off, exactly
   as `app/[tenant]/products/page.tsx` does.

6. **Tests** — `tests/unit/orders.test.ts` for the pure rules,
   `tests/actions/orders.test.ts` (mock `@/lib/supabase/server` with
   `tests/helpers/supabase.ts`; pass `{ sections: ["orders"] }` to `tenantSetup`)
   and a `describe` in `tests/db/schema.test.ts` that pins the policies you wrote.
   Run `pnpm verify`.


