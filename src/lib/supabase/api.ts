/**
 * Data access layer for Supabase operations.
 */
import { getSupabase } from './client';
import type {
  ClassConfig,
  ClassDetail,
  ClassFormInput,
  ClassListItem,
  ClassRow,
  Examination,
  ExaminationRow,
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
    rangeName: row.range_name ?? '',
    className: row.class_name,
    totalStudents: row.total_students,
    includeQuranHifz: row.include_quran_hifz,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toExamination(row: ExaminationRow): Examination {
  return {
    id: row.id,
    classId: row.class_id,
    examName: row.exam_name,
    examYear: row.exam_year,
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
    examId: row.exam_id,
    category: row.category ?? 'boys',
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
  examinations: ExaminationRow[] | null;
};

export async function listClasses(): Promise<ClassListItem[]> {
  const { data, error } = await getSupabase()
    .from('classes')
    .select(
      'id, institution_name, institution_location, range_name, class_name, total_students, include_quran_hifz, created_at, updated_at, subjects(kind), examinations(*)',
    )
    .order('updated_at', { ascending: false });

  if (error) throw error;

  const items: ClassListItem[] = [];
  for (const row of data as unknown as ClassListRow[]) {
    const schoolClass = toClass(row);
    const examinations = (row.examinations ?? []).map(toExamination).sort((a, b) => b.examYear - a.examYear);
    
    // Count total students for the latest exam
    let studentCount = 0;
    if (examinations.length > 0) {
      const latestExamId = examinations[0].id;
      const { count } = await getSupabase()
        .from('students')
        .select('*', { count: 'exact', head: true })
        .eq('exam_id', latestExamId);
      studentCount = count ?? 0;
    }

    items.push({
      ...schoolClass,
      normalSubjectCount: (row.subjects ?? []).filter((s) => s.kind === 'normal').length,
      studentCount,
      examinations,
    });
  }

  return items;
}

type RawClassQuery = ClassRow & {
  subjects: SubjectRow[] | null;
  examinations: ExaminationRow[] | null;
};

export async function getClassDetail(classId: string, examId?: string): Promise<ClassDetail | null> {
  // 1. Fetch class, subjects and examinations
  const { data: classData, error: classError } = await getSupabase()
    .from('classes')
    .select('*, subjects(*), examinations(*)')
    .eq('id', classId)
    .maybeSingle();

  if (classError) {
    if (classError.code === '22P02') return null;
    throw classError;
  }
  if (!classData) return null;

  const raw = classData as unknown as RawClassQuery;
  const schoolClass = toClass(raw);
  const allSubjects = (raw.subjects ?? []).map(toSubject);
  const allExaminations = (raw.examinations ?? []).map(toExamination).sort((a, b) => b.examYear - a.examYear);

  if (allExaminations.length === 0) {
    // Fallback: create default exam if missing
    const { data: newExamId } = await getSupabase().rpc('save_examination', {
      p_class_id: classId,
      p_exam_id: null,
      p_exam_name: 'Half-Yearly Examination',
      p_exam_year: new Date().getFullYear(),
    });
    return getClassDetail(classId, newExamId as string);
  }

  // Selected examination (or latest one if not specified)
  const activeExam = examId ? allExaminations.find((e) => e.id === examId) ?? allExaminations[0] : allExaminations[0];

  // 2. Fetch students & marks for the active exam
  const { data: studentData, error: studentError } = await getSupabase()
    .from('students')
    .select('*, marks(*)')
    .eq('exam_id', activeExam.id);

  if (studentError) throw studentError;

  const students = ((studentData as unknown as (StudentRow & { marks: MarkRow[] | null })[]) ?? [])
    .map(toStudent)
    .sort((a, b) => {
      if (a.category !== b.category) return a.category === 'boys' ? -1 : 1;
      return a.rollNumber - b.rollNumber;
    });

  return {
    schoolClass,
    examination: activeExam,
    allExaminations,
    allSubjects,
    config: buildClassConfig(schoolClass, allSubjects),
    students,
  };
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export async function saveClass(classId: string | null, input: ClassFormInput): Promise<{ classId: string; examId: string }> {
  const { data, error } = await getSupabase().rpc('save_class', {
    p_class_id: classId,
    p_institution_name: input.institutionName,
    p_institution_location: input.institutionLocation,
    p_range_name: input.rangeName,
    p_class_name: input.className,
    p_total_students: input.totalStudents,
    p_include_quran_hifz: input.includeQuranHifz,
    p_subjects: input.subjects.map((s) => ({ id: s.id, name: s.name })),
    p_exam_name: input.examName,
    p_exam_year: input.examYear,
  });
  if (error) throw error;
  const res = data as { class_id: string; exam_id: string };
  return { classId: res.class_id, examId: res.exam_id };
}

export async function saveExamination(classId: string, examName: string, examYear: number, examId?: string | null): Promise<string> {
  const { data, error } = await getSupabase().rpc('save_examination', {
    p_class_id: classId,
    p_exam_id: examId ?? null,
    p_exam_name: examName,
    p_exam_year: examYear,
  });
  if (error) throw error;
  return data as string;
}

export async function deleteClass(classId: string): Promise<void> {
  const { error } = await getSupabase().from('classes').delete().eq('id', classId);
  if (error) throw error;
}

import { isValidUuid } from '../../utils/validation';

export async function saveStudent(input: StudentInput): Promise<string> {
  for (const m of input.marks) {
    if (!isValidUuid(m.subjectId)) {
      throw new Error(
        `Cannot save student mark: Subject ID '${m.subjectId}' is not a valid database UUID. Importer subject IDs must be resolved to database UUIDs before saving.`,
      );
    }
  }

  const { data, error } = await getSupabase().rpc('save_student', {
    p_exam_id: input.examId,
    p_student_id: input.studentId,
    p_category: input.category,
    p_roll_number: input.rollNumber,
    p_student_name: input.studentName,
    p_is_absent: input.isAbsent,
    p_marks: input.marks.map((m) => ({ subject_id: m.subjectId, marks: m.marks })),
  });
  if (error) throw error;
  return data as string;
}

export async function deleteStudent(studentId: string): Promise<void> {
  const { error } = await getSupabase().from('students').delete().eq('id', studentId);
  if (error) throw error;
}
