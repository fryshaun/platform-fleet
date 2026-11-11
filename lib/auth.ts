import "server-only";

import { cacheLife } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { hasPasswordProvider } from "@/lib/account";
import { createClient } from "@/lib/supabase/server";
import type {
  MemberRole,
  SubscriptionStatus,
  Tables,
} from "@/lib/supabase/types";

export type SessionUser = {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  /**
   * Whether the account has a password to confirm before changing it, or only
   * an OAuth provider. See `hasPasswordProvider`.
   */
  hasPassword: boolean;
};

export type Company = Tables<"companies">;

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  role: MemberRole;
  subscriptionStatus: SubscriptionStatus;
  /** The uploaded mark, or `null` — the chooser then draws the badge. */
  logoUrl: string | null;
  /** One or two characters or an emoji; `null` means the initials of the name. */
  badge: string | null;
};

export type TenantContext = {
  company: Company;
  role: MemberRole;
  user: SessionUser;
};

/**
 * Data Access Layer for identity and tenancy.
 *
 * Every read here is `'use cache: private'`: it touches the session cookie, so
 * the result is request-scoped and never stored in a server cache that other
 * users could hit. Callers must sit behind a `<Suspense>` boundary.
 */

/** The signed-in user, or `null`. Never throws. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  "use cache: private";
  cacheLife("minutes");

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  return {
    id: user.id,
    email: user.email ?? "",
    fullName: profile?.full_name ?? null,
    avatarUrl: profile?.avatar_url ?? null,
    hasPassword: hasPasswordProvider(user.app_metadata?.providers),
  };
}

/** The signed-in user, redirecting to `/login` when absent. */
export async function requireUser(nextPath: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }
  return user;
}

/** Every company the current user belongs to, with their role in each. */
export async function getWorkspaces(): Promise<Workspace[]> {
  "use cache: private";
  cacheLife("minutes");

  const user = await getCurrentUser();
  if (!user) {
    return [];
  }

  const supabase = await createClient();

  const { data: memberships } = await supabase
    .from("company_members")
    .select("company_id, role")
    .eq("user_id", user.id);

  if (!memberships || memberships.length === 0) {
    return [];
  }

  const { data: companies } = await supabase
    .from("companies")
    .select("id, name, slug, subscription_status, logo_url, badge")
    .in(
      "id",
      memberships.map((membership) => membership.company_id),
    );

  if (!companies) {
    return [];
  }

  const roleByCompany = new Map(
    memberships.map((membership) => [membership.company_id, membership.role]),
  );

  return companies
    .map((company) => ({
      id: company.id,
      name: company.name,
      slug: company.slug,
      subscriptionStatus: company.subscription_status,
      logoUrl: company.logo_url,
      badge: company.badge,
      role: roleByCompany.get(company.id) ?? "member",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type PendingInvitation = {
  id: string;
  companyName: string;
  companySlug: string;
  role: MemberRole;
  invitedAt: string | null;
};

/**
 * Invitations the current user has not answered yet.
 *
 * A pending membership is invisible under RLS — that is the whole point of
 * migration 08 — so the caller's own pending rows can only be read through
 * `my_pending_invitations()`, which filters on `auth.uid()`.
 */
export async function getPendingInvitations(): Promise<PendingInvitation[]> {
  "use cache: private";
  cacheLife("minutes");

  const user = await getCurrentUser();
  if (!user) {
    return [];
  }

  const supabase = await createClient();
  const { data } = await supabase.rpc("my_pending_invitations");

  return (data ?? []).map((row) => ({
    id: row.membership_id,
    companyName: row.company_name,
    companySlug: row.company_slug,
    role: row.role,
    invitedAt: row.invited_at,
  }));
}

/**
 * Resolves a tenant from its URL slug and asserts the current user is a member.
 *
 * A missing company and a company the user cannot access both produce
 * `notFound()` so tenant slugs cannot be enumerated.
 */
export async function getTenantContext(slug: string): Promise<TenantContext> {
  "use cache: private";
  cacheLife("minutes");

  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/${slug}/dashboard`)}`);
  }

  const supabase = await createClient();

  const { data: company } = await supabase
    .from("companies")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (!company) {
    notFound();
  }

  const { data: membership } = await supabase
    .from("company_members")
    .select("role")
    .eq("company_id", company.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    notFound();
  }

  return { company, role: membership.role, user };
}

/**
 * Role predicates live in `lib/roles.ts` so Client Components can use them
 * without importing this server-only data access layer. Re-exported here for
 * callers that already resolve the tenant through this module.
 */
export * from "@/lib/roles";
