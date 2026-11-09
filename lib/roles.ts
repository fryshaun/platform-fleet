import type { MemberRole } from "@/lib/supabase/types";

/**
 * Role metadata and authorization predicates.
 *
 * This module is deliberately free of framework and database imports so both
 * Server Components and Client Components can use the same labels and checks.
 * Authorization is still enforced by Postgres RLS; these helpers only decide
 * what the UI and Server Actions offer.
 */

export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  staff: "Staff",
  member: "Viewer",
};

/**
 * One line per role, shown in the invite picker.
 *
 * `manager` and `staff` describe a tier rather than a fixed set of screens: the
 * products section interprets them (manager writes, staff reads), and a module
 * that needs a front-desk writer attaches to `canFrontDesk`.
 */
export const ROLE_DESCRIPTIONS: Record<MemberRole, string> = {
  owner: "Full control, including billing and ownership.",
  admin: "Billing, workspace settings and team management.",
  manager: "Supervises day-to-day work; extend this tier per feature module.",
  staff: "Front-line tier below manager; extend this tier per feature module.",
  member: "Read-only access to the workspace.",
};

/**
 * Roles an owner or admin may hand out. Ownership and admin rights are
 * intentionally not assignable from the team screen.
 */
export const ASSIGNABLE_ROLES = ["manager", "staff", "member"] as const;

export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const ASSIGNABLE_ROLE_OPTIONS = ASSIGNABLE_ROLES.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
  description: ROLE_DESCRIPTIONS[role],
}));

export function isAssignableRole(value: unknown): value is AssignableRole {
  return (
    typeof value === "string" &&
    (ASSIGNABLE_ROLES as readonly string[]).includes(value)
  );
}

export function roleLabel(role: MemberRole): string {
  return ROLE_LABELS[role] ?? role;
}

/** True when the role may manage billing, the company profile and the team. */
export function canAdminister(role: MemberRole): boolean {
  return role === "owner" || role === "admin";
}

/**
 * True when the role may write a feature module's records.
 *
 * The products section is the first user: `requireManager` in
 * `lib/actions/support.ts` is its Server Action counterpart, and the module's
 * RLS policies admit the same three roles. Both checks exist because neither is
 * sufficient on its own.
 */
export function canManage(role: MemberRole): boolean {
  return canAdminister(role) || role === "manager";
}

/**
 * True when the role may do front-line work.
 *
 * Like `canManage`, this exists for feature modules rather than for the base
 * template; `requireFrontDesk` is its Server Action counterpart.
 */
export function canFrontDesk(role: MemberRole): boolean {
  return canManage(role) || role === "staff";
}

/** True when the role may transfer ownership or delete the company. */
export function isOwner(role: MemberRole): boolean {
  return role === "owner";
}
