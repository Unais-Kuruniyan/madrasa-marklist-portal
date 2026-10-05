import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { ClassDetail, Student } from '../types';
import {
  calculateGrandTotal,
  calculateQuranHifzTotal,
  calculateResult,
  isPassingMark,
  PASS_MARK,
  requiredSubjectIds,
  round2,
} from '../lib/calculations/marks';
import { saveStudent } from '../lib/supabase/api';
import { handleError } from '../lib/supabase/errors';
import { cx, formatMark } from '../utils/format';
import { parseMark, parseRollNumber, suggestNextRollNumber } from '../utils/validation';
import { Alert } from './ui/Alert';
import { Button } from './ui/Button';
import { CheckIcon } from './ui/Icons';

interface StudentFormProps {
  detail: ClassDetail;
  /** Student being edited, or null to add a new student. */
  editing: Student | null;
  onSaved: (info: { studentId: string; rollNumber: number; name: string; wasEdit: boolean }) => void;
  onCancelEdit: () => void;
}

type MarkInputs = Record<string, string>;

function initialMarks(detail: ClassDetail, student: Student | null): MarkInputs {
  const inputs: MarkInputs = {};
  for (const id of requiredSubjectIds(detail.config)) {
    const v = student?.marks[id];
    inputs[id] = v === undefined ? '' : formatMark(v);
  }
  return inputs;
}

export function StudentForm({ detail, editing, onSaved, onCancelEdit }: StudentFormProps) {
  const { config, students, schoolClass } = detail;
  const isEdit = editing !== null;
  const subjectMax = (id: string) => detail.allSubjects.find((s) => s.id === id)?.maxMarks ?? 100;

  const [roll, setRoll] = useState(() =>
    editing ? String(editing.rollNumber) : String(suggestNextRollNumber(students.map((s) => s.rollNumber))),
  );
  const [name, setName] = useState(editing?.studentName ?? '');
  const [isAbsent, setIsAbsent] = useState(() => (editing ? Object.keys(editing.marks).length === 0 : false));
  const [marks, setMarks] = useState<MarkInputs>(() => initialMarks(detail, editing));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const orderedMarkIds = requiredSubjectIds(config);

  /* -------------------- validation -------------------- */

  const rollResult = parseRollNumber(roll);
  const duplicate =
    rollResult.ok && students.find((s) => s.rollNumber === rollResult.value && s.id !== editing?.id);
  const rollError = !rollResult.ok
    ? rollResult.error
    : duplicate
      ? `Roll ${rollResult.value} is already used by ${duplicate.studentName}`
      : null;
  const nameError = name.trim() ? null : 'Please enter the student name';

  const parsedMarks = useMemo(() => {
    const result: Record<string, ReturnType<typeof parseMark>> = {};
    for (const id of orderedMarkIds) result[id] = parseMark(marks[id] ?? '', subjectMax(id));
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks, config]);

  const markErrors: Record<string, string | null> = {};
  for (const id of orderedMarkIds) {
    const r = parsedMarks[id];
    markErrors[id] = isAbsent || r.ok ? null : r.error;
  }

  const showError = (field: string, error: string | null) => {
    if (!error) return null;
    const raw = field === 'roll' ? roll : field === 'name' ? name : marks[field] ?? '';
    // Show immediately for clearly invalid typed values; show "required" only after blur / submit.
    if (submitted || touched[field] || raw.trim() !== '') return error;
    return null;
  };

  /* -------------------- live calculations -------------------- */

  const valueOf = (id: string | undefined): number | null => {
    if (!id) return null;
    const r = parsedMarks[id];
    return r && r.ok ? r.value : null;
  };

  const normalValues = config.normalSubjects.map((s) => valueOf(s.id));
  const quranValue = valueOf(config.quranSubject?.id);
  const hifzValue = valueOf(config.hifzSubject?.id);
  const quranHifzTotal =
    config.includeQuranHifz && quranValue !== null && hifzValue !== null
      ? calculateQuranHifzTotal(quranValue, hifzValue)
      : null;
  const allEntered =
    normalValues.every((v) => v !== null) && (!config.includeQuranHifz || quranHifzTotal !== null);
  const enteredCount =
    normalValues.filter((v) => v !== null).length +
    (config.includeQuranHifz ? [quranValue, hifzValue].filter((v) => v !== null).length : 0);
  const runningTotal = round2(
    normalValues.reduce<number>((a, v) => a + (v ?? 0), 0) + (config.includeQuranHifz ? (quranValue ?? 0) + (hifzValue ?? 0) : 0),
  );
  const grandTotal = allEntered ? calculateGrandTotal(normalValues as number[], quranHifzTotal) : null;
  const result = allEntered ? calculateResult(normalValues as number[], quranHifzTotal) : null;

  /* -------------------- keyboard navigation -------------------- */

  function focusNext(current: HTMLElement) {
    const form = formRef.current;
    if (!form) return;
    const fields = Array.from(form.querySelectorAll<HTMLInputElement>('input[data-entry]:not([disabled])'));
    const index = fields.indexOf(current as HTMLInputElement);
    if (index >= 0 && index < fields.length - 1) {
      fields[index + 1].focus();
      fields[index + 1].select();
    } else {
      form.requestSubmit();
    }
  }

  function onEntryKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      focusNext(e.currentTarget);
    }
  }

  /* -------------------- submit -------------------- */

  function resetForNext(savedRoll: number) {
    const rolls = [...students.filter((s) => s.id !== editing?.id).map((s) => s.rollNumber), savedRoll];
    setRoll(String(suggestNextRollNumber(rolls)));
    setName('');
    setIsAbsent(false);
    setMarks(initialMarks(detail, null));
    setTouched({});
    setSubmitted(false);
    requestAnimationFrame(() => nameRef.current?.focus());
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (savingRef.current) return; // guard against double submission
    setSubmitted(true);
    setSaveError(null);

    const hasMarkErrors = Object.values(markErrors).some(Boolean);
    if (rollError || nameError || hasMarkErrors || !rollResult.ok) {
      requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();
      });
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      const studentName = name.trim();
      const studentId = await saveStudent({
        classId: schoolClass.id,
        studentId: editing?.id ?? null,
        rollNumber: rollResult.value,
        studentName,
        isAbsent,
        marks: isAbsent
          ? []
          : orderedMarkIds.map((id) => {
              const r = parsedMarks[id];
              if (!r.ok) throw new Error('Invalid mark'); // unreachable: validated above
              return { subjectId: id, marks: r.value };
            }),
      });
      onSaved({ studentId, rollNumber: rollResult.value, name: studentName, wasEdit: isEdit });
      if (!isEdit) resetForNext(rollResult.value);
    } catch (err) {
      setSaveError(handleError(err, isEdit ? 'Could not update the student.' : 'Could not save the student.'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  /* -------------------- render helpers -------------------- */

  const markField = (id: string, label: string, opts: { evaluateIndividually: boolean }) => {
    const inputId = `mark-${id}`;
    const err = showError(id, markErrors[id]);
    const v = valueOf(id);
    const below = opts.evaluateIndividually && v !== null && !isPassingMark(v);
    return (
      <div key={id}>
        <label htmlFor={inputId} className="mb-1 block truncate text-sm font-medium text-slate-700" title={label}>
          {label}
        </label>
        <input
          id={inputId}
          data-entry
          className={cx('field-input text-center text-lg font-semibold tabular-nums', below && 'border-red-300 text-fail-700')}
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="next"
          maxLength={6}
          placeholder="0–100"
          value={isAbsent ? '' : marks[id] ?? ''}
          disabled={isAbsent}
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? `${inputId}-error` : below ? `${inputId}-below` : undefined}
          onChange={(e) => setMarks((m) => ({ ...m, [id]: e.target.value }))}
          onBlur={() => setTouched((t) => ({ ...t, [id]: true }))}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={onEntryKeyDown}
        />
        {err ? (
          <p id={`${inputId}-error`} className="mt-1 text-xs font-medium text-fail-700" role="alert">
            {err}
          </p>
        ) : below ? (
          <p id={`${inputId}-below`} className="mt-1 text-xs text-fail-700">
            Below {PASS_MARK}
          </p>
        ) : null}
      </div>
    );
  };

  const rollErr = showError('roll', rollError);
  const nameErr = showError('name', nameError);

  return (
    <form ref={formRef} onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-5" aria-label={isEdit ? 'Edit student' : 'Add student'}>
      <div className="grid grid-cols-[6.5rem_1fr] gap-3">
        <div>
          <label htmlFor="student-roll" className="mb-1 block text-sm font-medium text-slate-700">
            Roll No.
          </label>
          <input
            id="student-roll"
            data-entry
            className="field-input text-center text-lg font-semibold tabular-nums"
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="next"
            maxLength={5}
            value={roll}
            aria-invalid={rollErr ? true : undefined}
            aria-describedby={rollErr ? 'student-roll-error' : undefined}
            onChange={(e) => setRoll(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, roll: true }))}
            onKeyDown={onEntryKeyDown}
          />
        </div>
        <div>
          <label htmlFor="student-name" className="mb-1 block text-sm font-medium text-slate-700">
            Student name
          </label>
          <input
            id="student-name"
            ref={nameRef}
            data-entry
            className="field-input text-lg"
            autoComplete="off"
            autoCapitalize="words"
            enterKeyHint="next"
            maxLength={150}
            placeholder="Full name"
            value={name}
            aria-invalid={nameErr ? true : undefined}
            aria-describedby={nameErr ? 'student-name-error' : undefined}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, name: true }))}
            onKeyDown={onEntryKeyDown}
          />
        </div>
        {(rollErr || nameErr) && (
          <div className="col-span-2 -mt-1 space-y-1">
            {rollErr && (
              <p id="student-roll-error" className="text-sm font-medium text-fail-700" role="alert">
                {rollErr}
              </p>
            )}
            {nameErr && (
              <p id="student-name-error" className="text-sm font-medium text-fail-700" role="alert">
                {nameErr}
              </p>
            )}
          </div>
        )}
      </div>

      <label htmlFor="student-absent" className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm hover:bg-slate-50 has-[:checked]:border-slate-400 has-[:checked]:bg-slate-50">
        <input
          id="student-absent"
          type="checkbox"
          className="size-5 shrink-0 accent-brand-700"
          checked={isAbsent}
          onChange={(e) => setIsAbsent(e.target.checked)}
        />
        <span>
          <span className="font-medium text-slate-800">Absent / did not appear</span>
          <span className="block text-xs text-slate-500">Save the student without marks. Shown as “AB”, not counted as appeared.</span>
        </span>
      </label>
      {isEdit && isAbsent && Object.keys(editing.marks).length > 0 && (
        <Alert tone="warning">Saving as absent will delete this student's existing marks.</Alert>
      )}

      {!isAbsent && (
        <>
          {config.normalSubjects.length > 0 && (
            <fieldset>
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Subject marks (out of 100, pass {PASS_MARK})
              </legend>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {config.normalSubjects.map((s) => markField(s.id, s.name, { evaluateIndividually: true }))}
              </div>
            </fieldset>
          )}

          {config.includeQuranHifz && config.quranSubject && config.hifzSubject && (
            <fieldset className="rounded-xl border border-brand-100 bg-brand-50/40 p-3.5">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-brand-800">
                Quran + Hifz (one subject)
              </legend>
              <div className="grid grid-cols-3 items-start gap-3">
                {markField(config.quranSubject.id, 'Quran', { evaluateIndividually: false })}
                {markField(config.hifzSubject.id, 'Hifz', { evaluateIndividually: false })}
                <div>
                  <p className="mb-1 block text-sm font-medium text-slate-700" id="qh-total-label">
                    Total
                  </p>
                  <output
                    aria-labelledby="qh-total-label"
                    aria-live="polite"
                    className={cx(
                      'flex min-h-[3.25rem] items-center justify-center rounded-lg border bg-white text-lg font-bold tabular-nums',
                      quranHifzTotal === null
                        ? 'border-slate-200 text-slate-400'
                        : isPassingMark(quranHifzTotal)
                          ? 'border-green-200 text-pass-700'
                          : 'border-red-200 text-fail-700',
                    )}
                  >
                    {formatMark(quranHifzTotal)}
                  </output>
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-600">
                Pass if Quran + Hifz ≥ {PASS_MARK}. Each part is not checked separately.
                {quranHifzTotal !== null && (
                  <strong className={cx('ml-1', isPassingMark(quranHifzTotal) ? 'text-pass-700' : 'text-fail-700')}>
                    {isPassingMark(quranHifzTotal) ? 'Passed' : 'Below pass mark'}
                  </strong>
                )}
              </p>
            </fieldset>
          )}

          {/* Live results */}
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-900 p-4 text-white sm:grid-cols-3" aria-live="polite">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                {allEntered ? 'Grand Total' : 'Total so far'}
              </p>
              <p className="mt-0.5 text-2xl font-bold tabular-nums">{allEntered ? formatMark(grandTotal) : formatMark(runningTotal)}</p>
              {!allEntered && (
                <p className="text-xs text-slate-400">
                  {enteredCount} of {orderedMarkIds.length} marks entered
                </p>
              )}
            </div>
            {config.includeQuranHifz && (
              <div className="hidden sm:block">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Quran + Hifz</p>
                <p className="mt-0.5 text-2xl font-bold tabular-nums">{formatMark(quranHifzTotal)}</p>
              </div>
            )}
            <div className="text-right sm:text-left">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Result</p>
              <div className="mt-1">
                {result ? (
                  <span
                    className={cx(
                      'inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-lg font-bold',
                      result === 'P' ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300',
                    )}
                  >
                    {result} <span className="text-sm font-semibold">{result === 'P' ? 'Pass' : 'Fail'}</span>
                  </span>
                ) : (
                  <span className="text-sm text-slate-400">Enter all marks</span>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {saveError && <Alert tone="error">{saveError}</Alert>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {isEdit && (
          <Button variant="secondary" size="lg" onClick={onCancelEdit} disabled={saving} id="cancel-edit-student">
            Cancel
          </Button>
        )}
        <Button type="submit" size="lg" loading={saving} icon={<CheckIcon />} id="save-student-button" className="sm:min-w-48">
          {saving ? (isEdit ? 'Updating marks…' : 'Saving student…') : isEdit ? 'Update Student' : 'Save & Next'}
        </Button>
      </div>
    </form>
  );
}
