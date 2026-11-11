import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowRightIcon, PlusIcon } from "lucide-react";
import { Suspense } from "react";

import { FormMessage } from "@/components/form-message";
import { CompanyMark } from "@/components/tenant/company-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { respondToInvitation } from "@/lib/actions/invitations";
import {
  getPendingInvitations,
  getWorkspaces,
  type PendingInvitation,
  type Workspace,
} from "@/lib/auth";
import { roleLabel } from "@/lib/roles";
import { readParam } from "@/lib/search-params";

export const metadata: Metadata = {
  title: "Your workspaces",
};

export default function WorkspacesPage({
  searchParams,
}: PageProps<"/workspaces">) {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Your workspaces
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Pick a company to continue.
          </p>
        </div>
        <Button asChild>
          <Link href="/onboarding">
            <PlusIcon aria-hidden="true" />
            New company
          </Link>
        </Button>
      </div>

      <Suspense
        fallback={
          <div className="grid gap-3">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        }
      >
        <WorkspacesContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function WorkspacesContent({
  searchParams,
}: {
  searchParams: PageProps<"/workspaces">["searchParams"];
}) {
  // Creating the client starts `auth-js`' session recovery, which reads the
  // current time. Render at request time so that read does not happen while
  // prerendering, where it is reported as an unstable value.
  await connection();

  const [query, workspaces, invitations] = await Promise.all([
    searchParams,
    getWorkspaces(),
    getPendingInvitations(),
  ]);

  return (
    <div className="space-y-6">
      <FormMessage
        error={readParam(query.error)}
        success={readParam(query.ok)}
      />

      {invitations.length > 0 ? (
        <InvitationList invitations={invitations} />
      ) : null}

      <WorkspaceList workspaces={workspaces} />
    </div>
  );
}

/**
 * Invitations waiting on this user.
 *
 * Nothing here is reachable until they accept: a pending membership is ignored
 * by every RLS predicate, so the company does not appear in the list below.
 */
function InvitationList({
  invitations,
}: {
  invitations: PendingInvitation[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending invitations</CardTitle>
        <CardDescription>
          Someone added you to their workspace. Accept to get access to it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-border divide-y rounded-xl border">
          {invitations.map((invitation) => (
            <li
              key={invitation.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {invitation.companyName}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  /{invitation.companySlug} · {roleLabel(invitation.role)}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <form action={respondToInvitation}>
                  <input
                    type="hidden"
                    name="membership_id"
                    value={invitation.id}
                  />
                  <input type="hidden" name="decision" value="accept" />
                  <Button type="submit" size="sm">
                    Accept
                  </Button>
                </form>
                <form action={respondToInvitation}>
                  <input
                    type="hidden"
                    name="membership_id"
                    value={invitation.id}
                  />
                  <input type="hidden" name="decision" value="decline" />
                  <Button type="submit" size="sm" variant="ghost">
                    Decline
                  </Button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function WorkspaceList({ workspaces }: { workspaces: Workspace[] }) {
  if (workspaces.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No workspaces yet</CardTitle>
          <CardDescription>
            Create your first company to get a workspace of your own.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/onboarding">
              Create a company
              <ArrowRightIcon aria-hidden="true" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="grid gap-3">
      {workspaces.map((workspace) => (
        <li key={workspace.id}>
          <WorkspaceRow workspace={workspace} />
        </li>
      ))}
    </ul>
  );
}

function WorkspaceRow({ workspace }: { workspace: Workspace }) {
  const needsBilling =
    workspace.subscriptionStatus === "none" ||
    workspace.subscriptionStatus === "past_due" ||
    workspace.subscriptionStatus === "unpaid" ||
    workspace.subscriptionStatus === "canceled";

  return (
    <Link
      href={`/${workspace.slug}/dashboard`}
      className="border-border/60 hover:bg-accent/60 flex items-center justify-between gap-4 rounded-xl border p-4 transition-colors"
    >
      <div className="flex min-w-0 items-center gap-3">
        <CompanyMark
          name={workspace.name}
          logoUrl={workspace.logoUrl}
          badge={workspace.badge}
          className="size-10"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{workspace.name}</p>
          <p className="text-muted-foreground truncate text-xs">
            /{workspace.slug} · {roleLabel(workspace.role)}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {needsBilling ? (
          <Badge variant="outline">Billing needed</Badge>
        ) : (
          <Badge
            variant={
              workspace.subscriptionStatus === "active" ? "success" : "secondary"
            }
          >
            {workspace.subscriptionStatus}
          </Badge>
        )}
        <ArrowRightIcon aria-hidden="true" className="size-4" />
      </div>
    </Link>
  );
}
