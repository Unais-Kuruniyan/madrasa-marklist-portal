/**
 * Converts a validated extraction into an editable "draft" in the application's own data model,
 * and performs ALL validation / calculations using the existing business rules
 * (src/lib/calculations/marks.ts, src/utils/validation.ts).
 *
 * The AI only supplies raw readings. Nothing here trusts the AI for totals, pass/fail, or roll sequences.
 */
import type { ClassDetail, SchoolClass, Student, StudentCategory, StudentInput, StudentResult, Subject } from '../../types';
import { evaluateStudent, requiredSubjectIds } from '../calculations/marks';
import { parseMark, parseRollNumber, suggestNextRollNumber, type TranslateFn } from '../../utils/validation';
import { formatMark, makeKey } from '../../utils/format';
import { matchColumns, normalizeSubjectText, type ColumnMapping } from './subjectMatching';
import type { BoundingBox, ClassSubjectInfo, Confidence, ExtractedCell, ExtractedColumn, ExtractionResult } from './types';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type DuplicateChoice = 'undecided' | 'update' | 'create';

export interface DraftRow {
  key: string;
  /** '' = could not be determined → teacher must choose */
  category: StudentCategory | '';
  roll: string;
  /** True when the roll number was not readable and was assigned with the app's own rule. */
  rollAssigned: boolean;
  admissionNumber: string;
  name: string;
  absent: boolean;
  /** subjectId → raw input text (same representation StudentForm uses) */
  marks: Record<string, string>;
  /** Fields flagged "please check". Cleared when the teacher edits the field. */
  review: { category: boolean; roll: boolean; admission: boolean; name: boolean; marks: Record<string, boolean> };
  /** Source cells keyed by photo column index (kept so the column mapping can be changed). */
  cells: Record<number, ExtractedCell>;
  importedGrandTotal: number | null;
  importedQuranHifzTotal: number | null;
  duplicateChoice: DuplicateChoice;
  box?: BoundingBox | null;
}

export interface DraftHeader {
  institutionName: string;
  institutionLocation: string;
  rangeName: string;
  className: string;
  division: string;
  examName: string;
  examYear: string;
  examDate: string;
  confidence: Record<string, Confidence>;
}

export interface DetectedSubject {
  id: string;
  name: string;
  kind: 'normal' | 'quran' | 'hifz';
  columnIndex: number;
  confidence: Confidence;
}

export interface ImportDraft {
  header: DraftHeader;
  columns: ExtractedColumn[];
  detectedSubjects: DetectedSubject[];
  mapping: ColumnMapping;
  rows: DraftRow[];
  warnings: string[];
  detectedCount: number;
}

export interface RowValidation {
  errors: {
    category?: string;
    roll?: string;
    name?: string;
    marks: Record<string, string>;
    duplicate?: string;
  };
  /** Existing student that looks like the same person (null when none). */
  duplicate: Student | null;
  ok: boolean;
}

export interface TotalMismatch {
  kind: 'grand' | 'quranHifz';
  imported: number;
  calculated: number;
}

/* ------------------------------------------------------------------ */
/* Class context helpers                                               */
/* ------------------------------------------------------------------ */

/** Subjects the importer may fill for this class (Quran/Hifz only when enabled). */
export function importableSubjects(detail: ClassDetail): Subject[] {
  const { config } = detail;
  const list = [...config.normalSubjects];
  if (config.includeQuranHifz && config.quranSubject && config.hifzSubject) {
    list.push(config.quranSubject, config.hifzSubject);
  }
  return list;
}

export function toSubjectInfo(subjects: Subject[]): ClassSubjectInfo[] {
  return subjects.map((s) => ({ id: s.id, name: s.name, kind: s.kind }));
}

/** Construct a synthetic ClassDetail for Home Import when a new class will be created. */
export function createSyntheticDetail(header: DraftHeader, detectedSubjects: DetectedSubject[]): ClassDetail {
  const hasQuran = detectedSubjects.some((s) => s.kind === 'quran');
  const hasHifz = detectedSubjects.some((s) => s.kind === 'hifz');
  const includeQuranHifz = hasQuran && hasHifz;

  const subjects: Subject[] = detectedSubjects.map((s, idx) => ({
    id: s.id,
    classId: 'synth-class',
    name: s.name,
    kind: s.kind,
    displayOrder: idx,
    maxMarks: 100,
  }));

  const normalSubjects = subjects.filter((s) => s.kind === 'normal');
  const quranSubject = subjects.find((s) => s.kind === 'quran') ?? null;
  const hifzSubject = subjects.find((s) => s.kind === 'hifz') ?? null;

  const fullClassName = header.division ? `${header.className} ${header.division}`.trim() : header.className;

  const schoolClass: SchoolClass = {
    id: 'synth-class',
    institutionName: header.institutionName,
    institutionLocation: header.institutionLocation,
    rangeName: header.rangeName,
    className: fullClassName || 'New Class',
    totalStudents: 0,
    includeQuranHifz,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return {
    schoolClass,
    examination: {
      id: 'synth-exam',
      classId: 'synth-class',
      examName: header.examName || 'Examination',
      examYear: Number(header.examYear) || new Date().getFullYear(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    allExaminations: [],
    allSubjects: subjects,
    config: {
      includeQuranHifz,
      normalSubjects,
      quranSubject: includeQuranHifz ? quranSubject : null,
      hifzSubject: includeQuranHifz ? hifzSubject : null,
    },
    students: [],
  };
}

/* ------------------------------------------------------------------ */
/* Draft creation                                                      */
/* ------------------------------------------------------------------ */

const emptyReview = (): DraftRow['review'] => ({ category: false, roll: false, admission: false, name: false, marks: {} });

export function newBlankRow(detail: ClassDetail, rows: DraftRow[], category: StudentCategory = 'boys'): DraftRow {
  const next = suggestNextRollNumber([
    ...detail.students.filter((s) => s.category === category).map((s) => s.rollNumber),
    ...rows.filter((r) => r.category === category).map((r) => Number(r.roll)).filter((n) => Number.isInteger(n) && n > 0),
  ]);
  return {
    key: makeKey(),
    category,
    roll: String(next),
    rollAssigned: false,
    admissionNumber: '',
    name: '',
    absent: false,
    marks: {},
    review: emptyReview(),
    cells: {},
    importedGrandTotal: null,
    importedQuranHifzTotal: null,
    duplicateChoice: 'undecided',
  };
}

/** Fill ONE subject's mark from the photo cell mapped to it. Blank/unreadable/absent cells stay empty and flagged. */
function fillSubject(row: DraftRow, subjectId: string, mapping: ColumnMapping): void {
  const match = mapping.matches.find((m) => m.subjectId === subjectId);
  const cell = match ? row.cells[match.columnIndex] : undefined;
  row.marks[subjectId] = '';
  row.review.marks[subjectId] = true; // needs review until a confident value is placed
  if (match && cell && cell.status === 'value' && cell.value !== null) {
    row.marks[subjectId] = formatMark(cell.value);
    row.review.marks[subjectId] = cell.confidence !== 'high' || match.needsReview;
  }
}

/** Fill a row's marks from its source cells using the given column mapping. */
function applyCells(row: DraftRow, mapping: ColumnMapping, subjects: Subject[]): void {
  row.marks = {};
  row.review.marks = {};
  const cellStatuses: string[] = [];
  for (const subject of subjects) {
    fillSubject(row, subject.id, mapping);
    const match = mapping.matches.find((m) => m.subjectId === subject.id);
    const cell = match ? row.cells[match.columnIndex] : undefined;
    if (cell) cellStatuses.push(cell.status);
  }
  // Student is absent only if every mapped subject cell is explicitly "AB".
  row.absent = cellStatuses.length > 0 && cellStatuses.every((s) => s === 'absent');
  if (row.absent) row.review.marks = {};
}

export function buildDraft(extraction: ExtractionResult, detail?: ClassDetail | null): ImportDraft {
  const rawMeta: any = extraction.documentMetadata ?? (extraction as any).header ?? {};
  const rawInst = (extraction as any).institution;
  const rawExam = (extraction as any).exam;

  const detectedSubjects: DetectedSubject[] = (extraction.columns ?? [])
    .filter((c) => c.kind === 'subject' || c.kind === 'quran' || c.kind === 'hifz')
    .map((c) => ({
      id: `subj-col-${c.index}`,
      name: c.header,
      kind: c.kind === 'quran' ? 'quran' : c.kind === 'hifz' ? 'hifz' : 'normal',
      columnIndex: c.index,
      confidence: c.confidence,
    }));

  const header: DraftHeader = {
    institutionName: rawMeta.institutionName ?? rawInst?.name ?? '',
    institutionLocation: rawMeta.location ?? rawInst?.location ?? '',
    rangeName: rawMeta.range ?? rawInst?.range ?? '',
    className: rawMeta.className ?? (extraction as any).className ?? '',
    division: rawMeta.division ?? '',
    examName: rawMeta.examName ?? rawExam?.name ?? '',
    examYear:
      rawMeta.examYear !== undefined && rawMeta.examYear !== null
        ? String(rawMeta.examYear)
        : rawExam?.year !== undefined && rawExam?.year !== null
          ? String(rawExam.year)
          : '',
    examDate: rawMeta.examDate ?? '',
    confidence: rawMeta.confidence ?? {
      institutionName: 'high',
      location: 'high',
      range: 'high',
      examName: 'high',
      examYear: 'high',
      className: 'high',
      division: 'high',
      examDate: 'high',
    },
  };

  const activeDetail = detail ?? createSyntheticDetail(header, detectedSubjects);
  const subjects = importableSubjects(activeDetail);
  const mapping = matchColumns(extraction.columns, toSubjectInfo(subjects));

  const rows: DraftRow[] = extraction.students.map((s) => {
    const cells: Record<number, ExtractedCell> = {};
    for (const c of s.cells) cells[c.columnIndex] = c;

    const totalOf = (idx: number | null): number | null =>
      idx !== null && cells[idx]?.status === 'value' ? cells[idx].value : null;

    const row: DraftRow = {
      key: makeKey(),
      category: s.category ?? '',
      roll: s.rollNumber !== null ? String(s.rollNumber) : '',
      rollAssigned: false,
      admissionNumber: s.admissionNumber ?? '',
      name: s.name ?? '',
      absent: false,
      marks: {},
      review: {
        category: s.category === null || s.categoryConfidence !== 'high',
        roll: s.rollNumber === null || s.rollConfidence !== 'high',
        admission: s.admissionNumber === null || s.admissionConfidence !== 'high',
        name: s.name === null || s.nameConfidence !== 'high',
        marks: {},
      },
      cells,
      importedGrandTotal: totalOf(mapping.grandTotalColumn),
      importedQuranHifzTotal: totalOf(mapping.quranHifzTotalColumn),
      duplicateChoice: 'undecided',
      box: s.box,
    };
    applyCells(row, mapping, subjects);
    return row;
  });

  assignMissingRolls(rows, activeDetail);

  return {
    header,
    columns: extraction.columns,
    detectedSubjects,
    mapping,
    rows,
    warnings: extraction.warnings,
    detectedCount: rows.length,
  };
}

/** Missing roll numbers are assigned using the app's own rule: highest roll in that category + 1. */
export function assignMissingRolls(rows: DraftRow[], detail: ClassDetail): void {
  for (const category of ['boys', 'girls'] as StudentCategory[]) {
    const used = [
      ...detail.students.filter((s) => s.category === category).map((s) => s.rollNumber),
      ...rows.filter((r) => r.category === category && r.roll.trim() !== '').map((r) => Number(r.roll)).filter(Number.isFinite),
    ];
    for (const r of rows) {
      if (r.category === category && r.roll.trim() === '') {
        const next = suggestNextRollNumber(used);
        r.roll = String(next);
        r.review.roll = true;
        r.rollAssigned = true;
        used.push(next);
      }
    }
  }
}

/**
 * Re-point a photo column to a (different) class subject — or to nothing (`null` = ignore).
 * Marks previously filled from this column are cleared; the new subject is filled from the photo's cells.
 */
export function remapColumn(
  draft: ImportDraft,
  detail: ClassDetail,
  columnIndex: number,
  subjectId: string | null,
): ImportDraft {
  const subjects = importableSubjects(detail);
  const matches = draft.mapping.matches.map((m) => {
    if (m.columnIndex === columnIndex) {
      return { ...m, subjectId, method: subjectId ? ('exact' as const) : null, needsReview: subjectId === null };
    }
    // a subject can only be fed by one column
    if (subjectId && m.subjectId === subjectId) return { ...m, subjectId: null, method: null, needsReview: true };
    return m;
  });
  // Only the subjects whose source changed are refilled, so the teacher's other edits survive.
  const affected = new Set<string>();
  for (const m of draft.mapping.matches) {
    if (m.columnIndex === columnIndex && m.subjectId) affected.add(m.subjectId);
    if (subjectId && m.subjectId === subjectId) affected.add(subjectId);
  }
  if (subjectId) affected.add(subjectId);
  const matched = new Set(matches.map((m) => m.subjectId).filter((x): x is string => !!x));
  const mapping: ColumnMapping = {
    ...draft.mapping,
    matches,
    unrecognized: matches.filter((m) => m.subjectId === null),
    missingSubjectIds: subjects.filter((s) => !matched.has(s.id)).map((s) => s.id),
  };
  const rows = draft.rows.map((r) => {
    const next: DraftRow = { ...r, marks: { ...r.marks }, review: { ...r.review, marks: { ...r.review.marks } } };
    for (const id of affected) fillSubject(next, id, mapping);
    return next;
  });
  return { ...draft, mapping, rows };
}

/* ------------------------------------------------------------------ */
/* Duplicates                                                          */
/* ------------------------------------------------------------------ */

/** Finds an existing student that is probably the same person: same category + (same roll OR same normalized name). */
export function findPossibleDuplicate(row: Pick<DraftRow, 'category' | 'roll' | 'name'>, existing: Student[]): Student | null {
  if (row.category === '') return null;
  const roll = Number(row.roll);
  const name = normalizeSubjectText(row.name);
  const sameCategory = existing.filter((s) => s.category === row.category);
  const byName = name ? sameCategory.find((s) => normalizeSubjectText(s.studentName) === name) : undefined;
  const byRoll = Number.isInteger(roll) ? sameCategory.find((s) => s.rollNumber === roll) : undefined;
  return byName ?? byRoll ?? null;
}

/* ------------------------------------------------------------------ */
/* Validation (re-uses existing rules)                                 */
/* ------------------------------------------------------------------ */

export function validateRow(
  row: DraftRow,
  allRows: DraftRow[],
  detail: ClassDetail,
  t: TranslateFn,
): RowValidation {
  const errors: RowValidation['errors'] = { marks: {} };
  const duplicate = findPossibleDuplicate(row, detail.students);
  const updating = duplicate !== null && row.duplicateChoice === 'update';

  if (row.category === '') errors.category = t('photoImport.errCategory');

  const rollResult = parseRollNumber(row.roll, t);
  if (!rollResult.ok) {
    errors.roll = rollResult.error;
  } else if (row.category !== '') {
    const clashDraft = allRows.find(
      (r) => r.key !== row.key && r.category === row.category && Number(r.roll) === rollResult.value,
    );
    const clashExisting = detail.students.find(
      (s) => s.category === row.category && s.rollNumber === rollResult.value && !(updating && s.id === duplicate?.id),
    );
    if (clashDraft) {
      errors.roll = t('photoImport.errRollDuplicateInImport', { roll: rollResult.value });
    } else if (clashExisting) {
      errors.roll = t('validation.rollExists', {
        roll: rollResult.value,
        category: row.category === 'boys' ? t('student.boys') : t('student.girls'),
        name: clashExisting.studentName,
      });
    }
  }

  if (!row.name.trim()) errors.name = t('validation.enterStudentName');
  else if (row.name.trim().length > 150) errors.name = t('photoImport.errNameTooLong');

  if (!row.absent) {
    for (const id of requiredSubjectIds(detail.config)) {
      const max = detail.allSubjects.find((s) => s.id === id)?.maxMarks ?? 100;
      const r = parseMark(row.marks[id] ?? '', max, t);
      if (!r.ok) errors.marks[id] = r.error;
    }
  }

  if (duplicate && row.duplicateChoice === 'undecided') errors.duplicate = t('photoImport.errChooseDuplicate');

  const ok =
    !errors.category && !errors.roll && !errors.name && !errors.duplicate && Object.keys(errors.marks).length === 0;
  return { errors, duplicate, ok };
}

/** Numeric marks for a row using only values that pass the existing parser. */
export function numericMarks(row: DraftRow, detail: ClassDetail): Record<string, number> {
  const out: Record<string, number> = {};
  if (row.absent) return out;
  for (const id of requiredSubjectIds(detail.config)) {
    const max = detail.allSubjects.find((s) => s.id === id)?.maxMarks ?? 100;
    const r = parseMark(row.marks[id] ?? '', max);
    if (r.ok) out[id] = r.value;
  }
  return out;
}

/** Application-side evaluation (Quran+Hifz total, Grand Total, P/F) – the ONLY source of truth. */
export function evaluateRow(row: DraftRow, detail: ClassDetail): StudentResult {
  return evaluateStudent(detail.config, {
    id: row.key,
    category: row.category === '' ? 'boys' : row.category,
    marks: numericMarks(row, detail),
  });
}

/** Compare totals printed in the photo against the application's own calculation. */
export function findTotalMismatches(row: DraftRow, detail: ClassDetail): TotalMismatch[] {
  if (row.absent) return [];
  const res = evaluateRow(row, detail);
  const out: TotalMismatch[] = [];
  if (res.status === 'complete') {
    if (row.importedGrandTotal !== null && res.grandTotal !== null && row.importedGrandTotal !== res.grandTotal) {
      out.push({ kind: 'grand', imported: row.importedGrandTotal, calculated: res.grandTotal });
    }
  }
  if (
    row.importedQuranHifzTotal !== null &&
    res.quranHifzTotal !== null &&
    row.importedQuranHifzTotal !== res.quranHifzTotal
  ) {
    out.push({ kind: 'quranHifz', imported: row.importedQuranHifzTotal, calculated: res.quranHifzTotal });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Save                                                                */
/* ------------------------------------------------------------------ */

/** Builds the exact inputs the existing `saveStudent` RPC wrapper expects. Throws if the row is not valid. */
export function toStudentInput(row: DraftRow, detail: ClassDetail, validation: RowValidation): StudentInput {
  if (!validation.ok || row.category === '') throw new Error('Row is not valid');
  const roll = Number(row.roll);
  const update = validation.duplicate !== null && row.duplicateChoice === 'update';
  return {
    examId: detail.examination.id,
    studentId: update ? validation.duplicate!.id : null,
    category: row.category,
    rollNumber: roll,
    studentName: row.name.trim(),
    isAbsent: row.absent,
    marks: row.absent
      ? []
      : requiredSubjectIds(detail.config).map((id) => ({ subjectId: id, marks: numericMarks(row, detail)[id] })),
  };
}

/** All rows → inputs for the existing `saveStudent`. Rows must already be valid; invalid rows are skipped. */
export function buildPhotoSaveBatch(
  rows: DraftRow[],
  detail: ClassDetail,
  validations: Map<string, RowValidation>,
): { key: string; input: StudentInput }[] {
  const batch: { key: string; input: StudentInput }[] = [];
  for (const row of rows) {
    const v = validations.get(row.key);
    if (!v || !v.ok) continue;
    batch.push({ key: row.key, input: toStudentInput(row, detail, v) });
  }
  return batch;
}

/** "8 students detected. 12 students may be missing from the image." */
export function missingStudentEstimate(detail: ClassDetail, detected: number): number {
  const expected = detail.schoolClass.totalStudents;
  return expected > detected ? expected - detected : 0;
}
