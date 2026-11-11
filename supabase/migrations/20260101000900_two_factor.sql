-- =============================================================================
-- 09 · Two-factor authentication
-- =============================================================================
-- Two small pieces, both about the *account* rather than the workspace:
--
--   * `companies.require_mfa` is the workspace policy. Off by default, so an
--     existing workspace behaves exactly as it did before this migration. An
--     owner or admin flips it under Settings → Security, and every member of
--     that workspace is asked to prove a second factor before they can use it.
--
--   * `public.has_password()` answers the question the app could not answer
--     before: does this account have a password at all? Supabase's client
--     libraries never expose `auth.users.encrypted_password` — not on `User`,
--     not on the admin API — so the only truthful source is this function.
--
-- Why the second one matters: `app_metadata.providers` lists the ways an account
-- may sign in, and an invited user has `providers = {email}` even though GoTrue
-- never stored a password for them (`encrypted_password` is null until they set
-- one). Reading the provider list therefore said "has a password" for exactly
-- the people who did not, and the account sheet asked them for a current
-- password they had never chosen. The provider list is still a useful fallback
-- (see `hasPasswordProvider` in `lib/account.ts`), but it is not the truth.
--
-- The two factors themselves live in `auth.mfa_factors` and are gone over by
-- Supabase Auth; nothing about them is stored here.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The workspace policy
-- -----------------------------------------------------------------------------
-- Written through `companies`, whose update policy is already owner/admin only
-- (migration 01) — no new grant is needed for the column.
--
-- The database does not enforce this column. It is a product rule the app
-- applies, because the alternative — putting an `aal` check inside every RLS
-- policy — would lock a member out of reading even the workspace name they need
-- in order to be told they must enrol. `lib/mfa.ts` is the one place that decides
-- what the column means.
alter table public.companies
  add column if not exists require_mfa boolean not null default false;

comment on column public.companies.require_mfa is
  'When true, members of this workspace must sign in with a second factor before using it. Applied by the app (lib/mfa.ts), not by RLS.';

-- -----------------------------------------------------------------------------
-- Does the account have a password?
-- -----------------------------------------------------------------------------
-- `security definer` because `auth.users` is not readable by `authenticated`;
-- `set search_path = ''` because a definer function that honours a caller's
-- `search_path` can be pointed at a shadowing table. Every reference below is
-- schema-qualified for the same reason.
--
-- `stable`, not `volatile`: the answer does not change within a statement, and
-- the planner may then cache it per query.
--
-- A caller with no session (`auth.uid()` is null) answers `false`: there is no
-- account to ask about. The function is granted to `authenticated` only, so an
-- anonymous request cannot reach it in the first place.
create or replace function public.has_password()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select u.encrypted_password is not null
         and length(u.encrypted_password) > 0
      from auth.users u
      where u.id = auth.uid()
    ),
    false
  );
$$;

comment on function public.has_password() is
  'Whether the signed-in account has a password (auth.users.encrypted_password is set). The only truthful source: the client libraries never expose the hash, and app_metadata.providers is set for invited users who have no password yet.';

-- `create or replace` keeps whatever grants an earlier version had, so they are
-- stated explicitly. The default for a new function is EXECUTE to PUBLIC, which
-- would include `anon`.
revoke all on function public.has_password() from public;
grant execute on function public.has_password() to authenticated;
