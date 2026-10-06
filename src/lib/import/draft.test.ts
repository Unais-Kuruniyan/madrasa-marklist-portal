import { describe, expect, it } from 'vitest';
import type { ClassDetail, Student, Subject } from '../../types';
import { buildClassConfig } from '../supabase/api';
import {
  buildDraft,
  buildPhotoSaveBatch,
  evaluateRow,
  findPossibleDuplicate,
  findTotalMismatches,
  missingStudentEstimate,
  remapColumn,
  validateRow,
  type DraftRow,
  type RowValidation,
} from './draft';
import type { ExtractedCell, ExtractedStudent, ExtractionResult } from './types';

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}:${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')}` : key;

const subj = (id: string, name: string, kind: Subject['kind'], order: number): Subject => ({
  id,
  classId: 'c1',
  name,
  kind,
  displayOrder: order,
  maxMarks: 100,
});

function makeDetail(opts: { quranHifz?: boolean; students?: Student[]; totalStudents?: number } = {}): ClassDetail {
  const allSubjects = [subj('fiqh', 'Fiqh', 'normal', 0), subj('duroos', 'Duroos', 'normal', 1), subj('thazkiya', 'Thazkiya', 'normal', 2)];
  if (opts.quranHifz !== false) allSubjects.push(subj('quran', 'Quran', 'quran', 1000), subj('hifz', 'Hifz', 'hifz', 1001));
  const schoolClass = {
    id: 'c1',
    institutionName: 'Inst',
    institutionLocation: 'Loc',
    rangeName: 'R',
    className: 'Class 5',
    totalStudents: opts.totalStudents ?? 20,
    includeQuranHifz: opts.quranHifz !== false,
    createdAt: '',
    updatedAt: '',
  };
  return {
    schoolClass,
    examination: { id: 'e1', classId: 'c1', examName: 'Annual', examYear: 2026, createdAt: '', updatedAt: '' },
    allExaminations: [],
    allSubjects,
    config: buildClassConfig(schoolClass, allSubjects),
    students: opts.students ?? [],
  };
}

const cell = (columnIndex: number, value: number | null, status: ExtractedCell['status'] = 'value', confidence: ExtractedCell['confidence'] = 'high'): ExtractedCell => ({
  columnIndex,
  status,
  value,
  confidence,
});

function student(over: Partial<ExtractedStudent>): ExtractedStudent {
  return {
    category: 'boys',
    rollNumber: 1,
    admissionNumber: null,
    name: 'Unais',
    categoryConfidence: 'high',
    rollConfidence: 'high',
    admissionConfidence: 'high',
    nameConfidence: 'high',
    cells: [],
    ...over,
  };
}

function extraction(students: ExtractedStudent[]): ExtractionResult {
  return {
    documentMetadata: {
      institutionName: null,
      location: null,
      range: null,
      examName: null,
      examYear: null,
      className: null,
      division: null,
      examDate: null,
      confidence: {
        institutionName: 'high',
        location: 'high',
        range: 'high',
        examName: 'high',
        examYear: 'high',
        className: 'high',
        division: 'high',
        examDate: 'high',
      },
    },
    institution: { name: null, location: null, range: null },
    exam: { name: null, year: null },
    className: null,
    columns: [
      { index: 0, header: 'Fiqh', kind: 'subject', confidence: 'high' },
      { index: 1, header: 'Duroos', kind: 'subject', confidence: 'high' },
      { index: 2, header: 'Thazkiya', kind: 'subject', confidence: 'high' },
      { index: 3, header: 'Quran', kind: 'quran', confidence: 'high' },
      { index: 4, header: 'Hifz', kind: 'hifz', confidence: 'high' },
      { index: 5, header: 'Quran + Hifz', kind: 'quranHifzTotal', confidence: 'high' },
      { index: 6, header: 'Grand Total', kind: 'grandTotal', confidence: 'high' },
    ],
    students,
    warnings: [],
  };
}

const full = (marks: number[], extra: ExtractedCell[] = []): ExtractedCell[] => [...marks.map((m, i) => cell(i, m)), ...extra];

const validate = (row: DraftRow, rows: DraftRow[], detail: ClassDetail) => validateRow(row, rows, detail, t);

describe('buildDraft – marks & nulls', () => {
  it('imports visible marks and matches subject columns', () => {
    const d = buildDraft(extraction([student({ cells: full([50, 60, 70, 30, 10]) })]), makeDetail());
    expect(d.rows[0].marks).toEqual({ fiqh: '50', duroos: '60', thazkiya: '70', quran: '30', hifz: '10' });
    expect(d.rows[0].review.marks.fiqh).toBe(false); // high confidence
  });

  it('keeps blank cells empty (NEVER zero) and flags them', () => {
    const d = buildDraft(extraction([student({ cells: [cell(0, 50), cell(1, null, 'blank'), cell(2, 70), cell(3, 30), cell(4, 10)] })]), makeDetail());
    expect(d.rows[0].marks.duroos).toBe('');
    expect(d.rows[0].review.marks.duroos).toBe(true);
    expect(validate(d.rows[0], d.rows, makeDetail()).errors.marks.duroos).toBeDefined();
  });

  it('keeps unreadable cells empty and flagged; low/medium confidence is flagged', () => {
    const d = buildDraft(
      extraction([student({ cells: [cell(0, null, 'unreadable', 'low'), cell(1, 60, 'value', 'medium'), cell(2, 70), cell(3, 30), cell(4, 10)] })]),
      makeDetail(),
    );
    expect(d.rows[0].marks.fiqh).toBe('');
    expect(d.rows[0].review.marks.fiqh).toBe(true);
    expect(d.rows[0].marks.duroos).toBe('60');
    expect(d.rows[0].review.marks.duroos).toBe(true);
    expect(d.rows[0].review.marks.thazkiya).toBe(false);
  });

  it('maps explicit AB for every subject to an absent student (existing model)', () => {
    const cells = [0, 1, 2, 3, 4].map((i) => cell(i, null, 'absent'));
    const detail = makeDetail();
    const d = buildDraft(extraction([student({ cells })]), detail);
    expect(d.rows[0].absent).toBe(true);
    const v = validate(d.rows[0], d.rows, detail);
    expect(v.ok).toBe(true);
    const batch = buildPhotoSaveBatch(d.rows, detail, new Map([[d.rows[0].key, v]]));
    expect(batch[0].input).toMatchObject({ isAbsent: true, marks: [] });
  });

  it('does NOT treat unreadable or blank as absent', () => {
    const d = buildDraft(extraction([student({ cells: [0, 1, 2, 3, 4].map((i) => cell(i, null, 'unreadable', 'low')) })]), makeDetail());
    expect(d.rows[0].absent).toBe(false);
    const d2 = buildDraft(extraction([student({ cells: [0, 1, 2, 3, 4].map((i) => cell(i, null, 'blank')) })]), makeDetail());
    expect(d2.rows[0].absent).toBe(false);
  });

  it('mixed AB + marks: AB cell stays empty & flagged, student is not absent', () => {
    const d = buildDraft(extraction([student({ cells: [cell(0, null, 'absent'), cell(1, 60), cell(2, 70), cell(3, 30), cell(4, 10)] })]), makeDetail());
    expect(d.rows[0].absent).toBe(false);
    expect(d.rows[0].marks.fiqh).toBe('');
    expect(d.rows[0].review.marks.fiqh).toBe(true);
  });

  it('never imports an unrecognized column and flags missing class subjects', () => {
    const ex = extraction([student({ cells: [cell(0, 50), cell(1, 60), cell(2, 70), cell(3, 30), cell(4, 10), cell(7, 99)] })]);
    ex.columns.push({ index: 7, header: 'Science', kind: 'subject', confidence: 'high' });
    const d = buildDraft(ex, makeDetail());
    expect(d.mapping.unrecognized.map((c) => c.header)).toEqual(['Science']);
    expect(Object.keys(d.rows[0].marks).sort()).toEqual(['duroos', 'fiqh', 'hifz', 'quran', 'thazkiya']);
    const ex2 = extraction([student({ cells: [cell(0, 50)] })]);
    ex2.columns = ex2.columns.slice(0, 1);
    expect(buildDraft(ex2, makeDetail()).mapping.missingSubjectIds).toContain('duroos');
  });
});

describe('category & roll numbers', () => {
  it('uses independent roll sequences per category and does not invent when present', () => {
    const d = buildDraft(
      extraction([
        student({ category: 'boys', rollNumber: 1 }),
        student({ category: 'boys', rollNumber: 2, name: 'B' }),
        student({ category: 'girls', rollNumber: 1, name: 'G' }),
      ]),
      makeDetail(),
    );
    expect(d.rows.map((r) => `${r.category}${r.roll}`)).toEqual(['boys1', 'boys2', 'girls1']);
    expect(d.rows.some((r) => r.rollAssigned)).toBe(false);
  });

  it('assigns missing roll numbers per category with the existing rule (max + 1) and flags them', () => {
    const existing: Student[] = [{ id: 's1', examId: 'e1', category: 'girls', rollNumber: 4, studentName: 'Old', marks: {} }];
    const d = buildDraft(
      extraction([
        student({ category: 'boys', rollNumber: null, name: 'A' }),
        student({ category: 'boys', rollNumber: null, name: 'B' }),
        student({ category: 'girls', rollNumber: null, name: 'C' }),
      ]),
      makeDetail({ students: existing }),
    );
    expect(d.rows.map((r) => r.roll)).toEqual(['1', '2', '5']);
    expect(d.rows.every((r) => r.rollAssigned && r.review.roll)).toBe(true);
  });

  it('does not silently assign an unknown category: it must be chosen', () => {
    const detail = makeDetail();
    const d = buildDraft(extraction([student({ category: null, categoryConfidence: 'low', cells: full([50, 60, 70, 30, 10]) })]), detail);
    expect(d.rows[0].category).toBe('');
    expect(d.rows[0].review.category).toBe(true);
    const v = validate(d.rows[0], d.rows, detail);
    expect(v.ok).toBe(false);
    expect(v.errors.category).toBeDefined();
  });

  it('rejects the same roll twice within one category in the import', () => {
    const detail = makeDetail();
    const d = buildDraft(extraction([student({ rollNumber: 3, cells: full([50, 60, 70, 30, 10]) }), student({ rollNumber: 3, name: 'X', cells: full([50, 60, 70, 30, 10]) })]), detail);
    expect(validate(d.rows[0], d.rows, detail).errors.roll).toContain('errRollDuplicateInImport');
    // but boys 3 and girls 3 are fine
    d.rows[1].category = 'girls';
    expect(validate(d.rows[0], d.rows, detail).errors.roll).toBeUndefined();
  });
});

describe('Quran + Hifz, Grand Total and result (application is the source of truth)', () => {
  const detail = makeDetail();

  it('calculates Quran + Hifz total from the individual marks (30 + 10 = 40)', () => {
    const d = buildDraft(extraction([student({ cells: full([50, 60, 70, 30, 10]) })]), detail);
    const res = evaluateRow(d.rows[0], detail);
    expect(res.quranHifzTotal).toBe(40);
    expect(res.grandTotal).toBe(50 + 60 + 70 + 40);
    expect(res.result).toBe('P'); // Quran + Hifz counted as ONE subject, 40 is a pass
  });

  it('fails when the combined Quran + Hifz is below 40 even if each part is "fine"', () => {
    const d = buildDraft(extraction([student({ cells: full([50, 60, 70, 20, 10]) })]), detail);
    const res = evaluateRow(d.rows[0], detail);
    expect(res.quranHifzTotal).toBe(30);
    expect(res.result).toBe('F');
    expect(res.failedSubjects).toContain('Quran + Hifz');
  });

  it('fails a normal subject below pass mark 40', () => {
    const d = buildDraft(extraction([student({ cells: full([39, 60, 70, 30, 10]) })]), detail);
    expect(evaluateRow(d.rows[0], detail).result).toBe('F');
  });

  it('uses printed totals only as a cross-check and flags conflicts', () => {
    const d = buildDraft(extraction([student({ cells: full([50, 60, 70, 30, 10], [cell(5, 45), cell(6, 230)]) })]), detail);
    const mm = findTotalMismatches(d.rows[0], detail);
    expect(mm.find((m) => m.kind === 'quranHifz')).toEqual({ kind: 'quranHifz', imported: 45, calculated: 40 });
    expect(mm.find((m) => m.kind === 'grand')).toEqual({ kind: 'grand', imported: 230, calculated: 220 });
  });

  it('flags a Grand Total mismatch (imported 220 vs calculated 210) without overwriting', () => {
    const d = buildDraft(extraction([student({ cells: full([50, 60, 60, 30, 10], [cell(6, 220)]) })]), detail);
    const mm = findTotalMismatches(d.rows[0], detail);
    expect(mm).toEqual([{ kind: 'grand', imported: 220, calculated: 210 }]);
    expect(evaluateRow(d.rows[0], detail).grandTotal).toBe(210);
    expect(d.rows[0].marks.fiqh).toBe('50'); // marks untouched
  });

  it('works for classes without Quran/Hifz (ignores a Quran column as unrecognized)', () => {
    const noQ = makeDetail({ quranHifz: false });
    const d = buildDraft(extraction([student({ cells: full([50, 60, 70, 30, 10]) })]), noQ);
    expect(Object.keys(d.rows[0].marks).sort()).toEqual(['duroos', 'fiqh', 'thazkiya']);
    expect(d.mapping.unrecognized.map((c) => c.header).sort()).toEqual(['Hifz', 'Quran']);
    expect(evaluateRow(d.rows[0], noQ).grandTotal).toBe(180);
  });
});

describe('validation of edited rows', () => {
  const detail = makeDetail();
  const good = () => buildDraft(extraction([student({ cells: full([50, 60, 70, 30, 10]) })]), detail).rows;

  it('accepts a complete valid row', () => {
    const rows = good();
    expect(validate(rows[0], rows, detail).ok).toBe(true);
  });

  it('rejects invalid marks (105, -20, abc) using the existing parser', () => {
    const rows = good();
    rows[0].marks.fiqh = '105';
    rows[0].marks.duroos = '-20';
    rows[0].marks.thazkiya = 'abc';
    const v = validate(rows[0], rows, detail);
    expect(v.ok).toBe(false);
    expect(Object.keys(v.errors.marks).sort()).toEqual(['duroos', 'fiqh', 'thazkiya']);
  });

  it('requires a name and a valid roll number', () => {
    const rows = good();
    rows[0].name = '  ';
    rows[0].roll = '0';
    const v = validate(rows[0], rows, detail);
    expect(v.errors.name).toBeDefined();
    expect(v.errors.roll).toBeDefined();
  });
});

describe('duplicate protection', () => {
  const existing: Student[] = [{ id: 's1', examId: 'e1', category: 'boys', rollNumber: 1, studentName: 'Unais', marks: {} }];
  const detail = makeDetail({ students: existing });

  it('detects the same person by name or roll within the same category only', () => {
    expect(findPossibleDuplicate({ category: 'boys', roll: '1', name: 'Unais' }, existing)?.id).toBe('s1');
    expect(findPossibleDuplicate({ category: 'boys', roll: '9', name: ' unais ' }, existing)?.id).toBe('s1');
    expect(findPossibleDuplicate({ category: 'boys', roll: '1', name: 'Someone else' }, existing)?.id).toBe('s1'); // roll collision
    expect(findPossibleDuplicate({ category: 'girls', roll: '1', name: 'Unais' }, existing)).toBeNull();
    expect(findPossibleDuplicate({ category: '', roll: '1', name: 'Unais' }, existing)).toBeNull();
  });

  it('never auto-overwrites: the teacher must choose Update or Create', () => {
    const d = buildDraft(extraction([student({ cells: full([50, 60, 70, 30, 10]) })]), detail);
    const row = d.rows[0];
    expect(row.duplicateChoice).toBe('undecided');
    const v = validate(row, d.rows, detail);
    expect(v.ok).toBe(false);
    expect(v.duplicate?.id).toBe('s1');
    expect(v.errors.duplicate).toBeDefined();
  });

  it('"Update existing" saves onto the existing student id', () => {
    const d = buildDraft(extraction([student({ cells: full([50, 60, 70, 30, 10]) })]), detail);
    d.rows[0].duplicateChoice = 'update';
    const v = validate(d.rows[0], d.rows, detail);
    expect(v.ok).toBe(true);
    const [item] = buildPhotoSaveBatch(d.rows, detail, new Map([[d.rows[0].key, v]]));
    expect(item.input.studentId).toBe('s1');
    expect(item.input.examId).toBe('e1');
  });

  it('"Create new" with a colliding roll is blocked until the roll is changed', () => {
    const d = buildDraft(extraction([student({ cells: full([50, 60, 70, 30, 10]) })]), detail);
    const row = d.rows[0];
    row.duplicateChoice = 'create';
    let v: RowValidation = validate(row, d.rows, detail);
    expect(v.ok).toBe(false);
    expect(v.errors.roll).toContain('validation.rollExists');
    row.roll = '2';
    v = validate(row, d.rows, detail);
    expect(v.ok).toBe(true);
    expect(buildPhotoSaveBatch(d.rows, detail, new Map([[row.key, v]]))[0].input.studentId).toBeNull();
  });
});

describe('partial imports & remapping', () => {
  it('estimates missing students against the class size', () => {
    const detail = makeDetail({ totalStudents: 20 });
    expect(missingStudentEstimate(detail, 8)).toBe(12);
    expect(missingStudentEstimate(detail, 20)).toBe(0);
    expect(missingStudentEstimate(detail, 25)).toBe(0);
  });

  it('allows importing only the detected students (partial import is valid)', () => {
    const detail = makeDetail({ totalStudents: 20 });
    const d = buildDraft(extraction([student({ cells: full([50, 60, 70, 30, 10]) })]), detail);
    const v = validate(d.rows[0], d.rows, detail);
    expect(v.ok).toBe(true);
    expect(buildPhotoSaveBatch(d.rows, detail, new Map([[d.rows[0].key, v]]))).toHaveLength(1);
  });

  it('remapping a column refills only the affected subjects and preserves other edits', () => {
    const detail = makeDetail();
    const ex = extraction([student({ cells: full([50, 60, 70, 30, 10]) })]);
    ex.columns.push({ index: 7, header: 'Science', kind: 'subject', confidence: 'high' });
    ex.students[0].cells.push(cell(7, 88));
    let d = buildDraft(ex, detail);
    d.rows[0].marks.duroos = '61'; // teacher edit
    d = remapColumn(d, detail, 7, 'thazkiya'); // Science → Thazkiya
    expect(d.rows[0].marks.thazkiya).toBe('88');
    expect(d.rows[0].marks.duroos).toBe('61'); // untouched
    expect(d.mapping.unrecognized).toHaveLength(1); // the old Thazkiya column lost its subject
    d = remapColumn(d, detail, 7, null); // ignore
    expect(d.rows[0].marks.thazkiya).toBe('');
    expect(d.rows[0].review.marks.thazkiya).toBe(true);
  });
});
