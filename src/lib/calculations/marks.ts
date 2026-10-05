/**
 * Mark calculations — SINGLE source of truth for all business rules.
 */
import type {
  ClassConfig,
  ClassSummary,
  ResultCode,
  Student,
  StudentResult,
} from '../../types';

export const PASS_MARK = 40;
export const DEFAULT_MAX_MARKS = 100;
export const QURAN_HIFZ_LABEL = 'Quran + Hifz';

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sum(values: number[]): number {
  return round2(values.reduce((acc, v) => acc + v, 0));
}

export function calculateQuranHifzTotal(quran: number, hifz: number): number {
  return round2(quran + hifz);
}

export function calculateQuranHifzMax(
  quranMax: number = DEFAULT_MAX_MARKS,
  hifzMax: number = DEFAULT_MAX_MARKS,
): number {
  return quranMax + hifzMax;
}

export function calculateGrandTotal(
  normalMarks: number[],
  quranHifzTotal?: number | null,
): number {
  const base = sum(normalMarks);
  return quranHifzTotal == null ? base : round2(base + quranHifzTotal);
}

export function isPassingMark(mark: number): boolean {
  return mark >= PASS_MARK;
}

export function calculateResult(
  normalMarks: number[],
  quranHifzTotal?: number | null,
): ResultCode {
  const normalOk = normalMarks.every(isPassingMark);
  const quranHifzOk = quranHifzTotal == null ? true : isPassingMark(quranHifzTotal);
  return normalOk && quranHifzOk ? 'P' : 'F';
}

export function requiredSubjectIds(config: ClassConfig): string[] {
  const ids = config.normalSubjects.map((s) => s.id);
  if (config.includeQuranHifz && config.quranSubject && config.hifzSubject) {
    ids.push(config.quranSubject.id, config.hifzSubject.id);
  }
  return ids;
}

export function evaluateStudent(
  config: ClassConfig,
  student: Pick<Student, 'id' | 'category' | 'marks'>,
): StudentResult {
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
      category: student.category ?? 'boys',
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
    category: student.category ?? 'boys',
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
 * Calculates summary statistics for Boys, Girls and Overall.
 */
export function calculateSummary(totalCapacity: number, results: StudentResult[]): ClassSummary {
  const boys = results.filter((r) => r.category === 'boys');
  const girls = results.filter((r) => r.category === 'girls');

  const totalBoys = boys.length;
  const totalGirls = girls.length;

  const appearedBoys = boys.filter((r) => r.status === 'complete').length;
  const appearedGirls = girls.filter((r) => r.status === 'complete').length;

  const passedBoys = boys.filter((r) => r.result === 'P').length;
  const passedGirls = girls.filter((r) => r.result === 'P').length;

  const failedBoys = boys.filter((r) => r.result === 'F').length;
  const failedGirls = girls.filter((r) => r.result === 'F').length;

  const totalParticipants = totalBoys + totalGirls;
  const totalAppeared = appearedBoys + appearedGirls;
  const totalPassed = passedBoys + passedGirls;
  const totalFailed = failedBoys + failedGirls;

  const passPercentage = totalAppeared === 0 ? 0 : round2((totalPassed / totalAppeared) * 100);

  return {
    totalStudents: totalCapacity,
    totalBoys,
    totalGirls,
    appearedBoys,
    appearedGirls,
    passedBoys,
    passedGirls,
    failedBoys,
    failedGirls,
    totalParticipants,
    totalAppeared,
    totalPassed,
    totalFailed,
    passPercentage,
  };
}

/** Formats counts as `boys + girls = total` (e.g. "10 + 5 = 15") */
export function formatCombinedCount(boysCount: number, girlsCount: number, total: number): string {
  return `${boysCount} + ${girlsCount} = ${total}`;
}
