import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type {
  Database,
  MemberRole,
  SubscriptionStatus,
} from "@/lib/supabase/types";

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
] as const;

function readMigration(name: string): string {
  return readFileSync(`${MIGRATIONS_DIR}${name}`, "utf8");
}

const accountsSql = readMigration("20260101000000_accounts_and_companies.sql");
const invitationSql = readMigration("20260101000100_team_invitations.sql");
const allSql = [accountsSql, invitationSql].join("\n");

type PublicSchema = Database["public"];
type TableName = keyof PublicSchema["Tables"];

/**
 * Every table the application expects to exist.
 *
 * The `satisfies` clause makes a typo a compile error, and `_TablesCovered`
 * makes an omission a compile error too: if a table is added to
 * `lib/supabase/types.ts` and not listed here, that alias resolves to `never`
 * and `pnpm typecheck` fails.
 */
const TABLES = ["profiles", "companies", "company_members"] as const satisfies
  readonly TableName[];

export type _TablesCovered = Exclude<
  TableName,
  (typeof TABLES)[number]
> extends never
  ? true
  : never;

describe("type definitions", () => {
  it("describes the three core tables", () => {
    expect(TABLES).toHaveLength(3);
  });

  it("declares every table in a migration", () => {
    for (const table of TABLES) {
      expect(
        allSql.includes(`create table if not exists public.${table} (`),
        `${table} is missing from the migrations`,
      ).toBe(true);
    }
  });

  it("ships no domain tables of its own", () => {
    // The template is the base a feature module builds on: every table here is
    // part of accounts, tenancy or billing state.
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
});
