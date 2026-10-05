import type { ReactNode } from 'react';
import { cx } from '../../utils/format';

type Tone = 'error' | 'success' | 'info' | 'warning';

const tones: Record<Tone, string> = {
  error: 'border-red-200 bg-fail-50 text-fail-700',
  success: 'border-green-200 bg-pass-50 text-pass-700',
  info: 'border-brand-100 bg-brand-50 text-brand-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
};

const icons: Record<Tone, string> = {
  error: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  success: 'M20 6 9 17l-5-5',
  info: 'M12 16v-4m0-4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  warning: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
};

interface AlertProps {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function Alert({ tone = 'info', title, children, action, className }: AlertProps) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx('flex gap-3 rounded-lg border px-4 py-3 text-sm', tones[tone], className)}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 size-5 shrink-0" aria-hidden="true">
        <path d={icons[tone]} />
      </svg>
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cx(title && 'mt-0.5')}>{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}
