import { describe, expect, it } from 'vitest';
import {
  calculateGrandTotal,
  calculateQuranHifzTotal,
  calculateResult,
  calculateSummary,
  evaluateStudent,
  formatCombinedCount,
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
  it('Quran 30 + Hifz 50 = 80 → passes (component < 40 allowed)', () => {
    const total = calculateQuranHifzTotal(30, 50);
    expect(total).toBe(80);
    expect(calculateResult([50, 50], total)).toBe('P');
  });
});

describe('grand total', () => {
  it('counts Quran + Hifz total exactly once', () => {
    expect(calculateGrandTotal([45, 50, 55], calculateQuranHifzTotal(30, 50))).toBe(230);
  });
});

describe('Boys & Girls Category Summary', () => {
  it('formats mathematical participant count 10 + 5 = 15', () => {
    expect(formatCombinedCount(10, 5, 15)).toBe('10 + 5 = 15');
  });

  it('calculates 10 boys + 5 girls (14 passed total) → 93.33%', () => {
    // 10 Boys (all passed)
    const boysList = Array.from({ length: 10 }, (_, i) =>
      evaluateStudent(withoutQH, {
        id: `b-${i}`,
        category: 'boys',
        marks: { fiqh: 50, arabic: 50, thaskiya: 50 },
      }),
    );
    // 5 Girls (4 passed, 1 failed)
    const girlsList = Array.from({ length: 5 }, (_, i) =>
      evaluateStudent(withoutQH, {
        id: `g-${i}`,
        category: 'girls',
        marks: i < 4 ? { fiqh: 50, arabic: 50, thaskiya: 50 } : { fiqh: 20, arabic: 50, thaskiya: 50 },
      }),
    );

    const summary = calculateSummary(20, [...boysList, ...girlsList]);

    expect(summary.totalBoys).toBe(10);
    expect(summary.totalGirls).toBe(5);
    expect(summary.totalParticipants).toBe(15);
    expect(summary.totalAppeared).toBe(15);

    expect(summary.passedBoys).toBe(10);
    expect(summary.passedGirls).toBe(4);
    expect(summary.totalPassed).toBe(14);

    expect(summary.failedBoys).toBe(0);
    expect(summary.failedGirls).toBe(1);
    expect(summary.totalFailed).toBe(1);

    expect(summary.passPercentage).toBe(93.33);
  });
});
