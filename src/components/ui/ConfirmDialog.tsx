import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './Button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Accessible confirmation dialog built on the native <dialog> element
 * (focus trapping, Esc to close and backdrop are handled by the browser).
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-dialog-title"
      className="no-print m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-slate-200 bg-white p-0 text-slate-800 shadow-xl"
      onCancel={(e) => {
        e.preventDefault();
        if (!loading) onCancel();
      }}
      onClick={(e) => {
        // click on backdrop
        if (e.target === ref.current && !loading) onCancel();
      }}
    >
      <div className="p-5 sm:p-6">
        <h2 id="confirm-dialog-title" className="text-lg font-semibold text-slate-900">
          {title}
        </h2>
        {children && <div className="mt-2 space-y-2 text-sm text-slate-600">{children}</div>}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel} disabled={loading} id="confirm-dialog-cancel">
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading} id="confirm-dialog-confirm">
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
