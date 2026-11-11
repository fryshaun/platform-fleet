# Supabase email templates

Every email this app sends points at one route: `/auth/callback`. It verifies the
link and then forwards to the `next` you name in the template, so each template
is a URL plus a `type` plus a destination. This file records the values that make
that work, and the HTML to paste into **Authentication → Emails**.

`app/auth/callback/route.ts` is the contract: it accepts `?token_hash=…&type=…`,
or `?code=…` (OAuth), validates `next` as a same-origin path, and only then
redirects.

## Use `token_hash`, not `{{ .ConfirmationURL }}`

Supabase's default link is `{{ .ConfirmationURL }}`, which points at GoTrue's
`/verify` endpoint. That endpoint redirects back with `?code=…`, and a PKCE code
is only exchangeable by the browser that holds the verifier cookie — which is
almost never the browser that opens the email. The link works on the desktop that
requested it and fails on the phone.

`{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=…` is
self-contained: the token carries everything, so any browser can verify it. The
same reason is why `inviteUserByEmail` cannot use PKCE at all — the person who
invites and the person who accepts are on different machines.

Mail scanners (Outlook Safe Links and friends) still fetch every URL they are
given, and a fetch spends a single-use token. The answer is the six-digit code:
`{{ .Token }}` in the **Magic Link** template is what makes the code form on
`/login` and the callback's `type=email` fallback work. Turn off link rewriting
at your mail provider where you can.

Two details that decide whether a template works:

- `next` is a query value, so it is URL-encoded: `%2Fonboarding`, not
  `/onboarding`. A missing `next` falls back to `/workspaces`.
- In an HTML `href`, write `&amp;` between parameters. Browsers decode it to `&`;
  a validator does not.

## Project settings

**Authentication → URL Configuration**

| Setting       | Value                                                                |
| ------------- | -------------------------------------------------------------------- |
| Site URL      | the production origin, no trailing slash (`https://app.example.com`)  |
| Redirect URLs | `https://app.example.com/**`, `http://localhost:3000/**`, `https://*-<team>.vercel.app/**` for previews |

A `redirect_to` that is not on the list is refused, and GoTrue falls back to the
bare Site URL — the result then arrives at `/?code=…`, which `proxy.ts` forwards
to the callback. The flow still completes, but the site URL must be the origin
and not a deep path, or that fallback has nowhere to go.

**Authentication → Sign In / Providers → Email**

| Setting                | Value | Why                                                                                              |
| ---------------------- | ----- | ------------------------------------------------------------------------------------------------ |
| Confirm email          | on    | `/signup` shows "check your inbox"; it never assumes a session                                   |
| Email OTP length       | 6     | `OTP_LENGTH` in `lib/auth-policy.ts` is 6, and `verifyEmailOtp` rejects anything else            |
| Email OTP expiry       | 3600  | the copy promises "it expires in an hour"                                                        |
| Secure password change | off   | `changePassword` proves the old password by signing in and sends no reauthentication nonce; with this on, `updateUser({ password })` fails with "needs reauthentication" |

**Authentication → Settings**

- **Custom SMTP** before anyone outside your team uses the app. The built-in
  sender is rate-limited to a handful of messages an hour, which invitations and
  magic links exhaust immediately.
- **Secure email change** is your call. The callback verifies `type=email_change`
  either way; with it on, both addresses have to confirm.

## The five templates that carry a link

| Template             | `type`         | `next`              | Sent from              |
| -------------------- | -------------- | ------------------- | ---------------------- |
| Confirm signup       | `signup`       | `%2Fonboarding`     | `signUpWithEmail`      |
| Magic Link           | `magiclink`    | `%2Fworkspaces`     | `sendMagicLink`        |
| Invite user          | `invite`       | `%2Fworkspaces`     | `inviteMember`         |
| Reset password       | `recovery`     | `%2Freset-password` | `requestPasswordReset` |
| Change Email Address | `email_change` | `%2Fworkspaces`     | Supabase, if you add that screen |

Three of these values are load-bearing:

- `type=invite` is what makes the callback call `accept_company_invitations()`.
  Without it the invitation stays pending and the workspace stays closed.
- `type=recovery` is what makes the callback mark the browser as having opened a
  recovery link; `/reset-password` refuses to replace a password without it.
- `next=%2Freset-password` is the only page that marker is valid on. A recovery
  link that lands anywhere else verifies fine and then dead-ends.

### Confirm signup

Subject: `Confirm your email address`

`href`:

```
{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&amp;type=signup&amp;next=%2Fonboarding
```

After confirming, a new account names its company and picks a plan on
`/onboarding`.

### Magic Link

Subject: `Your sign-in link and code`

`href`:

```
{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&amp;type=magiclink&amp;next=%2Fworkspaces
```

The code below the button (`{{ .Token }}`) is not decoration: it is the only path
that works when the mail is opened on a different device, and it is what the
"Code from the email" field submits. If the template leaves `{{ .Token }}` out,
that field can never succeed.

### Invite user

Subject: `You've been invited to a workspace`

`href`:

```
{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&amp;type=invite&amp;next=%2Fworkspaces
```

`inviteMember` sends `data: { company_name }`, so the body can name the workspace:

```
{{ if index .Data "company_name" }}{{ index .Data "company_name" }} has invited you{{ else }}You have been invited{{ end }}
```

The `if` guard matters: an invitation sent without that data renders
`<no value>` otherwise.

### Reset password

Subject: `Reset your password`

`href`:

```
{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&amp;type=recovery&amp;next=%2Freset-password
```

The link is single-use and expires with the OTP expiry (an hour). It lands on
`/reset-password`, which asks for the new password twice and saves it; the
recipient never has to remember the old one. Opening the page again afterwards —
or opening it without having come through the link — shows "This link has
expired" rather than a form.

### Change Email Address

Subject: `Confirm your new email address`

`href`:

```
{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&amp;type=email_change&amp;next=%2Fworkspaces
```

`verifyOtp({ token_hash, type })` needs no address for this type, which is why the
callback can verify both messages (old address and new) with the same code path.

## Templates without a link

**Reauthentication** sends a code and no link; it is only used if you call
`supabase.auth.reauthenticate()`, which this app does not. **Password changed**,
**Email changed** and the other security notices are plain notifications — no
`type`, no `next`. Leave their wording to say what happened and to point people at
support if it was not them.

## Ready-to-paste HTML

The markup below is deliberately plain: a table for the button (Outlook ignores
`border-radius` on `<a>`), inline styles, no external CSS. Each template repeats
the shell because Supabase wants a complete document per template.

### Shell

```html
<table
  role="presentation"
  width="100%"
  cellpadding="0"
  cellspacing="0"
  style="background:#f4f4f5;padding:32px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
>
  <tr>
    <td align="center">
      <table
        role="presentation"
        width="100%"
        cellpadding="0"
        cellspacing="0"
        style="max-width:480px;background:#ffffff;border-radius:12px;padding:32px"
      >
        <tr>
          <td
            style="font-size:16px;font-weight:600;color:#18181b;padding-bottom:16px"
          >
            Platform
          </td>
        </tr>
        <tr>
          <td style="font-size:15px;line-height:24px;color:#3f3f46">
            <!-- per-template body -->
          </td>
        </tr>
        <tr>
          <td
            style="font-size:12px;line-height:18px;color:#a1a1aa;padding-top:24px;border-top:1px solid #e4e4e7"
          >
            Platform — <a href="https://app.example.com" style="color:#71717a">app.example.com</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
```

### Button and link fallback

```html
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0">
  <tr>
    <td style="border-radius:8px;background:#18181b">
      <a
        href="LINK"
        style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px"
        >BUTTON LABEL</a
      >
    </td>
  </tr>
</table>
<p style="font-size:13px;line-height:20px;color:#71717a;margin:0">
  If the button does not work, paste this into your browser:<br />
  <span style="word-break:break-all">LINK</span>
</p>
```

### Confirm signup — body

```html
<p style="margin:0 0 8px">
  Confirm <strong>{{ .Email }}</strong> to finish setting up your account.
</p>
<p style="margin:0 0 8px">You will name your company and choose a plan next.</p>
<!-- button + fallback; LINK = the confirm-signup href above -->
<p style="font-size:13px;color:#71717a;margin:24px 0 0">
  The link expires in an hour. If you did not create an account, ignore this
  email.
</p>
```

### Magic Link — body

```html
<p style="margin:0 0 8px">
  Use the button below, or the code, to sign in to Platform.
</p>
<!-- button + fallback; LINK = the magic-link href above -->
<p style="margin:24px 0 8px;font-size:15px;color:#3f3f46">Your code:</p>
<p
  style="margin:0;font-size:32px;line-height:40px;font-weight:700;letter-spacing:8px;color:#18181b"
>
  {{ .Token }}
</p>
<p style="font-size:13px;color:#71717a;margin:24px 0 0">
  The link and the code expire in an hour and work once. If you did not ask to
  sign in, ignore this email.
</p>
```

### Invite user — body

```html
<p style="margin:0 0 8px">
  {{ if index .Data "company_name" }}<strong>{{ index .Data "company_name" }}</strong>
  has invited you{{ else }}You have been invited{{ end }} to join their
  workspace on Platform.
</p>
<p style="margin:0 0 8px">
  Accepting adds you to their team with the role they chose.
</p>
<!-- button + fallback; LINK = the invite href above -->
<p style="font-size:13px;color:#71717a;margin:24px 0 0">
  The link expires in an hour. If you were not expecting this, ignore this email.
</p>
```

### Reset password — body

```html
<p style="margin:0 0 8px">
  Somebody asked to reset the password for <strong>{{ .Email }}</strong>.
</p>
<p style="margin:0 0 8px">
  Choosing a new one takes a moment and replaces the old one.
</p>
<!-- button + fallback; LINK = the reset href above -->
<p style="font-size:13px;color:#71717a;margin:24px 0 0">
  The link expires in an hour and works once. If this was not you, ignore this
  email — your password stays as it is.
</p>
```

### Change Email Address — body

```html
<p style="margin:0 0 8px">
  Confirm that <strong>{{ .NewEmail }}</strong> should become the address for
  your Platform account.
</p>
<!-- button + fallback; LINK = the email-change href above -->
<p style="font-size:13px;color:#71717a;margin:24px 0 0">
  The link expires in an hour and works once.
</p>
```

## Checking it works

Run these once against a real project; each exercises a different branch of the
callback.

1. **Cross-browser confirmation.** Sign up in one browser, open the confirmation
   link in another (or on a phone). You should land on `/onboarding`, signed in.
2. **Magic link and code.** Request a link, then type the six digits into "Code
   from the email" instead of clicking. You should land on `/workspaces`.
   Request it again and open the link on a second device: same destination.
3. **Invitation.** Settings → Team → invite an address that has no account. Open
   the invitation in a fresh browser: `/workspaces` lists the workspace as
   **Registered**, and the template names the company.
4. **Recovery.** On `/login` choose "Forgot your password?", open the link, set a
   new password, and sign in with it. Reloading `/reset-password` afterwards
   shows "This link has expired" instead of a form.
5. **Regression.** `pnpm verify` — the callback, action and proxy tests cover the
   `type` values and the destinations above.


