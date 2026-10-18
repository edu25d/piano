-- Run after teacher-screen.sql to enable teacher-owned practice song management.
alter table public.practice_songs
  add column if not exists created_by uuid references auth.users(id) on delete set null;

create index if not exists practice_songs_owner_active_idx
  on public.practice_songs (created_by, is_active, sort_order);

drop policy if exists "Signed-in users can read active practice songs" on public.practice_songs;
drop policy if exists "Teachers can read active practice songs" on public.practice_songs;
drop policy if exists "Teachers can read built-in and owned practice songs" on public.practice_songs;
create policy "Teachers can read built-in and owned practice songs"
  on public.practice_songs for select to authenticated
  using (
    (created_by = auth.uid())
    or (created_by is null and is_active and musicxml_path like 'builtin:%')
  );

drop policy if exists "Teachers can create owned practice songs" on public.practice_songs;
create policy "Teachers can create owned practice songs"
  on public.practice_songs for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists "Teachers can update owned practice songs" on public.practice_songs;
create policy "Teachers can update owned practice songs"
  on public.practice_songs for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

drop policy if exists "Teachers can delete owned practice songs" on public.practice_songs;
create policy "Teachers can delete owned practice songs"
  on public.practice_songs for delete to authenticated
  using (created_by = auth.uid());

drop policy if exists "Teachers can upload owned library MusicXML" on storage.objects;
create policy "Teachers can upload owned library MusicXML"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'musicxml'
    and (storage.foldername(name))[1] = 'library'
    and (storage.foldername(name))[2] = auth.uid()::text
    and exists (
      select 1 from public.practice_songs ps
      where ps.musicxml_path = name and ps.created_by = auth.uid()
    )
  );

drop policy if exists "Teachers can read owned library MusicXML" on storage.objects;
create policy "Teachers can read owned library MusicXML"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'musicxml'
    and (storage.foldername(name))[1] = 'library'
    and (storage.foldername(name))[2] = auth.uid()::text
    and exists (
      select 1 from public.practice_songs ps
      where ps.musicxml_path = name and ps.created_by = auth.uid()
    )
  );

drop policy if exists "Teachers can delete owned library MusicXML" on storage.objects;
create policy "Teachers can delete owned library MusicXML"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'musicxml'
    and (storage.foldername(name))[1] = 'library'
    and (storage.foldername(name))[2] = auth.uid()::text
    and exists (
      select 1 from public.practice_songs ps
      where ps.musicxml_path = name and ps.created_by = auth.uid()
    )
  );

drop policy if exists "Teachers can delete class MusicXML" on storage.objects;
create policy "Teachers can delete class MusicXML"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'musicxml'
    and exists (
      select 1 from public.teacher_classes tc
      where tc.teacher_id = auth.uid()
        and tc.class_id::text = (storage.foldername(name))[1]
    )
  );
