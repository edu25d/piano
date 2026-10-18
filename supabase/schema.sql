create extension if not exists pgcrypto;

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  grade smallint not null check (grade between 1 and 12),
  class_name text not null,
  created_at timestamptz not null default now(),
  unique (grade, class_name)
);

create table if not exists public.teacher_classes (
  teacher_id uuid not null references auth.users(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (teacher_id, class_id)
);

create table if not exists public.practice_songs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  musicxml_path text not null,
  difficulty text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  title text not null,
  musicxml_path text not null,
  created_by uuid references auth.users(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (class_id, display_name)
);

create table if not exists public.practice_attempts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  assignment_id uuid references public.assignments(id) on delete cascade,
  practice_song_id uuid references public.practice_songs(id) on delete cascade,
  current_note_index integer not null default 0 check (current_note_index >= 0),
  total_notes integer not null check (total_notes > 0),
  correct_count integer not null default 0 check (correct_count >= 0),
  incorrect_count integer not null default 0 check (incorrect_count >= 0),
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((assignment_id is null) <> (practice_song_id is null))
);

create table if not exists public.answer_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.practice_attempts(id) on delete cascade,
  note_index integer not null check (note_index >= 0),
  try_number integer not null check (try_number > 0),
  target_midi integer not null,
  played_midi integer not null,
  is_correct boolean not null,
  created_at timestamptz not null default now(),
  unique (attempt_id, note_index, try_number)
);

create index if not exists assignments_class_active_idx
  on public.assignments (class_id, is_active, created_at desc);
create index if not exists students_class_name_idx
  on public.students (class_id, display_name);
create index if not exists attempts_student_updated_idx
  on public.practice_attempts (student_id, updated_at desc);
create index if not exists attempts_assignment_status_idx
  on public.practice_attempts (assignment_id, status);
create index if not exists answer_events_attempt_note_idx
  on public.answer_events (attempt_id, note_index, try_number);

alter table public.classes enable row level security;
alter table public.teacher_classes enable row level security;
alter table public.practice_songs enable row level security;
alter table public.assignments enable row level security;
alter table public.students enable row level security;
alter table public.practice_attempts enable row level security;
alter table public.answer_events enable row level security;

drop policy if exists "Teachers can read their class links" on public.teacher_classes;
create policy "Teachers can read their class links"
  on public.teacher_classes for select to authenticated
  using (teacher_id = auth.uid());

drop policy if exists "Teachers can read assigned classes" on public.classes;
create policy "Teachers can read assigned classes"
  on public.classes for select to authenticated
  using (exists (
    select 1 from public.teacher_classes tc
    where tc.class_id = classes.id and tc.teacher_id = auth.uid()
  ));

drop policy if exists "Signed-in users can read active practice songs" on public.practice_songs;
create policy "Signed-in users can read active practice songs"
  on public.practice_songs for select to authenticated
  using (is_active);

drop policy if exists "Teachers can manage assignments in their classes" on public.assignments;
create policy "Teachers can manage assignments in their classes"
  on public.assignments for all to authenticated
  using (exists (
    select 1 from public.teacher_classes tc
    where tc.class_id = assignments.class_id and tc.teacher_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.teacher_classes tc
    where tc.class_id = assignments.class_id and tc.teacher_id = auth.uid()
  ));

insert into storage.buckets (id, name, public)
values ('musicxml', 'musicxml', false)
on conflict (id) do nothing;
