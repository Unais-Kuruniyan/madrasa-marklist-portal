-- =====================================================================
--  School / Madrasa Mark List Portal — Supabase schema
--  Run this whole file in: Supabase Dashboard → SQL Editor → New query → Run
--  The script is idempotent: it is safe to run again after changes.
-- =====================================================================
--
--  Data model
--  ----------
--  classes   1 ── * subjects   (per-class subject configuration)
--  classes   1 ── * students
--  students  1 ── * marks  * ── 1 subjects
--
--  Quran & Hifz are stored as two rows in `subjects` with
--  kind = 'quran' and kind = 'hifz'. Normal subjects use kind = 'normal'.
--  The app evaluates Quran + Hifz together as ONE subject (combined
--  total >= 40). Calculated values (totals, P/F, summary) are NOT stored;
--  they are derived from the source marks in application code.
--
--  Cascading deletes (intentional)
--  -------------------------------
--  * Deleting a class deletes its subjects, students and their marks.
--  * Deleting a student deletes that student's marks.
--  * Deleting a subject deletes all marks for that subject.
--  The UI always asks for confirmation before any of these.
--
--  Security (READ THIS)
--  --------------------
--  This app intentionally has NO authentication. Row Level Security is
--  enabled, but the policies below grant the public `anon` role full
--  read/insert/update/delete on these four tables. Anyone who has the
--  site URL (and therefore the public anon key) can read and modify all
--  mark data. See README.md → "Security model" for details.
-- =====================================================================

-- gen_random_uuid() is built in to PostgreSQL 13+ (Supabase), no extension needed.

-- ---------------------------------------------------------------------
--  Helper: keep updated_at current
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
--  classes
-- ---------------------------------------------------------------------
create table if not exists public.classes (
  id                   uuid primary key default gen_random_uuid(),
  institution_name     text not null default ''
                         check (char_length(institution_name) <= 200),
  institution_location text not null default ''
                         check (char_length(institution_location) <= 200),
  class_name           text not null
                         check (char_length(btrim(class_name)) between 1 and 100),
  total_students       integer not null default 0
                         check (total_students between 0 and 1000),
  include_quran_hifz   boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists classes_updated_at_idx on public.classes (updated_at desc);

drop trigger if exists classes_set_updated_at on public.classes;
create trigger classes_set_updated_at
  before update on public.classes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
--  subjects
-- ---------------------------------------------------------------------
create table if not exists public.subjects (
  id            uuid primary key default gen_random_uuid(),
  class_id      uuid not null references public.classes (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 100),
  kind          text not null default 'normal'
                  check (kind in ('normal', 'quran', 'hifz')),
  display_order integer not null default 0 check (display_order >= 0),
  max_marks     integer not null default 100 check (max_marks between 1 and 100),
  created_at    timestamptz not null default now()
);

create index if not exists subjects_class_order_idx
  on public.subjects (class_id, display_order);

-- At most one Quran row and one Hifz row per class.
create unique index if not exists subjects_quran_hifz_unique
  on public.subjects (class_id, kind)
  where kind in ('quran', 'hifz');

-- ---------------------------------------------------------------------
--  students
-- ---------------------------------------------------------------------
create table if not exists public.students (
  id           uuid primary key default gen_random_uuid(),
  class_id     uuid not null references public.classes (id) on delete cascade,
  roll_number  integer not null check (roll_number between 1 and 99999),
  student_name text not null check (char_length(btrim(student_name)) between 1 and 150),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Same roll number cannot appear twice in the same class.
  -- (This unique index also serves lookups by class_id.)
  constraint students_class_roll_unique unique (class_id, roll_number)
);

drop trigger if exists students_set_updated_at on public.students;
create trigger students_set_updated_at
  before update on public.students
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
--  marks
-- ---------------------------------------------------------------------
create table if not exists public.marks (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete cascade,
  marks      numeric(5, 2) not null check (marks >= 0 and marks <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marks_student_subject_unique unique (student_id, subject_id)
);

create index if not exists marks_subject_id_idx on public.marks (subject_id);

drop trigger if exists marks_set_updated_at on public.marks;
create trigger marks_set_updated_at
  before update on public.marks
  for each row execute function public.set_updated_at();

-- Integrity: a mark's subject must belong to the student's class and the
-- mark must not exceed that subject's max_marks.
create or replace function public.validate_mark()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_subject_class uuid;
  v_max           integer;
  v_student_class uuid;
begin
  select class_id, max_marks into v_subject_class, v_max
    from public.subjects where id = new.subject_id;
  select class_id into v_student_class
    from public.students where id = new.student_id;

  if v_subject_class is null or v_student_class is null
     or v_subject_class <> v_student_class then
    raise exception 'Subject and student must belong to the same class'
      using errcode = '23514';
  end if;

  if new.marks > v_max then
    raise exception 'Mark % exceeds the maximum of %', new.marks, v_max
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists marks_validate on public.marks;
create trigger marks_validate
  before insert or update on public.marks
  for each row execute function public.validate_mark();

-- ---------------------------------------------------------------------
--  RPC: save_class — create or update a class and its subjects atomically
--  p_subjects: JSON array in display order, e.g.
--    [{"id": "<uuid or null>", "name": "Fiqh"}, {"id": null, "name": "Arabic"}]
--  Normal subjects of the class that are NOT in the array are deleted
--  (with their marks — the UI warns the teacher first).
--  Quran/Hifz rows are created when enabled. When disabled they are kept
--  (hidden) so previously entered Quran/Hifz marks are not silently lost.
-- ---------------------------------------------------------------------
create or replace function public.save_class(
  p_class_id             uuid,
  p_institution_name     text,
  p_institution_location text,
  p_class_name           text,
  p_total_students       integer,
  p_include_quran_hifz   boolean,
  p_subjects             jsonb
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_class_id   uuid;
  v_item       jsonb;
  v_index      integer := 0;
  v_keep       uuid[] := '{}';
  v_subject_id uuid;
begin
  if p_subjects is null or jsonb_typeof(p_subjects) <> 'array' then
    raise exception 'p_subjects must be a JSON array' using errcode = '22023';
  end if;

  if jsonb_array_length(p_subjects) = 0 and not coalesce(p_include_quran_hifz, false) then
    raise exception 'A class needs at least one subject' using errcode = '23514';
  end if;

  if p_class_id is null then
    insert into public.classes
      (institution_name, institution_location, class_name, total_students, include_quran_hifz)
    values
      (btrim(coalesce(p_institution_name, '')), btrim(coalesce(p_institution_location, '')),
       btrim(p_class_name), p_total_students, coalesce(p_include_quran_hifz, false))
    returning id into v_class_id;
  else
    update public.classes
       set institution_name     = btrim(coalesce(p_institution_name, '')),
           institution_location = btrim(coalesce(p_institution_location, '')),
           class_name           = btrim(p_class_name),
           total_students       = p_total_students,
           include_quran_hifz   = coalesce(p_include_quran_hifz, false)
     where id = p_class_id
    returning id into v_class_id;

    if v_class_id is null then
      raise exception 'Class not found' using errcode = 'P0002';
    end if;
  end if;

  for v_item in select value from jsonb_array_elements(p_subjects)
  loop
    v_subject_id := nullif(v_item ->> 'id', '')::uuid;

    if v_subject_id is not null then
      update public.subjects
         set name = btrim(v_item ->> 'name'),
             display_order = v_index
       where id = v_subject_id
         and class_id = v_class_id
         and kind = 'normal'
      returning id into v_subject_id;   -- becomes NULL if no row matched
    end if;

    if v_subject_id is null then
      insert into public.subjects (class_id, name, kind, display_order)
      values (v_class_id, btrim(v_item ->> 'name'), 'normal', v_index)
      returning id into v_subject_id;
    end if;

    v_keep  := array_append(v_keep, v_subject_id);
    v_index := v_index + 1;
  end loop;

  delete from public.subjects
   where class_id = v_class_id
     and kind = 'normal'
     and not (id = any (v_keep));

  if coalesce(p_include_quran_hifz, false) then
    insert into public.subjects (class_id, name, kind, display_order)
    select v_class_id, 'Quran', 'quran', 1000
     where not exists (select 1 from public.subjects
                        where class_id = v_class_id and kind = 'quran');

    insert into public.subjects (class_id, name, kind, display_order)
    select v_class_id, 'Hifz', 'hifz', 1001
     where not exists (select 1 from public.subjects
                        where class_id = v_class_id and kind = 'hifz');
  end if;

  return v_class_id;
end;
$$;

-- ---------------------------------------------------------------------
--  RPC: save_student — create or update a student and their marks atomically
--  p_marks: JSON array, e.g. [{"subject_id": "<uuid>", "marks": 45}, ...]
--  p_is_absent = true  → student is saved with NO marks (not appeared).
-- ---------------------------------------------------------------------
create or replace function public.save_student(
  p_class_id     uuid,
  p_student_id   uuid,
  p_roll_number  integer,
  p_student_name text,
  p_is_absent    boolean,
  p_marks        jsonb
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_student_id uuid;
begin
  if p_student_id is null then
    insert into public.students (class_id, roll_number, student_name)
    values (p_class_id, p_roll_number, btrim(p_student_name))
    returning id into v_student_id;
  else
    update public.students
       set roll_number  = p_roll_number,
           student_name = btrim(p_student_name)
     where id = p_student_id
       and class_id = p_class_id
    returning id into v_student_id;

    if v_student_id is null then
      raise exception 'Student not found' using errcode = 'P0002';
    end if;
  end if;

  if coalesce(p_is_absent, false) then
    delete from public.marks where student_id = v_student_id;
  else
    insert into public.marks (student_id, subject_id, marks)
    select v_student_id,
           (e ->> 'subject_id')::uuid,
           (e ->> 'marks')::numeric
      from jsonb_array_elements(coalesce(p_marks, '[]'::jsonb)) as e
    on conflict (student_id, subject_id)
      do update set marks = excluded.marks;
  end if;

  return v_student_id;
end;
$$;

-- ---------------------------------------------------------------------
--  Grants (the Data API roles)
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.classes  to anon, authenticated;
grant select, insert, update, delete on public.subjects to anon, authenticated;
grant select, insert, update, delete on public.students to anon, authenticated;
grant select, insert, update, delete on public.marks    to anon, authenticated;
grant execute on function public.save_class(uuid, text, text, text, integer, boolean, jsonb)
  to anon, authenticated;
grant execute on function public.save_student(uuid, uuid, integer, text, boolean, jsonb)
  to anon, authenticated;

-- ---------------------------------------------------------------------
--  Row Level Security
--  RLS is ON for every table. Because the app is intentionally
--  login-free, the policies deliberately allow public access.
--  To lock the database down later (e.g. read-only), drop the
--  insert/update/delete policies below.
-- ---------------------------------------------------------------------
alter table public.classes  enable row level security;
alter table public.subjects enable row level security;
alter table public.students enable row level security;
alter table public.marks    enable row level security;

-- classes
drop policy if exists "classes_public_select" on public.classes;
drop policy if exists "classes_public_insert" on public.classes;
drop policy if exists "classes_public_update" on public.classes;
drop policy if exists "classes_public_delete" on public.classes;
create policy "classes_public_select" on public.classes for select to anon, authenticated using (true);
create policy "classes_public_insert" on public.classes for insert to anon, authenticated with check (true);
create policy "classes_public_update" on public.classes for update to anon, authenticated using (true) with check (true);
create policy "classes_public_delete" on public.classes for delete to anon, authenticated using (true);

-- subjects
drop policy if exists "subjects_public_select" on public.subjects;
drop policy if exists "subjects_public_insert" on public.subjects;
drop policy if exists "subjects_public_update" on public.subjects;
drop policy if exists "subjects_public_delete" on public.subjects;
create policy "subjects_public_select" on public.subjects for select to anon, authenticated using (true);
create policy "subjects_public_insert" on public.subjects for insert to anon, authenticated with check (true);
create policy "subjects_public_update" on public.subjects for update to anon, authenticated using (true) with check (true);
create policy "subjects_public_delete" on public.subjects for delete to anon, authenticated using (true);

-- students
drop policy if exists "students_public_select" on public.students;
drop policy if exists "students_public_insert" on public.students;
drop policy if exists "students_public_update" on public.students;
drop policy if exists "students_public_delete" on public.students;
create policy "students_public_select" on public.students for select to anon, authenticated using (true);
create policy "students_public_insert" on public.students for insert to anon, authenticated with check (true);
create policy "students_public_update" on public.students for update to anon, authenticated using (true) with check (true);
create policy "students_public_delete" on public.students for delete to anon, authenticated using (true);

-- marks
drop policy if exists "marks_public_select" on public.marks;
drop policy if exists "marks_public_insert" on public.marks;
drop policy if exists "marks_public_update" on public.marks;
drop policy if exists "marks_public_delete" on public.marks;
create policy "marks_public_select" on public.marks for select to anon, authenticated using (true);
create policy "marks_public_insert" on public.marks for insert to anon, authenticated with check (true);
create policy "marks_public_update" on public.marks for update to anon, authenticated using (true) with check (true);
create policy "marks_public_delete" on public.marks for delete to anon, authenticated using (true);

-- Ask PostgREST to reload its schema cache so the new RPCs are available immediately.
notify pgrst, 'reload schema';
