/**
 * Data access layer. All Supabase queries live here so components stay simple.
 */
import { getSupabase } from './client';
import type {
  ClassConfig,
  ClassDetail,
  ClassFormInput,
  ClassListItem,
  ClassRow,
  MarkRow,
  SchoolClass,
  StudentInput,
  Student,
  StudentRow,
  Subject,
  SubjectKind,
  SubjectRow,
} from '../../types';

/* ------------------------------------------------------------------ */
/* Mappers                                                             */
/* ------------------------------------------------------------------ */

function toClass(row: ClassRow): SchoolClass {
  return {
    id: row.id,
    institutionName: row.institution_name,
    institutionLocation: row.institution_location,
    className: row.class_name,
    totalStudents: row.total_students,
    includeQuranHifz: row.include_quran_hifz,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSubject(row: SubjectRow): Subject {
  return {
    id: row.id,
    classId: row.class_id,
    name: row.name,
    kind: row.kind,
    displayOrder: row.display_order,
    maxMarks: row.max_marks,
  };
}

function toStudent(row: StudentRow & { marks: MarkRow[] | null }): Student {
  const marks: Record<string, number> = {};
  for (const m of row.marks ?? []) {
    const value = typeof m.marks === 'number' ? m.marks : Number(m.marks);
    if (Number.isFinite(value)) marks[m.subject_id] = value;
  }
  return {
    id: row.id,
    classId: row.class_id,
    rollNumber: row.roll_number,
    studentName: row.student_name,
    marks,
  };
}

export function buildClassConfig(schoolClass: SchoolClass, subjects: Subject[]): ClassConfig {
  const normalSubjects = subjects
    .filter((s) => s.kind === 'normal')
    .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
  const quran = subjects.find((s) => s.kind === 'quran') ?? null;
  const hifz = subjects.find((s) => s.kind === 'hifz') ?? null;
  const enabled = schoolClass.includeQuranHifz && !!quran && !!hifz;
  return {
    includeQuranHifz: enabled,
    normalSubjects,
    quranSubject: enabled ? quran : null,
    hifzSubject: enabled ? hifz : null,
  };
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

type ClassListRow = ClassRow & {
  subjects: { kind: SubjectKind }[] | null;
  students: { count: number }[] | null;
};

export async function listClasses(): Promise<ClassListItem[]> {
  const { data, error } = await getSupabase()
    .from('classes')
    .select(
      'id, institution_name, institution_location, class_name, total_students, include_quran_hifz, created_at, updated_at, subjects(kind), students(count)',
    )
    .order('updated_at', { ascending: false });

  if (error) throw error;

  return (data as unknown as ClassListRow[]).map((row) => ({
    ...toClass(row),
    normalSubjectCount: (row.subjects ?? []).filter((s) => s.kind === 'normal').length,
    studentCount: row.students?.[0]?.count ?? 0,
  }));
}

type ClassDetailRow = ClassRow & {
  subjects: SubjectRow[] | null;
  students: (StudentRow & { marks: MarkRow[] | null })[] | null;
};

/** Load a class with subjects, students and marks in ONE request. Returns null if not found. */
export async function getClassDetail(classId: string): Promise<ClassDetail | null> {
  const { data, error } = await getSupabase()
    .from('classes')
    .select('*, subjects(*), students(*, marks(*))')
    .eq('id', classId)
    .maybeSingle();

  if (error) {
    // Invalid UUID in the URL → treat as not found.
    if (error.code === '22P02') return null;
    throw error;
  }
  if (!data) return null;

  const row = data as unknown as ClassDetailRow;
  const schoolClass = toClass(row);
  const allSubjects = (row.subjects ?? []).map(toSubject);
  const students = (row.students ?? []).map(toStudent).sort((a, b) => a.rollNumber - b.rollNumber);

  return {
    schoolClass,
    allSubjects,
    config: buildClassConfig(schoolClass, allSubjects),
    students,
  };
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

/** Create (classId = null) or update a class and its subjects atomically. Returns the class id. */
export async function saveClass(classId: string | null, input: ClassFormInput): Promise<string> {
  const { data, error } = await getSupabase().rpc('save_class', {
    p_class_id: classId,
    p_institution_name: input.institutionName,
    p_institution_location: input.institutionLocation,
    p_class_name: input.className,
    p_total_students: input.totalStudents,
    p_include_quran_hifz: input.includeQuranHifz,
    p_subjects: input.subjects.map((s) => ({ id: s.id, name: s.name })),
  });
  if (error) throw error;
  return data as string;
}

/** Deletes the class. Subjects, students and marks are removed by ON DELETE CASCADE. */
export async function deleteClass(classId: string): Promise<void> {
  const { error } = await getSupabase().from('classes').delete().eq('id', classId);
  if (error) throw error;
}

/** Create or update a student with all marks atomically. Returns the student id. */
export async function saveStudent(input: StudentInput): Promise<string> {
  const { data, error } = await getSupabase().rpc('save_student', {
    p_class_id: input.classId,
    p_student_id: input.studentId,
    p_roll_number: input.rollNumber,
    p_student_name: input.studentName,
    p_is_absent: input.isAbsent,
    p_marks: input.marks.map((m) => ({ subject_id: m.subjectId, marks: m.marks })),
  });
  if (error) throw error;
  return data as string;
}

/** Deletes a student. Their marks are removed by ON DELETE CASCADE. */
export async function deleteStudent(studentId: string): Promise<void> {
  const { error } = await getSupabase().from('students').delete().eq('id', studentId);
  if (error) throw error;
}
