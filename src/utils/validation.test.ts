import { describe, expect, it } from 'vitest';
import { isValidUuid, parseMark, parseRollNumber, suggestNextRollNumber } from './validation';

describe('parseMark', () => {
  it('accepts valid marks', () => {
    expect(parseMark('45')).toEqual({ ok: true, value: 45 });
    expect(parseMark('0')).toEqual({ ok: true, value: 0 });
    expect(parseMark('100')).toEqual({ ok: true, value: 100 });
    expect(parseMark('42.5')).toEqual({ ok: true, value: 42.5 });
  });
  it('rejects empty instead of treating it as 0', () => {
    expect(parseMark('').ok).toBe(false);
    expect(parseMark('   ').ok).toBe(false);
  });
  it('rejects negative, > 100 and text', () => {
    expect(parseMark('-1').ok).toBe(false);
    expect(parseMark('101').ok).toBe(false);
    expect(parseMark('abc').ok).toBe(false);
    expect(parseMark('4e1').ok).toBe(false);
  });
});

describe('roll numbers', () => {
  it('parses positive integers only', () => {
    expect(parseRollNumber('7')).toEqual({ ok: true, value: 7 });
    expect(parseRollNumber('0').ok).toBe(false);
    expect(parseRollNumber('1.5').ok).toBe(false);
  });
  it('suggests next roll after the highest (non-sequential safe)', () => {
    expect(suggestNextRollNumber([])).toBe(1);
    expect(suggestNextRollNumber([1, 2, 3])).toBe(4);
    expect(suggestNextRollNumber([1, 5, 3])).toBe(6);
  });
});

describe('isValidUuid', () => {
  it('validates UUIDs correctly and rejects temporary frontend IDs', () => {
    expect(isValidUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(isValidUuid('subj-col-0')).toBe(false);
    expect(isValidUuid('synth-quran-id')).toBe(false);
    expect(isValidUuid('')).toBe(false);
    expect(isValidUuid(null)).toBe(false);
  });
});
