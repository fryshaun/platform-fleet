-- =============================================================================
-- 05 · Account avatars
-- =============================================================================
-- A person's photo is not a workspace's data: it belongs to the account, follows
-- them between companies, and is stored in `profiles.avatar_url` — a column
-- migration 01 already declares. What is missing is somewhere to put the file.
--
--   * A second public bucket, `avatars`, capped at 2 MB per object and limited to
--     the four image types the uploader accepts.
--   * Writes keyed by the account: every object is `<user-id>/<uuid>.<ext>`, and
--     the policies compare the first path segment with `auth.uid()`. Nobody can
--     write into somebody else's folder, and no company is consulted — the same
--     photo is used in every workspace.
--   * Reads are public, because the file is rendered in the rail, in the account
--     menu and in the team list; a signed read URL would expire out from under
--     all of them.
--
-- The profile row stays the source of truth. The uploader puts the object in the
-- bucket, then `setAvatar` records its public URL in `profiles.avatar_url`; the
-- action also deletes the object it replaced, so changing a photo repeatedly does
-- not leave a trail of orphans behind.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp', 'image/avif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

comment on column public.profiles.avatar_url is
  'Public URL of the account photo in the `avatars` bucket, or null.';

-- -----------------------------------------------------------------------------
-- Policies
-- -----------------------------------------------------------------------------
-- `storage.foldername(name)` splits the object key, so element 1 is the folder
-- the uploader built from the account id. `auth.uid()` is wrapped in a sub-select
-- so it is evaluated once per statement rather than once per row.
--
-- The select policy is not what makes a photo visible: the bucket is public, so
-- anonymous readers are served by the public endpoint without consulting RLS at
-- all. It exists for the authenticated API path (`storage.from(...).download`).
drop policy if exists "avatars_objects_select" on storage.objects;
create policy "avatars_objects_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "avatars_objects_insert" on storage.objects;
create policy "avatars_objects_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "avatars_objects_update" on storage.objects;
create policy "avatars_objects_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "avatars_objects_delete" on storage.objects;
create policy "avatars_objects_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
