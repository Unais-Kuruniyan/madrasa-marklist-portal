import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useAsyncData } from '../hooks/useAsyncData';
import { navigate, paths } from '../hooks/useHashRoute';
import { useTranslation } from '../i18n/context';
import { getClassDetail, saveClass } from '../lib/supabase/api';
import { handleError } from '../lib/supabase/errors';
import type { ClassDetail, SubjectDraft } from '../types';
import { makeKey } from '../utils/format';
import { loadInstitution, saveInstitution } from '../utils/storage';
import { parseTotalStudents, parseYear } from '../utils/validation';
import { SubjectEditor } from '../components/SubjectEditor';
import { Alert } from '../components/ui/Alert';
import { Button, LinkButton } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmptyState } from '../components/ui/EmptyState';
import { ArrowLeftIcon } from '../components/ui/Icons';
import { LoadingBlock } from '../components/ui/Spinner';
import { TextField } from '../components/ui/TextField';

const COMMON_EXAMS = [
  { id: 'Half-Yearly Examination', key: 'exam.halfYearly' },
  { id: 'Annual Examination', key: 'exam.annual' },
  { id: 'Quarterly Examination', key: 'exam.quarterly' },
  { id: 'Monthly Examination', key: 'exam.monthly' },
  { id: 'Model Examination', key: 'exam.model' },
  { id: 'Custom', key: 'exam.custom' },
];

export function ClassFormPage({ classId }: { classId: string | null }) {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useAsyncData(
    () => (classId ? getClassDetail(classId) : Promise.resolve(null)),
    [classId],
  );

  if (classId) {
    if (loading) return <LoadingBlock message={t('common.loading')} />;
    if (error)
      return (
        <Alert tone="error" title={t('dashboard.loadErrorTitle')} action={<Button variant="secondary" size="sm" onClick={() => void reload()}>{t('common.tryAgain')}</Button>}>
          {error}
        </Alert>
      );
    if (!data)
      return (
        <EmptyState
          title={t('class.classNotFoundTitle')}
          description={t('class.classNotFoundDesc')}
          action={<LinkButton href={paths.dashboard()}>{t('class.backToClasses')}</LinkButton>}
        />
      );
  }

  return <ClassForm detail={data ?? null} />;
}

/* ------------------------------------------------------------------ */

interface FormErrors {
  className?: string;
  examName?: string;
  examYear?: string;
  totalStudents?: string;
  subjects?: string;
  subjectFields: Record<string, string>;
}

function ClassForm({ detail }: { detail: ClassDetail | null }) {
  const { t } = useTranslation();
  const isEdit = detail !== null;
  const remembered = useMemo(() => loadInstitution(), []);

  const [institutionName, setInstitutionName] = useState(
    isEdit ? (detail.schoolClass.institutionName ?? '') : remembered.name,
  );
  const [institutionLocation, setInstitutionLocation] = useState(
    isEdit ? (detail.schoolClass.institutionLocation ?? '') : remembered.location,
  );
  const [rangeName, setRangeName] = useState(detail?.schoolClass.rangeName ?? '');
  const [className, setClassName] = useState(detail?.schoolClass.className ?? '');

  const initialExamName = detail?.examination.examName ?? 'Half-Yearly Examination';
  const isCustomExam = !COMMON_EXAMS.slice(0, -1).some((e) => e.id === initialExamName);
  const [examSelect, setExamSelect] = useState(isCustomExam ? 'Custom' : initialExamName);
  const [customExamName, setCustomExamName] = useState(isCustomExam ? initialExamName : '');
  const [examYear, setExamYear] = useState(String(detail?.examination.examYear ?? new Date().getFullYear()));

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
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<SubjectDraft | null>(null);
  const savingRef = useRef(false);

  const markCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const student of detail?.students ?? []) {
      for (const subjectId of Object.keys(student.marks)) counts[subjectId] = (counts[subjectId] ?? 0) + 1;
    }
    return counts;
  }, [detail]);

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

  function validate(): FormErrors & { valid: boolean; total: number; parsedYear: number; finalExamName: string } {
    const next: FormErrors = { subjectFields: {} };
    if (!className.trim()) next.className = t('class.classNameRequired');

    const finalExamName = (examSelect === 'Custom' ? customExamName : examSelect).trim();
    if (!finalExamName) next.examName = t('class.examNameRequired');

    const parsedYr = parseYear(examYear, t);
    if (!parsedYr.ok) next.examYear = parsedYr.error;

    const total = parseTotalStudents(totalStudents, t);
    if (!total.ok) next.totalStudents = total.error;

    const seen = new Map<string, string>();
    for (const s of subjects) {
      const name = s.name.trim();
      const lower = name.toLowerCase();
      if (!name) next.subjectFields[s.key] = t('class.enterSubjectNameError');
      else if (seen.has(lower)) next.subjectFields[s.key] = t('class.duplicateSubjectError');
      else if (includeQuranHifz && (lower === 'quran' || lower === 'hifz'))
        next.subjectFields[s.key] = t('class.quranHifzAutoError');
      seen.set(lower, s.key);
    }
    if (subjects.length === 0 && !includeQuranHifz) next.subjects = t('class.atLeastOneSubjectError');

    const valid =
      !next.className &&
      !next.examName &&
      !next.examYear &&
      !next.totalStudents &&
      !next.subjects &&
      Object.keys(next.subjectFields).length === 0;

    return {
      ...next,
      valid,
      total: total.ok ? total.value : 0,
      parsedYear: parsedYr.ok ? parsedYr.value : new Date().getFullYear(),
      finalExamName,
    };
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (savingRef.current) return;
    setSaveError(null);
    setSuccessMessage(null);

    const result = validate();
    setErrors(result);
    if (!result.valid) {
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLInputElement>('[aria-invalid="true"]');
        el?.focus();
      });
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      const res = await saveClass(
        detail?.schoolClass.id ?? null,
        {
          institutionName: institutionName.trim(),
          institutionLocation: institutionLocation.trim(),
          rangeName: rangeName.trim(),
          className: className.trim(),
          examName: result.finalExamName,
          examYear: result.parsedYear,
          totalStudents: result.total,
          includeQuranHifz,
          subjects: subjects.map((s) => ({ id: s.id, name: s.name.trim() })),
        },
        detail?.examination.id ?? null,
      );
      saveInstitution({ name: institutionName.trim(), location: institutionLocation.trim() });
      setSuccessMessage(isEdit ? t('class.updateSuccess') : t('class.createSuccess'));

      setTimeout(() => {
        navigate(paths.classPage(res.classId, res.examId));
      }, 500);
    } catch (err) {
      console.error('[ClassFormPage] Database update failed:', err);
      setSaveError(handleError(err, isEdit ? t('class.updateError') : t('class.createError')));
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <a
        href={isEdit ? paths.classPage(detail.schoolClass.id, detail.examination.id) : paths.dashboard()}
        className="mb-4 inline-flex min-h-10 items-center gap-1.5 rounded-md text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <ArrowLeftIcon className="size-4" />
        {isEdit ? t('class.backToMarkList') : t('class.allClasses')}
      </a>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">{isEdit ? t('class.editTitle') : t('class.createTitle')}</h1>
      <p className="mt-1 text-sm text-slate-500">
        {t('class.formSubhead')}
      </p>

      <form className="mt-6 space-y-5" onSubmit={(e) => void handleSubmit(e)} noValidate>
        {/* Institution & Range */}
        <fieldset className="card space-y-4 p-4 sm:p-6">
          <legend className="sr-only">{t('class.institutionSectionTitle')}</legend>
          <h2 className="text-base font-semibold text-slate-900">{t('class.institutionSectionTitle')}</h2>
          <TextField
            label={t('class.institutionNameLabel')}
            id="institution-name"
            value={institutionName}
            onChange={(e) => setInstitutionName(e.target.value)}
            placeholder={t('class.institutionNamePlaceholder')}
            maxLength={200}
            autoComplete="organization"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextField
              label={t('class.locationLabel')}
              id="institution-location"
              value={institutionLocation}
              onChange={(e) => setInstitutionLocation(e.target.value)}
              placeholder={t('class.locationPlaceholder')}
              maxLength={200}
            />
            <TextField
              label={t('class.rangeLabel')}
              id="range-name"
              value={rangeName}
              onChange={(e) => setRangeName(e.target.value)}
              placeholder={t('class.rangePlaceholder')}
              maxLength={200}
              hint={t('class.rangeHint')}
            />
          </div>
        </fieldset>

        {/* Examination & Class Details */}
        <fieldset className="card space-y-4 p-4 sm:p-6">
          <legend className="sr-only">{t('class.classExamSectionTitle')}</legend>
          <h2 className="text-base font-semibold text-slate-900">{t('class.classExamSectionTitle')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextField
              label={<>{t('class.classNameLabel')} <span className="text-fail-700">*</span></>}
              id="class-name"
              value={className}
              onChange={(e) => setClassName(e.target.value)}
              placeholder={t('class.classNamePlaceholder')}
              maxLength={100}
              required
              error={errors.className}
            />
            <TextField
              label={<>{t('class.totalStudentsLabel')} <span className="text-fail-700">*</span></>}
              id="total-students"
              value={totalStudents}
              onChange={(e) => setTotalStudents(e.target.value)}
              placeholder={t('class.totalStudentsPlaceholder')}
              inputMode="numeric"
              pattern="[0-9]*"
              required
              error={errors.totalStudents}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <div>
              <label htmlFor="exam-select" className="mb-1.5 block text-sm font-medium text-slate-700">
                {t('exam.name')} <span className="text-fail-700">*</span>
              </label>
              <select
                id="exam-select"
                className="field-input"
                value={examSelect}
                onChange={(e) => setExamSelect(e.target.value)}
              >
                {COMMON_EXAMS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {t(item.key)}
                  </option>
                ))}
              </select>
              {examSelect === 'Custom' && (
                <input
                  id="custom-exam-name"
                  type="text"
                  className="field-input mt-2"
                  placeholder={t('class.customExamPlaceholder')}
                  value={customExamName}
                  onChange={(e) => setCustomExamName(e.target.value)}
                  maxLength={100}
                />
              )}
              {errors.examName && (
                <p className="mt-1.5 text-sm font-medium text-fail-700" role="alert">
                  {errors.examName}
                </p>
              )}
            </div>

            <TextField
              label={<>{t('exam.year')} <span className="text-fail-700">*</span></>}
              id="exam-year"
              value={examYear}
              onChange={(e) => setExamYear(e.target.value)}
              placeholder="e.g. 2026"
              inputMode="numeric"
              maxLength={4}
              required
              error={errors.examYear}
            />
          </div>
        </fieldset>

        {/* Subjects */}
        <fieldset className="card space-y-4 p-4 sm:p-6">
          <legend className="sr-only">{t('class.subjectsSectionTitle')}</legend>
          <div>
            <h2 className="text-base font-semibold text-slate-900">{t('class.subjectsSectionTitle')}</h2>
            <p className="mt-0.5 text-sm text-slate-500">{t('class.passMarkHint')}</p>
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

        {/* Quran + Hifz Toggle */}
        <fieldset className="card p-4 sm:p-6">
          <legend className="sr-only">{t('class.specialSubjectTitle')}</legend>
          <h2 className="text-base font-semibold text-slate-900">{t('class.specialSubjectTitle')}</h2>
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
              <span className="block font-medium text-slate-900">{t('class.includeQuranHifzCheckbox')}</span>
              <span className="mt-1 block text-sm text-slate-600">
                {t('class.includeQuranHifzHint')}
              </span>
            </span>
          </label>
        </fieldset>

        {saveError && <Alert tone="error">{saveError}</Alert>}
        {successMessage && <Alert tone="success">{successMessage}</Alert>}

        <div className="flex flex-col-reverse gap-3 pb-4 sm:flex-row sm:justify-end">
          <LinkButton href={isEdit ? paths.classPage(detail.schoolClass.id, detail.examination.id) : paths.dashboard()} variant="secondary" size="lg">
            {t('common.cancel')}
          </LinkButton>
          <Button type="submit" size="lg" loading={saving} id="save-class-button">
            {saving
              ? isEdit
                ? t('common.saving')
                : t('class.creatingState')
              : isEdit
                ? t('common.saveChanges')
                : t('class.createClassButton')}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={pendingRemove !== null}
        title={t('class.removeSubjectConfirmTitle', { name: pendingRemove?.name ?? '' })}
        confirmLabel={t('class.removeSubjectConfirmButton')}
        danger
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => {
          if (pendingRemove) removeSubject(pendingRemove.key);
          setPendingRemove(null);
        }}
      >
        <p>{t('class.removeSubjectConfirmBody')}</p>
      </ConfirmDialog>
    </div>
  );
}
