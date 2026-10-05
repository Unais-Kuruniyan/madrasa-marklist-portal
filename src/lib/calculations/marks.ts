/**
 * Mark calculations — the SINGLE source of truth for all business rules.
 *
 * Rules:
 *  1. Every normal subject must be >= PASS_MARK (40) independently.
 *  2. Quran and Hifz are two components of ONE subject. They are NOT
 *     checked individually. Only their combined total is checked
 *     against PASS_MARK.
 *  3. Grand Total = sum of normal subjects (+ Quran + Hifz total, once).
 *  4. Result is 'P' only if rule 1 holds and (when enabled) rule 2 holds.
 *
 * All functions here are pure and framework-free so they can be unit tested.
 */
import type {
  ClassConfig,
  ClassSummary,
  ResultCode,
  Student,
  StudentResult,
} from '../../types';

/** Minimum mark required to pass a subject (and the combined Quran + Hifz). */
export const PASS_MARK = 40;

/** Default maximum mark for any subject / component. */
export const DEFAULT_MAX_MARKS = 100;

/** Display name for the combined subject. */
export const QURAN_HIFZ_LABEL = 'Quran + Hifz';

/** Round to 2 decimals and avoid floating point noise (e.g. 0.1 + 0.2). */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sum(values: number[]): number {
  return round2(values.reduce((acc, v) => acc + v, 0));
}

/** Quran + Hifz combined total. */
export function calculateQuranHifzTotal(quran: number, hifz: number): number {
  return round2(quran + hifz);
}

/** Maximum possible combined Quran + Hifz total, from the component maxima. */
export function calculateQuranHifzMax(
  quranMax: number = DEFAULT_MAX_MARKS,
  hifzMax: number = DEFAULT_MAX_MARKS,
): number {
  return quranMax + hifzMax;
}

/**
 * Grand Total = all normal subject marks + Quran/Hifz combined total.
 * Pass `null`/`undefined` for `quranHifzTotal` when Quran/Hifz is disabled.
 * Quran/Hifz therefore contributes exactly once.
 */
export function calculateGrandTotal(
  normalMarks: number[],
  quranHifzTotal?: number | null,
): number {
  const base = sum(normalMarks);
  return quranHifzTotal == null ? base : round2(base + quranHifzTotal);
}

/** Does a single (normal or combined) subject score pass? */
export function isPassingMark(mark: number): boolean {
  return mark >= PASS_MARK;
}

/**
 * Overall result.
 * - every normal subject must be >= 40
 * - if Quran/Hifz is enabled, the COMBINED total must be >= 40
 * Pass `null`/`undefined` for `quranHifzTotal` when Quran/Hifz is disabled.
 */
export function calculateResult(
  normalMarks: number[],
  quranHifzTotal?: number | null,
): ResultCode {
  const normalOk = normalMarks.every(isPassingMark);
  const quranHifzOk = quranHifzTotal == null ? true : isPassingMark(quranHifzTotal);
  return normalOk && quranHifzOk ? 'P' : 'F';
}

/** Ids of every subject a student must have a mark for, given the config. */
export function requiredSubjectIds(config: ClassConfig): string[] {
  const ids = config.normalSubjects.map((s) => s.id);
  if (config.includeQuranHifz && config.quranSubject && config.hifzSubject) {
    ids.push(config.quranSubject.id, config.hifzSubject.id);
  }
  return ids;
}

/**
 * Evaluate one student against the class configuration.
 * Handles absent (no marks) and incomplete (some marks missing) students.
 */
export function evaluateStudent(config: ClassConfig, student: Pick<Student, 'id' | 'marks'>): StudentResult {
  const markOf = (subjectId: string | undefined): number | null => {
    if (!subjectId) return null;
    const value = student.marks[subjectId];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };

  const withQuranHifz = config.includeQuranHifz && !!config.quranSubject && !!config.hifzSubject;

  const normalMarks = config.normalSubjects.map((s) => markOf(s.id));
  const quran = withQuranHifz ? markOf(config.quranSubject?.id) : null;
  const hifz = withQuranHifz ? markOf(config.hifzSubject?.id) : null;
  const quranHifzTotal =
    withQuranHifz && quran !== null && hifz !== null ? calculateQuranHifzTotal(quran, hifz) : null;

  const required = [...normalMarks, ...(withQuranHifz ? [quran, hifz] : [])];
  const enteredCount = required.filter((m) => m !== null).length;

  const status: StudentResult['status'] =
    enteredCount === 0 ? 'absent' : enteredCount < required.length ? 'incomplete' : 'complete';

  if (status !== 'complete') {
    return {
      studentId: student.id,
      status,
      normalMarks,
      quran,
      hifz,
      quranHifzTotal,
      grandTotal: null,
      result: null,
      failedSubjects: [],
    };
  }

  const completeNormal = normalMarks as number[];
  const failedSubjects = config.normalSubjects
    .filter((_, i) => !isPassingMark(completeNormal[i]))
    .map((s) => s.name);
  if (quranHifzTotal !== null && !isPassingMark(quranHifzTotal)) {
    failedSubjects.push(QURAN_HIFZ_LABEL);
  }

  return {
    studentId: student.id,
    status,
    normalMarks,
    quran,
    hifz,
    quranHifzTotal,
    grandTotal: calculateGrandTotal(completeNormal, quranHifzTotal),
    result: calculateResult(completeNormal, quranHifzTotal),
    failedSubjects,
  };
}

/**
 * Class summary.
 * Appeared = students whose marks are completely entered.
 * Absent (no marks) and incomplete students are NOT counted as appeared.
 */
export function calculateSummary(totalStudents: number, results: StudentResult[]): ClassSummary {
  const appeared = results.filter((r) => r.status === 'complete').length;
  const passed = results.filter((r) => r.result === 'P').length;
  const failed = results.filter((r) => r.result === 'F').length;
  const absent = results.filter((r) => r.status === 'absent').length;
  const incomplete = results.filter((r) => r.status === 'incomplete').length;

  return {
    totalStudents,
    appeared,
    passed,
    failed,
    absent,
    incomplete,
    passPercentage: appeared === 0 ? 0 : round2((passed / appeared) * 100),
  };
}
