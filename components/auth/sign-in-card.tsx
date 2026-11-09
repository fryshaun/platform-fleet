import { AuthError } from "@/components/auth/auth-message";
import {
  EmailPasswordForm,
  type AuthMode,
} from "@/components/auth/email-password-form";
import { MagicLinkForm } from "@/components/auth/magic-link-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { signInWithGoogle } from "@/lib/actions/auth";

type SignInCardProps = {
  /** Sign in or sign up: only the copy and the default `next` differ. */
  mode: AuthMode;
  /** Where to send the user after a successful sign in. */
  next: string;
  title: string;
  description: string;
  /** Error forwarded from the callback, e.g. a refused code. */
  error?: string;
};

/**
 * One card for both entry points: email + password first, Google and a
 * passwordless link as alternatives.
 */
export function SignInCard({
  mode,
  next,
  title,
  description,
  error,
}: SignInCardProps) {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <AuthError>{error}</AuthError> : null}

        <EmailPasswordForm mode={mode} next={next} />

        <Divider />

        <form action={signInWithGoogle}>
          <input type="hidden" name="next" value={next} />
          <Button
            type="submit"
            variant="outline"
            size="lg"
            className="w-full"
          >
            <GoogleMark />
            Continue with Google
          </Button>
        </form>

        <MagicLinkForm next={next} />

        <p className="text-muted-foreground text-center text-xs leading-relaxed">
          We use your email or Google account only for identity. You can delete
          your account at any time.
        </p>
      </CardContent>
    </Card>
  );
}

function Divider() {
  return (
    <div className="text-muted-foreground flex items-center gap-3 text-xs uppercase">
      <span aria-hidden="true" className="bg-border h-px flex-1" />
      or
      <span aria-hidden="true" className="bg-border h-px flex-1" />
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path
        fill="currentColor"
        d="M21.35 11.1H12v2.98h5.35c-.23 1.37-1.66 4.02-5.35 4.02a6.1 6.1 0 0 1 0-12.2c1.73 0 2.89.74 3.55 1.37l2.42-2.33C16.53 3.53 14.47 2.6 12 2.6a9.4 9.4 0 0 0 0 18.8c5.43 0 9.02-3.81 9.02-9.18 0-.62-.07-1.09-.15-1.56Z"
      />
    </svg>
  );
}
