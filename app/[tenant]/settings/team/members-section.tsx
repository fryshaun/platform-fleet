import { Trash2Icon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  inviteMember,
  removeMember,
  updateMemberRole,
} from "@/lib/actions/members";
import {
  ASSIGNABLE_ROLE_OPTIONS,
  isAssignableRole,
  roleLabel,
} from "@/lib/roles";
import type { MemberRole } from "@/lib/supabase/types";

export type TeamMember = {
  id: string;
  userId: string;
  email: string;
  fullName: string | null;
  role: MemberRole;
  invitedAt: string | null;
  acceptedAt: string | null;
};

const SELECT_CLASSES =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px]";

export function MembersSection({
  slug,
  members,
  currentUserId,
}: {
  slug: string;
  members: TeamMember[];
  currentUserId: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Team</CardTitle>
        <CardDescription>
          Invite managers, front-desk staff and read-only viewers. Owners and
          admins can manage this list and billing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form
          action={inviteMember}
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end"
        >
          <input type="hidden" name="slug" value={slug} />

          <div className="space-y-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              name="email"
              type="email"
              autoComplete="off"
              placeholder="teammate@example.com"
              required
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="invite-role">Role</Label>
            <select
              id="invite-role"
              name="role"
              defaultValue="staff"
              className={SELECT_CLASSES}
            >
              {ASSIGNABLE_ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <Button type="submit">Send invite</Button>
        </form>

        <ul className="divide-border divide-y rounded-xl border">
          {members.map((member) => (
            <li key={member.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {member.fullName ?? member.email}
                    {member.userId === currentUserId ? (
                      <span className="text-muted-foreground font-normal">
                        {" "}
                        · You
                      </span>
                    ) : null}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {member.email}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <StatusBadge acceptedAt={member.acceptedAt} />
                  <MemberControls member={member} slug={slug} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function MemberControls({
  member,
  slug,
}: {
  member: TeamMember;
  slug: string;
}) {
  if (!isAssignableRole(member.role)) {
    return <Badge variant="secondary">{roleLabel(member.role)}</Badge>;
  }

  return (
    <>
      <form
        action={updateMemberRole}
        className="flex items-center gap-2"
        aria-label={`Role for ${member.email}`}
      >
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="membership_id" value={member.id} />
        <select
          name="role"
          defaultValue={member.role}
          aria-label={`Role for ${member.email}`}
          className={`${SELECT_CLASSES} w-28`}
        >
          {ASSIGNABLE_ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" variant="outline">
          Save
        </Button>
      </form>

      <form action={removeMember}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="membership_id" value={member.id} />
        <Button type="submit" size="sm" variant="ghost">
          <Trash2Icon aria-hidden="true" />
          Remove
        </Button>
      </form>
    </>
  );
}

function StatusBadge({ acceptedAt }: { acceptedAt: string | null }) {
  return acceptedAt ? (
    <Badge variant="success">Registered</Badge>
  ) : (
    <Badge variant="outline">Invitation sent</Badge>
  );
}
