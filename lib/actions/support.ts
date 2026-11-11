import "server-only";

import { redirect } from "next/navigation";

import { hasPasswordProvider } from "@/lib/account";
import { isSectionEnabled, type SectionKey } from "@/lib/features";
import {
  canAdminister,
  canFrontDesk,
  canManage,
} from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import type { MemberRole, Tables } from "@/lib/supabase/types";

export type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

export type ActionContext = {
  supabase: ServerSupabase;
  user: { id: string; email: string };
  company: Tables<"companies">;
  role: MemberRole;
};

/**
 * Resolves the tenant for a Server Action.
 *
 * Server Actions do not go through the cached data access layer, so the session
 * and membership are re-read here. That is deliberate: an action must authorize
 * itself rather than trusting anything the page already rendered.
 */
export async function getActionContext(slug: string): Promise<ActionContext> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/${slug}/dashboard`)}`);
  }

  const { data: company } = await supabase
    .from("companies")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (!company) {
    redirect("/workspaces");
  }

  const { data: membership } = await supabase
    .from("company_members")
    .select("role")
    .eq("company_id", company.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    redirect("/workspaces");
  }

  return {
    supabase,
    user: { id: user.id, email: user.email ?? "" },
    company,
    role: membership.role,
  };
}

export type SessionContext = {
  supabase: ServerSupabase;
  user: { id: string; email: string; hasPassword: boolean };
};

/**
 * Resolves the signed-in user for an action that belongs to the person rather
 * than to a workspace.
 *
 * Account actions (name, photo, password) are the same in every tenant, so they
 * take no slug. The row they write is keyed by `auth.uid()` and RLS stops them
 * touching anything else, which is why a plain session is a complete check here
 * — there is no role to look up.
 */
export async function getSessionContext(): Promise<SessionContext> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return {
    supabase,
    user: {
      id: user.id,
      email: user.email ?? "",
      hasPassword: hasPasswordProvider(user.app_metadata?.providers),
    },
  };
}


/** Throws unless the caller may manage billing, the team or company details. */
export function requireAdministrator(context: ActionContext, slug: string) {
  if (!canAdminister(context.role)) {
    redirectWith(slug, "dashboard", {
      error: "You do not have permission to do that.",
    });
  }
}

/** Throws unless the caller holds the manager tier or above. */
export function requireManager(context: ActionContext, slug: string) {
  if (!canManage(context.role)) {
    redirectWith(slug, "dashboard", {
      error: "You do not have permission to do that.",
    });
  }
}

/** Throws unless the caller holds the front-desk tier or above. */
export function requireFrontDesk(context: ActionContext, slug: string) {
  if (!canFrontDesk(context.role)) {
    redirectWith(slug, "dashboard", {
      error: "You do not have permission to do that.",
    });
  }
}

/**
 * Throws unless the workspace has the section switched on.
 *
 * This is the Server Action half of `has_company_section()`: RLS is what
 * actually stops a write when a section is off, and this turns the resulting
 * empty result set into an explanation instead of a silent no-op. Owner and
 * admin can flip the switch on Settings → Extensions.
 */
export function requireSection(
  context: ActionContext,
  slug: string,
  section: SectionKey,
) {
  if (!isSectionEnabled(context.company, section)) {
    redirectWith(slug, "dashboard", {
      error: "That extension is not enabled for this workspace.",
    });
  }
}

/**
 * Redirects to a tenant path. Used to return after a mutation so the page
 * re-renders with fresh data and a human-readable message.
 */
export function redirectWith(
  slug: string,
  path: string,
  params: Record<string, string>,
): never {
  const search = new URLSearchParams(params).toString();
  redirect(`/${slug}/${path}${search ? `?${search}` : ""}`);
}

/** Reads a trimmed string field, treating empty values as absent. */
export function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Reads a field verbatim, without trimming.
 *
 * Passwords are the fields where that matters: a leading or trailing space is
 * part of the password, and a helpful trim would quietly change it.
 */
export function readSecret(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Reads an integer field, returning `null` when absent or invalid. */
export function readInt(formData: FormData, name: string): number | null {
  const raw = readField(formData, name);
  if (raw === "") return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
