/**
 * Shared domain types for the Mark List Portal.
 */

export type SubjectKind = 'normal' | 'quran' | 'hifz';
export type StudentCategory = 'boys' | 'girls';

/* ------------------------------------------------------------------ */
/* Database row types                                                  */
/* ------------------------------------------------------------------ */

export interface ClassRow {
  id: string;
  institution_name: string;
  institution_location: string;
  range_name: string;
  class_name: string;
  total_students: number;
  include_quran_hifz: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExaminationRow {
  id: string;
  class_id: string;
  exam_name: string;
  exam_year: number;
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
  exam_id: string;
  category: StudentCategory;
  roll_number: number;
  student_name: string;
  created_at: string;
  updated_at: string;
}

export interface MarkRow {
  id: string;
  student_id: string;
  subject_id: string;
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
  rangeName: string;
  className: string;
  totalStudents: number;
  includeQuranHifz: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Examination {
  id: string;
  classId: string;
  examName: string;
  examYear: number;
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
  examId: string;
  category: StudentCategory;
  rollNumber: number;
  studentName: string;
  marks: Record<string, number>;
}

export interface ClassListItem extends SchoolClass {
  normalSubjectCount: number;
  studentCount: number;
  examinations: Examination[];
}

export interface ClassConfig {
  includeQuranHifz: boolean;
  normalSubjects: Subject[];
  quranSubject: Subject | null;
  hifzSubject: Subject | null;
}

export interface ClassDetail {
  schoolClass: SchoolClass;
  examination: Examination;
  allExaminations: Examination[];
  allSubjects: Subject[];
  config: ClassConfig;
  students: Student[];
}

/* ------------------------------------------------------------------ */
/* Calculation results                                                 */
/* ------------------------------------------------------------------ */

export type ResultCode = 'P' | 'F';
export type StudentStatus = 'complete' | 'incomplete' | 'absent';

export interface StudentResult {
  studentId: string;
  category: StudentCategory;
  status: StudentStatus;
  normalMarks: (number | null)[];
  quran: number | null;
  hifz: number | null;
  quranHifzTotal: number | null;
  grandTotal: number | null;
  result: ResultCode | null;
  failedSubjects: string[];
}

export interface ClassSummary {
  totalStudents: number;
  totalBoys: number;
  totalGirls: number;
  appearedBoys: number;
  appearedGirls: number;
  passedBoys: number;
  passedGirls: number;
  failedBoys: number;
  failedGirls: number;
  totalParticipants: number;
  totalAppeared: number;
  totalPassed: number;
  totalFailed: number;
  /** Overall percentage: (totalPassed / totalAppeared) * 100 */
  passPercentage: number;
}

/* ------------------------------------------------------------------ */
/* Form / input types                                                  */
/* ------------------------------------------------------------------ */

export interface SubjectDraft {
  id: string | null;
  key: string;
  name: string;
}

export interface ClassFormInput {
  institutionName: string;
  institutionLocation: string;
  rangeName: string;
  className: string;
  examName: string;
  examYear: number;
  totalStudents: number;
  includeQuranHifz: boolean;
  subjects: { id: string | null; name: string }[];
}

export interface StudentInput {
  examId: string;
  studentId: string | null;
  category: StudentCategory;
  rollNumber: number;
  studentName: string;
  isAbsent: boolean;
  marks: { subjectId: string; marks: number }[];
}
