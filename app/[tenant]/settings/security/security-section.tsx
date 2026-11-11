import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { updateTwoFactorPolicy } from "@/lib/actions/settings";
import { MFA_SETUP_PATH } from "@/lib/mfa";

/**
 * Settings → Security: the second-factor policy.
 *
 * One switch, because there is one question: must everyone in this workspace
 * prove a second factor? The rest of the card explains what happens to the
 * people who have not set one up yet — an owner flipping this needs to know that
 * their team is about to be interrupted, and that turning it off again is how a
 * member who lost their phone gets back in.
 */
export function SecuritySection({
  slug,
  requireMfa,
  enrolled,
}: {
  slug: string;
  requireMfa: boolean;
  /** Whether the person reading this has an authenticator of their own. */
  enrolled: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Two-factor authentication</CardTitle>
        <CardDescription>
          A password can be guessed, reused or phished. An authenticator app
          cannot: the second code only exists on the device that holds the key.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form action={updateTwoFactorPolicy} className="space-y-4">
          <input type="hidden" name="slug" value={slug} />

          <div className="flex items-start gap-3">
            <input
              id="require-mfa"
              name="require_mfa"
              type="checkbox"
              value="on"
              defaultChecked={requireMfa}
              className="accent-primary mt-1 size-4"
            />
            <div className="min-w-0 space-y-1">
              <Label htmlFor="require-mfa">
                Require two-factor authentication
              </Label>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Everyone in this workspace signs in with a password and a code
                from an authenticator app. Anyone who has not added one yet is
                asked to do so the next time they open the workspace — they are
                not signed out, and nothing they own is deleted.
              </p>
            </div>
          </div>

          <Button type="submit">Save security settings</Button>
        </form>

        <div className="space-y-2 border-t pt-4">
          <p className="text-sm font-medium">Your own account</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {enrolled
              ? "You have an authenticator app set up. Manage it — and your backup codes — from the account menu at the bottom of the rail."
              : "You have not added an authenticator yet. Turning the requirement on applies to you as well, so set yours up first."}
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href={MFA_SETUP_PATH}>
              {enrolled ? "Review your authenticator" : "Set up an authenticator"}
            </Link>
          </Button>
        </div>

        <p className="text-muted-foreground border-t pt-4 text-xs leading-relaxed">
          Lost phone? Turn the requirement off, the member signs in and adds a new
          authenticator, then turn it back on. Owners and admins can do that here;
          nobody else can.
        </p>
      </CardContent>
    </Card>
  );
}