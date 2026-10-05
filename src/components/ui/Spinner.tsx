import { cx } from '../../utils/format';

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <svg
      className={cx('animate-spin', className ?? 'size-5')}
      viewBox="0 0 24 24"
      fill="none"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Centered loading message for page-level loads. */
export function LoadingBlock({ message }: { message: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center justify-center gap-3 py-16 text-slate-500">
      <Spinner className="size-7 text-brand-600" />
      <p className="text-sm font-medium">{message}</p>
    </div>
  );
}

/** Skeleton placeholder block. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-slate-200', className)} aria-hidden="true" />;
}
