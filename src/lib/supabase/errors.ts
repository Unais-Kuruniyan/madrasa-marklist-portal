/**
 * Convert Supabase / network errors into friendly messages for teachers.
 * Raw details are logged to the console for developers only.
 */

interface ErrorLike {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

export class AppError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'AppError';
  }
}

function asErrorLike(error: unknown): ErrorLike {
  if (error && typeof error === 'object') return error as ErrorLike;
  return { message: String(error) };
}

export function friendlyErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error instanceof AppError) return error.message;

  const e = asErrorLike(error);
  const message = e.message ?? '';
  const text = `${message} ${e.details ?? ''}`;

  if (message === 'SUPABASE_NOT_CONFIGURED') {
    return 'The database is not configured. Ask the administrator to set the Supabase environment variables.';
  }
  if (/Failed to fetch|NetworkError|Load failed|fetch failed|ERR_NETWORK|network/i.test(message)) {
    return 'Cannot reach the database. Please check your internet connection and try again.';
  }

  switch (e.code) {
    case '23505':
      if (text.includes('students_class_roll_unique')) {
        return 'This roll number is already used in this class. Please choose a different roll number.';
      }
      return 'This record already exists.';
    case '23514':
      if (/at least one subject/i.test(text)) return 'Please add at least one subject.';
      return 'Some values are outside the allowed range. Please check the marks and try again.';
    case '23503':
      return 'This item no longer exists. Please refresh the page.';
    case '23502':
      return 'Some required information is missing.';
    case 'P0002':
    case 'PGRST116':
      return 'This item could not be found. It may have been deleted.';
    case 'PGRST202':
    case '42883':
    case '42P01':
    case 'PGRST205':
      return 'The database is not set up yet. Ask the administrator to run supabase/schema.sql.';
    case '42501':
      return 'The database refused this action (permission denied). Check the RLS policies in schema.sql.';
    default:
      return fallback;
  }
}

/** Log a developer-friendly error and return a teacher-friendly message. */
export function handleError(error: unknown, fallback?: string): string {
  console.error('[MarkList]', error);
  return friendlyErrorMessage(error, fallback);
}
