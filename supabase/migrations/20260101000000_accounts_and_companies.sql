-- =============================================================================
-- 01 · Accounts, companies and tenant membership
-- =============================================================================
-- The tenancy core the template is built on:
--   profiles         · one row per auth user
--   companies        · one row per tenant (the path segment is `slug`)
--   company_members  · the join table that makes a user a member of a tenant
--
-- Access control is enforced with RLS everywhere. Membership lookups go through
-- SECURITY DEFINER helpers so that policies on `company_members` do not recurse
-- into their own table.
--
-- This file is the whole core: enums, tables, helpers, policies and grants. A
-- feature module adds a migration of its own; it never edits this one.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
-- The ladder is created in a single statement. PostgreSQL requires a new enum
-- value to commit before another statement may use it, so growing the ladder
-- later would need a migration of its own — which is why `manager` and `staff`
-- are present even though nothing in the template requires them yet.
--
--   owner   · everything, including billing and deleting the company
--   admin   · billing, company settings and team management
--   manager · a tier for feature modules to interpret
--   staff   · a tier below manager, for feature modules to interpret
--   member  · Viewer: read-only
do $$
begin
  if not exists (select 1 from pg_type where typname = 'member_role') then
    create type public.member_role as enum (
      'owner',
      'admin',
      'manager',
      'staff',
      'member'
    );
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'subscription_status') then
    create type public.subscription_status as enum (
      'none',
      'trialing',
      'active',
      'past_due',
      'canceled',
      'incomplete',
      'incomplete_expired',
      'unpaid',
      'paused'
    );
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Shared trigger: keep `updated_at` honest
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- companies
-- -----------------------------------------------------------------------------
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  -- The tenant path segment: `/acme/dashboard` -> 'acme'.
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$'),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  subscription_status public.subscription_status not null default 'none',
  trial_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists companies_set_updated_at on public.companies;
create trigger companies_set_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- company_members
-- -----------------------------------------------------------------------------
-- `accepted_at` is nullable on purpose: a pending invitation has only
-- `invited_at`. The default marks direct inserts — the founding owner, or a row
-- an operator writes by hand — as already registered, so an invitation is the
-- only way to create a membership that grants nothing.
create table if not exists public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null default 'member',
  invited_at timestamptz,
  accepted_at timestamptz default now(),
  created_at timestamptz not null default now(),
  unique (company_id, user_id),
  constraint company_members_invitation_state
    check (accepted_at is not null or invited_at is not null)
);

comment on column public.company_members.invited_at is
  'When an invitation email was last sent. NULL for members added directly.';
comment on column public.company_members.accepted_at is
  'When the user accepted the invitation. NULL while the invitation is pending.';

create index if not exists company_members_user_id_idx
  on public.company_members (user_id);
create index if not exists company_members_company_id_idx
  on public.company_members (company_id);

-- A company must always have exactly one owner. A partial unique index means a
-- later insert cannot silently create a second owner.
create unique index if not exists company_members_single_owner_idx
  on public.company_members (company_id)
  where role = 'owner';

-- -----------------------------------------------------------------------------
-- Membership helpers (SECURITY DEFINER breaks RLS recursion)
-- -----------------------------------------------------------------------------
-- Every policy in the schema routes through these three, so the `accepted_at`
-- filter here is what makes a pending invitation grant nothing at all — not to
-- workspace data, not even to the colleague list.
create or replace function public.is_company_member(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = target_company_id
      and m.user_id = auth.uid()
      and m.accepted_at is not null
  );
$$;

create or replace function public.has_company_role(
  target_company_id uuid,
  allowed_roles public.member_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = target_company_id
      and m.user_id = auth.uid()
      and m.accepted_at is not null
      and m.role = any (allowed_roles)
  );
$$;

create or replace function public.current_member_role(target_company_id uuid)
returns public.member_role
language sql
stable
security definer
set search_path = public
as $$
  select m.role
  from public.company_members m
  where m.company_id = target_company_id
    and m.user_id = auth.uid()
    and m.accepted_at is not null
  limit 1;
$$;

comment on function public.is_company_member(uuid) is
  'True when the caller has accepted a membership of the company.';
comment on function public.has_company_role(uuid, public.member_role[]) is
  'True when the caller''s accepted role is one of the allowed roles.';
comment on function public.current_member_role(uuid) is
  'The caller''s accepted role in the company, or NULL.';

-- -----------------------------------------------------------------------------
-- New-user provisioning: mirror auth.users into public.profiles
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.profiles.full_name, excluded.full_name),
        avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;

-- profiles: a user reads and edits only their own row. Colleagues can read each
-- other's profiles through `profiles_select_colleague` in migration 02.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- companies: members read; owner/admin update; only the owner deletes.
drop policy if exists "companies_select_member" on public.companies;
create policy "companies_select_member"
  on public.companies for select
  to authenticated
  using (public.is_company_member(id));

drop policy if exists "companies_update_admin" on public.companies;
create policy "companies_update_admin"
  on public.companies for update
  to authenticated
  using (public.has_company_role(id, array['owner', 'admin']::public.member_role[]))
  with check (public.has_company_role(id, array['owner', 'admin']::public.member_role[]));

drop policy if exists "companies_delete_owner" on public.companies;
create policy "companies_delete_owner"
  on public.companies for delete
  to authenticated
  using (public.has_company_role(id, array['owner']::public.member_role[]));

-- company_members: every colleague can read the roster, but only owners and
-- admins may invite, re-role or remove somebody. Owner and admin rows are
-- immutable from the client: ownership transfer and admin promotion are
-- service-role work. The founding owner row is inserted by the service role
-- during signup.
drop policy if exists "company_members_select_colleague" on public.company_members;
create policy "company_members_select_colleague"
  on public.company_members for select
  to authenticated
  using (public.is_company_member(company_id));

drop policy if exists "company_members_insert_admin" on public.company_members;
drop policy if exists "company_members_update_admin" on public.company_members;
drop policy if exists "company_members_delete_admin" on public.company_members;
drop policy if exists "company_members_insert_assignable" on public.company_members;
drop policy if exists "company_members_update_assignable" on public.company_members;
drop policy if exists "company_members_delete_assignable" on public.company_members;

create policy "company_members_insert_assignable"
  on public.company_members for insert
  to authenticated
  with check (
    public.has_company_role(company_id, array['owner', 'admin']::public.member_role[])
    and role in ('manager', 'staff', 'member')
  );

create policy "company_members_update_assignable"
  on public.company_members for update
  to authenticated
  using (
    public.has_company_role(company_id, array['owner', 'admin']::public.member_role[])
    and role in ('manager', 'staff', 'member')
  )
  with check (
    public.has_company_role(company_id, array['owner', 'admin']::public.member_role[])
    and role in ('manager', 'staff', 'member')
  );

create policy "company_members_delete_assignable"
  on public.company_members for delete
  to authenticated
  using (
    public.has_company_role(company_id, array['owner', 'admin']::public.member_role[])
    and role in ('manager', 'staff', 'member')
  );

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
-- Supabase configures
--
--   alter default privileges in schema public
--     grant execute on functions to anon, authenticated, service_role;
--
-- so every function created here is *explicitly* granted to `anon` at creation
-- time. Revoking from `public` alone only removes the implicit PUBLIC grant, so
-- each SECURITY DEFINER helper is revoked from `anon` by name. A feature module
-- that adds a helper must do the same.

-- Membership predicates: callable by signed-in users only.
revoke all on function public.is_company_member(uuid) from public, anon;
revoke all on function public.has_company_role(uuid, public.member_role[]) from public, anon;
revoke all on function public.current_member_role(uuid) from public, anon;

grant execute on function public.is_company_member(uuid) to authenticated, service_role;
grant execute on function public.has_company_role(uuid, public.member_role[]) to authenticated, service_role;
grant execute on function public.current_member_role(uuid) to authenticated, service_role;

-- Trigger-only functions: no client role may execute these. PostgreSQL does not
-- check EXECUTE when firing a trigger, so this changes nothing for the triggers
-- themselves.
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;

grant execute on function public.set_updated_at() to service_role;
grant execute on function public.handle_new_user() to service_role;
