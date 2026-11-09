-- =============================================================================
-- 02 · Team invitations
-- =============================================================================
-- Migration 01 created memberships but no way to invite anybody. Three pieces
-- are needed for a team, and all three are about *consent*:
--
--   * The members list needs names and email addresses, which live in
--     `profiles`. `shares_company_with()` widens the profile read to people who
--     share a company, without exposing the rest of the user table.
--   * A pending invitation must be visible to the person it is for and to
--     nobody else. The membership predicates in migration 01 filter pending
--     rows out, so RLS alone would hide an invitation from its recipient too;
--     `my_pending_invitations()` is that one narrow window.
--   * Accepting or declining is an explicit write.
--     `respond_to_company_invitation()` can only ever touch the caller's own
--     pending row.
--
-- The invitation email is still consent: clicking a link only the recipient
-- received proves intent, so `/auth/callback` calls `accept_company_invitations()`
-- for `type=invite`. What it no longer does is accept invitations on the
-- strength of an unrelated sign-in.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Colleague profiles
-- -----------------------------------------------------------------------------
-- The caller must have accepted *their* membership; the target only has to
-- share a company. Requiring the target to be accepted as well would hide a
-- pending invitee from the admin waiting on them, which is the one place the
-- pending row is meant to be visible.
create or replace function public.shares_company_with(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_user_id = auth.uid()
    or exists (
      select 1
      from public.company_members mine
      join public.company_members colleague
        on colleague.company_id = mine.company_id
      where mine.user_id = auth.uid()
        and mine.accepted_at is not null
        and colleague.user_id = target_user_id
    );
$$;

drop policy if exists "profiles_select_colleague" on public.profiles;
create policy "profiles_select_colleague"
  on public.profiles for select
  to authenticated
  using (public.shares_company_with(id));

-- -----------------------------------------------------------------------------
-- Accepting every pending invitation
-- -----------------------------------------------------------------------------
-- Called from `/auth/callback` after an invitation link has been verified. It
-- is narrowly scoped: the caller can only stamp their own memberships, and only
-- rows that are still pending.
create or replace function public.accept_company_invitations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  accepted integer;
begin
  if auth.uid() is null then
    return 0;
  end if;

  update public.company_members
  set accepted_at = now()
  where user_id = auth.uid()
    and accepted_at is null;

  get diagnostics accepted = row_count;
  return accepted;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reading and answering an invitation
-- -----------------------------------------------------------------------------
-- Pending rows are invisible under RLS by design, so the invited user needs one
-- scoped window onto their own. SECURITY DEFINER with `auth.uid()` hard-coded
-- into the filter, matching the pattern of the other helpers.
create or replace function public.my_pending_invitations()
returns table (
  membership_id uuid,
  company_id uuid,
  company_name text,
  company_slug text,
  role public.member_role,
  invited_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, c.id, c.name, c.slug, m.role, m.invited_at
  from public.company_members m
  join public.companies c on c.id = m.company_id
  where m.user_id = auth.uid()
    and m.accepted_at is null
  order by m.invited_at asc nulls last;
$$;

create or replace function public.respond_to_company_invitation(
  target_membership_id uuid,
  accept boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer;
begin
  if auth.uid() is null then
    return false;
  end if;

  if accept then
    update public.company_members
    set accepted_at = now()
    where id = target_membership_id
      and user_id = auth.uid()
      and accepted_at is null;
  else
    -- Declining removes the pending row instead of leaving a tombstone. The
    -- owner guard is belt and braces: an owner row is never pending, because
    -- the founding owner is inserted with `accepted_at` defaulted.
    delete from public.company_members
    where id = target_membership_id
      and user_id = auth.uid()
      and accepted_at is null
      and role <> 'owner';
  end if;

  get diagnostics touched = row_count;
  return touched > 0;
end;
$$;

-- `my_pending_invitations()` filters on `user_id` alone, so give it an index
-- that only covers the rows it can ever return.
create index if not exists company_members_pending_idx
on public.company_members (user_id)
  where accepted_at is null;

comment on function public.shares_company_with(uuid) is
  'True when the caller and the target share a company.';
comment on function public.accept_company_invitations() is
  'Stamps every pending membership of the caller; the number of rows affected.';
comment on function public.my_pending_invitations() is
  'The caller''s own pending invitations, with enough company detail to show them.';
comment on function public.respond_to_company_invitation(uuid, boolean) is
  'Accepts (stamps accepted_at) or declines (deletes) the caller''s own pending membership.';

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
-- Same rule as migration 01: Supabase grants EXECUTE on new `public` functions
-- to `anon` explicitly, so revoking from `public` alone is not enough. All four
-- helpers are SECURITY DEFINER and one of them writes membership state.
revoke all on function public.shares_company_with(uuid) from public, anon;
revoke all on function public.accept_company_invitations() from public, anon;
revoke all on function public.my_pending_invitations() from public, anon;
revoke all on function public.respond_to_company_invitation(uuid, boolean) from public, anon;

grant execute on function public.shares_company_with(uuid) to authenticated, service_role;
grant execute on function public.accept_company_invitations() to authenticated, service_role;
grant execute on function public.my_pending_invitations() to authenticated, service_role;
grant execute on function public.respond_to_company_invitation(uuid, boolean) to authenticated, service_role;
