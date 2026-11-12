-- =============================================================================
-- 10 · The billing columns belong to the webhook
-- =============================================================================
-- `companies` has exactly one update policy and it is row-level: it asks whether
-- the caller is an owner or admin of the row, and nothing else. Every column is
-- therefore writable by any owner or admin over PostgREST with the publishable
-- key — including the four that describe the subscription.
--
-- That is not theoretical, because the rest of the app trusts those columns:
--
--   * `stripe_customer_id` is the handle `openBillingPortal()` opens a portal
--     session for. A row pointed at somebody else's customer would open *their*
--     invoices, card and cancellation.
--   * `reconcileCompanySubscription()` reads the subscription back from Stripe
--     with the service role and writes the answer onto the row, so a tampered
--     customer id is laundered into a trusted `subscription_status`.
--
-- Two guards, because they fail in different places:
--
--   1. Column grants — refused by the database before a policy is consulted, and
--      PostgREST answers 403 instead of silently dropping the field.
--   2. A BEFORE UPDATE trigger — grants belong to the role, so a later migration
--      that re-grants the table would quietly undo guard 1.
--
-- `service_role` is exempt from both: the webhook, the reconciler and onboarding
-- write these columns with it. A signed-in session never does.
--
-- The last two sections close the same hole one table over: a row-level policy
-- plus a table-wide grant also lets a session delete the row that owns the
-- subscription, or rewrite who a membership row belongs to.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Guard 1: what a signed-in session may change
-- -----------------------------------------------------------------------------
-- The identity fields the settings screens own. `subscription_status`,
-- `stripe_customer_id`, `stripe_subscription_id` and `trial_ends_at` are
-- deliberately absent from the list.
--
-- `revoke` first, then `grant` by column: the table-wide update Supabase's
-- `alter default privileges` handed to `authenticated` has to go before a
-- column list means anything.
revoke update on public.companies from anon, authenticated;

grant update (name, currency, badge, logo_url, enabled_sections, require_mfa)
  on public.companies to authenticated;

-- -----------------------------------------------------------------------------
-- Guard 2: the trigger
-- -----------------------------------------------------------------------------
-- Column grants are a property of the role. This is the property of the table,
-- and it survives somebody re-granting `update` on all columns later.
create or replace function public.companies_guard_billing_columns()
returns trigger
language plpgsql
-- Pinned for the same reason `has_password()` pins it: a caller's `search_path`
-- must not decide what the body resolves. `auth.role()` is schema-qualified and
-- everything else comes from `pg_catalog`, so an empty path resolves it all.
set search_path = ''
as $$
begin
  -- Only the two roles a browser can reach are refused. `service_role` is how the
  -- webhook, the reconciler and onboarding write; every other role (`postgres`,
  -- `supabase_admin`, …) is the project owner's own hand in the SQL editor, and
  -- already bypasses RLS entirely.
  --
  -- `auth.role()` reads the JWT claim rather than the role, so a SECURITY DEFINER
  -- wrapper running on behalf of a signed-in user — `current_user` = owner, claim
  -- = `authenticated` — is still recognised and refused.
  if current_user not in ('anon', 'authenticated')
     and coalesce(auth.role(), '') not in ('anon', 'authenticated') then
    return new;
  end if;

  if new.subscription_status is distinct from old.subscription_status
  or new.stripe_customer_id is distinct from old.stripe_customer_id
  or new.stripe_subscription_id is distinct from old.stripe_subscription_id
  or new.trial_ends_at is distinct from old.trial_ends_at then
    raise exception
      'Subscription state is written by the billing webhook, not by a signed-in session'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.companies_guard_billing_columns() is
  'Refuses a client session that tries to move `companies` subscription state.';

-- `before update of` lists the columns, so an update that does not name one of
-- them never reaches the function at all.
drop trigger if exists companies_guard_billing_columns on public.companies;
create trigger companies_guard_billing_columns
  before update of
    subscription_status,
    stripe_customer_id,
    stripe_subscription_id,
    trial_ends_at
  on public.companies
  for each row execute function public.companies_guard_billing_columns();

-- Same rule as the earlier migrations: Supabase grants EXECUTE on new `public`
-- functions to `anon`, and a trigger-only function should be reachable by no
-- client role at all. A trigger does not require the invoker to hold EXECUTE,
-- which is what makes `set_updated_at()` and `assets_stamp_status_change()` safe
-- on the same terms.
revoke all on function public.companies_guard_billing_columns()
  from public, anon, authenticated;
grant execute on function public.companies_guard_billing_columns() to service_role;

-- -----------------------------------------------------------------------------
-- The same shape on `profiles`
-- -----------------------------------------------------------------------------
-- A user edits their own row, so `email` — the address the team roster and the
-- invitation mail render — is theirs to rewrite. It grants nothing (invitations
-- are keyed on `user_id`, never on an address, and `handle_new_user()` rewrites
-- the column from `auth.users` on the next auth write), but a column grant keeps
-- the display name and the photo the only writable fields and stops the roster
-- from being spoofed.
revoke update on public.profiles from anon, authenticated;

grant update (full_name, avatar_url) on public.profiles to authenticated;

-- -----------------------------------------------------------------------------
-- What a session may not delete
-- -----------------------------------------------------------------------------
-- `companies_delete_owner` is row-level, and the app never deletes a company
-- from a session: onboarding's rollback uses the service role, and no screen
-- offers the verb. Leaving the table-wide delete granted means an owner can
-- remove a row that still has a live subscription — Stripe keeps charging, the
-- reconciler logs "matched no company" on every retry, and the paying customer
-- has no workspace left to open.
--
-- A client INSERT is refused for a different reason: a company created outside
-- onboarding has no Stripe customer and no owner membership, so it could be
-- neither billed nor administered.
revoke insert, delete on public.companies from anon, authenticated;

-- A profile row is created by `handle_new_user()` on the auth insert, so a
-- client delete is unrecoverable and leaves every membership pointing at an id
-- that renders as a blank colleague. `insert` stays granted: no policy admits one
-- today, and a self-service row is a plausible future feature.
revoke delete on public.profiles from anon, authenticated;

-- -----------------------------------------------------------------------------
-- `company_members`: the role is the only column a session may change
-- -----------------------------------------------------------------------------
-- `company_members_update_assignable` pins `company_id` when a row is inserted,
-- but on update it constrains neither `user_id` nor `accepted_at`. With the
-- table-wide grant an owner or admin could therefore rewrite a member row's
-- `user_id` to a colleague who never received an invitation — the consent the
-- invitation email exists to prove — or set `accepted_at` themselves.
--
-- `lib/actions/members.ts` writes `role` and nothing else, and both invitation
-- answers run inside `respond_to_company_invitation()` /
-- `accept_company_invitations()`, which are `security definer` and so are not
-- constrained by a grant on the invoker.
revoke update on public.company_members from anon, authenticated;

grant update (role) on public.company_members to authenticated;
