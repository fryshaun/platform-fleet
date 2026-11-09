# Platform

A multi-tenant **base template** on Next.js 16 and Supabase: sign-in, per-workspace
membership and roles, RLS-scoped data and Stripe billing, plus one worked domain
module — an optional **products** section with categories, variants, stock,
date-based inventory and a media gallery. Switch it off and you are back to the
bare base; copy it for the next section (see
[Adding a new section](#adding-a-new-section)) and delete nothing.

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
   path allow-listed. Under **Authentication → Emails**:

   - *Confirm signup* / *Magic Link*: use
     `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup`
     (`type=magiclink` for the magic-link template) instead of the default
     `{{ .ConfirmationURL }}`. The `token_hash` form works in any browser, while
     the implicit-flow default only works in the browser that requested the link.
   - Add `{origin}/auth/callback` to **URL Configuration → Redirect URLs**
     (`http://localhost:3000/**` for development). A target that is not listed
     makes GoTrue fall back to the bare Site URL, and the code lands on `/` —
     `proxy.ts` forwards those to `/auth/callback`, so the flow still completes.
   - *Invite user*: use
     `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite`
     so a teammate can accept the invitation in any browser. That `type=invite`
     is what makes the callback activate the pending membership.
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

   A feature module adds its own numbered migration; it never edits the ones
   before it.

3. Copy the project URL, publishable key and secret key into `.env.local`. The
   keys are on **Project Settings → API Keys**: `sb_publishable_…` goes in
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `sb_secret_…` in `SUPABASE_SECRET_KEY`.
   The retired `anon` and `service_role` keys are still read as a fallback so an
   existing environment keeps working until it is rotated; using one logs a
   deprecation warning, and Supabase stops accepting them in 2027.

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
| Pure helpers    | `tests/unit/`                                                                  | slug generation against the `companies.slug` CHECK regex, query-param and class-name helpers, post-login redirect validation, the five-role hierarchy and assignable-role rules, plan filtering/formatting and `/100` price parity with the rest of the app, the section registry and its switch, product handles/money/stock/variant grouping/date windows/media limits |
| Config guards   | `tests/unit/{stripe,site,supabase-env,security-headers}.test.ts`                | lazy Stripe client, origin resolution behind proxy headers (including malformed `Host`/`X-Forwarded-Proto`), named missing-env errors, the response header set and its production-only HSTS |
| Route handlers  | `tests/api/`                                                                   | Stripe webhook signature/secret checks, every status → enum mapping, idempotent replay, 5xx retry semantics, unmatched subscriptions, OAuth code exchange, email `token_hash` verification, open-redirect guards, invitation acceptance only for `type=invite` |
| Server Actions  | `tests/actions/`                                                               | tenant resolution, role gates, pending invitation creation (and identical wording for both paths), accepting/declining an invitation, validation messages, plan validation against Stripe, Postgres error codes (`23503`, `23505`), checkout rollback, product/category/variant/stock/date writes scoped by tenant, the section switch, gallery upload targets and path checks |
| Routing         | `tests/integration/`                                                           | which paths require auth, cookie preservation across redirects, matcher exclusions            |
| Schema          | `tests/db/schema.test.ts`                                                      | RLS enabled on every table, slug regex parity with the client, `anon` grant revocation, invitation columns/policies, accepted-only membership predicates, enum parity, the section predicate in every products policy, tenant-keyed foreign keys, the single-level variant trigger and the bucket limits |

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
   `/onboarding`. Google and the magic-link form land on the same callback.
2. `/onboarding` lists the plans Stripe sells, then names the company, reserves
   `companies.slug`, inserts the caller as `owner`, and redirects to Stripe
   Checkout for the plan they picked.
3. `/api/stripe/webhook` writes the subscription state back onto the company.
   That delivery is the fast path, not the only one: `lib/billing/sync.ts` also
   re-reads the subscription from Stripe on the billing page and on a dashboard
   visit whose stored status has not settled, so a missed webhook cannot leave a
   paying company looking unpaid.
4. `/{slug}/dashboard` is the workspace. The rail carries the dashboard plus the
   optional sections the workspace has switched on; **Products** is off until an
   owner or admin enables it on `/{slug}/settings` → Sections. Settings and
   billing live in the account menu at the foot of the rail, and both are
   owner/admin-only — a manager or viewer sees neither.

## Team roles and invitations

`member` predates the team model and is labelled **Viewer**. It is not migrated
to another role: existing members become read-only, while managers and staff are
invited explicitly.

| Task                                | Owner | Admin | Manager | Staff | Viewer |
| ----------------------------------- | :---: | :---: | :-----: | :---: | :----: |
| Read every workspace page           |  yes  |  yes  |   yes   |  yes  |  yes   |
| Write in the products section       |  yes  |  yes  |   yes   |   —   |   —    |
| Switch sections on and off          |  yes  |  yes  |    —    |   —   |   —    |
| Billing and company details         |  yes  |  yes  |    —    |   —   |   —    |
| Invite, re-role and remove the team |  yes  |  yes  |    —    |   —   |   —    |

`manager` is the write tier the products section uses; `staff` reads it and can
be given front-line writes by a module that knows what those are. Gate the UI with
`canManage`/`canFrontDesk` and mirror the same role lists in the RLS policy — the
two are cheap to keep in step and expensive to drift.

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

## The products section

`app/[tenant]/products/` is the template's first domain module and the worked
example of a *switchable* section. It is off until an owner or admin turns it on
under **Settings → Sections**; while it is off its routes `notFound()` and every
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

Every child row is keyed on `(company_id, …)` rather than on an id alone:
`foreign key (company_id, product_id) references products (company_id, id)`. A
row therefore cannot point at another tenant's row even if a policy were wrong,
because the key itself refuses it. Deleting a category leaves its products
behind, uncategorised (`on delete set null (category_id)`); deleting a product
cascades to its variants, dates and gallery rows.

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
  also asks `has_company_section(company_id, 'products')`, a `SECURITY DEFINER`
  helper that reads `companies.enabled_sections` and is revoked from `anon`. The
  switch is data, not code: flipping it off hides rows and keeps them.
- **A product variant is one level deep.** `products.parent_id` is a
  self-reference, and `products_check_variant_depth()` refuses a variant of a
  variant — and a product that has variants becoming one — in both directions.
- **A child row cannot point outside its tenant.** Every child key is composite
  (`(company_id, product_id)`, `(company_id, category_id)`,
  `(company_id, parent_id)`), so a row can only reference a parent of the same
  company. That holds even if a policy were written wrongly.
- **Money is a non-negative integer in minor units.** `price_cents`,
  `compare_at_price_cents` and `product_dates.price_cents` are `integer` with
  `check (>= 0)`, and `currency` is a three-letter lowercase code.

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
- **`getOrigin()` validates, it does not allowlist.** The `Host` and
  `X-Forwarded-Host` headers are restricted to `hostname[:port]` characters and
  `X-Forwarded-Proto` to `http`/`https`, so a malformed value can no longer reach
  a Stripe `success_url` or an OAuth `redirectTo`. Behind a proxy that overwrites
  the header (Vercel) that is sufficient. Serving Node directly from the internet
  needs a hostname allowlist on top — the deployment knows its own domains via
  `NEXT_PUBLIC_SITE_URL` and `VERCEL_*`, and this is the point to add it.

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
- **`lib/roles.ts`** holds `ROLE_LABELS`, the assignable role list and the
  `canAdminister`/`canManage`/`canFrontDesk` predicates. It is framework-free so
  the sidebar, pages and Server Actions share one hierarchy; Postgres RLS is the
  final authority, not these helpers.
- **`lib/features.ts`** is the section registry: `SECTION_KEYS`, the labels and
  paths the rail and Settings render, and `isSectionEnabled`. The stored switch is
  `companies.enabled_sections` (`text[]`), which an owner or admin edits on
  Settings → Sections. The database repeats that check in
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
  onboarding/                    # create company + start Stripe Checkout
  workspaces/                    # workspace picker + pending invitations
  auth/callback/route.ts         # OAuth code exchange + email token verification
  api/stripe/webhook/route.ts    # subscription sync
  [tenant]/
    layout.tsx                   # icon rail shell + account menu
    page.tsx                     # redirects to the dashboard
    dashboard/                   # the workspace overview
    products/                    # products section (categories, variants, stock, gallery)
    products/new/                # create a product
    products/[handle]/           # details, stock, dates, variants, gallery
    products/categories/         # aisle management
    settings/                    # company + sections + team cards
    settings/billing/            # plan, portal, invoices
components/
  tenant/{sidebar-nav,tenant-sidebar,user-menu,page-header}.tsx
lib/
  auth.ts                        # session + tenancy data access layer
  features.ts                    # optional-section registry + switch (client-safe)
  products.ts                    # catalogue rules, money, stock and media (client-safe)
  roles.ts                       # labels + authorization predicates (client-safe)
  safe-redirect.ts               # post-login `next` validation (client-safe)
  billing/{checkout,sync}.ts     # Checkout payloads + subscription reconciliation
  plans.ts                       # plan shape, filters and formatting (client-safe)
  slug.ts                        # shared reserved segments and slug rules
  site.ts                        # request origin (validated Host + configured URL)
  subscriptions.ts               # plan catalogue, read from Stripe
  supabase/{client,server,admin,proxy,env,env.server}.ts
  actions/{auth,billing,company,members,products,settings,support}.ts
supabase/migrations/             # schema + RLS (three files)
tests/                           # unit, actions, api, integration, db
```

## Adding a new section

The products module is the worked example, so copy it when you add the next one.
Say the new section is called `orders`. Six steps, in this order — each step ends
with something runnable:

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

   If one of your tables references another, key the reference on the tenant as
   well — `foreign key (company_id, customer_id) references ... (company_id, id)`
   — or a member of one company can point a row at another company's row.
   A policy only checks the row being written.

2. **Types** — add the table to `lib/supabase/types.ts` (`Row`, `Insert`,
   `Update`, `Relationships: []`) and to `MODULE_TABLES` in
   `tests/db/schema.test.ts` — a module's tables go there, `CORE_TABLES` is what
   every deployment ships. Both arrays are `satisfies readonly TableName[]`, so
   the compiler tells you if the two disagree.

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

4. **Page** — `app/[tenant]/orders/page.tsx`. Copy `settings/page.tsx`: `await
   connection()`, `getTenantContext(tenant)`, a role gate, then query through
   `createClient()`. Wrap the authenticated subtree in `<Suspense>` because
   `getTenantContext` reads cookies. Read `PageProps<"/[tenant]/orders">` — the
   route types are generated, so the string is checked.

5. **Navigation and the switch** — add the key to `SECTION_KEYS` in
   `lib/features.ts` with a label, a path and a one-line description, then add an
   icon to `SECTION_ICONS` in `components/tenant/sidebar-nav.tsx`. The rail, the
   Settings → Sections checklist, the redirect target and the active state all
   follow from those two lists. Gate the page with
   `isSectionEnabled(company, "orders")` and `notFound()` when it is off, exactly
   as `app/[tenant]/products/page.tsx` does.

6. **Tests** — `tests/unit/orders.test.ts` for the pure rules,
   `tests/actions/orders.test.ts` (mock `@/lib/supabase/server` with
   `tests/helpers/supabase.ts`; pass `{ sections: ["orders"] }` to `tenantSetup`)
   and a `describe` in `tests/db/schema.test.ts` that pins the policies you wrote.
   Run `pnpm verify`.


