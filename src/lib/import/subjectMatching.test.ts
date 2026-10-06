import { describe, expect, it } from 'vitest';
import { levenshtein, matchColumns, matchHeader, normalizeSubjectText } from './subjectMatching';
import type { ClassSubjectInfo, ExtractedColumn } from './types';

const subjects: ClassSubjectInfo[] = [
  { id: 'fiqh', name: 'Fiqh', kind: 'normal' },
  { id: 'duroos', name: 'Duroos', kind: 'normal' },
  { id: 'thazkiya', name: 'Thazkiya', kind: 'normal' },
  { id: 'arabic', name: 'Arabic', kind: 'normal' },
  { id: 'quran', name: 'Quran', kind: 'quran' },
  { id: 'hifz', name: 'Hifz', kind: 'hifz' },
];

const col = (index: number, header: string, kind: ExtractedColumn['kind'] = 'subject'): ExtractedColumn => ({
  index,
  header,
  kind,
  confidence: 'high',
});

describe('normalizeSubjectText', () => {
  it('ignores case, spaces, punctuation and zero-width characters', () => {
    expect(normalizeSubjectText(' F.I.Q.H ')).toBe('fiqh');
    expect(normalizeSubjectText('Qur\u200d-an')).toBe('quran');
  });
});

describe('matchHeader', () => {
  it('exact', () => expect(matchHeader('Fiqh', subjects)).toEqual({ subjectId: 'fiqh', method: 'exact' }));
  it('normalized', () => expect(matchHeader('  FIQH. ', subjects)).toEqual({ subjectId: 'fiqh', method: 'normalized' }));
  it('alias (spelling variants)', () => {
    expect(matchHeader('Tazkiya', subjects)).toEqual({ subjectId: 'thazkiya', method: 'alias' });
    expect(matchHeader('Durus', subjects)).toEqual({ subjectId: 'duroos', method: 'alias' });
  });
  it('alias (Malayalam)', () => {
    expect(matchHeader('ഫിഖ്ഹ്', subjects)?.subjectId).toBe('fiqh');
    expect(matchHeader('ഖുർആൻ', subjects)?.subjectId).toBe('quran');
    expect(matchHeader('ഹിഫ്ള്', subjects)?.subjectId).toBe('hifz');
    expect(matchHeader('അറബി', subjects)?.subjectId).toBe('arabic');
  });
  it('fuzzy only when safe', () => {
    expect(matchHeader('Thazkiyya', subjects)?.subjectId).toBe('thazkiya');
    expect(matchHeader('Duroosh', subjects)).toMatchObject({ subjectId: 'duroos', method: 'fuzzy' });
  });
  it('never maps unrelated or too-short headers', () => {
    expect(matchHeader('Science', subjects)).toBeNull();
    expect(matchHeader('Fiq', subjects)).toBeNull(); // too short to fuzzy match
    expect(matchHeader('Remarks', subjects)).toBeNull();
    expect(matchHeader('', subjects)).toBeNull();
  });
  it('does not guess when two subjects normalize identically', () => {
    const ambiguous: ClassSubjectInfo[] = [
      { id: 'a', name: 'Fiqh', kind: 'normal' },
      { id: 'b', name: 'fiqh.', kind: 'normal' },
    ];
    expect(matchHeader('FIQH', ambiguous)).toBeNull();
  });
  it('does not fuzzy-match between two close candidates', () => {
    const close: ClassSubjectInfo[] = [
      { id: 'a', name: 'Duroosa', kind: 'normal' },
      { id: 'b', name: 'Duroosb', kind: 'normal' },
    ];
    expect(matchHeader('Duroosc', close)).toBeNull();
  });
});

describe('matchColumns', () => {
  it('maps Quran and Hifz separately and keeps totals out of the mapping', () => {
    const m = matchColumns(
      [col(0, 'Fiqh'), col(1, 'Quran', 'quran'), col(2, 'Hifz', 'hifz'), col(3, 'Quran+Hifz', 'quranHifzTotal'), col(4, 'Total', 'grandTotal')],
      subjects,
    );
    expect(m.matches.map((x) => x.subjectId)).toEqual(['fiqh', 'quran', 'hifz']);
    expect(m.quranHifzTotalColumn).toBe(3);
    expect(m.grandTotalColumn).toBe(4);
    expect(m.unrecognized).toHaveLength(0);
  });

  it('reports unrecognized subjects and never creates new ones', () => {
    const m = matchColumns([col(0, 'Fiqh'), col(1, 'Science')], subjects);
    expect(m.unrecognized.map((x) => x.header)).toEqual(['Science']);
    expect(m.unrecognized[0].needsReview).toBe(true);
    expect(m.matches.find((x) => x.header === 'Science')?.subjectId).toBeNull();
  });

  it('lists class subjects missing from the photo', () => {
    const m = matchColumns([col(0, 'Fiqh')], subjects);
    expect(m.missingSubjectIds).toEqual(['duroos', 'thazkiya', 'arabic', 'quran', 'hifz']);
  });

  it('uses the model kind only as a fallback for Quran/Hifz and flags it', () => {
    const m = matchColumns([col(0, 'Q', 'quran')], subjects);
    expect(m.matches[0]).toMatchObject({ subjectId: 'quran', method: 'kindHint', needsReview: true });
  });

  it('assigns a subject to only one column (strongest method wins)', () => {
    const m = matchColumns([col(0, 'Durooss'), col(1, 'Duroos')], subjects);
    expect(m.matches.find((x) => x.columnIndex === 1)?.subjectId).toBe('duroos');
    expect(m.matches.find((x) => x.columnIndex === 0)?.subjectId).toBeNull();
    expect(m.unrecognized.map((x) => x.columnIndex)).toEqual([0]);
  });

  it('flags fuzzy matches for review', () => {
    const m = matchColumns([col(0, 'Duroosh')], subjects);
    expect(m.matches[0].needsReview).toBe(true);
  });
});

describe('levenshtein', () => {
  it('computes edit distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('same', 'same')).toBe(0);
  });
});
