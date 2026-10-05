/**
 * Input parsing/validation helpers.
 */

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const NUMBER_PATTERN = /^\d+(\.\d{1,2})?$/;

export function parseMark(raw: string, max = 100): ParseResult<number> {
  const text = raw.trim();
  if (text === '') return { ok: false, error: 'Please enter a mark' };
  if (text.startsWith('-')) return { ok: false, error: 'Mark cannot be negative' };
  if (!NUMBER_PATTERN.test(text)) return { ok: false, error: 'Enter a number (e.g. 45)' };
  const value = Number(text);
  if (!Number.isFinite(value)) return { ok: false, error: 'Enter a valid number' };
  if (value > max) return { ok: false, error: `Mark cannot be more than ${max}` };
  return { ok: true, value };
}

export function parseRollNumber(raw: string): ParseResult<number> {
  const text = raw.trim();
  if (text === '') return { ok: false, error: 'Please enter a roll number' };
  if (!/^\d+$/.test(text)) return { ok: false, error: 'Roll number must be a whole number' };
  const value = Number(text);
  if (value < 1) return { ok: false, error: 'Roll number must be 1 or more' };
  if (value > 99999) return { ok: false, error: 'Roll number is too large' };
  return { ok: true, value };
}

export function parseTotalStudents(raw: string): ParseResult<number> {
  const text = raw.trim();
  if (text === '') return { ok: false, error: 'Please enter the number of students' };
  if (!/^\d+$/.test(text)) return { ok: false, error: 'Enter a whole number (e.g. 32)' };
  const value = Number(text);
  if (value > 1000) return { ok: false, error: 'Must be 1000 or fewer' };
  return { ok: true, value };
}

export function parseYear(raw: string): ParseResult<number> {
  const text = raw.trim();
  if (text === '') return { ok: false, error: 'Please enter the exam year' };
  if (!/^\d{4}$/.test(text)) return { ok: false, error: 'Enter a 4-digit year (e.g. 2026)' };
  const value = Number(text);
  if (value < 2000 || value > 2100) return { ok: false, error: 'Year must be between 2000 and 2100' };
  return { ok: true, value };
}

/** Suggest the next roll number for a category: 1 higher than highest roll in that category. */
export function suggestNextRollNumber(categoryRolls: number[]): number {
  if (categoryRolls.length === 0) return 1;
  return Math.max(...categoryRolls) + 1;
}
