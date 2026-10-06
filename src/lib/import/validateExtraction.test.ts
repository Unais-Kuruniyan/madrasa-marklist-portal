import { describe, expect, it } from 'vitest';
import { ImportError } from './types';
import { isValidMarkValue, parseModelJson, validateExtraction } from './validateExtraction';

const base = () => ({
  institution: { name: 'Darul Uloom', location: 'Kochi', range: 'North' },
  exam: { name: 'Annual', year: 2026 },
  className: 'Class 5',
  columns: [
    { index: 0, header: 'Fiqh', kind: 'subject' },
    { index: 1, header: 'Quran', kind: 'quran' },
  ],
  students: [
    {
      category: 'boys',
      categoryConfidence: 'high',
      rollNumber: 1,
      rollConfidence: 'high',
      name: 'Unais',
      nameConfidence: 'high',
      cells: [
        { columnIndex: 0, status: 'value', value: 50, confidence: 'high' },
        { columnIndex: 1, status: 'absent', value: null, confidence: 'high' },
      ],
    },
  ],
  warnings: [],
});

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ImportError);
    expect((e as ImportError).code).toBe(code);
    return;
  }
  throw new Error(`expected ImportError(${code})`);
}

describe('validateExtraction', () => {
  it('accepts a well-formed response', () => {
    const r = validateExtraction(base());
    expect(r.students).toHaveLength(1);
    expect(r.students[0].cells[0]).toMatchObject({ status: 'value', value: 50 });
    expect(r.students[0].cells[1]).toMatchObject({ status: 'absent', value: null });
    expect(r.exam!.year).toBe(2026);
  });

  it('rejects structurally malformed output', () => {
    expectCode(() => validateExtraction(null), 'malformedResponse');
    expectCode(() => validateExtraction([]), 'malformedResponse');
    expectCode(() => validateExtraction({ columns: [], students: 'x' }), 'malformedResponse');
    const bad = base();
    (bad.columns[0] as { kind: string }).kind = 'banana';
    expectCode(() => validateExtraction(bad), 'malformedResponse');
    const dup = base();
    dup.columns[1].index = 0;
    expectCode(() => validateExtraction(dup), 'malformedResponse');
  });

  it('reports no table / no students', () => {
    expectCode(() => validateExtraction({ ...base(), columns: [] }), 'noTable');
    expectCode(() => validateExtraction({ ...base(), students: [] }), 'noStudents');
  });

  it('neutralises out-of-range marks (105, -20) instead of accepting them', () => {
    const b = base();
    b.students[0].cells = [
      { columnIndex: 0, status: 'value', value: 105, confidence: 'high' },
      { columnIndex: 1, status: 'value', value: -20, confidence: 'high' },
    ];
    const r = validateExtraction(b);
    for (const cell of r.students[0].cells) {
      expect(cell.status).toBe('unreadable');
      expect(cell.value).toBeNull();
      expect(cell.confidence).toBe('low');
    }
    expect(r.warnings.join(' ')).toMatch(/invalid values/);
  });

  it('treats wrong mark types and NaN as unreadable', () => {
    const b = base();
    b.students[0].cells = [
      { columnIndex: 0, status: 'value', value: '50' as unknown as number, confidence: 'high' },
      { columnIndex: 1, status: 'value', value: Number.NaN, confidence: 'high' },
    ];
    const r = validateExtraction(b);
    expect(r.students[0].cells.every((c) => c.status === 'unreadable' && c.value === null)).toBe(true);
  });

  it('keeps 0 and 100 as valid marks and keeps blank as blank (never 0)', () => {
    const b = base();
    b.students[0].cells = [
      { columnIndex: 0, status: 'value', value: 0, confidence: 'high' },
      { columnIndex: 1, status: 'blank', value: 7 as unknown as null, confidence: 'high' },
    ];
    const r = validateExtraction(b);
    expect(r.students[0].cells[0]).toMatchObject({ status: 'value', value: 0 });
    expect(r.students[0].cells[1]).toMatchObject({ status: 'blank', value: null });
  });

  it('validates categories and roll numbers (null when invalid)', () => {
    const b = base();
    Object.assign(b.students[0], { category: 'children', rollNumber: -3 });
    const r = validateExtraction(b);
    expect(r.students[0].category).toBeNull();
    expect(r.students[0].categoryConfidence).toBe('low');
    expect(r.students[0].rollNumber).toBeNull();

    const c = base();
    Object.assign(c.students[0], { rollNumber: 1.5 });
    expect(validateExtraction(c).students[0].rollNumber).toBeNull();
    const d = base();
    Object.assign(d.students[0], { rollNumber: '12' });
    expect(validateExtraction(d).students[0].rollNumber).toBe(12);
  });

  it('keeps null names and low confidence; does not invent them', () => {
    const b = base();
    Object.assign(b.students[0], { name: '   ', nameConfidence: 'high' });
    const r = validateExtraction(b);
    expect(r.students[0].name).toBeNull();
    expect(r.students[0].nameConfidence).toBe('low');
  });

  it('enforces maximum text lengths and preserves Malayalam', () => {
    const b = base();
    Object.assign(b.students[0], { name: 'അ'.repeat(400) });
    expect(validateExtraction(b).students[0].name).toHaveLength(150);
    const m = base();
    Object.assign(m.students[0], { name: 'മുഹമ്മദ് ഉനൈസ്' });
    expect(validateExtraction(m).students[0].name).toBe('മുഹമ്മദ് ഉനൈസ്');
  });

  it('drops cells that reference unknown or repeated columns', () => {
    const b = base();
    b.students[0].cells.push({ columnIndex: 9, status: 'value', value: 10, confidence: 'high' });
    b.students[0].cells.push({ columnIndex: 0, status: 'value', value: 11, confidence: 'high' });
    const r = validateExtraction(b);
    expect(r.students[0].cells).toHaveLength(2);
    expect(r.students[0].cells[0].value).toBe(50);
  });

  it('skips completely empty rows but keeps partially read ones', () => {
    const b = base();
    b.students.push({
      category: null as unknown as 'boys',
      categoryConfidence: 'low',
      rollNumber: null as unknown as number,
      rollConfidence: 'low',
      name: null as unknown as string,
      nameConfidence: 'low',
      cells: [],
    });
    expect(validateExtraction(b).students).toHaveLength(1);
  });

  it('rejects absurd sizes', () => {
    const b = base();
    b.students = Array.from({ length: 500 }, () => base().students[0]);
    expectCode(() => validateExtraction(b), 'malformedResponse');
  });

  it('sanitises header info and year range', () => {
    const b = base();
    Object.assign(b.exam, { year: 1850 });
    expect(validateExtraction(b).exam!.year).toBeNull();
  });
});

describe('parseModelJson', () => {
  it('parses plain and fenced JSON, rejects garbage/empty', () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expectCode(() => parseModelJson('not json'), 'malformedResponse');
    expectCode(() => parseModelJson(''), 'malformedResponse');
    expectCode(() => parseModelJson(undefined), 'malformedResponse');
  });
});

describe('isValidMarkValue', () => {
  it('accepts 0..100 with up to 2 decimals only', () => {
    expect([0, 1, 25, 40, 50, 99.5, 100, 42.25].every(isValidMarkValue)).toBe(true);
    expect([-1, 100.01, 101, 1.234, Number.NaN, Infinity].some(isValidMarkValue)).toBe(false);
    expect(isValidMarkValue('5')).toBe(false);
  });
});
