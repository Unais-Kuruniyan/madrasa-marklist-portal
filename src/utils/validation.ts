/**
 * Input parsing/validation helpers. These never silently turn invalid
 * or missing input into 0 — they return an error message instead.
 */

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const NUMBER_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * Parse a mark typed by a teacher.
 * Accepts whole numbers or up to 2 decimals between 0 and `max`.
 */
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

/** Parse a roll number (positive whole number). */
export function parseRollNumber(raw: string): ParseResult<number> {
  const text = raw.trim();
  if (text === '') return { ok: false, error: 'Please enter a roll number' };
  if (!/^\d+$/.test(text)) return { ok: false, error: 'Roll number must be a whole number' };
  const value = Number(text);
  if (value < 1) return { ok: false, error: 'Roll number must be 1 or more' };
  if (value > 99999) return { ok: false, error: 'Roll number is too large' };
  return { ok: true, value };
}

/** Parse the "total students in class" field. */
export function parseTotalStudents(raw: string): ParseResult<number> {
  const text = raw.trim();
  if (text === '') return { ok: false, error: 'Please enter the number of students' };
  if (!/^\d+$/.test(text)) return { ok: false, error: 'Enter a whole number (e.g. 32)' };
  const value = Number(text);
  if (value > 1000) return { ok: false, error: 'Must be 1000 or fewer' };
  return { ok: true, value };
}

/** Suggest the next roll number: one more than the highest existing roll. */
export function suggestNextRollNumber(existing: number[]): number {
  if (existing.length === 0) return 1;
  return Math.max(...existing) + 1;
}
