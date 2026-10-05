/**
 * Shared domain types for the Mark List Portal.
 *
 * Database rows use snake_case (as stored in Supabase); the rest of the app
 * uses camelCase domain types, mapped in `src/lib/supabase/api.ts`.
 */

/** Kind of subject row. Quran & Hifz are two components of ONE subject. */
export type SubjectKind = 'normal' | 'quran' | 'hifz';

/* ------------------------------------------------------------------ */
/* Database row types                                                  */
/* ------------------------------------------------------------------ */

export interface ClassRow {
  id: string;
  institution_name: string;
  institution_location: string;
  class_name: string;
  total_students: number;
  include_quran_hifz: boolean;
  created_at: string;
  updated_at: string;
}

export interface SubjectRow {
  id: string;
  class_id: string;
  name: string;
  kind: SubjectKind;
  display_order: number;
  max_marks: number;
  created_at: string;
}

export interface StudentRow {
  id: string;
  class_id: string;
  roll_number: number;
  student_name: string;
  created_at: string;
  updated_at: string;
}

export interface MarkRow {
  id: string;
  student_id: string;
  subject_id: string;
  /** numeric columns may arrive as number or string from PostgREST */
  marks: number | string;
  created_at: string;
  updated_at: string;
}

/* ------------------------------------------------------------------ */
/* Domain types                                                        */
/* ------------------------------------------------------------------ */

export interface SchoolClass {
  id: string;
  institutionName: string;
  institutionLocation: string;
  className: string;
  totalStudents: number;
  includeQuranHifz: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Subject {
  id: string;
  classId: string;
  name: string;
  kind: SubjectKind;
  displayOrder: number;
  maxMarks: number;
}

export interface Mark {
  id: string;
  studentId: string;
  subjectId: string;
  marks: number;
}

export interface Student {
  id: string;
  classId: string;
  rollNumber: number;
  studentName: string;
  /** subjectId → mark */
  marks: Record<string, number>;
}

/** Item shown on the dashboard. */
export interface ClassListItem extends SchoolClass {
  normalSubjectCount: number;
  studentCount: number;
}

/**
 * Everything needed to evaluate students of a class.
 * Quran/Hifz subjects are only present when `includeQuranHifz` is true.
 */
export interface ClassConfig {
  includeQuranHifz: boolean;
  normalSubjects: Subject[];
  quranSubject: Subject | null;
  hifzSubject: Subject | null;
}

/** Full class with configuration and students (mark list page). */
export interface ClassDetail {
  schoolClass: SchoolClass;
  /** All subject rows (including hidden Quran/Hifz rows when disabled). */
  allSubjects: Subject[];
  config: ClassConfig;
  students: Student[];
}

/* ------------------------------------------------------------------ */
/* Calculation results                                                 */
/* ------------------------------------------------------------------ */

export type ResultCode = 'P' | 'F';

/**
 * - complete:   every required mark entered → P/F decided
 * - incomplete: some (but not all) required marks entered (e.g. a subject
 *               was added after the student was saved) → no P/F yet
 * - absent:     no marks at all → did not appear
 */
export type StudentStatus = 'complete' | 'incomplete' | 'absent';

export interface StudentResult {
  studentId: string;
  status: StudentStatus;
  /** Marks for each normal subject, in subject order (null = missing). */
  normalMarks: (number | null)[];
  quran: number | null;
  hifz: number | null;
  /** Quran + Hifz combined (null if disabled or a component is missing). */
  quranHifzTotal: number | null;
  /** null unless status is 'complete'. */
  grandTotal: number | null;
  /** null unless status is 'complete'. */
  result: ResultCode | null;
  /** Names of subjects below the pass mark (Quran + Hifz counted as one). */
  failedSubjects: string[];
}

export interface ClassSummary {
  totalStudents: number;
  appeared: number;
  passed: number;
  failed: number;
  absent: number;
  incomplete: number;
  /** 0–100, rounded to 2 decimals */
  passPercentage: number;
}

/* ------------------------------------------------------------------ */
/* Form / input types                                                  */
/* ------------------------------------------------------------------ */

export interface SubjectDraft {
  /** Existing subject id, or null for a new subject. */
  id: string | null;
  /** Stable key for React lists. */
  key: string;
  name: string;
}

export interface ClassFormInput {
  institutionName: string;
  institutionLocation: string;
  className: string;
  totalStudents: number;
  includeQuranHifz: boolean;
  /** Normal subjects in display order. */
  subjects: { id: string | null; name: string }[];
}

export interface StudentInput {
  classId: string;
  studentId: string | null;
  rollNumber: number;
  studentName: string;
  isAbsent: boolean;
  marks: { subjectId: string; marks: number }[];
}
