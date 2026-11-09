import "server-only";

import { redirect } from "next/navigation";

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

/** Reads an integer field, returning `null` when absent or invalid. */
export function readInt(formData: FormData, name: string): number | null {
  const raw = readField(formData, name);
  if (raw === "") return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
