import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../../utils/format';

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: ReactNode;
  error?: string | null;
  hint?: ReactNode;
  /** Visually hide the label (still accessible). */
  hideLabel?: boolean;
  containerClassName?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, hint, hideLabel, id, className, containerClassName, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={containerClassName}>
      <label
        htmlFor={inputId}
        className={cx('mb-1.5 block text-sm font-medium text-slate-700', hideLabel && 'sr-only')}
      >
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx('field-input', className)}
        {...rest}
      />
      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1.5 text-sm font-medium text-fail-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});
