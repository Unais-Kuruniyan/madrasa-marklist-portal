-- =====================================================================
--  School / Madrasa Mark List Portal — Supabase schema (Updated)
--  Run this whole file in: Supabase Dashboard → SQL Editor → New query → Run
--  The script is idempotent: it is safe to run again after changes.
-- =====================================================================
--
--  Data model
--  ----------
--  classes       1 ── * examinations  (e.g., Half-Yearly 2026, Annual 2026)
--  classes       1 ── * subjects      (per-class subject configuration)
--  examinations  1 ── * students      (boys / girls with independent roll numbers)
--  students      1 ── * marks     * ── 1 subjects
--
-- =====================================================================

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
  institution_name     text not null default '' check (char_length(institution_name) <= 200),
  institution_location text not null default '' check (char_length(institution_location) <= 200),
  range_name           text not null default '' check (char_length(range_name) <= 200),
  class_name           text not null check (char_length(btrim(class_name)) between 1 and 100),
  total_students       integer not null default 0 check (total_students between 0 and 1000),
  include_quran_hifz   boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Ensure range_name column exists if migrating from earlier schema
alter table public.classes add column if not exists range_name text not null default '';

create index if not exists classes_updated_at_idx on public.classes (updated_at desc);

drop trigger if exists classes_set_updated_at on public.classes;
create trigger classes_set_updated_at
  before update on public.classes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
--  examinations
-- ---------------------------------------------------------------------
create table if not exists public.examinations (
  id         uuid primary key default gen_random_uuid(),
  class_id   uuid not null references public.classes (id) on delete cascade,
  exam_name  text not null check (char_length(btrim(exam_name)) between 1 and 100),
  exam_year  integer not null check (exam_year between 2000 and 2100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint examinations_class_exam_year_unique unique (class_id, exam_name, exam_year)
);

create index if not exists examinations_class_id_idx on public.examinations (class_id);

drop trigger if exists examinations_set_updated_at on public.examinations;
create trigger examinations_set_updated_at
  before update on public.examinations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
--  subjects
-- ---------------------------------------------------------------------
create table if not exists public.subjects (
  id            uuid primary key default gen_random_uuid(),
  class_id      uuid not null references public.classes (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 100),
  kind          text not null default 'normal' check (kind in ('normal', 'quran', 'hifz')),
  display_order integer not null default 0 check (display_order >= 0),
  max_marks     integer not null default 100 check (max_marks between 1 and 100),
  created_at    timestamptz not null default now()
);

create index if not exists subjects_class_order_idx on public.subjects (class_id, display_order);

create unique index if not exists subjects_quran_hifz_unique
  on public.subjects (class_id, kind)
  where kind in ('quran', 'hifz');

-- ---------------------------------------------------------------------
--  students
-- ---------------------------------------------------------------------
create table if not exists public.students (
  id           uuid primary key default gen_random_uuid(),
  exam_id      uuid references public.examinations (id) on delete cascade,
  category     text not null default 'boys' check (category in ('boys', 'girls')),
  roll_number  integer not null check (roll_number between 1 and 99999),
  student_name text not null check (char_length(btrim(student_name)) between 1 and 150),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint students_exam_category_roll_unique unique (exam_id, category, roll_number)
);

-- Ensure migration compatibility for existing columns
alter table public.students add column if not exists exam_id uuid references public.examinations (id) on delete cascade;
alter table public.students add column if not exists category text not null default 'boys';

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

-- Integrity trigger: mark max limit check
create or replace function public.validate_mark()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_max integer;
begin
  select max_marks into v_max from public.subjects where id = new.subject_id;

  if v_max is not null and new.marks > v_max then
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
--  RPC: save_class — save class details, range name & subjects atomically
-- ---------------------------------------------------------------------
create or replace function public.save_class(
  p_class_id             uuid,
  p_institution_name     text,
  p_institution_location text,
  p_range_name           text,
  p_class_name           text,
  p_total_students       integer,
  p_include_quran_hifz   boolean,
  p_subjects             jsonb,
  p_exam_name            text default 'Half-Yearly Examination',
  p_exam_year            integer default 2026
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_class_id   uuid;
  v_exam_id    uuid;
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
      (institution_name, institution_location, range_name, class_name, total_students, include_quran_hifz)
    values
      (btrim(coalesce(p_institution_name, '')), btrim(coalesce(p_institution_location, '')),
       btrim(coalesce(p_range_name, '')), btrim(p_class_name), p_total_students, coalesce(p_include_quran_hifz, false))
    returning id into v_class_id;
  else
    update public.classes
       set institution_name     = btrim(coalesce(p_institution_name, '')),
           institution_location = btrim(coalesce(p_institution_location, '')),
           range_name           = btrim(coalesce(p_range_name, '')),
           class_name           = btrim(p_class_name),
           total_students       = p_total_students,
           include_quran_hifz   = coalesce(p_include_quran_hifz, false)
     where id = p_class_id
    returning id into v_class_id;

    if v_class_id is null then
      raise exception 'Class not found' using errcode = 'P0002';
    end if;
  end if;

  -- Ensure an examination row exists for this class
  insert into public.examinations (class_id, exam_name, exam_year)
  values (v_class_id, btrim(coalesce(p_exam_name, 'Half-Yearly Examination')), coalesce(p_exam_year, 2026))
  on conflict (class_id, exam_name, exam_year)
  do update set updated_at = now()
  returning id into v_exam_id;

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
      returning id into v_subject_id;
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

  return jsonb_build_object('class_id', v_class_id, 'exam_id', v_exam_id);
end;
$$;

-- ---------------------------------------------------------------------
--  RPC: save_examination — create or update an exam for a class
-- ---------------------------------------------------------------------
create or replace function public.save_examination(
  p_class_id   uuid,
  p_exam_id    uuid,
  p_exam_name  text,
  p_exam_year  integer
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_exam_id uuid;
begin
  if p_exam_id is null then
    insert into public.examinations (class_id, exam_name, exam_year)
    values (p_class_id, btrim(p_exam_name), p_exam_year)
    returning id into v_exam_id;
  else
    update public.examinations
       set exam_name = btrim(p_exam_name),
           exam_year = p_exam_year
     where id = p_exam_id and class_id = p_class_id
    returning id into v_exam_id;
  end if;

  return v_exam_id;
end;
$$;

-- ---------------------------------------------------------------------
--  RPC: save_student — create or update a student and their marks atomically
-- ---------------------------------------------------------------------
create or replace function public.save_student(
  p_exam_id      uuid,
  p_student_id   uuid,
  p_category     text,
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
  v_category   text := lower(btrim(coalesce(p_category, 'boys')));
begin
  if v_category not in ('boys', 'girls') then
    raise exception 'Category must be boys or girls' using errcode = '23514';
  end if;

  if p_student_id is null then
    insert into public.students (exam_id, category, roll_number, student_name)
    values (p_exam_id, v_category, p_roll_number, btrim(p_student_name))
    returning id into v_student_id;
  else
    update public.students
       set category     = v_category,
           roll_number  = p_roll_number,
           student_name = btrim(p_student_name)
     where id = p_student_id
       and exam_id = p_exam_id
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
--  Grants & RLS Policies
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.classes      to anon, authenticated;
grant select, insert, update, delete on public.examinations to anon, authenticated;
grant select, insert, update, delete on public.subjects     to anon, authenticated;
grant select, insert, update, delete on public.students     to anon, authenticated;
grant select, insert, update, delete on public.marks        to anon, authenticated;
grant execute on function public.save_class(uuid, text, text, text, text, integer, boolean, jsonb, text, integer) to anon, authenticated;
grant execute on function public.save_examination(uuid, uuid, text, integer) to anon, authenticated;
grant execute on function public.save_student(uuid, uuid, text, integer, text, boolean, jsonb) to anon, authenticated;

alter table public.classes      enable row level security;
alter table public.examinations enable row level security;
alter table public.subjects     enable row level security;
alter table public.students     enable row level security;
alter table public.marks        enable row level security;

-- Policies for public anon access
drop policy if exists "classes_public_all" on public.classes;
create policy "classes_public_all" on public.classes for all to anon, authenticated using (true) with check (true);

drop policy if exists "examinations_public_all" on public.examinations;
create policy "examinations_public_all" on public.examinations for all to anon, authenticated using (true) with check (true);

drop policy if exists "subjects_public_all" on public.subjects;
create policy "subjects_public_all" on public.subjects for all to anon, authenticated using (true) with check (true);

drop policy if exists "students_public_all" on public.students;
create policy "students_public_all" on public.students for all to anon, authenticated using (true) with check (true);

drop policy if exists "marks_public_all" on public.marks;
create policy "marks_public_all" on public.marks for all to anon, authenticated using (true) with check (true);

notify pgrst, 'reload schema';
