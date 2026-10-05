import { describe, expect, it } from 'vitest';
import {
  calculateGrandTotal,
  calculateQuranHifzMax,
  calculateQuranHifzTotal,
  calculateResult,
  calculateSummary,
  evaluateStudent,
  PASS_MARK,
} from './marks';
import type { ClassConfig, Subject } from '../../types';

const subject = (id: string, name: string, kind: Subject['kind'] = 'normal'): Subject => ({
  id,
  classId: 'c1',
  name,
  kind,
  displayOrder: 0,
  maxMarks: 100,
});

const fiqh = subject('fiqh', 'Fiqh');
const arabic = subject('arabic', 'Arabic');
const thaskiya = subject('thaskiya', 'Thaskiya');
const quran = subject('quran', 'Quran', 'quran');
const hifz = subject('hifz', 'Hifz', 'hifz');

const withQH: ClassConfig = {
  includeQuranHifz: true,
  normalSubjects: [fiqh, arabic, thaskiya],
  quranSubject: quran,
  hifzSubject: hifz,
};

const withoutQH: ClassConfig = {
  includeQuranHifz: false,
  normalSubjects: [fiqh, arabic, thaskiya],
  quranSubject: null,
  hifzSubject: null,
};

describe('pass mark', () => {
  it('is 40', () => expect(PASS_MARK).toBe(40));
});

describe('normal subjects', () => {
  it('all >= 40 → P', () => {
    expect(calculateResult([40, 55, 90])).toBe('P');
  });
  it('one subject < 40 → F', () => {
    expect(calculateResult([39, 55, 90])).toBe('F');
  });
  it('single subject class works', () => {
    expect(calculateResult([40])).toBe('P');
    expect(calculateResult([10])).toBe('F');
  });
});

describe('Quran + Hifz', () => {
  it('Quran 35 + Hifz 45 = 80 → passes', () => {
    const total = calculateQuranHifzTotal(35, 45);
    expect(total).toBe(80);
    expect(calculateResult([], total)).toBe('P');
  });
  it('Quran 15 + Hifz 20 = 35 → fails', () => {
    const total = calculateQuranHifzTotal(15, 20);
    expect(total).toBe(35);
    expect(calculateResult([], total)).toBe('F');
  });
  it('Quran 39 + Hifz 1 = 40 → passes', () => {
    const total = calculateQuranHifzTotal(39, 1);
    expect(total).toBe(40);
    expect(calculateResult([], total)).toBe('P');
  });
  it('Quran 100 + Hifz 100 = 200 within combined maximum', () => {
    const total = calculateQuranHifzTotal(100, 100);
    expect(total).toBe(200);
    expect(total).toBeLessThanOrEqual(calculateQuranHifzMax(100, 100));
    expect(calculateQuranHifzMax()).toBe(200);
  });
  it('components are NOT checked individually against 40', () => {
    // Quran below 40 but combined total passes
    expect(calculateResult([50, 60], calculateQuranHifzTotal(10, 35))).toBe('P');
  });
});

describe('specification examples', () => {
  it('Example A → P', () => {
    const r = evaluateStudent(withQH, {
      id: 's',
      marks: { fiqh: 45, arabic: 55, thaskiya: 60, quran: 35, hifz: 45 },
    });
    expect(r.quranHifzTotal).toBe(80);
    expect(r.result).toBe('P');
  });
  it('Example B (Fiqh 38) → F', () => {
    const cfg: ClassConfig = { ...withQH, normalSubjects: [fiqh, arabic] };
    const r = evaluateStudent(cfg, { id: 's', marks: { fiqh: 38, arabic: 55, quran: 50, hifz: 50 } });
    expect(r.quranHifzTotal).toBe(100);
    expect(r.result).toBe('F');
    expect(r.failedSubjects).toEqual(['Fiqh']);
  });
  it('Example C (Quran+Hifz 35) → F', () => {
    const cfg: ClassConfig = { ...withQH, normalSubjects: [fiqh, arabic] };
    const r = evaluateStudent(cfg, { id: 's', marks: { fiqh: 50, arabic: 60, quran: 15, hifz: 20 } });
    expect(r.quranHifzTotal).toBe(35);
    expect(r.result).toBe('F');
    expect(r.failedSubjects).toEqual(['Quran + Hifz']);
  });
  it('Example D → P', () => {
    const cfg: ClassConfig = { ...withQH, normalSubjects: [fiqh, arabic] };
    const r = evaluateStudent(cfg, { id: 's', marks: { fiqh: 50, arabic: 60, quran: 35, hifz: 45 } });
    expect(r.result).toBe('P');
  });
});

describe('grand total', () => {
  it('without Quran/Hifz = sum of normal subjects', () => {
    expect(calculateGrandTotal([50, 55, 45])).toBe(150);
  });
  it('counts Quran + Hifz exactly once', () => {
    // 50 + 55 + 45 + (40 + 45) = 235
    expect(calculateGrandTotal([50, 55, 45], calculateQuranHifzTotal(40, 45))).toBe(235);
    const r = evaluateStudent(withQH, {
      id: 's',
      marks: { fiqh: 50, arabic: 55, thaskiya: 45, quran: 40, hifz: 45 },
    });
    expect(r.grandTotal).toBe(235);
  });
  it('ignores hidden Quran/Hifz marks when disabled', () => {
    const r = evaluateStudent(withoutQH, {
      id: 's',
      marks: { fiqh: 50, arabic: 55, thaskiya: 45, quran: 10, hifz: 10 },
    });
    expect(r.grandTotal).toBe(150);
    expect(r.quranHifzTotal).toBeNull();
    expect(r.result).toBe('P');
  });
  it('handles decimals without floating point noise', () => {
    expect(calculateGrandTotal([0.1, 0.2])).toBe(0.3);
  });
});

describe('student status', () => {
  it('no marks → absent, no result', () => {
    const r = evaluateStudent(withQH, { id: 's', marks: {} });
    expect(r.status).toBe('absent');
    expect(r.result).toBeNull();
    expect(r.grandTotal).toBeNull();
  });
  it('missing mark → incomplete, never treated as 0', () => {
    const r = evaluateStudent(withQH, { id: 's', marks: { fiqh: 50, arabic: 55, thaskiya: 45, quran: 40 } });
    expect(r.status).toBe('incomplete');
    expect(r.result).toBeNull();
    expect(r.quranHifzTotal).toBeNull();
  });
});

describe('summary', () => {
  const results = [
    evaluateStudent(withoutQH, { id: '1', marks: { fiqh: 50, arabic: 50, thaskiya: 50 } }), // P
    evaluateStudent(withoutQH, { id: '2', marks: { fiqh: 30, arabic: 50, thaskiya: 50 } }), // F
    evaluateStudent(withoutQH, { id: '3', marks: { fiqh: 70, arabic: 80, thaskiya: 90 } }), // P
    evaluateStudent(withoutQH, { id: '4', marks: {} }), // absent
    evaluateStudent(withoutQH, { id: '5', marks: { fiqh: 70 } }), // incomplete
  ];

  it('counts appeared / passed / failed', () => {
    const s = calculateSummary(32, results);
    expect(s.totalStudents).toBe(32);
    expect(s.appeared).toBe(3);
    expect(s.passed).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.absent).toBe(1);
    expect(s.incomplete).toBe(1);
  });
  it('pass percentage = passed / appeared * 100, rounded to 2 decimals', () => {
    expect(calculateSummary(32, results).passPercentage).toBe(66.67);
  });
  it('27 of 32 → 84.38%', () => {
    const many = Array.from({ length: 32 }, (_, i) =>
      evaluateStudent(withoutQH, {
        id: String(i),
        marks: i < 27 ? { fiqh: 60, arabic: 60, thaskiya: 60 } : { fiqh: 10, arabic: 60, thaskiya: 60 },
      }),
    );
    expect(calculateSummary(32, many).passPercentage).toBe(84.38);
  });
  it('empty class → zeros', () => {
    expect(calculateSummary(0, [])).toEqual({
      totalStudents: 0,
      appeared: 0,
      passed: 0,
      failed: 0,
      absent: 0,
      incomplete: 0,
      passPercentage: 0,
    });
  });
});
