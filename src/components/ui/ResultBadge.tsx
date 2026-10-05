import type { StudentResult } from '../../types';
import { cx } from '../../utils/format';

/** P / F / AB / Incomplete badge — always shows text, never color alone. */
export function ResultBadge({ result, size = 'md' }: { result: Pick<StudentResult, 'status' | 'result'>; size?: 'md' | 'lg' }) {
  const base = cx(
    'inline-flex items-center justify-center rounded-md font-bold tracking-wide',
    size === 'lg' ? 'min-w-12 px-3 py-1.5 text-lg' : 'min-w-8 px-2 py-0.5 text-sm',
  );

  if (result.status === 'absent') {
    return (
      <span className={cx(base, 'bg-slate-100 text-slate-600')} title="Absent / not appeared">
        AB
      </span>
    );
  }
  if (result.status === 'incomplete' || result.result === null) {
    return (
      <span className={cx(base, 'bg-amber-50 text-amber-800 font-semibold')} title="Some marks are missing">
        {size === 'lg' ? 'Incomplete' : 'Inc.'}
      </span>
    );
  }
  if (result.result === 'P') {
    return (
      <span className={cx(base, 'bg-pass-50 text-pass-700 ring-1 ring-green-200')} title="Pass">
        P
      </span>
    );
  }
  return (
    <span className={cx(base, 'bg-fail-50 text-fail-700 ring-1 ring-red-200')} title="Fail">
      F
    </span>
  );
}
