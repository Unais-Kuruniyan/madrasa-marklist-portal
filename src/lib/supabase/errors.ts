/**
 * Convert Supabase / network errors into friendly messages for teachers.
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

export function friendlyErrorMessage(
  error: unknown,
  fallback?: string,
  t?: (key: string) => string,
): string {
  if (error instanceof AppError) return error.message;

  const e = asErrorLike(error);
  const message = e.message ?? '';
  const text = `${message} ${e.details ?? ''}`;

  const translate = (key: string, defaultText: string) => (t ? t(key) : defaultText);

  if (message === 'SUPABASE_NOT_CONFIGURED') {
    return translate('errors.supabaseNotConfigured', 'The database is not configured. Set Supabase environment variables.');
  }
  if (/Failed to fetch|NetworkError|Load failed|fetch failed|ERR_NETWORK|network/i.test(message)) {
    return translate('errors.networkError', 'Cannot reach the database. Please check your internet connection and try again.');
  }

  switch (e.code) {
    case '23505':
      if (text.includes('students_exam_category_roll_unique') || text.includes('students_class_roll_unique')) {
        return translate('validation.duplicateRoll', 'This roll number already exists.');
      }
      return translate('errors.duplicateRecord', 'This record already exists.');
    case '23514':
      return translate('errors.outOfRange', 'Some values are outside the allowed range.');
    case 'P0002':
    case 'PGRST116':
      return translate('errors.notFound', 'This item could not be found.');
    case '42501':
      return translate('errors.permissionDenied', 'Database permission denied.');
    default:
      return fallback || translate('errors.generic', 'Something went wrong. Please try again.');
  }
}

export function handleError(error: unknown, fallback?: string, t?: (key: string) => string): string {
  console.error('[MarkList]', error);
  return friendlyErrorMessage(error, fallback, t);
}
