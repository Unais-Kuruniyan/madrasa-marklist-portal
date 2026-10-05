/** Format a mark without trailing zeros: 45 → "45", 42.5 → "42.5". */
export function formatMark(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

/** 84.375 → "84.38%" ; 100 → "100%" */
export function formatPercent(value: number): string {
  return `${formatMark(value)}%`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Generate a stable-ish key for client-side list items. */
export function makeKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

/** Join class names, ignoring falsy values. */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
