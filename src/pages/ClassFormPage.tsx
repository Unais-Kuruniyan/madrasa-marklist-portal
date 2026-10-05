import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useAsyncData } from '../hooks/useAsyncData';
import { navigate, paths } from '../hooks/useHashRoute';
import { getClassDetail, saveClass } from '../lib/supabase/api';
import { handleError } from '../lib/supabase/errors';
import type { ClassDetail, SubjectDraft } from '../types';
import { makeKey } from '../utils/format';
import { loadInstitution, saveInstitution } from '../utils/storage';
import { parseTotalStudents } from '../utils/validation';
import { SubjectEditor } from '../components/SubjectEditor';
import { Alert } from '../components/ui/Alert';
import { Button, LinkButton } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmptyState } from '../components/ui/EmptyState';
import { ArrowLeftIcon } from '../components/ui/Icons';
import { LoadingBlock } from '../components/ui/Spinner';
import { TextField } from '../components/ui/TextField';

export function ClassFormPage({ classId }: { classId: string | null }) {
  const { data, loading, error, reload } = useAsyncData(
    () => (classId ? getClassDetail(classId) : Promise.resolve(null)),
    [classId],
  );

  if (classId) {
    if (loading) return <LoadingBlock message="Loading class…" />;
    if (error)
      return (
        <Alert tone="error" title="Could not load class" action={<Button variant="secondary" size="sm" onClick={() => void reload()}>Try again</Button>}>
          {error}
        </Alert>
      );
    if (!data)
      return (
        <EmptyState
          title="Class not found"
          description="This class may have been deleted."
          action={<LinkButton href={paths.dashboard()}>Back to all classes</LinkButton>}
        />
      );
  }

  return <ClassForm detail={data ?? null} />;
}

/* ------------------------------------------------------------------ */

interface FormErrors {
  className?: string;
  totalStudents?: string;
  subjects?: string;
  subjectFields: Record<string, string>;
}

function ClassForm({ detail }: { detail: ClassDetail | null }) {
  const isEdit = detail !== null;
  const remembered = useMemo(() => loadInstitution(), []);

  const [institutionName, setInstitutionName] = useState(detail?.schoolClass.institutionName ?? remembered.name);
  const [institutionLocation, setInstitutionLocation] = useState(
    detail?.schoolClass.institutionLocation ?? remembered.location,
  );
  const [className, setClassName] = useState(detail?.schoolClass.className ?? '');
  const [totalStudents, setTotalStudents] = useState(detail ? String(detail.schoolClass.totalStudents) : '');
  const [includeQuranHifz, setIncludeQuranHifz] = useState(detail?.schoolClass.includeQuranHifz ?? false);
  const [subjects, setSubjects] = useState<SubjectDraft[]>(() =>
    detail
      ? detail.config.normalSubjects.map((s) => ({ id: s.id, key: s.id, name: s.name }))
      : [{ id: null, key: makeKey(), name: '' }],
  );
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormErrors>({ subjectFields: {} });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<SubjectDraft | null>(null);
  const savingRef = useRef(false);

  /** subject id → number of students with a mark for it */
  const markCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const student of detail?.students ?? []) {
      for (const subjectId of Object.keys(student.marks)) counts[subjectId] = (counts[subjectId] ?? 0) + 1;
    }
    return counts;
  }, [detail]);

  const quranHifzMarkCount = useMemo(() => {
    if (!detail) return 0;
    const ids = detail.allSubjects.filter((s) => s.kind !== 'normal').map((s) => s.id);
    return (detail.students ?? []).filter((st) => ids.some((id) => st.marks[id] !== undefined)).length;
  }, [detail]);

  const removedWithMarks = useMemo(() => {
    if (!detail) return [];
    const kept = new Set(subjects.map((s) => s.id).filter(Boolean));
    return detail.config.normalSubjects.filter((s) => !kept.has(s.id) && (markCounts[s.id] ?? 0) > 0);
  }, [detail, subjects, markCounts]);

  function addSubject(name = '') {
    const key = makeKey();
    setSubjects((prev) => [...prev, { id: null, key, name }]);
    if (!name) setFocusKey(key);
  }

  function requestRemove(subject: SubjectDraft) {
    const count = subject.id ? markCounts[subject.id] ?? 0 : 0;
    if (count > 0) setPendingRemove(subject);
    else removeSubject(subject.key);
  }

  function removeSubject(key: string) {
    setSubjects((prev) => prev.filter((s) => s.key !== key));
    setErrors((prev) => {
      const subjectFields = { ...prev.subjectFields };
      delete subjectFields[key];
      return { ...prev, subjectFields };
    });
  }

  function validate(): FormErrors & { valid: boolean; total: number } {
    const next: FormErrors = { subjectFields: {} };
    if (!className.trim()) next.className = 'Please enter the class name';

    const total = parseTotalStudents(totalStudents);
    if (!total.ok) next.totalStudents = total.error;

    const seen = new Map<string, string>();
    for (const s of subjects) {
      const name = s.name.trim();
      const lower = name.toLowerCase();
      if (!name) next.subjectFields[s.key] = 'Enter a subject name or remove this row';
      else if (seen.has(lower)) next.subjectFields[s.key] = 'This subject is already in the list';
      else if (includeQuranHifz && (lower === 'quran' || lower === 'hifz'))
        next.subjectFields[s.key] = 'Quran and Hifz are added automatically by the option below';
      seen.set(lower, s.key);
    }
    if (subjects.length === 0 && !includeQuranHifz) next.subjects = 'Please add at least one subject';

    const valid =
      !next.className && !next.totalStudents && !next.subjects && Object.keys(next.subjectFields).length === 0;
    return { ...next, valid, total: total.ok ? total.value : 0 };
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (savingRef.current) return; // protect against double submit
    setSaveError(null);

    const result = validate();
    setErrors(result);
    if (!result.valid) {
      // Focus first invalid field
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLInputElement>('[aria-invalid="true"]');
        el?.focus();
      });
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      const id = await saveClass(detail?.schoolClass.id ?? null, {
        institutionName: institutionName.trim(),
        institutionLocation: institutionLocation.trim(),
        className: className.trim(),
        totalStudents: result.total,
        includeQuranHifz,
        subjects: subjects.map((s) => ({ id: s.id, name: s.name.trim() })),
      });
      saveInstitution({ name: institutionName.trim(), location: institutionLocation.trim() });
      navigate(paths.classPage(id));
    } catch (err) {
      setSaveError(handleError(err, isEdit ? 'Could not update the class.' : 'Could not create the class.'));
      savingRef.current = false;
      setSaving(false);
    }
  }

  const entered = detail?.students.length ?? 0;
  const totalParsed = parseTotalStudents(totalStudents);

  return (
    <div className="mx-auto max-w-2xl">
      <a
        href={isEdit ? paths.classPage(detail.schoolClass.id) : paths.dashboard()}
        className="mb-4 inline-flex min-h-10 items-center gap-1.5 rounded-md text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <ArrowLeftIcon className="size-4" />
        {isEdit ? 'Back to mark list' : 'All classes'}
      </a>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">{isEdit ? 'Edit Class' : 'Create New Class'}</h1>
      <p className="mt-1 text-sm text-slate-500">
        {isEdit ? 'Update the class details and subjects.' : 'Set up the class and its subjects. You can change these later.'}
      </p>

      <form className="mt-6 space-y-5" onSubmit={(e) => void handleSubmit(e)} noValidate>
        <fieldset className="card space-y-4 p-4 sm:p-6">
          <legend className="sr-only">Institution information</legend>
          <h2 className="text-base font-semibold text-slate-900">Institution</h2>
          <TextField
            label="Institution name"
            id="institution-name"
            value={institutionName}
            onChange={(e) => setInstitutionName(e.target.value)}
            placeholder="e.g. Darul Huda Islamic Academy"
            maxLength={200}
            autoComplete="organization"
          />
          <TextField
            label="Institution location"
            id="institution-location"
            value={institutionLocation}
            onChange={(e) => setInstitutionLocation(e.target.value)}
            placeholder="e.g. Chemmad, Malappuram"
            maxLength={200}
          />
        </fieldset>

        <fieldset className="card space-y-4 p-4 sm:p-6">
          <legend className="sr-only">Class information</legend>
          <h2 className="text-base font-semibold text-slate-900">Class</h2>
          <TextField
            label={<>Class name <span className="text-fail-700">*</span></>}
            id="class-name"
            value={className}
            onChange={(e) => setClassName(e.target.value)}
            placeholder="e.g. 6th Standard"
            maxLength={100}
            required
            error={errors.className}
          />
          <TextField
            label={<>Total students in class <span className="text-fail-700">*</span></>}
            id="total-students"
            value={totalStudents}
            onChange={(e) => setTotalStudents(e.target.value)}
            placeholder="e.g. 32"
            inputMode="numeric"
            pattern="[0-9]*"
            required
            error={errors.totalStudents}
            hint={
              isEdit && totalParsed.ok && totalParsed.value < entered
                ? `Note: ${entered} students are already entered, which is more than this number.`
                : 'The full class strength, including students who may be absent.'
            }
          />
        </fieldset>

        <fieldset className="card space-y-4 p-4 sm:p-6">
          <legend className="sr-only">Subjects</legend>
          <div>
            <h2 className="text-base font-semibold text-slate-900">Subjects</h2>
            <p className="mt-0.5 text-sm text-slate-500">Each subject is out of 100. Pass mark is 40.</p>
          </div>
          {errors.subjects && <Alert tone="error">{errors.subjects}</Alert>}
          <SubjectEditor
            subjects={subjects}
            errors={errors.subjectFields}
            markCounts={Object.fromEntries(subjects.map((s) => [s.key, s.id ? markCounts[s.id] ?? 0 : 0]))}
            onChange={setSubjects}
            onAdd={addSubject}
            onRequestRemove={requestRemove}
            focusKey={focusKey}
          />
        </fieldset>

        <fieldset className="card p-4 sm:p-6">
          <legend className="sr-only">Special subject</legend>
          <h2 className="text-base font-semibold text-slate-900">Special Subject</h2>
          <label
            htmlFor="include-quran-hifz"
            className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-4 hover:bg-slate-50 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50/50"
          >
            <input
              id="include-quran-hifz"
              type="checkbox"
              className="mt-0.5 size-5 shrink-0 accent-brand-700"
              checked={includeQuranHifz}
              onChange={(e) => setIncludeQuranHifz(e.target.checked)}
            />
            <span>
              <span className="block font-medium text-slate-900">Include Quran &amp; Hifz</span>
              <span className="mt-1 block text-sm text-slate-600">
                Quran and Hifz are entered separately but evaluated as one subject using their combined total
                (pass if Quran + Hifz ≥ 40).
              </span>
            </span>
          </label>
          {isEdit && detail.schoolClass.includeQuranHifz && !includeQuranHifz && quranHifzMarkCount > 0 && (
            <Alert tone="warning" className="mt-3">
              {quranHifzMarkCount} student(s) already have Quran/Hifz marks. Turning this off hides those marks and removes them
              from totals and results. The marks are kept, so turning it back on restores them.
            </Alert>
          )}
        </fieldset>

        {removedWithMarks.length > 0 && (
          <Alert tone="warning" title="Marks will be deleted">
            Saving will permanently delete all marks for:{' '}
            <strong>{removedWithMarks.map((s) => s.name).join(', ')}</strong>.
          </Alert>
        )}

        {saveError && <Alert tone="error">{saveError}</Alert>}

        <div className="flex flex-col-reverse gap-3 pb-4 sm:flex-row sm:justify-end">
          <LinkButton href={isEdit ? paths.classPage(detail.schoolClass.id) : paths.dashboard()} variant="secondary" size="lg">
            Cancel
          </LinkButton>
          <Button type="submit" size="lg" loading={saving} id="save-class-button">
            {saving ? (isEdit ? 'Saving changes…' : 'Creating class…') : isEdit ? 'Save Changes' : 'Create Class'}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={pendingRemove !== null}
        title={`Remove “${pendingRemove?.name ?? ''}”?`}
        confirmLabel="Remove subject"
        danger
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => {
          if (pendingRemove) removeSubject(pendingRemove.key);
          setPendingRemove(null);
        }}
      >
        <p>
          <strong>
            {pendingRemove?.id ? markCounts[pendingRemove.id] ?? 0 : 0} student(s)
          </strong>{' '}
          already have marks for this subject.
        </p>
        <p>
          When you save the class, these marks will be <strong>permanently deleted</strong>. You can still cancel the whole
          edit without saving.
        </p>
      </ConfirmDialog>
    </div>
  );
}
