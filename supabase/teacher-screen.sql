-- Run after schema.sql to enable teacher-owned classes and the teacher dashboard.
alter table public.classes
  add column if not exists created_by uuid references auth.users(id) on delete set null;

drop policy if exists "Teachers can read assigned classes" on public.classes;
create policy "Teachers can read assigned classes"
  on public.classes for select to authenticated
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.teacher_classes tc
      where tc.class_id = classes.id and tc.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can create their own classes" on public.classes;
create policy "Teachers can create their own classes"
  on public.classes for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists "Teachers can link themselves to created classes" on public.teacher_classes;
create policy "Teachers can link themselves to created classes"
  on public.teacher_classes for insert to authenticated
  with check (
    teacher_id = auth.uid()
    and exists (
      select 1 from public.classes c
      where c.id = class_id and c.created_by = auth.uid()
    )
  );

drop policy if exists "Teachers can read students in their classes" on public.students;
create policy "Teachers can read students in their classes"
  on public.students for select to authenticated
  using (
    exists (
      select 1 from public.teacher_classes tc
      where tc.class_id = students.class_id and tc.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can read attempts in their classes" on public.practice_attempts;
create policy "Teachers can read attempts in their classes"
  on public.practice_attempts for select to authenticated
  using (
    exists (
      select 1
      from public.students s
      join public.teacher_classes tc on tc.class_id = s.class_id
      where s.id = practice_attempts.student_id and tc.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can read answer events in their classes" on public.answer_events;
create policy "Teachers can read answer events in their classes"
  on public.answer_events for select to authenticated
  using (
    exists (
      select 1
      from public.practice_attempts a
      join public.students s on s.id = a.student_id
      join public.teacher_classes tc on tc.class_id = s.class_id
      where a.id = answer_events.attempt_id and tc.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can upload class MusicXML" on storage.objects;
create policy "Teachers can upload class MusicXML"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'musicxml'
    and exists (
      select 1 from public.teacher_classes tc
      where tc.teacher_id = auth.uid()
        and tc.class_id::text = (storage.foldername(name))[1]
    )
  );

drop policy if exists "Teachers can read class MusicXML" on storage.objects;
create policy "Teachers can read class MusicXML"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'musicxml'
    and exists (
      select 1 from public.teacher_classes tc
      where tc.teacher_id = auth.uid()
        and tc.class_id::text = (storage.foldername(name))[1]
    )
  );
