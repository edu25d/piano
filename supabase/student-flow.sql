-- Run after schema.sql and teacher-screen.sql to enable resumable student practice.
alter table public.practice_attempts
  add column if not exists note_midi_sequence integer[] not null default '{}';

alter table public.answer_events
  add column if not exists client_event_id uuid default gen_random_uuid();

update public.answer_events
set client_event_id = gen_random_uuid()
where client_event_id is null;

alter table public.answer_events
  alter column client_event_id set not null;

create unique index if not exists answer_events_client_event_id_uidx
  on public.answer_events (client_event_id);

insert into public.practice_songs (id, title, musicxml_path, difficulty, sort_order, is_active)
values
  ('10000000-0000-4000-8000-000000000001', '작은 별 · 첫걸음', 'builtin:twinkle', '기초', 1, true),
  ('10000000-0000-4000-8000-000000000002', '도레미 산책', 'builtin:scale', '기초', 2, true),
  ('10000000-0000-4000-8000-000000000003', '높낮이 다리', 'builtin:leaps', '연습', 3, true)
on conflict (id) do nothing;
