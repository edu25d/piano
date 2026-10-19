-- Run after teacher-library.sql to make student practice songs class-scoped.
create table if not exists public.class_practice_songs (
  class_id uuid not null references public.classes(id) on delete cascade,
  practice_song_id uuid not null references public.practice_songs(id) on delete restrict,
  added_by uuid references auth.users(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (class_id, practice_song_id)
);

create index if not exists class_practice_songs_active_idx
  on public.class_practice_songs (class_id, is_active, practice_song_id);

create table if not exists public.class_repertoire_migrations (
  migration_key text primary key,
  completed_at timestamptz not null default now()
);
alter table public.class_repertoire_migrations enable row level security;

alter table public.class_practice_songs enable row level security;

drop policy if exists "Teachers can read repertoire for their classes" on public.class_practice_songs;
create policy "Teachers can read repertoire for their classes"
  on public.class_practice_songs for select to authenticated
  using (
    exists (
      select 1 from public.teacher_classes tc
      where tc.class_id = class_practice_songs.class_id
        and tc.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can add repertoire to their classes" on public.class_practice_songs;
create policy "Teachers can add repertoire to their classes"
  on public.class_practice_songs for insert to authenticated
  with check (
    added_by = auth.uid()
    and exists (
      select 1 from public.teacher_classes tc
      where tc.class_id = class_practice_songs.class_id
        and tc.teacher_id = auth.uid()
    )
    and exists (
      select 1 from public.practice_songs ps
      where ps.id = class_practice_songs.practice_song_id
        and (ps.created_by = auth.uid() or (ps.created_by is null and ps.musicxml_path like 'builtin:%'))
    )
  );

drop policy if exists "Teachers can update repertoire for their classes" on public.class_practice_songs;
create policy "Teachers can update repertoire for their classes"
  on public.class_practice_songs for update to authenticated
  using (
    exists (
      select 1 from public.teacher_classes tc
      where tc.class_id = class_practice_songs.class_id
        and tc.teacher_id = auth.uid()
    )
  )
  with check (
    added_by = auth.uid()
    and exists (
      select 1 from public.teacher_classes tc
      where tc.class_id = class_practice_songs.class_id
        and tc.teacher_id = auth.uid()
    )
    and exists (
      select 1 from public.practice_songs ps
      where ps.id = class_practice_songs.practice_song_id
        and (ps.created_by = auth.uid() or (ps.created_by is null and ps.musicxml_path like 'builtin:%'))
    )
  );

drop policy if exists "Teachers can remove repertoire from their classes" on public.class_practice_songs;
create policy "Teachers can remove repertoire from their classes"
  on public.class_practice_songs for delete to authenticated
  using (
    exists (
      select 1 from public.teacher_classes tc
      where tc.class_id = class_practice_songs.class_id
        and tc.teacher_id = auth.uid()
    )
  );

-- Backfill once only; rerunning this file must not enroll classes created later.
do $backfill$
begin
  if not exists (
    select 1 from public.class_repertoire_migrations
    where migration_key = 'class-repertoire-backfill-v1'
  ) then
    insert into public.class_practice_songs (class_id, practice_song_id, added_by)
    select distinct tc.class_id, ps.id, tc.teacher_id
    from public.teacher_classes tc
    join public.practice_songs ps
      on ps.is_active
      and (
        ps.created_by = tc.teacher_id
        or (
          ps.created_by is null
          and ps.musicxml_path like 'builtin:%'
          and not exists (
            select 1
            from public.teacher_classes peer
            join public.practice_songs override_song
              on override_song.created_by = peer.teacher_id
             and override_song.musicxml_path = ps.musicxml_path
            where peer.class_id = tc.class_id
          )
        )
      )
    on conflict (class_id, practice_song_id) do nothing;

    insert into public.class_repertoire_migrations (migration_key)
    values ('class-repertoire-backfill-v1')
    on conflict (migration_key) do nothing;
  end if;
end
$backfill$;
