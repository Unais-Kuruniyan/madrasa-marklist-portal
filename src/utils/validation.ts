/**
 * Input parsing/validation helpers.
 */

export type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const NUMBER_PATTERN = /^\d+(\.\d{1,2})?$/;

export function parseMark(raw: string, max = 100, t?: TranslateFn): ParseResult<number> {
  const text = raw.trim();
  if (text === '') return { ok: false, error: t ? t('validation.enterMark') : 'Please enter a mark' };
  if (text.startsWith('-')) return { ok: false, error: t ? t('validation.negativeMark') : 'Mark cannot be negative' };
  if (!NUMBER_PATTERN.test(text)) return { ok: false, error: t ? t('validation.numberPattern') : 'Enter a number (e.g. 45)' };
  const value = Number(text);
  if (!Number.isFinite(value)) return { ok: false, error: t ? t('validation.validNumber') : 'Enter a valid number' };
  if (value > max) return { ok: false, error: t ? t('validation.maxMark', { max }) : `Mark cannot be more than ${max}` };
  return { ok: true, value };
}

export function parseRollNumber(raw: string, t?: TranslateFn): ParseResult<number> {
  const text = raw.trim();
  if (text === '') return { ok: false, error: t ? t('validation.enterRoll') : 'Please enter a roll number' };
  if (!/^\d+$/.test(text)) return { ok: false, error: t ? t('validation.wholeRoll') : 'Roll number must be a whole number' };
  const value = Number(text);
  if (value < 1) return { ok: false, error: t ? t('validation.minRoll') : 'Roll number must be 1 or more' };
  if (value > 99999) return { ok: false, error: t ? t('validation.maxRoll') : 'Roll number is too large' };
  return { ok: true, value };
}

export function parseTotalStudents(raw: string, t?: TranslateFn): ParseResult<number> {
  const text = raw.trim();
  if (text === '') return { ok: false, error: t ? t('validation.enterTotalStudents') : 'Please enter the number of students' };
  if (!/^\d+$/.test(text)) return { ok: false, error: t ? t('validation.wholeTotalStudents') : 'Enter a whole number (e.g. 32)' };
  const value = Number(text);
  if (value > 1000) return { ok: false, error: t ? t('validation.maxTotalStudents') : 'Must be 1000 or fewer' };
  return { ok: true, value };
}

export function parseYear(raw: string, t?: TranslateFn): ParseResult<number> {
  const text = raw.trim();
  if (text === '') return { ok: false, error: t ? t('validation.enterYear') : 'Please enter the exam year' };
  if (!/^\d{4}$/.test(text)) return { ok: false, error: t ? t('validation.yearPattern') : 'Enter a 4-digit year (e.g. 2026)' };
  const value = Number(text);
  if (value < 2000 || value > 2100) return { ok: false, error: t ? t('validation.yearRange') : 'Year must be between 2000 and 2100' };
  return { ok: true, value };
}

/** Suggest the next roll number for a category: 1 higher than highest roll in that category. */
export function suggestNextRollNumber(categoryRolls: number[]): number {
  if (categoryRolls.length === 0) return 1;
  return Math.max(...categoryRolls) + 1;
}

/** Check if a string is a valid UUID v4. */
export function isValidUuid(str: string | null | undefined): boolean {
  if (!str) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str.trim());
}
