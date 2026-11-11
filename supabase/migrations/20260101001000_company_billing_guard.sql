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
