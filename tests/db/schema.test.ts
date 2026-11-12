import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type {
  AssetStatus,
  BookingChannel,
  BookingStatus,
  Database,
  MemberRole,
  ProductKind,
  ProductMediaKind,
  ProductStatus,
  SubscriptionStatus,
} from "@/lib/supabase/types";

import { WRITABLE_STATUSES } from "@/lib/billing/entitlements";
import { ASSET_STATUSES } from "@/lib/assets";
import { BLOCKING_BOOKING_STATUSES } from "@/lib/bookings";

/**
 * Static guards over the SQL migrations.
 *
 * These run without a database, so they belong in CI: they catch the case where
 * the client types or the application-level rules drift away from the schema
 * that will actually be applied. Behavioural RLS checks live elsewhere (they
 * need a live Postgres).
 */

const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../supabase/migrations/", import.meta.url),
);

const MIGRATION_FILES = [
  "20260101000000_accounts_and_companies.sql",
  "20260101000100_team_invitations.sql",
  "20260101000200_products.sql",
  "20260101000300_assets.sql",
  "20260101000400_account_avatars.sql",
  "20260101000500_company_identity.sql",
  "20260101000900_two_factor.sql",
  "20260101001000_company_billing_guard.sql",
  "20260101001100_subscription_write_gate.sql",
  "20260101001200_renters.sql",
  "20260101001300_bookings.sql",
  "20260101001400_bookings_write_gate.sql",
  "20260101001500_catalog_addons.sql",
  "20260101001600_addons_write_gate.sql",
  "20260101001700_addon_stock.sql",
  "20260101001800_asset_components.sql",
  "20260101001900_components_write_gate.sql",
  "20260101002000_component_bookings.sql",
  "20260101002100_asset_usage_logs.sql",
  "20260101002200_component_service.sql",
  "20260101002300_usage_write_gate.sql",
  "20260101002400_asset_status_workshop.sql",
  "20260101002500_asset_status_rented.sql",
] as const;

function readMigration(name: string): string {
  return readFileSync(`${MIGRATIONS_DIR}${name}`, "utf8");
}

const accountsSql = readMigration("20260101000000_accounts_and_companies.sql");
const invitationSql = readMigration("20260101000100_team_invitations.sql");
const productsSql = readMigration("20260101000200_products.sql");
const assetsSql = readMigration("20260101000300_assets.sql");
const avatarsSql = readMigration("20260101000400_account_avatars.sql");
const identitySql = readMigration("20260101000500_company_identity.sql");
const twoFactorSql = readMigration("20260101000900_two_factor.sql");
const billingGuardSql = readMigration(
  "20260101001000_company_billing_guard.sql",
);
const subscriptionGateSql = readMigration(
  "20260101001100_subscription_write_gate.sql",
);
const rentersSql = readMigration("20260101001200_renters.sql");
const bookingsSql = readMigration("20260101001300_bookings.sql");
const bookingsGateSql = readMigration("20260101001400_bookings_write_gate.sql");
const addonsSql = readMigration("20260101001500_catalog_addons.sql");
const addonsGateSql = readMigration("20260101001600_addons_write_gate.sql");
const addonStockSql = readMigration("20260101001700_addon_stock.sql");
const componentsSql = readMigration("20260101001800_asset_components.sql");
const componentsGateSql = readMigration(
  "20260101001900_components_write_gate.sql",
);
const componentBookingsSql = readMigration(
  "20260101002000_component_bookings.sql",
);
const usageSql = readMigration("20260101002100_asset_usage_logs.sql");
const serviceSql = readMigration("20260101002200_component_service.sql");
const usageGateSql = readMigration("20260101002300_usage_write_gate.sql");
const assetStatusSql = readMigration("20260101002400_asset_status_workshop.sql");
const rentedSql = readMigration("20260101002500_asset_status_rented.sql");

/**
 * The write gate is more than one file: a policy cannot name a table that does
 * not exist yet, so migrations 14, 16 and 19 state the same rule for the tables
 * migrations 13, 15 and 18 add. The policy names are unique across them, which
 * is what lets the gate assertions below read one string.
 */
const allGateSql = [
  subscriptionGateSql,
  bookingsGateSql,
  addonsGateSql,
  componentsGateSql,
  usageGateSql,
].join("\n");

const allSql = [
  accountsSql,
  invitationSql,
  productsSql,
  assetsSql,
  avatarsSql,
  identitySql,
  twoFactorSql,
  billingGuardSql,
  subscriptionGateSql,
  rentersSql,
  bookingsSql,
  bookingsGateSql,
  addonsSql,
  addonsGateSql,
  addonStockSql,
  componentsSql,
  componentsGateSql,
  componentBookingsSql,
  usageSql,
  serviceSql,
  usageGateSql,
  assetStatusSql,
  rentedSql,
].join("\n");

type PublicSchema = Database["public"];
type TableName = keyof PublicSchema["Tables"];

/**
 * The tables every deployment has: accounts, tenancy and billing state.
 */
const CORE_TABLES = [
  "profiles",
  "companies",
  "company_members",
] as const satisfies readonly TableName[];

/**
 * Tables the optional modules add. They are listed separately because the
 * distinction is the point: `CORE_TABLES` is what this template ships for
 * everybody, and a module's tables arrive with the module.
 *
 * The two module groups are kept apart so each migration can be asserted on its
 * own — a table may only be created by the migration that owns it.
 */
const PRODUCT_TABLES = [
  "product_categories",
  "products",
  "product_media",
  "product_dates",
] as const satisfies readonly TableName[];

/** Tables the second module adds. A workspace that never switches the assets
 * section on never reads a row of it. */
const ASSET_TABLES = ["assets"] as const satisfies readonly TableName[];

/**
 * The fleet's internals (migration 18): the taxonomy and the parts. They belong
 * to the assets section, and their policies ask about `assets` — not `products`,
 * which is the guess the new names invite.
 */
const COMPONENT_TABLES = [
  "component_kinds",
  "asset_components",
  "asset_usage_logs",
  "component_service_events",
] as const satisfies readonly TableName[];

/** The renters module: the people a booking is for, not the staff who take it. */
const RENTER_TABLES = [
  "customers",
  "rider_preferences",
] as const satisfies readonly TableName[];

/** The booking book itself. */
const BOOKING_TABLES = [
  "bookings",
  "booking_line_items",
] as const satisfies readonly TableName[];

/**
 * The extras (migration 15). Listed apart from the booking book because they are
 * a catalogue of their own — and because their policies ask about the *bookings*
 * section, which is the detail a reader would otherwise guess wrong.
 */
const ADDON_TABLES = [
  "addons",
  "addon_products",
  "booking_line_addons",
] as const satisfies readonly TableName[];

const MODULE_TABLES = [
  ...PRODUCT_TABLES,
  ...ASSET_TABLES,
  ...COMPONENT_TABLES,
  ...RENTER_TABLES,
  ...BOOKING_TABLES,
  ...ADDON_TABLES,
] as const;

/**
 * Every table the application expects to exist.
 *
 * The `satisfies` clauses make a typo a compile error, and `_TablesCovered`
 * makes an omission a compile error too: if a table is added to
 * `lib/supabase/types.ts` and not listed here, that alias resolves to `never`
 * and `pnpm typecheck` fails.
 */
const TABLES = [...CORE_TABLES, ...MODULE_TABLES] as const;

export type _TablesCovered = Exclude<
  TableName,
  (typeof TABLES)[number]
> extends never
  ? true
  : never;

describe("type definitions", () => {
  it("describes the three core tables", () => {
    expect(CORE_TABLES).toHaveLength(3);
  });

  it("declares every table in a migration", () => {
    for (const table of TABLES) {
      expect(
        allSql.includes(`create table if not exists public.${table} (`),
        `${table} is missing from the migrations`,
      ).toBe(true);
    }
  });

  it("creates exactly the tables the types declare", () => {
    // Nothing may exist in Postgres that `lib/supabase/types.ts` does not
    // describe, and nothing may be described that the migrations do not create.
    const created = [
      ...allSql.matchAll(/create table if not exists public\.([a-z_]+) \(/g),
    ].map((match) => match[1]);

    expect(new Set(created)).toEqual(new Set(TABLES));
  });
});

describe("row level security", () => {
  it("enables RLS on every table", () => {
    for (const table of TABLES) {
      expect(allSql).toContain(
        `alter table public.${table} enable row level security;`,
      );
    }
  });

  it("never opens an anonymous policy", () => {
    // Nothing in the template is meant to be world-readable; a feature module
    // that needs a public surface serves it with the service role.
    expect(allSql).not.toMatch(/create policy[\s\S]{0,200}?\bto anon\b/);
  });

  it("scopes membership reads to the caller's company", () => {
    expect(accountsSql).toContain("public.is_company_member(company_id)");
    expect(accountsSql).toContain("public.has_company_role(company_id");
  });

  it("keeps profile rows private except to colleagues", () => {
    expect(accountsSql).toContain('create policy "profiles_select_own"');
    expect(invitationSql).toContain('create policy "profiles_select_colleague"');
  });
});

describe("company slug rule", () => {
  it("matches the pattern the client validates against", () => {
    // Mirrors `SLUG_PATTERN` in lib/slug.ts. `tests/unit/slug.test.ts` pins the
    // client side; this pins the column that has the final say.
    const pattern = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/;
    expect(accountsSql).toContain(`slug ~ '${pattern.source}'`);
  });

  it("keeps slugs unique and non-null", () => {
    expect(accountsSql).toMatch(/slug text not null unique check/);
  });

  it("bounds the company name the same way the form does", () => {
    expect(accountsSql).toMatch(
      /name text not null check \(length\(trim\(name\)\) between 1 and 120\)/,
    );
  });
});

describe("tenant invariants", () => {
  it("allows exactly one owner per company", () => {
    expect(accountsSql).toContain(
      "create unique index if not exists company_members_single_owner_idx",
    );
    expect(accountsSql).toMatch(/where role = 'owner'/);
  });

  it("prevents duplicate memberships", () => {
    expect(accountsSql).toContain("unique (company_id, user_id)");
  });

  it("cascades memberships when the company or the user goes away", () => {
    expect(accountsSql).toMatch(
      /company_id uuid not null references public\.companies \(id\) on delete cascade/,
    );
    expect(accountsSql).toMatch(
      /user_id uuid not null references auth\.users \(id\) on delete cascade/,
    );
  });
});

describe("team invitations", () => {
  it("records when an invitation was sent and accepted", () => {
    expect(accountsSql).toContain("invited_at timestamptz,");
    expect(accountsSql).toContain("accepted_at timestamptz default now(),");
    expect(accountsSql).toContain(
      "check (accepted_at is not null or invited_at is not null)",
    );
  });

  it("leaves accepted_at nullable for pending invitations", () => {
    // A pending row has invited_at set and accepted_at NULL, so the column must
    // not be NOT NULL. The default still covers direct inserts such as the
    // founding owner.
    expect(accountsSql).toMatch(/accepted_at timestamptz default now\(\)/);
    expect(accountsSql).not.toMatch(/accepted_at timestamptz not null/);
  });

  it("lets only owners and admins change assignable memberships", () => {
    for (const action of ["insert", "update", "delete"]) {
      expect(accountsSql).toContain(
        `"company_members_${action}_assignable"`,
      );
    }
    expect(accountsSql).toContain("role in ('manager', 'staff', 'member')");
  });

  it("drops the earlier broad membership policies", () => {
    for (const action of ["insert", "update", "delete"]) {
      expect(accountsSql).toContain(
        `drop policy if exists "company_members_${action}_admin"`,
      );
    }
  });

  it("defines the colleague profile policy after the helper it calls", () => {
    const helperIndex = invitationSql.indexOf(
      "create or replace function public.shares_company_with",
    );
    const policyIndex = invitationSql.indexOf(
      'create policy "profiles_select_colleague"',
    );

    expect(helperIndex).toBeGreaterThan(-1);
    expect(policyIndex).toBeGreaterThan(-1);
    expect(helperIndex).toBeLessThan(policyIndex);
  });
});

describe("function grants", () => {
  /** The predicates every RLS policy in the schema routes through. */
  const PREDICATES = [
    "public.is_company_member(uuid)",
    "public.has_company_role(uuid, public.member_role[])",
    "public.current_member_role(uuid)",
  ];

  /** Trigger-only functions: no client role may reach them. */
  const TRIGGERS = ["public.set_updated_at()", "public.handle_new_user()"];

  it.each(PREDICATES)("revokes execute on %s from anon", (fn) => {
    // Supabase's `alter default privileges` grants EXECUTE on new `public`
    // functions to `anon` explicitly, so revoking from `public` alone leaves it
    // reachable by anonymous clients.
    expect(accountsSql).toContain(
      `revoke all on function ${fn} from public, anon;`,
    );
  });

  it.each(PREDICATES)("grants %s to signed-in users", (fn) => {
    expect(accountsSql).toContain(
      `grant execute on function ${fn} to authenticated, service_role;`,
    );
  });

  it.each(TRIGGERS)("revokes execute on %s from every client role", (fn) => {
    expect(accountsSql).toContain(
      `revoke all on function ${fn} from public, anon, authenticated;`,
    );
    expect(accountsSql).toContain(
      `grant execute on function ${fn} to service_role;`,
    );
  });

  it("declares the predicates SECURITY DEFINER with a pinned search_path", () => {
    // Without the pin, a caller could shadow `company_members` and defeat RLS.
    const definitions = accountsSql.match(
      /create or replace function public\.(is_company_member|has_company_role|current_member_role)[\s\S]*?\$\$;/g,
    );
    expect(definitions).not.toBeNull();
    expect(definitions).toHaveLength(3);

    for (const definition of definitions ?? []) {
      expect(definition).toContain("security definer");
      expect(definition).toContain("set search_path = public");
    }
  });
});

describe("invitation function grants", () => {
  const INVITATION_HELPERS = [
    "public.shares_company_with(uuid)",
    "public.accept_company_invitations()",
    "public.my_pending_invitations()",
    "public.respond_to_company_invitation(uuid, boolean)",
  ];

  it.each(INVITATION_HELPERS)("revokes execute on %s from anon", (fn) => {
    expect(invitationSql).toContain(
      `revoke all on function ${fn} from public, anon;`,
    );
  });

  it.each(INVITATION_HELPERS)("grants %s to signed-in users", (fn) => {
    expect(invitationSql).toContain(
      `grant execute on function ${fn} to authenticated, service_role;`,
    );
  });

  it("declares all four helpers SECURITY DEFINER with a pinned search_path", () => {
    const definitions = invitationSql.match(
      /create or replace function public\.(shares_company_with|accept_company_invitations|my_pending_invitations|respond_to_company_invitation)[\s\S]*?\$\$;/g,
    );
    expect(definitions).toHaveLength(4);

    for (const definition of definitions ?? []) {
      expect(definition).toContain("security definer");
      expect(definition).toContain("set search_path = public");
    }
  });

  it("only stamps the caller's own pending memberships", () => {
    expect(invitationSql).toContain("where user_id = auth.uid()");
    expect(invitationSql).toContain("and accepted_at is null");
    expect(invitationSql).toMatch(/returns integer/);
  });
});

describe("invitation consent", () => {
  /** The predicates every RLS policy in the schema routes through. */
  const PREDICATES = [
    "is_company_member",
    "has_company_role",
    "current_member_role",
  ];

  it.each(PREDICATES)("ignores pending memberships in %s", (name) => {
    const definition = accountsSql.match(
      new RegExp(
        `create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`,
      ),
    )?.[0];

    expect(definition, name).toBeDefined();
    // Without this a pending membership would grant the same access as an
    // accepted one, which defeats the point of inviting somebody.
    expect(definition).toContain("and m.accepted_at is not null");
    expect(definition).toContain("security definer");
    expect(definition).toContain("set search_path = public");
  });

  it("still shows an admin the invitee they are waiting on", () => {
    const definition = invitationSql.match(
      /create or replace function public\.shares_company_with[\s\S]*?\$\$;/,
    )?.[0];

    expect(definition).toBeDefined();
    // The caller has to have accepted their own membership…
    expect(definition).toContain("mine.accepted_at is not null");
    // …but the colleague's row stays visible, or the pending invitee would
    // vanish from the members list that is supposed to show them.
    expect(definition).not.toContain("colleague.accepted_at");
  });

  it("exposes pending invitations to their recipient only", () => {
    const definition = invitationSql.match(
      /create or replace function public\.my_pending_invitations\(\)[\s\S]*?\$\$;/,
    )?.[0];

    expect(definition).toBeDefined();
    expect(definition).toContain("where m.user_id = auth.uid()");
    expect(definition).toContain("and m.accepted_at is null");
    expect(definition).toContain("security definer");
  });

  it("answers an invitation only for the caller's own pending row", () => {
    expect(invitationSql).toContain(
      "create or replace function public.respond_to_company_invitation(",
    );
    // Accepting stamps the row…
    expect(invitationSql).toContain("set accepted_at = now()");
    // …declining removes it, and neither can touch an owner row.
    expect(invitationSql).toContain("delete from public.company_members");
    expect(invitationSql).toContain("and role <> 'owner';");
    expect(invitationSql).toContain("and user_id = auth.uid()");
  });

  it("indexes only the rows a pending lookup can return", () => {
    expect(invitationSql).toContain(
      "create index if not exists company_members_pending_idx",
    );
    expect(invitationSql).toMatch(/where accepted_at is null;/);
  });

  it("is applied after the tenancy core it builds on", () => {
    expect(
      MIGRATION_FILES.indexOf("20260101000100_team_invitations.sql"),
    ).toBeGreaterThan(
      MIGRATION_FILES.indexOf("20260101000000_accounts_and_companies.sql"),
    );
  });
});

describe("products section", () => {
  it("switches the section on with a column, not a table", () => {
    expect(productsSql).toContain(
      "add column if not exists enabled_sections text[] not null default '{}'::text[]",
    );
  });

  it("asks the section predicate in every policy it declares", () => {
    const policies = productsSql.match(/create policy[\s\S]*?;/g) ?? [];

    expect(policies.length).toBeGreaterThanOrEqual(16);
    for (const policy of policies) {
      // Without this a switched-off section would still be readable: the
      // switch has to be part of the policy, not just of the UI.
      expect(policy).toContain("public.has_company_section(");
    }
  });

  it("enables RLS on every table the section adds", () => {
    for (const table of PRODUCT_TABLES) {
      expect(productsSql).toContain(
        `alter table public.${table} enable row level security;`,
      );
    }
  });

  it("defines the section predicate before the policies that call it", () => {
    const helper = productsSql.indexOf(
      "create or replace function public.has_company_section",
    );
    const firstPolicy = productsSql.indexOf("create policy");

    expect(helper).toBeGreaterThan(-1);
    expect(firstPolicy).toBeGreaterThan(helper);
  });

  it("revokes the new helpers from anonymous callers", () => {
    // Supabase grants EXECUTE on new `public` functions to `anon` explicitly.
    const helpers = [
      "public.has_company_section(uuid, text)",
      "public.storage_company_id(text)",
    ];

    for (const helper of helpers) {
      expect(productsSql).toContain(
        `revoke all on function ${helper} from public, anon;`,
      );
      expect(productsSql).toContain(
        `grant execute on function ${helper} to authenticated, service_role;`,
      );
    }
  });

  it("keeps the variant-depth trigger away from client roles", () => {
    expect(productsSql).toContain(
      "create or replace function public.products_check_variant_depth()",
    );
    expect(productsSql).toContain(
      "revoke all on function public.products_check_variant_depth() from public, anon, authenticated;",
    );
    expect(productsSql).toContain(
      "grant execute on function public.products_check_variant_depth() to service_role;",
    );
  });

  it("refuses nesting in both directions", () => {
    // A `check` sees one row, so the depth rule is a trigger.
    expect(productsSql).toContain(
      "A product variant cannot itself have variants",
    );
    expect(productsSql).toContain(
      "A product with variants cannot become a variant",
    );
    expect(productsSql).toContain("using errcode = 'check_violation'");
  });

  it("keys every child row on the tenant", () => {
    // A composite foreign key can only point at a row of the same company, so a
    // policy bug cannot leak one workspace's rows into another's.
    expect(productsSql).toContain("unique (company_id, id)");
    expect(productsSql).toContain("foreign key (company_id, parent_id)");
    expect(productsSql).toContain("foreign key (company_id, category_id)");
    expect(productsSql).toContain("foreign key (company_id, product_id)");
    // Deleting a category leaves its products behind, uncategorised.
    expect(productsSql).toContain("on delete set null (category_id)");
  });

  it("stores money in minor units", () => {
    expect(productsSql).toContain(
      "price_cents integer not null default 0 check (price_cents >= 0)",
    );
    expect(productsSql).toContain("currency text not null default 'usd'");
    expect(productsSql).toContain("check (currency ~ '^[a-z]{3}$')");
  });

  it("bounds a booking window inside one row", () => {
    expect(productsSql).toContain(
      "constraint product_dates_range check (ends_on >= starts_on)",
    );
    expect(productsSql).toContain(
      "unique (company_id, product_id, starts_on, ends_on)",
    );
  });

  it("gives a gallery row exactly one source", () => {
    expect(productsSql).toContain(
      "check ((storage_path is null) <> (url is null))",
    );
  });

  it("declares the bucket the app uploads to, with the same limits", () => {
    // `lib/products.ts` repeats the size ceiling and the MIME list; these
    // assertions are what keep the two in step.
    expect(productsSql).toContain("'product-media'");
    expect(productsSql).toContain("52428800");
    expect(productsSql).toContain("'image/png'");
    expect(productsSql).toContain("'video/mp4'");
  });

  it("reads the company out of the object path behind a guard", () => {
    // The cast needs a regex in front of it, or an unrelated object name would
    // fail the policy with a casting error instead of a clean refusal.
    const definition = productsSql.match(
      /create or replace function public\.storage_company_id[\s\S]*?\$\$;/,
    )?.[0];

    expect(definition).toBeDefined();
    expect(definition).toContain("case");
    expect(definition).toContain("::uuid");
    expect(definition).toContain("split_part(object_name, '/', 1)");
  });

  it("is applied after the tenancy core it builds on", () => {
    expect(MIGRATION_FILES.indexOf("20260101000200_products.sql")).toBeGreaterThan(
      MIGRATION_FILES.indexOf("20260101000000_accounts_and_companies.sql"),
    );
  });
});

describe("assets section", () => {
  it("asks the section predicate in every policy it declares", () => {
    const policies = assetsSql.match(/create policy[\s\S]*?;/g) ?? [];

    expect(policies).toHaveLength(4);
    for (const policy of policies) {
      expect(policy).toContain(
        "public.has_company_section(company_id, 'assets')",
      );
    }
  });

  it("never asks about another section's switch", () => {
    // The two sections are independent: a workspace may keep a fleet with the
    // catalogue switched off, so no assets policy may test the products key.
    expect(assetsSql).not.toContain("'products'");
  });

  it("lets staff take a unit out of action but not create or remove one", () => {
    const update = assetsSql.match(
      /create policy "assets_update_frontdesk"[\s\S]*?;/,
    )?.[0];

    // The front desk owns availability, and that is the only write it owns.
    expect(update).toContain("'staff'");

    for (const name of ["assets_insert_manager", "assets_delete_manager"]) {
      const definition = assetsSql.match(
        new RegExp(`create policy "${name}"[\\s\\S]*?;`),
      )?.[0];

      expect(definition).toBeDefined();
      expect(definition).toContain("array['owner', 'admin', 'manager']");
      expect(definition).not.toContain("'staff'");
    }
  });

  it("gives readers the member predicate", () => {
    const select = assetsSql.match(
      /create policy "assets_select_member"[\s\S]*?;/,
    )?.[0];

    expect(select).toContain("public.is_company_member(company_id)");
  });

  it("keys the unit on its tenant and its product", () => {
    // A composite foreign key can only point at a row of the same company, so a
    // policy bug cannot attach one workspace's unit to another's product.
    expect(assetsSql).toContain("unique (company_id, handle)");
    expect(assetsSql).toContain("unique (company_id, id)");
    expect(assetsSql).toContain("foreign key (company_id, product_id)");
  });

  it("unassigns units when a product is deleted instead of deleting them", () => {
    // A physical bike does not stop existing because a catalogue row went away.
    expect(assetsSql).toContain("on delete set null (product_id)");
    expect(assetsSql).toMatch(/product_id uuid,/);
    expect(assetsSql).not.toMatch(/product_id uuid not null/);
  });

  it("stores availability as a status, never as a count", () => {
    // Product stock is a number the shop edits; a fleet is rows the UI counts.
    // Copying one into the other is exactly the drift this table avoids, so the
    // word may appear in the notes above but never as a column.
    expect(assetsSql).not.toMatch(/^\s*inventory_quantity/m);
    expect(assetsSql).toContain(
      "status public.asset_status not null default 'available'",
    );
    expect(assetsSql).toContain(
      "create index if not exists assets_company_status_idx",
    );
  });

  it("enables RLS on the table it adds", () => {
    for (const table of ASSET_TABLES) {
      expect(assetsSql).toContain(
        `alter table public.${table} enable row level security;`,
      );
    }
  });

  it("keeps status_changed_at from drifting", () => {
    expect(assetsSql).toContain(
      "create or replace function public.assets_stamp_status_change()",
    );
    expect(assetsSql).toContain("new.status is distinct from old.status");
    // Trigger-only, like the other helpers: no client role may execute it.
    expect(assetsSql).toContain(
      "revoke all on function public.assets_stamp_status_change() from public, anon, authenticated;",
    );
    expect(assetsSql).toContain(
      "grant execute on function public.assets_stamp_status_change() to service_role;",
    );
  });

  it("keeps one serial number per unit inside a fleet", () => {
    expect(assetsSql).toContain(
      "create unique index if not exists assets_serial_idx",
    );
    expect(assetsSql).toContain("lower(serial)");
    expect(assetsSql).toMatch(/where serial is not null;/);
  });

  it("is applied after the modules it builds on", () => {
    expect(MIGRATION_FILES.indexOf("20260101000300_assets.sql")).toBeGreaterThan(
      MIGRATION_FILES.indexOf("20260101000200_products.sql"),
    );
  });
});

describe("renters", () => {
  it("keeps a renter apart from an account", () => {
    // `profiles` is the staff/auth table. A renter usually has no account, so
    // the link is optional — and deleting that account must not delete the
    // person the shop still has a booking for.
    expect(rentersSql).toContain(
      "profile_id uuid references public.profiles (id) on delete set null",
    );
    expect(rentersSql).not.toMatch(/profile_id uuid not null/);
  });

  it("keys the renter on the tenant", () => {
    expect(rentersSql).toContain("unique (company_id, handle)");
    // The target of `booking_line_items`' composite key, and of its `rider_id`.
    expect(rentersSql).toContain("unique (company_id, id)");
    expect(rentersSql).toContain("foreign key (company_id, customer_id)");
  });

  it("gives a renter at most one set of measurements", () => {
    // The renter is the key, not a separate id: one rider, one row.
    expect(rentersSql).toContain("customer_id uuid primary key");
    expect(rentersSql).toContain("on delete cascade");
    expect(rentersSql).toContain("disciplines text[] not null default '{}'");
  });

  it("keeps one address per renter inside a workspace", () => {
    // Case-insensitive like `assets_serial_idx`, partial because a walk-in may
    // give only a name and a phone number.
    expect(rentersSql).toContain(
      "create unique index if not exists customers_email_idx",
    );
    expect(rentersSql).toContain("lower(email)");
    expect(rentersSql).toMatch(/where email is not null;/);
  });

  it("asks the bookings switch in every policy it declares", () => {
    const policies = rentersSql.match(/create policy[\s\S]*?;/g) ?? [];

    expect(policies).toHaveLength(8);
    for (const policy of policies) {
      expect(policy).toContain(
        "public.has_company_section(company_id, 'bookings')",
      );
    }
  });

  it("never asks about another section's switch", () => {
    expect(rentersSql).not.toContain("'products'");
    expect(rentersSql).not.toContain("'assets'");
  });

  it("lets the front desk record a walk-in and the manager remove one", () => {
    for (const table of RENTER_TABLES) {
      for (const command of ["insert", "update"] as const) {
        const body = rentersSql.match(
          new RegExp(`create policy "${table}_${command}_frontdesk"[\\s\\S]*?;`),
        )?.[0];

        expect({ table, command, declared: Boolean(body) }).toEqual({
          table,
          command,
          declared: true,
        });
        expect(body).toContain("'staff'");
      }

      const removal = rentersSql.match(
        new RegExp(`create policy "${table}_delete_manager"[\\s\\S]*?;`),
      )?.[0];

      expect(removal).toContain("array['owner', 'admin', 'manager']");
      expect(removal).not.toContain("'staff'");
    }
  });

  it("gives readers the member predicate", () => {
    for (const table of RENTER_TABLES) {
      const select = rentersSql.match(
        new RegExp(`create policy "${table}_select_member"[\\s\\S]*?;`),
      )?.[0];

      expect(select).toContain("public.is_company_member(company_id)");
    }
  });

  it("enables RLS on the tables it adds", () => {
    for (const table of RENTER_TABLES) {
      expect(rentersSql).toContain(
        `alter table public.${table} enable row level security;`,
      );
    }
  });

  it("is applied after the modules it builds on", () => {
    expect(
      MIGRATION_FILES.indexOf("20260101001200_renters.sql"),
    ).toBeGreaterThan(
      MIGRATION_FILES.indexOf("20260101000300_assets.sql"),
    );
  });
});

describe("bookings section", () => {
  it("asks the section predicate in every policy it declares", () => {
    const policies = bookingsSql.match(/create policy[\s\S]*?;/g) ?? [];

    expect(policies).toHaveLength(8);
    for (const policy of policies) {
      expect(policy).toContain(
        "public.has_company_section(company_id, 'bookings')",
      );
    }
  });

  it("never asks about another section's switch", () => {
    // The book may point at a product and a unit, but it does not depend on
    // either section being switched on: a shop can rent out what it has without
    // a catalogue.
    expect(bookingsSql).not.toContain("'products'");
    expect(bookingsSql).not.toContain("'assets'");
  });

  it("installs the operator class the constraint needs", () => {
    // `=` on a uuid inside a GiST index is `btree_gist`'s contribution.
    expect(bookingsSql).toContain("create extension if not exists btree_gist");
  });

  it("guards the overlap where the single unit is", () => {
    // A `uuid[]` on `bookings` cannot take a GiST `&&`, so the constraint sits
    // on the line that names one asset.
    expect(bookingsSql).toContain("exclude using gist");
    expect(bookingsSql).toContain("company_id with =");
    expect(bookingsSql).toContain("asset_id with =");
    expect(bookingsSql).toContain("daterange(starts_on, ends_on, '[)') with &&");
    expect(bookingsSql).toContain(
      "where (asset_id is not null and blocks_stock)",
    );
  });

  it("reads half-open windows everywhere", () => {
    // The constraint, the advisory check and `lib/bookings.ts` all use `[)`.
    // `ends_on > starts_on` is then the only date rule a booking needs.
    expect(bookingsSql).toContain(
      "constraint bookings_window check (ends_on > starts_on)",
    );
    expect(bookingsSql).toContain(
      "constraint booking_line_items_window check (ends_on > starts_on)",
    );
    expect(
      bookingsSql.match(/daterange\([^)]*starts_on, [^)]*ends_on, '\[\)'\)/g),
    ).toHaveLength(3);
  });

  it("copies the window and the flag from the booking, never the client", () => {
    expect(bookingsSql).toContain(
      "create or replace function public.booking_line_items_sync()",
    );
    expect(bookingsSql).toContain("new.starts_on := parent_starts_on;");
    expect(bookingsSql).toContain(
      "new.blocks_stock := public.booking_blocks_stock(parent_status);",
    );
    expect(bookingsSql).toContain(
      "before insert or update on public.booking_line_items",
    );
  });

  it("drags the lines with the booking", () => {
    expect(bookingsSql).toContain(
      "create or replace function public.bookings_propagate_dates()",
    );
    expect(bookingsSql).toContain(
      "after update of starts_on, ends_on, status on public.bookings",
    );
    // A no-op update of the booking must not touch every line in the book.
    expect(bookingsSql).toContain(
      "if new.starts_on is not distinct from old.starts_on",
    );
  });

  it("releases a cancelled booking without deleting its history", () => {
    expect(bookingsSql).toContain(
      "select target_status in ('pending', 'confirmed', 'out');",
    );
    expect(bookingsSql).toContain("blocks_stock boolean not null default true");
  });

  it("holds the same statuses lib/bookings.ts calls blocking", () => {
    // The drift that would hurt: a status the UI treats as released while the
    // constraint still holds the unit, or the other way round. Same shape as the
    // write-gate check against `WRITABLE_STATUSES`.
    const list = bookingsSql.match(/target_status in \(([^)]*)\)/)?.[1] ?? "";
    const statuses = [...list.matchAll(/'([a-z_]+)'/g)].map(
      (match) => match[1],
    );

    expect(statuses).toEqual([...BLOCKING_BOOKING_STATUSES]);
  });

  it("stores no availability of its own", () => {
    // The whole module is derived: a booking reserves a unit by existing, and
    // nothing here copies a number or a status onto another table.
    expect(bookingsSql).not.toMatch(/^\s*inventory_quantity/m);
    expect(bookingsSql).not.toMatch(/update public\.(products|assets)/i);
  });

  it("exposes availability through an invoker view", () => {
    expect(bookingsSql).toContain(
      "create or replace view public.asset_availability",
    );
    // Without this a view runs as its owner and would hand one workspace
    // another's calendar.
    expect(bookingsSql).toContain("with (security_invoker = true)");
    expect(bookingsSql).toContain("where l.asset_id is not null");
    expect(bookingsSql).toContain("and l.blocks_stock;");
    expect(bookingsSql).toContain(
      "revoke all on public.asset_availability from anon;",
    );
  });

  it("keys every line on the booking, the product, the unit and the rider", () => {
    for (const target of ["bookings", "products", "assets", "customers"]) {
      expect(bookingsSql).toContain(
        `references public.${target} (company_id, id)`,
      );
    }
    expect(bookingsSql).toContain("unique (company_id, id)");
  });

  it("keeps a renter with history undeletable", () => {
    // A booking is the reason the renter row exists; `restrict` says so, and the
    // manager-facing action turns the refusal into a sentence.
    expect(bookingsSql).toMatch(
      /foreign key \(company_id, customer_id\)[\s\S]*?on delete restrict/,
    );
  });

  it("answers the advisory check as a definer with an empty search_path", () => {
    expect(bookingsSql).toContain(
      "create or replace function public.check_asset_availability(",
    );
    expect(bookingsSql).toContain("set search_path = ''");
    expect(bookingsSql).toContain("stable");
    // `0` means free; the constraint, not this, is the guarantee.
    expect(bookingsSql).toContain("select count(*)::integer");
  });

  it("revokes every new helper from the anonymous role", () => {
    for (const signature of [
      "public.booking_blocks_stock(public.booking_status)",
      "public.check_asset_availability(uuid, uuid, date, date)",
    ]) {
      expect(bookingsSql).toContain(
        `revoke all on function ${signature} from public, anon;`,
      );
      expect(bookingsSql).toContain(
        `grant execute on function ${signature} to authenticated, service_role;`,
      );
    }

    for (const signature of [
      "public.booking_line_items_sync()",
      "public.bookings_propagate_dates()",
    ]) {
      // Trigger-only, like `assets_stamp_status_change`.
      expect(bookingsSql).toContain(
        `revoke all on function ${signature} from public, anon, authenticated;`,
      );
      expect(bookingsSql).toContain(
        `grant execute on function ${signature} to service_role;`,
      );
    }
  });

  it("enables RLS on the tables it adds", () => {
    for (const table of BOOKING_TABLES) {
      expect(bookingsSql).toContain(
        `alter table public.${table} enable row level security;`,
      );
    }
  });

  it("gives the front desk the book and the manager its removal", () => {
    for (const command of ["insert", "update"] as const) {
      const body = bookingsSql.match(
        new RegExp(`create policy "bookings_${command}_frontdesk"[\\s\\S]*?;`),
      )?.[0];

      expect(body).toContain("'staff'");
    }

    const removal = bookingsSql.match(
      /create policy "bookings_delete_manager"[\s\S]*?;/,
    )?.[0];

    expect(removal).toContain("array['owner', 'admin', 'manager']");
    expect(removal).not.toContain("'staff'");
  });

  it("is applied after the renters it points at", () => {
    expect(
      MIGRATION_FILES.indexOf("20260101001300_bookings.sql"),
    ).toBeGreaterThan(
      MIGRATION_FILES.indexOf("20260101001200_renters.sql"),
    );
  });

  it("states its write gate after the tables it names", () => {
    // A policy cannot be created before its table, which is why Guard 5 is a
    // migration of its own rather than a block in migration 11.
    expect(
      MIGRATION_FILES.indexOf("20260101001400_bookings_write_gate.sql"),
    ).toBeGreaterThan(
      MIGRATION_FILES.indexOf("20260101001300_bookings.sql"),
    );
  });
});

describe("account avatars", () => {
  it("declares the bucket the uploader writes to, with the same limits", () => {
    // `lib/account.ts` repeats the size ceiling and the MIME list; these
    // assertions are what keep the two in step.
    expect(avatarsSql).toContain("'avatars'");
    expect(avatarsSql).toContain("2097152");
    expect(avatarsSql).toContain("'image/png'");
    expect(avatarsSql).toContain("'image/avif'");
  });

  it("scopes every write to the caller's own folder", () => {
    const policies = avatarsSql.match(/create policy[\s\S]*?;/g) ?? [];

    expect(policies).toHaveLength(4);
    for (const policy of policies) {
      expect(policy).toContain("bucket_id = 'avatars'");
      expect(policy).toContain(
        "(storage.foldername(name))[1] = (select auth.uid())::text",
      );
    }
  });

  it("asks no company before letting a photo through", () => {
    // A photo belongs to the account, so a workspace membership — or a switched
    // off section — must not be part of the decision.
    expect(avatarsSql).not.toContain("has_company_role");
    expect(avatarsSql).not.toContain("has_company_section");
  });

  it("is applied after the profile column it fills", () => {
    expect(
      MIGRATION_FILES.indexOf("20260101000400_account_avatars.sql"),
    ).toBeGreaterThan(
      MIGRATION_FILES.indexOf("20260101000000_accounts_and_companies.sql"),
    );
  });
});

describe("company identity", () => {
  it("adds the default currency, the logo and the badge to the company row", () => {
    expect(identitySql).toContain(
      "add column if not exists currency text not null default 'usd'",
    );
    expect(identitySql).toContain("add column if not exists logo_url text");
    expect(identitySql).toContain("add column if not exists badge text");
  });

  it("accepts the same currency codes as products.currency", () => {
    // The column is the outer bound; `lib/products.ts` is the allowlist the form
    // and the actions enforce, so adding a currency needs no migration.
    expect(identitySql).toContain("check (currency ~ '^[a-z]{3}$')");
    expect(productsSql).toContain("check (currency ~ '^[a-z]{3}$')");
  });

  it("treats an absent badge as \"draw the initials\"", () => {
    // Null, not empty string: `companyMark()` branches on it. The length bound
    // is in UTF-16 units, so a multi-code-point emoji fits inside it; the
    // one-or-two *graphemes* rule lives in `lib/company.ts`.
    expect(identitySql).toContain(
      "check (badge is null or length(badge) between 1 and 8)",
    );
  });

  it("declares the bucket the uploader writes to, with the same limits", () => {
    // `lib/company.ts` repeats the size ceiling and the MIME list; these
    // assertions are what keep the two in step.
    expect(identitySql).toContain("'company-logos'");
    expect(identitySql).toContain("2097152");
    expect(identitySql).toContain("'image/png'");
    expect(identitySql).toContain("'image/avif'");
  });

  it("keys every policy on the company in the first path segment", () => {
    const policies = identitySql.match(/create policy[\s\S]*?;/g) ?? [];

    expect(policies).toHaveLength(4);
    for (const policy of policies) {
      expect(policy).toContain("bucket_id = 'company-logos'");
      expect(policy).toContain("public.storage_company_id(name)");
    }
  });

  it("lets every member read the mark and only owners and admins write it", () => {
    const policies = identitySql.match(/create policy[\s\S]*?;/g) ?? [];
    const [select, insert, update, remove] = policies;

    // A logo is rendered in the rail for everybody in the workspace…
    expect(select).toContain("public.is_company_member(");
    // …but changing it is an administrative act, like the name and the address.
    for (const policy of [insert, update, remove]) {
      expect(policy).toContain("array['owner', 'admin']::public.member_role[]");
    }
  });

  it("asks no section before letting a logo through", () => {
    // Identity belongs to the workspace itself, so switching a module off must
    // not blank the rail.
    expect(identitySql).not.toContain("has_company_section");
  });

  it("is applied after the company table it extends", () => {
    expect(
      MIGRATION_FILES.indexOf("20260101000500_company_identity.sql"),
    ).toBeGreaterThan(
      MIGRATION_FILES.indexOf("20260101000000_accounts_and_companies.sql"),
    );
  });
});

describe("enum values", () => {
  /** Pulls the members out of `create type public.<name> as enum (...)`. */
  function enumValues(sql: string, name: string): string[] {
    const match = new RegExp(
      `create type public\\.${name} as enum \\(([\\s\\S]*?)\\)`,
    ).exec(sql);
    expect(match, `enum ${name} not found`).not.toBeNull();

    return (match?.[1] ?? "")
      .split(",")
      .map((value) => value.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);
  }

  it("matches member_role, most to least privileged", () => {
    expect(enumValues(accountsSql, "member_role")).toEqual([
      "owner",
      "admin",
      "manager",
      "staff",
      "member",
    ] satisfies MemberRole[]);
  });

  it("keeps member as the read-only Viewer role", () => {
    // `member` predates the ladder and is deliberately not renamed to `staff`:
    // existing members stay read-only, and managers/staff are invited
    // explicitly.
    expect(accountsSql).not.toMatch(/update\s+public\.company_members/i);
    expect(accountsSql).not.toMatch(/set\s+role\s*=\s*'staff'/i);
  });

  it("matches subscription_status", () => {
    expect(enumValues(accountsSql, "subscription_status")).toEqual([
      "none",
      "trialing",
      "active",
      "past_due",
      "canceled",
      "incomplete",
      "incomplete_expired",
      "unpaid",
      "paused",
    ] satisfies SubscriptionStatus[]);
  });

  it("gives every subscription status a Stripe mapping", async () => {
    // `mapSubscriptionStatus` falls back to `incomplete`, so every value here
    // must be reachable from a Stripe status the mapper spells out.
    const { readFileSync } = await import("node:fs");
    const sync = readFileSync(
      fileURLToPath(new URL("../../lib/billing/sync.ts", import.meta.url)),
      "utf8",
    );

    const mapped = [...sync.matchAll(/case "([a-z_]+)":/g)].map(
      (match) => match[1],
    );

    for (const status of enumValues(accountsSql, "subscription_status")) {
      if (status === "none") continue;
      expect(mapped, `${status} is not mapped by mapStatus`).toContain(status);
    }
  });

  it("matches product_status", () => {
    expect(enumValues(productsSql, "product_status")).toEqual([
      "draft",
      "active",
      "archived",
    ] satisfies ProductStatus[]);
  });

  it("matches product_kind", () => {
    // Two stocking models: one number, or one row per window.
    expect(enumValues(productsSql, "product_kind")).toEqual([
      "item",
      "dated",
    ] satisfies ProductKind[]);
  });

  it("matches product_media_kind", () => {
    expect(enumValues(productsSql, "product_media_kind")).toEqual([
      "image",
      "video",
    ] satisfies ProductMediaKind[]);
  });

  it("matches asset_status, including the rename and the added value", () => {
    // Created complete in migration 03 as `available, maintenance, retired`,
    // then renamed and extended in migration 24. The ladder as it stands is
    // `ASSET_STATUSES`, and this assertion is what fails if either side moves
    // without the other — the drift that would make a `rented` unit count as
    // retired on the fleet page.
    expect(enumValues(assetsSql, "asset_status")).toEqual([
      "available",
      "maintenance",
      "retired",
    ]);
    expect(assetStatusSql).toContain("to ''in_workshop''");
    expect(assetStatusSql).toContain("add value if not exists 'rented'");
    expect(ASSET_STATUSES).toEqual([
      "available",
      "in_workshop",
      "retired",
      "rented",
    ] satisfies AssetStatus[]);
  });

  it("matches booking_status", () => {
    expect(enumValues(bookingsSql, "booking_status")).toEqual([
      "pending",
      "confirmed",
      "out",
      "returned",
      "cancelled",
    ] satisfies BookingStatus[]);
  });

  it("matches booking_channel", () => {
    expect(enumValues(bookingsSql, "booking_channel")).toEqual([
      "staff",
      "api",
    ] satisfies BookingChannel[]);
  });
});

describe("two-factor authentication", () => {
  it("adds the workspace policy as an off-by-default flag", () => {
    // Off by default, so a deploy changes nothing until an owner asks for it.
    expect(twoFactorSql).toContain(
      "add column if not exists require_mfa boolean not null default false",
    );
  });

  it("describes the flag in the type it is read through", () => {
    // `Database["public"]["Tables"]["companies"]["Row"]` is hand-maintained; a
    // column that exists in Postgres but not here is invisible to the app.
    const row: PublicSchema["Tables"]["companies"]["Row"] = {
      id: "c",
      name: "Acme",
      slug: "acme",
      stripe_customer_id: null,
      stripe_subscription_id: null,
      subscription_status: "none",
      trial_ends_at: null,
      enabled_sections: [],
      currency: "usd",
      logo_url: null,
      badge: null,
      require_mfa: false,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };

    expect(row.require_mfa).toBe(false);
  });

  it("asks no new grant for the column", () => {
    // Writes ride on `companies_update_admin` from migration 01; a second policy
    // would be a second place to keep in step.
    expect(twoFactorSql).not.toContain("create policy");
    expect(twoFactorSql).not.toContain("grant update on public.companies");
  });

  it("answers the password question the client libraries cannot", () => {
    expect(twoFactorSql).toContain("create or replace function public.has_password()");
    // The truth lives in a schema `authenticated` cannot read.
    expect(twoFactorSql).toContain("from auth.users u");
    expect(twoFactorSql).toContain("u.encrypted_password is not null");
    // A user with no session has no account to ask about.
    expect(twoFactorSql).toContain("where u.id = auth.uid()");
  });

  it("is a definer function that cannot be redirected", () => {
    // `security definer` is what lets it read `auth.users` at all, and an empty
    // `search_path` is what stops a caller pointing it at a shadowing table.
    expect(twoFactorSql).toContain("security definer");
    expect(twoFactorSql).toContain("set search_path = ''");
    expect(twoFactorSql).toContain("stable");
  });

  it("is callable by a session and by nobody else", () => {
    expect(twoFactorSql).toContain(
      "revoke all on function public.has_password() from public;",
    );
    expect(twoFactorSql).toContain(
      "grant execute on function public.has_password() to authenticated;",
    );
    expect(twoFactorSql).not.toContain("to anon");
  });

  it("is applied after the company table it extends", () => {
    expect(
      MIGRATION_FILES.indexOf("20260101000900_two_factor.sql"),
    ).toBeGreaterThan(
      MIGRATION_FILES.indexOf("20260101000000_accounts_and_companies.sql"),
    );
  });
});

describe("billing column guard", () => {
  /**
   * The columns only the billing webhook, the reconciler and onboarding write.
   * A session that can move them can point the workspace at another customer.
   */
  const BILLING_COLUMNS = [
    "subscription_status",
    "stripe_customer_id",
    "stripe_subscription_id",
    "trial_ends_at",
  ];

  it("takes the table-wide update away and grants the identity columns back", () => {
    // `companies_update_admin` is row-level only, so without this a session can
    // rewrite every column of its own row.
    expect(billingGuardSql).toContain(
      "revoke update on public.companies from anon, authenticated;",
    );
    expect(billingGuardSql).toContain(
      "grant update (name, currency, badge, logo_url, enabled_sections, require_mfa)",
    );
    expect(billingGuardSql).toContain("on public.companies to authenticated;");
  });

  it.each(BILLING_COLUMNS)("keeps %s out of every client grant", (column) => {
    const grants = billingGuardSql.match(/^grant update \([^)]*\)[^;]*;/gm) ?? [];
    expect(grants.length).toBeGreaterThan(0);
    for (const grant of grants) {
      expect(grant).not.toContain(column);
    }
  });

  it("refuses the columns at the trigger, where a re-grant cannot undo it", () => {
    // `before update of` lists the columns, so an update that names none of them
    // never reaches the function.
    const trigger = billingGuardSql.match(
      /create trigger companies_guard_billing_columns[\s\S]*?;/,
    )?.[0];
    expect(trigger).toBeDefined();
    expect(trigger).toContain("before update of");
    for (const column of BILLING_COLUMNS) {
      expect(trigger).toContain(column);
    }
    expect(billingGuardSql).toContain(
      "create or replace function public.companies_guard_billing_columns()",
    );
    // 42501 is what PostgREST reports as a 403, so the client sees a refusal
    // rather than a 500.
    expect(billingGuardSql).toContain("using errcode = '42501'");
    // `is distinct from`, so writing the same value back is not an error.
    expect(billingGuardSql).toContain("is distinct from old.subscription_status");
  });

  it("lets the webhook through, so the guard never refuses its own writer", () => {
    // The guard exists to close a row-level-only policy, not to fight the roles
    // that already bypass RLS: `service_role` (webhook, reconciler, onboarding)
    // and the owner's own SQL editor session.
    expect(billingGuardSql).toContain(
      "if current_user not in ('anon', 'authenticated')",
    );
  });

  it("refuses the claim too, so a definer wrapper cannot launder a client write", () => {
    // A `security definer` helper would run as its owner; the JWT claim is what
    // still identifies the signed-in user behind it.
    expect(billingGuardSql).toContain(
      "and coalesce(auth.role(), '') not in ('anon', 'authenticated') then",
    );
  });

  it("is a trigger-only function no client role can call", () => {
    expect(billingGuardSql).toContain(
      "revoke all on function public.companies_guard_billing_columns()",
    );
    expect(billingGuardSql).toContain("from public, anon, authenticated;");
    expect(billingGuardSql).toContain(
      "grant execute on function public.companies_guard_billing_columns() to service_role;",
    );
  });

  it("drops the trigger before recreating it, so the file is re-runnable", () => {
    expect(billingGuardSql).toContain(
      "drop trigger if exists companies_guard_billing_columns on public.companies;",
    );
  });

  it("takes the same columns off a user's own profile", () => {
    // `email` is on the row the roster renders, so a session that can write it
    // can appear as a colleague.
    expect(billingGuardSql).toContain(
      "revoke update on public.profiles from anon, authenticated;",
    );
    expect(billingGuardSql).toContain(
      "grant update (full_name, avatar_url) on public.profiles to authenticated;",
    );
  });

  it("pins its search_path, so a caller cannot redirect what the body resolves", () => {
    // The body calls `auth.role()` schema-qualified and nothing else that lives
    // outside `pg_catalog`, which is why an empty path is the right one.
    expect(billingGuardSql).toContain("set search_path = ''");
  });

  it("is applied after the columns it protects exist", () => {
    expect(
      MIGRATION_FILES.indexOf("20260101001000_company_billing_guard.sql"),
    ).toBeGreaterThan(
      MIGRATION_FILES.indexOf("20260101000000_accounts_and_companies.sql"),
    );
  });
});

describe("the rows a session may not write at all", () => {
  it("keeps a company row from being created or deleted by a session", () => {
    // `companies_delete_owner` is row-level, and a row deleted while its
    // subscription is live leaves Stripe charging a customer whose workspace is
    // gone. Onboarding's rollback and its only insert both use the service role.
    expect(billingGuardSql).toContain(
      "revoke insert, delete on public.companies from anon, authenticated;",
    );
  });

  it("keeps a profile row from being deleted by the user it belongs to", () => {
    // The row is written by `handle_new_user()` on the auth insert, so a client
    // delete leaves every membership pointing at an id nothing can restore.
    expect(billingGuardSql).toContain(
      "revoke delete on public.profiles from anon, authenticated;",
    );
  });

  it("leaves a membership only its role writable", () => {
    // `company_members_update_assignable` constrains `company_id` and the role
    // values, but not `user_id` or `accepted_at`: with the table-wide grant an
    // admin could add somebody who never accepted an invitation, or accept on
    // their behalf.
    expect(billingGuardSql).toContain(
      "revoke update on public.company_members from anon, authenticated;",
    );
    expect(billingGuardSql).toContain(
      "grant update (role) on public.company_members to authenticated;",
    );
  });
});

describe("the subscription write gate", () => {
  /**
   * The tables a subscription pays for. `companies`, `profiles` and
   * `company_members` are deliberately absent: they are how a lapsed workspace
   * fixes its card, its team and its own account, and how it leaves.
   *
   * The booking tables arrive after migration 11, so their policies live in
   * migration 14 — `allGateSql` reads both files.
   */
  const GATED_TABLES = [
    "products",
    "product_categories",
    "product_media",
    "product_dates",
    "assets",
    "customers",
    "rider_preferences",
    "bookings",
    "booking_line_items",
    "addons",
    "addon_products",
    "booking_line_addons",
    "component_kinds",
    "asset_components",
    "asset_usage_logs",
    "component_service_events",
  ] as const;

  const CARVED_OUT = ["companies", "profiles", "company_members"] as const;

  /** One policy, from `create policy` to the semicolon that ends it. */
  function policyFor(begin: string): string | undefined {
    return allGateSql.match(new RegExp(`${begin}[\\s\\S]*?;`))?.[0];
  }

  /** The members of an enum, read out of its `create type` statement. */
  function enumMembers(name: string): string[] {
    const body = accountsSql.match(
      new RegExp(`create type public\\.${name} as enum \\(([\\s\\S]*?)\\);`),
    )?.[1];

    return [...(body ?? "").matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
  }

  it("answers with a definer helper, so a policy never depends on the caller", () => {
    // Same shape as `has_company_section`: a policy on `products` must not care
    // whether the caller can read the row in `companies` it asks about.
    expect(subscriptionGateSql).toContain(
      "create or replace function public.has_active_subscription(",
    );
    expect(subscriptionGateSql).toContain("security definer");
    expect(subscriptionGateSql).toContain("set search_path = ''");
    expect(subscriptionGateSql).toContain("stable");
    expect(subscriptionGateSql).toContain("from public.companies c");
  });

  it("is callable by a session, by the webhook and by nobody else", () => {
    expect(subscriptionGateSql).toContain(
      "revoke all on function public.has_active_subscription(uuid) from public, anon;",
    );
    expect(subscriptionGateSql).toContain(
      "grant execute on function public.has_active_subscription(uuid) to authenticated, service_role;",
    );
  });

  it("reads the statuses the actions treat as writable", () => {
    // The drift that would hurt: a status the action allows and the policy
    // refuses is a write that fails silently, and the other way round is a
    // paywall that does not hold.
    const list =
      subscriptionGateSql.match(/subscription_status in \(([^)]*)\)/)?.[1] ?? "";
    const statuses = [...list.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);

    expect(statuses).toEqual([...WRITABLE_STATUSES]);
  });

  it("classifies every status in the column, so a new one cannot slip past", () => {
    const declared = enumMembers("subscription_status");
    const writable = new Set<string>(WRITABLE_STATUSES);

    expect(declared.length).toBe(9);
    // A member that lands in neither list is one nobody decided about, which is
    // exactly when this test should fail and a person should think.
    expect(declared.filter((status) => !writable.has(status)).sort()).toEqual([
      "canceled",
      "incomplete",
      "incomplete_expired",
      "none",
      "paused",
      "unpaid",
    ]);
  });

  it.each(GATED_TABLES)(
    "gates every write to %s with a restrictive policy",
    (table) => {
      for (const command of ["insert", "update", "delete"] as const) {
        const body = policyFor(
          `create policy "${table}_${command}_live_subscription"`,
        );

        expect({ table, command, gated: Boolean(body) }).toEqual({
          table,
          command,
          gated: true,
        });
        // Restrictive policies are ANDed onto every permissive one, so this is
        // the single place the paywall is stated for the table.
        expect(body).toContain("as restrictive");
        expect(body).toContain("public.has_active_subscription(company_id)");
        expect(body).toContain("to authenticated");
      }
    },
  );

  it("leaves reads alone, so a lapsed workspace still shows its data", () => {
    expect(allGateSql).not.toContain("as restrictive for select");
    // Not `for all` either: that form's `using` clause filters reads too.
    expect(allGateSql).not.toContain("as restrictive for all");
  });

  it("keeps the tables a workspace repairs itself with out of the gate", () => {
    for (const table of CARVED_OUT) {
      expect(subscriptionGateSql).not.toContain(`on public.${table}`);
    }
  });

  it("closes the gallery bucket beside the checks it already carried", () => {
    for (const command of ["insert", "update", "delete"] as const) {
      const body = policyFor(`create policy "product_media_objects_${command}"`);

      // Re-created in full, so losing a predicate while adding one is the
      // mistake this test exists to catch.
      expect(body).toContain("bucket_id = 'product-media'");
      expect(body).toContain("public.has_company_role(");
      expect(body).toContain(
        "public.has_company_section(public.storage_company_id(name), 'products')",
      );
      expect(body).toContain(
        "public.has_active_subscription(public.storage_company_id(name))",
      );
    }
  });

  it("leaves the buckets settings still writes out of it", () => {
    // A restrictive policy on `storage.objects` would apply to every bucket in
    // the table — freezing the logo and avatar uploads for the one workspace
    // whose job is to fix its card.
    expect(subscriptionGateSql).not.toContain("company_logos_objects_");
    expect(subscriptionGateSql).not.toContain("avatars_objects_");
    // Select is what renders the gallery; it keeps working.
    expect(subscriptionGateSql).not.toContain(
      'create policy "product_media_objects_select"',
    );
  });

  it("is applied after the columns it reads are protected", () => {
    expect(
      MIGRATION_FILES.indexOf("20260101001100_subscription_write_gate.sql"),
    ).toBeGreaterThan(
      MIGRATION_FILES.indexOf("20260101001000_company_billing_guard.sql"),
    );
  });
});

const ACTIONS_DIR = fileURLToPath(new URL("../../lib/actions/", import.meta.url));

function readAction(name: string): string {
  return readFileSync(`${ACTIONS_DIR}${name}`, "utf8");
}

/** Every `.from(table).update({...})` payload an action sends from a session. */
function sessionWrites(name: string) {
  const writes: { file: string; table: string; columns: string[] }[] = [];

  for (const match of readAction(name).matchAll(
    /\.from\("(companies|profiles)"\)\s*\.update\(\{([^}]*)\}\)/g,
  )) {
    writes.push({
      file: name,
      table: match[1],
      columns: match[2]
        .split(",")
        .map((entry) => entry.split(":")[0].trim())
        .filter(Boolean),
    });
  }

  return writes;
}

const sessionUpdates = [
  ...sessionWrites("settings.ts"),
  ...sessionWrites("company.ts"),
  ...sessionWrites("account.ts"),
];

/** The columns the migration grants `update` on, per table. */
function grantedColumns(table: "companies" | "profiles"): string[] {
  const statements = billingGuardSql.match(/grant update \([^)]*\)[\s\S]*?;/g) ?? [];
  const statement = statements.find((entry) =>
    entry.includes(`on public.${table} to authenticated`),
  );

  return (statement?.match(/\(([^)]*)\)/)?.[1] ?? "")
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
}

describe("the session writes fit inside the column grants", () => {
  /**
   * The failure this whole file exists to catch: an action writes a column the
   * grant does not name, and the only symptom is a 403 in production. Reading
   * the payloads out of the actions is what keeps the two lists in step.
   */
  it("finds the payloads it is meant to check", () => {
    // Otherwise every assertion below could pass by finding nothing at all.
    expect(sessionUpdates.length).toBeGreaterThanOrEqual(6);
    expect(grantedColumns("companies")).toContain("logo_url");
    expect(grantedColumns("profiles")).toEqual(["full_name", "avatar_url"]);
  });

  for (const table of ["companies", "profiles"] as const) {
    it(`grants every column a session writes on ${table}`, () => {
      const granted = grantedColumns(table);
      const writes = sessionUpdates.filter((write) => write.table === table);

      expect(writes.length).toBeGreaterThan(0);

      for (const write of writes) {
        for (const column of write.columns) {
          // Compared as an object so a failure names the file and the column.
          expect({
            file: write.file,
            column,
            granted: granted.includes(column),
          }).toEqual({ file: write.file, column, granted: true });
        }
      }
    });
  }

  it("keeps the service-role billing write out of the payload list", () => {
    // `billing.ts` writes `stripe_customer_id` with the admin client on purpose,
    // which is asserted in the action tests. This documents the exclusion: it is
    // not a session write and must not be granted to one.
    expect(readAction("billing.ts")).toMatch(
      /createAdminClient\(\)\s*\.from\("companies"\)\s*\.update\(\{ stripe_customer_id: customerId \}\)/,
    );
  });
});

describe("extras", () => {
  /** One policy, from `create policy` to the semicolon that ends it. */
  function policyFor(begin: string): string {
    return addonsSql.match(new RegExp(`${begin}[\\s\\S]*?;`))?.[0] ?? "";
  }

  it("anchors an extra on the line, and never on the booking", () => {
    // The booking is reached through the line. A second column would let a row
    // claim a booking its line does not belong to, and the money column on the
    // board reads the line.
    const table = addonsSql.match(
      /create table if not exists public\.booking_line_addons \([\s\S]*?\n\);/,
    )?.[0];

    expect(table).toBeDefined();
    expect(table).toContain("line_item_id uuid not null");
    expect(table).not.toContain("booking_id");
  });

  it("asks about the bookings section, not the products section", () => {
    // The catalogue is the desk's offer list. Scoping it to `products` would
    // hide the extras from every workspace that rents without a catalogue.
    for (const policy of [
      policyFor('create policy "addons_select_member"'),
      policyFor('create policy "addons_insert_manager"'),
      policyFor('create policy "addon_products_select_member"'),
      policyFor('create policy "addon_products_insert_manager"'),
      policyFor('create policy "booking_line_addons_select_member"'),
      policyFor('create policy "booking_line_addons_insert_frontdesk"'),
    ]) {
      expect(policy).toContain("public.has_company_section(company_id, 'bookings')");
      expect(policy).not.toContain("'products'");
    }
  });

  it("snapshots the price on insert only", () => {
    // The copy is what makes a catalogue price an offer rather than a promise
    // about the past: the update branch re-imposes the stored values instead.
    expect(addonsSql).toContain(
      "create or replace function public.booking_line_addons_snapshot()",
    );
    // `TG_OP` is uppercase in PL/pgSQL, and a lowercase comparison is the
    // mistake this assertion exists to catch: the insert branch never runs, the
    // price is never copied and the scope is never checked.
    expect(addonsSql).toMatch(
      /if tg_op = 'INSERT' then[\s\S]{0,400}new\.unit_price_cents := catalogue_price;/,
    );
    expect(addonsSql).toMatch(
      /if tg_op = 'UPDATE' then[\s\S]{0,900}new\.unit_price_cents := old\.unit_price_cents;/,
    );
    expect(addonsSql).not.toMatch(/tg_op = 'insert'/);
  });

  it("treats an unscoped extra as offered with everything", () => {
    // `not exists (scope rows)` is the whole of that rule, in the trigger and in
    // `isAddonOfferedFor`. Losing it hides every extra from every line.
    expect(addonsSql).toMatch(
      /if exists \(\s*select 1 from public\.addon_products ap[\s\S]{0,500}and not exists \(/,
    );
    expect(addonsSql).toContain("ap.product_id in (line_product, parent_product)");
  });

  it("refuses a product change under a line that carries extras", () => {
    expect(addonsSql).toContain(
      "create or replace function public.booking_line_items_product_guard()",
    );
    expect(addonsSql).toContain(
      "before update of product_id on public.booking_line_items",
    );
    // An edit form always sends the product, so the trigger must compare before
    // it refuses — otherwise every save of a line with extras fails.
    expect(addonsSql).toContain(
      "if new.product_id is not distinct from old.product_id then",
    );
  });

  it("replaces a scope in one statement, as a definer", () => {
    // Two client writes could fail between each other and leave the extra
    // unscoped, which the schema reads as "every product".
    expect(addonsSql).toContain(
      "create or replace function public.set_addon_products(",
    );
    expect(addonsSql).toContain("security definer");
    expect(addonsSql).toContain("set search_path = ''");
    expect(addonsSql).toContain(
      "revoke all on function public.set_addon_products(uuid, uuid[]) from public, anon;",
    );
    expect(addonsSql).toContain(
      "grant execute on function public.set_addon_products(uuid, uuid[]) to authenticated, service_role;",
    );
  });

  it("gives the extras a composite key to point at", () => {
    // `booking_line_items` had no `unique (company_id, id)` before migration 15,
    // and without it the foreign key below could not exist.
    expect(addonsSql).toContain(
      "add constraint booking_line_items_company_id_unique",
    );
    expect(addonsSql).toContain(
      "references public.booking_line_items (company_id, id)",
    );
    expect(addonsSql).toContain("on delete cascade");
  });

  it("keeps trigger-only functions away from every client role", () => {
    for (const fn of [
      "public.booking_line_addons_snapshot()",
      "public.booking_line_items_product_guard()",
    ]) {
      expect(addonsSql).toContain(
        `revoke all on function ${fn} from public, anon, authenticated;`,
      );
    }
  });

  it("is gated after the tables it gates", () => {
    // Same reason as Guard 5 for the booking book: a policy cannot name a table
    // that does not exist yet.
    expect(
      MIGRATION_FILES.indexOf("20260101001600_addons_write_gate.sql"),
    ).toBeGreaterThan(
      MIGRATION_FILES.indexOf("20260101001500_catalog_addons.sql"),
    );
  });
});

describe("add-on stock", () => {
  it("adds the two columns without a rewrite", () => {
    // `add column if not exists` with a default is what keeps the migration
    // runnable on a database that already has catalogue rows.
    expect(addonStockSql).toContain(
      "add column if not exists track_stock boolean not null default false",
    );
    expect(addonStockSql).toContain(
      "add column if not exists quantity_on_hand integer not null default 0",
    );
    // Untracked is the default: a shop that never counts its helmets must not be
    // told it has run out.
    expect(addonStockSql).toContain(
      "add constraint addons_quantity_on_hand_check",
    );
    expect(addonStockSql).toContain(
      "check (quantity_on_hand between 0 and 9999)",
    );
  });

  it("answers the availability question as a definer", () => {
    expect(addonStockSql).toContain(
      "create or replace function public.check_addon_availability(",
    );
    expect(addonStockSql).toContain("exclude_line_item_id uuid default null");
    expect(addonStockSql).toContain("l.blocks_stock");
    expect(addonStockSql).toContain(
      "daterange(l.starts_on, l.ends_on, '[)')",
    );
    expect(addonStockSql).toContain("set search_path = ''");
    expect(addonStockSql).toContain(
      "revoke all on function public.check_addon_availability(uuid, uuid, date, date, uuid) from public, anon;",
    );
  });

  it("locks the add-on row before it counts", () => {
    // The lock is the oversell guard; the count is only the sentence. Without
    // `for update` two desks read the same free figure and both insert.
    expect(addonStockSql).toMatch(
      /from public\.addons a[\s\S]{0,200}for update;/,
    );
    expect(addonStockSql).toContain(
      "if taken + new.quantity > catalogue_on_hand then",
    );
    // Only a counted extra is checked, and only on a line that holds stock.
    expect(addonStockSql).toContain(
      "if catalogue_tracks and line_blocks_stock then",
    );
  });

  it("re-checks the extras when a booking starts holding stock", () => {
    expect(addonStockSql).toContain(
      "create or replace function public.bookings_addon_stock_guard()",
    );
    expect(addonStockSql).toContain(
      "before update of status on public.bookings",
    );
    expect(addonStockSql).toContain(
      "if not public.booking_blocks_stock(new.status)",
    );
    expect(addonStockSql).toContain("for update;");
    // The booking being confirmed must not count its own lines against itself.
    expect(addonStockSql).toContain("l.booking_id <> new.id");
  });

  it("keeps the trigger-only guard away from every client role", () => {
    expect(addonStockSql).toContain(
      "revoke all on function public.bookings_addon_stock_guard() from public, anon, authenticated;",
    );
    expect(addonStockSql).toContain(
      "grant execute on function public.bookings_addon_stock_guard() to service_role;",
    );
  });

  it("is applied after the table it alters", () => {
    expect(
      MIGRATION_FILES.indexOf("20260101001700_addon_stock.sql"),
    ).toBeGreaterThan(
      MIGRATION_FILES.indexOf("20260101001500_catalog_addons.sql"),
    );
  });
});

describe("components", () => {
  /** One policy, from `create policy` to the semicolon that ends it. */
  function policyFor(begin: string): string {
    return componentsSql.match(new RegExp(`${begin}[\\s\\S]*?;`))?.[0] ?? "";
  }

  it("keeps a component when its unit or kind goes away", () => {
    // The part still exists, still has a serial and still needs servicing: a
    // cascade would erase the history that is the reason the row exists.
    expect(componentsSql).toContain("on delete set null (asset_id)");
    expect(componentsSql).toContain("on delete set null (kind_id)");
  });

  it("states the fitted window as half-open, with a null meaning fitted", () => {
    expect(componentsSql).toContain(
      "removed_on is null or removed_on > fitted_on",
    );
    expect(componentsSql).toContain("removed_on date");
    expect(componentsSql).toContain("NULL means it is fitted now");
  });

  it("allows one fitted part of a kind per unit", () => {
    // Two forks on one bike is a typo, not a fitting. A partial unique index is
    // what holds under two people fitting at once.
    expect(componentsSql).toContain(
      "create unique index if not exists asset_components_fitted_kind_idx",
    );
    expect(componentsSql).toContain(
      "where asset_id is not null and kind_id is not null and removed_on is null",
    );
  });

  it("asks about the assets section, not products or bookings", () => {
    for (const policy of [
      policyFor('create policy "component_kinds_select_member"'),
      policyFor('create policy "component_kinds_insert_manager"'),
      policyFor('create policy "asset_components_select_member"'),
      policyFor('create policy "asset_components_insert_frontdesk"'),
      policyFor('create policy "asset_components_delete_manager"'),
    ]) {
      expect(policy).toContain("public.has_company_section(company_id, 'assets')");
      expect(policy).not.toContain("'products'");
      expect(policy).not.toContain("'bookings'");
    }
  });

  it("lets the workshop fit a part and a manager delete one", () => {
    // Fitting happens in the workshop; deleting a component erases its history.
    expect(policyFor('create policy "asset_components_insert_frontdesk"')).toContain(
      "'staff'",
    );
    expect(policyFor('create policy "asset_components_delete_manager"')).not.toContain(
      "'staff'",
    );
    expect(policyFor('create policy "component_kinds_delete_manager"')).not.toContain(
      "'staff'",
    );
  });

  it("gives the later stages a composite key to point at", () => {
    // Migration 20 hangs a booking line off a component; that foreign key needs
    // this unique pair to exist first.
    expect(componentsSql).toContain("unique (company_id, id)");
  });

  it("is gated after the tables it gates", () => {
    expect(
      MIGRATION_FILES.indexOf("20260101001900_components_write_gate.sql"),
    ).toBeGreaterThan(
      MIGRATION_FILES.indexOf("20260101001800_asset_components.sql"),
    );
  });
});

describe("components on a booking line", () => {
  it("lets a line hold a unit or a part, never both", () => {
    expect(componentBookingsSql).toContain(
      "add column if not exists component_id uuid",
    );
    expect(componentBookingsSql).toContain(
      "check (component_id is null or asset_id is null)",
    );
  });

  it("keeps the part when its booking line or the part itself goes", () => {
    expect(componentBookingsSql).toContain(
      "references public.asset_components (company_id, id)",
    );
    expect(componentBookingsSql).toContain("on delete set null (component_id)");
  });

  it("books one part to one hire at a time", () => {
    // The same shape the asset constraint has, on the same half-open window.
    expect(componentBookingsSql).toContain(
      "add constraint booking_line_items_component_no_overlap",
    );
    expect(componentBookingsSql).toContain("component_id with =,");
    expect(componentBookingsSql).toContain(
      "where (component_id is not null and blocks_stock)",
    );
  });

  it("refuses to book a fitted part, and to fit a booked one", () => {
    // The two halves are complements: a part can only be booked while it is out
    // of a unit, and it cannot go into one while a hire is counting on it.
    expect(componentBookingsSql).toContain(
      "create or replace function public.booking_line_items_component_guard()",
    );
    expect(componentBookingsSql).toContain(
      "That component is fitted to a unit, so it cannot be booked on its own",
    );
    expect(componentBookingsSql).toContain(
      "create or replace function public.asset_components_booking_guard()",
    );
    expect(componentBookingsSql).toContain(
      "That component is on a booking, so it cannot be fitted to a unit",
    );
  });

  it("watches the columns that make the difference", () => {
    // `removed_on` is watched because clearing it is the same act as fitting.
    expect(componentBookingsSql).toContain(
      "before insert or update of component_id, asset_id on public.booking_line_items",
    );
    expect(componentBookingsSql).toContain(
      "before insert or update of asset_id, removed_on on public.asset_components",
    );
    // An edit that sends the column unchanged must not be refused: the line edit
    // form always posts the product, the unit and the part.
    expect(componentBookingsSql).toContain(
      "new.component_id is not distinct from old.component_id",
    );
  });

  it("keeps both guards away from every client role", () => {
    for (const fn of [
      "public.booking_line_items_component_guard()",
      "public.asset_components_booking_guard()",
    ]) {
      expect(componentBookingsSql).toContain(
        `revoke all on function ${fn} from public, anon, authenticated;`,
      );
    }
  });

  it("is applied after both tables it touches", () => {
    expect(
      MIGRATION_FILES.indexOf("20260101002000_component_bookings.sql"),
    ).toBeGreaterThan(
      MIGRATION_FILES.indexOf("20260101001800_asset_components.sql"),
    );
    expect(
      MIGRATION_FILES.indexOf("20260101002000_component_bookings.sql"),
    ).toBeGreaterThan(
      MIGRATION_FILES.indexOf("20260101001300_bookings.sql"),
    );
  });
});

describe("usage logs and servicing", () => {
  it("stores readings, not an odometer", () => {
    // The column comment is the contract: every sum in the view assumes the
    // number is "since the last reading".
    expect(usageSql).toContain(
      "constraint asset_usage_logs_reading check (hours > 0 or distance_km > 0)",
    );
    expect(usageSql).toContain("Hours since the previous reading");
    expect(usageSql).toContain("Kilometres since the previous reading");
    expect(usageSql).toContain("on delete cascade");
  });

  it("puts the interval on the kind, not on the part", () => {
    expect(serviceSql).toContain(
      "add column if not exists interval_days integer",
    );
    expect(serviceSql).toContain("add column if not exists interval_km");
    expect(serviceSql).toContain("add column if not exists interval_hours");
    expect(serviceSql).toContain(
      "a shop services every",
    );
  });

  it("derives the service state instead of storing it", () => {
    expect(serviceSql).toContain(
      "create or replace view public.component_service_status",
    );
    expect(serviceSql).toContain("with (security_invoker = true)");
    expect(serviceSql).toContain("then 'overdue'");
    expect(serviceSql).toContain("then 'due_soon'");
    expect(serviceSql).toContain("else 'ok'");
    // 80% is where a workshop hears about it; below that it is quiet.
    expect(serviceSql).toContain("* 0.8");
    // Usage is clipped to the fitted window and to the last service.
    expect(serviceSql).toContain("l.logged_on >= p.counted_from");
    expect(serviceSql).toContain(
      "p.removed_on is null or l.logged_on < p.removed_on",
    );
    expect(serviceSql).toContain(
      "revoke all on public.component_service_status from anon;",
    );
  });

  it("gates both new tables after they exist", () => {
    expect(
      MIGRATION_FILES.indexOf("20260101002300_usage_write_gate.sql"),
    ).toBeGreaterThan(
      MIGRATION_FILES.indexOf("20260101002100_asset_usage_logs.sql"),
    );
    expect(
      MIGRATION_FILES.indexOf("20260101002300_usage_write_gate.sql"),
    ).toBeGreaterThan(
      MIGRATION_FILES.indexOf("20260101002200_component_service.sql"),
    );
  });
});

describe("rented is derived", () => {
  it("keeps the enum change and its use in separate migrations", () => {
    // PostgreSQL refuses to use a value added in the same transaction, which is
    // the only reason these are two files.
    expect(
      MIGRATION_FILES.indexOf("20260101002500_asset_status_rented.sql"),
    ).toBeGreaterThan(
      MIGRATION_FILES.indexOf("20260101002400_asset_status_workshop.sql"),
    );
  });

  it("remembers what the unit was", () => {
    expect(rentedSql).toContain(
      "add column if not exists status_before_rent public.asset_status",
    );
    expect(rentedSql).toContain("status_before_rent = current_status");
    expect(rentedSql).toContain(
      "set status = coalesce(status_before_rent, 'available')",
    );
  });

  it("only counts today, half-open", () => {
    // The same arithmetic as the exclusion constraint: out on the 4th, back and
    // free on the morning of the 8th.
    expect(rentedSql).toContain("l.starts_on <= current_date");
    expect(rentedSql).toContain("l.ends_on > current_date");
  });

  it("is written by a trigger and by nothing else", () => {
    expect(rentedSql).toContain(
      "create or replace function public.refresh_asset_rented(",
    );
    expect(rentedSql).toContain(
      "after insert or update of asset_id, blocks_stock, starts_on, ends_on",
    );
    expect(rentedSql).toContain(
      "revoke all on function public.refresh_asset_rented(uuid, uuid) from public, anon, authenticated;",
    );
    expect(rentedSql).toContain(
      "revoke all on function public.booking_line_items_asset_status() from public, anon, authenticated;",
    );
  });

  it("does not let a person set it", () => {
    // The action and the form both refuse it; `ASSET_SETTABLE_STATUSES` is the
    // list they use, and it is deliberately shorter than the enum.
    expect(ASSET_STATUSES).toContain("rented");
  });
});

