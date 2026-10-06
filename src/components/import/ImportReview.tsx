import { Fragment, useMemo, useState } from 'react';
import type { ClassDetail, ClassListItem, StudentCategory } from '../../types';
import { useTranslation } from '../../i18n/context';
import {
  buildPhotoSaveBatch,
  evaluateRow,
  findTotalMismatches,
  importableSubjects,
  isStudentSaveable,
  missingStudentEstimate,
  newBlankRow,
  numericMarks,
  remapColumn,
  remapRowsToSavedDetail,
  updateSubjectName,
  validateRow,
  type DraftRow,
  type DuplicateChoice,
  type ImportDraft,
  type RowValidation,
} from '../../lib/import/draft';
import type { PreparedImage } from '../../lib/import/image';
import type { BoundingBox, Confidence } from '../../lib/import/types';
import { deleteClass, getClassDetail, saveClass, saveStudent } from '../../lib/supabase/api';
import { handleError } from '../../lib/supabase/errors';
import { cx, formatMark } from '../../utils/format';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { CheckIcon, PlusIcon, RefreshIcon, SearchIcon, TrashIcon, WarnIcon } from '../ui/Icons';
import { ResultBadge } from '../ui/ResultBadge';
import { SourceCropModal } from './SourceCropModal';

interface ImportReviewProps {
  mode?: 'home' | 'class';
  detail: ClassDetail;
  draft: ImportDraft;
  image: PreparedImage;
  existingClasses?: ClassListItem[];
  onChange: (updater: (d: ImportDraft) => ImportDraft) => void;
  onTryAgain: () => void;
  onImported: (count: number, createdClassId?: string) => void;
  onSelectExistingClass?: (classId: string) => Promise<void>;
}

type GroupKey = StudentCategory | '';

const inputBase = 'field-input !px-2 !py-1.5 !text-sm tabular-nums';

export function ImportReview({
  mode = 'class',
  detail,
  draft,
  image,
  existingClasses = [],
  onChange,
  onTryAgain,
  onImported,
  onSelectExistingClass,
}: ImportReviewProps) {
  const { t } = useTranslation();
  const isHomeMode = mode === 'home';

  const [saveOption, setSaveOption] = useState<'create' | 'existing'>('create');
  const [selectedTargetClassId, setSelectedTargetClassId] = useState<string>('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ tone: 'error' | 'warning'; text: string } | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  // Crop Modal state for Image-Cell Verification (Section 16)
  const [cropTarget, setCropTarget] = useState<{
    box?: BoundingBox | null;
    title: string;
    detectedValue: string | number | null;
  } | null>(null);

  const subjects = useMemo(() => importableSubjects(detail), [detail]);
  const config = detail.config;
  const withQH = config.includeQuranHifz && !!config.quranSubject && !!config.hifzSubject;

  const validations = useMemo(() => {
    const map = new Map<string, RowValidation>();
    for (const r of draft.rows) map.set(r.key, validateRow(r, draft.rows, detail, t));
    return map;
  }, [draft.rows, detail, t]);

  const invalidCount = draft.rows.filter((r) => !validations.get(r.key)?.ok).length;
  const missing = missingStudentEstimate(detail, draft.rows.length);

  /* -------------------- row editing -------------------- */

  const updateRow = (key: string, patch: (r: DraftRow) => DraftRow) =>
    onChange((d) => ({ ...d, rows: d.rows.map((r) => (r.key === key ? patch(r) : r)) }));

  const deleteRow = (key: string) => onChange((d) => ({ ...d, rows: d.rows.filter((r) => r.key !== key) }));

  const addRow = (cat: StudentCategory) => onChange((d) => ({ ...d, rows: [...d.rows, newBlankRow(detail, d.rows, cat)] }));

  /* -------------------- confidence badge helper -------------------- */

  const ConfidenceBadge = ({ confidence }: { confidence?: Confidence }) => {
    if (confidence === 'high') {
      return <span className="inline-block size-2.5 rounded-full bg-emerald-500" title={t('photoImport.highConfidence')} />;
    }
    if (confidence === 'medium') {
      return <span className="inline-block size-2.5 rounded-full bg-amber-500" title={t('photoImport.needsReview')} />;
    }
    return <span className="inline-block size-2.5 rounded-full bg-rose-500" title={t('photoImport.needsReview')} />;
  };

  /* -------------------- save -------------------- */

  const handleConfirm = async () => {
    setSubmitted(true);
    setSaveMessage(null);
    setRowErrors({});
    if (draft.rows.length === 0) return;

    if (invalidCount > 0) {
      setSaveMessage({ tone: 'error', text: t('photoImport.rowsNeedAttention', { count: invalidCount }) });
      const first = draft.rows.find((r) => !validations.get(r.key)?.ok);
      if (first) document.getElementById(`import-row-${first.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    setSaving(true);
    let createdClassId: string | undefined = undefined;

    try {
      let activeClassDetail = detail;
      let targetRows = draft.rows;
      let targetValidations = validations;

      console.log(`[ImportSave] Starting save process. Total students to save: ${draft.rows.length}`);

      // Mode A: Create New Class & Save
      if (isHomeMode && saveOption === 'create') {
        if (!draft.header.className.trim() || !draft.header.examName.trim()) {
          setSaveMessage({ tone: 'error', text: t('photoImport.missingRequiredMetadata') });
          setSaving(false);
          return;
        }

        const classInput = {
          institutionName: draft.header.institutionName,
          institutionLocation: draft.header.institutionLocation,
          rangeName: draft.header.rangeName,
          className: draft.header.className.trim(),
          examName: draft.header.examName.trim(),
          examYear: Number(draft.header.examYear) || new Date().getFullYear(),
          totalStudents: draft.rows.length,
          includeQuranHifz: subjects.some((s) => s.kind === 'quran' || s.kind === 'hifz'),
          subjects: subjects.map((s) => ({ id: null, name: s.name })),
        };

        console.log('[ImportSave] STEP 1: Creating class & subjects in database with input:', classInput);
        const result = await saveClass(null, classInput);
        createdClassId = result.classId;
        console.log(`[ImportSave]   -> Class created: classId = "${result.classId}", examId = "${result.examId}"`);

        // STEP 2: Fetch created class detail from database (contains real database subject UUIDs)
        console.log('[ImportSave] STEP 2: Fetching created class detail from database...');
        const realDetail = await getClassDetail(result.classId, result.examId);
        if (!realDetail) {
          throw new Error('Could not fetch newly created class detail from database.');
        }
        console.log(`[ImportSave]   -> Fetched class detail successfully. Real subjects count: ${realDetail.allSubjects.length}`);

        // STEP 3: Map draft rows (which used subj-col-0, etc.) to realDetail (which uses real UUIDs)
        console.log('[ImportSave] STEP 3: Mapping temporary subject IDs to real database UUIDs...');
        targetRows = remapRowsToSavedDetail(draft.rows, detail, realDetail);
        activeClassDetail = realDetail;

        // STEP 4: Re-validate mapped rows against realDetail
        const realValidations = new Map<string, RowValidation>();
        for (const r of targetRows) {
          realValidations.set(r.key, validateRow(r, targetRows, realDetail, t));
        }
        targetValidations = realValidations;
      } else if (isHomeMode && saveOption === 'existing' && onSelectExistingClass) {
        if (!selectedTargetClassId) {
          setSaveMessage({ tone: 'error', text: t('photoImport.chooseTargetClassPlaceholder') });
          setSaving(false);
          return;
        }
        console.log(`[ImportSave] Importing into existing class: ${selectedTargetClassId}`);
        await onSelectExistingClass(selectedTargetClassId);
      }

      console.log(`[ImportSave] Student Validation Diagnostics (${targetRows.length} total rows):`);
      for (const r of targetRows) {
        const v = targetValidations.get(r.key);
        const saveable = isStudentSaveable(r, activeClassDetail, v);
        const parsedCount = Object.keys(numericMarks(r, activeClassDetail)).length;
        console.log(`[ImportSave]   Student Roll ${r.roll || '?'} (${r.category || 'none'}) — "${r.name}": SAVEABLE=${saveable}, valid=${v?.ok}, markCount=${parsedCount}, errors=`, v?.errors);
      }

      const batch = buildPhotoSaveBatch(targetRows, activeClassDetail, targetValidations);
      console.log(`[ImportSave] STEP 4: Saving ${batch.length} student records...`);

      if (batch.length === 0) {
        throw new Error('No valid student records found to save.');
      }

      const savedKeys: string[] = [];
      const failures: Record<string, string> = {};

      for (let i = 0; i < batch.length; i++) {
        const item = batch[i];
        const studentDesc = `Roll ${item.input.rollNumber} (${item.input.category === 'boys' ? 'Boys' : 'Girls'}) — ${item.input.studentName}`;
        try {
          console.log(`[ImportSave]   Saving student ${i + 1}/${batch.length}: ${studentDesc} (examId: ${item.input.examId}, marks count: ${item.input.marks.length})...`);
          const savedStudentId = await saveStudent(item.input);
          console.log(`[ImportSave]     -> Student saved successfully! studentId = "${savedStudentId}"`);
          savedKeys.push(item.key);
        } catch (err: any) {
          const rawErr = err?.message || String(err);
          console.error(`[ImportSave]     -> FAILED to save student ${studentDesc}:`, rawErr);
          failures[item.key] = `${studentDesc}: ${rawErr}`;
        }
      }

      const failedCount = Object.keys(failures).length;

      if (failedCount > 0) {
        console.error(`[ImportSave] Save process incomplete: ${savedKeys.length} saved, ${failedCount} failed.`);
        if (createdClassId) {
          console.warn(`[ImportSave] Rolling back newly created class ${createdClassId} to prevent orphaned incomplete class...`);
          await deleteClass(createdClassId);
          console.warn('[ImportSave] Class rollback completed successfully.');
          createdClassId = undefined;
        }
        const firstErr = Object.values(failures)[0];
        setSaving(false);
        setRowErrors(failures);
        setSaveMessage({ tone: 'error', text: `Import failed: ${firstErr}. The newly created class was rolled back.` });
        return;
      }

      console.log(`[ImportSave] ALL ${savedKeys.length} STUDENTS SAVED SUCCESSFULLY! Finishing import.`);
      setSaving(false);
      onImported(savedKeys.length, createdClassId);
    } catch (err: any) {
      console.error('[ImportSave] Critical exception during import save:', err);
      if (createdClassId) {
        try {
          console.warn(`[ImportSave] Rolling back newly created class ${createdClassId}...`);
          await deleteClass(createdClassId);
          console.warn('[ImportSave] Class rollback completed successfully.');
        } catch (rollbackErr) {
          console.error('[ImportSave] Failed to rollback class:', rollbackErr);
        }
      }
      setSaving(false);
      setSaveMessage({ tone: 'error', text: handleError(err, t('errors.generic')) });
    }
  };

  /* -------------------- render helpers -------------------- */

  const cellClass = (error: string | undefined, raw: string, flagged: boolean) => {
    const showError = !!error && (submitted || raw.trim() !== '');
    return cx(
      inputBase,
      showError && 'border-red-400 bg-fail-50',
      !showError && flagged && 'border-amber-400 bg-amber-50',
    );
  };

  const markCell = (row: DraftRow, subjectId: string, v: RowValidation) => {
    const subject = subjects.find((s) => s.id === subjectId);
    const rawVal = row.marks[subjectId] ?? '';
    const isFlagged = row.review.marks[subjectId] === true;

    // Find cell box if present
    const match = draft.mapping.matches.find((m) => m.subjectId === subjectId);
    const cellObj = match ? row.cells[match.columnIndex] : undefined;

    return (
      <td key={subjectId} className="px-1.5 py-2">
        <div className="flex items-center gap-1">
          <input
            aria-label={`${row.name || '—'} – ${subject?.name ?? ''}`}
            inputMode="decimal"
            autoComplete="off"
            maxLength={6}
            className={cx(cellClass(v.errors.marks[subjectId], rawVal, isFlagged), 'w-14 text-center')}
            value={row.absent ? '' : rawVal}
            disabled={row.absent}
            aria-invalid={submitted && v.errors.marks[subjectId] ? true : undefined}
            title={isFlagged && !row.absent ? t('photoImport.needsReview') : undefined}
            onChange={(e) =>
              updateRow(row.key, (r) => ({
                ...r,
                marks: { ...r.marks, [subjectId]: e.target.value },
                review: { ...r.review, marks: { ...r.review.marks, [subjectId]: false } },
              }))
            }
          />
          {cellObj?.box && (
            <button
              type="button"
              onClick={() =>
                setCropTarget({
                  box: cellObj.box,
                  title: `${row.name || `Roll ${row.roll}`} — ${subject?.name ?? ''}`,
                  detectedValue: cellObj.value ?? (cellObj.status === 'absent' ? 'AB' : cellObj.status),
                })
              }
              className="text-slate-400 hover:text-brand-700 p-0.5 rounded"
              title={t('photoImport.viewSourceArea')}
            >
              <SearchIcon className="size-3.5" />
            </button>
          )}
        </div>
      </td>
    );
  };

  const renderRow = (row: DraftRow) => {
    const v = validations.get(row.key)!;
    const res = evaluateRow(row, detail);
    const mismatches = findTotalMismatches(row, detail);
    const flagged =
      row.review.category ||
      row.review.roll ||
      row.review.name ||
      (!row.absent && Object.values(row.review.marks).some(Boolean)) ||
      v.duplicate !== null;

    const messages: { tone: 'warn' | 'error'; text: string }[] = [];
    if (row.rollAssigned && row.review.roll) messages.push({ tone: 'warn', text: t('photoImport.rollAssigned') });
    for (const m of mismatches) {
      messages.push({
        tone: 'warn',
        text: t(m.kind === 'grand' ? 'photoImport.importedTotalMismatch' : 'photoImport.importedQuranHifzMismatch', {
          imported: formatMark(m.imported),
          calculated: formatMark(m.calculated),
        }),
      });
    }
    if (submitted) {
      const e = v.errors;
      for (const text of [e.category, e.roll, e.name, ...Object.values(e.marks)]) if (text) messages.push({ tone: 'error', text });
    }
    if (rowErrors[row.key]) messages.push({ tone: 'error', text: rowErrors[row.key] });

    const extraCols = subjects.length + (withQH ? 1 : 0) + 6;
    const hasNotes = v.duplicate !== null || messages.length > 0;
    const categoryLabel = (c: StudentCategory) => (c === 'boys' ? t('student.boys') : t('student.girls'));

    return (
      <Fragment key={row.key}>
        <tr id={`import-row-${row.key}`} className={cx('align-middle', flagged ? 'bg-amber-50/30' : 'bg-white')}>
          <td className="px-2 py-2 text-center">
            {flagged ? (
              <span className="inline-flex items-center gap-1 text-amber-700" title={t('photoImport.needsReview')}>
                <WarnIcon className="size-4" />
              </span>
            ) : (
              <span className="inline-flex items-center text-pass-700" title={t('photoImport.highConfidence')}>
                <CheckIcon className="size-4" />
              </span>
            )}
          </td>
          <td className="px-1.5 py-2">
            <input
              aria-label={t('student.rollNumber')}
              inputMode="numeric"
              maxLength={5}
              autoComplete="off"
              className={cx(cellClass(v.errors.roll, row.roll, row.review.roll), 'w-14 text-center')}
              value={row.roll}
              onChange={(e) =>
                updateRow(row.key, (r) => ({ ...r, roll: e.target.value, rollAssigned: false, review: { ...r.review, roll: false } }))
              }
            />
          </td>
          <td className="px-1.5 py-2">
            <input
              aria-label={t('student.name')}
              autoComplete="off"
              maxLength={150}
              className={cx(cellClass(v.errors.name, row.name, row.review.name), 'min-w-[11rem]')}
              value={row.name}
              onChange={(e) => updateRow(row.key, (r) => ({ ...r, name: e.target.value, review: { ...r.review, name: false } }))}
            />
          </td>
          <td className="px-1.5 py-2">
            <select
              aria-label={t('student.categoryLabel')}
              className={cx(cellClass(v.errors.category, row.category, row.review.category), 'w-24 !px-1')}
              value={row.category}
              onChange={(e) =>
                updateRow(row.key, (r) => ({
                  ...r,
                  category: e.target.value as GroupKey,
                  review: { ...r.review, category: false },
                }))
              }
            >
              <option value="">{t('photoImport.selectCategory')}</option>
              <option value="boys">{categoryLabel('boys')}</option>
              <option value="girls">{categoryLabel('girls')}</option>
            </select>
          </td>
          <td className="px-2 py-2 text-center">
            <input
              type="checkbox"
              className="size-5 accent-brand-700"
              aria-label={t('photoImport.colAbsentTitle')}
              title={t('photoImport.colAbsentTitle')}
              checked={row.absent}
              onChange={(e) => updateRow(row.key, (r) => ({ ...r, absent: e.target.checked }))}
            />
          </td>
          {config.normalSubjects.map((s) => markCell(row, s.id, v))}
          {withQH && config.quranSubject && config.hifzSubject && (
            <>
              {markCell(row, config.quranSubject.id, v)}
              {markCell(row, config.hifzSubject.id, v)}
              <td className="px-2 py-2 text-center font-bold tabular-nums text-brand-900">{row.absent ? '—' : formatMark(res.quranHifzTotal)}</td>
            </>
          )}
          <td className="px-2 py-2 text-center font-bold tabular-nums text-slate-900">
            {row.absent ? '—' : res.status === 'complete' ? formatMark(res.grandTotal) : '—'}
          </td>
          <td className="px-2 py-2 text-center">
            {row.absent ? (
              <ResultBadge result={{ status: 'absent', result: null }} />
            ) : res.status === 'complete' ? (
              <ResultBadge result={res} />
            ) : (
              <span className="text-slate-400">—</span>
            )}
          </td>
          <td className="px-2 py-2 text-right">
            <div className="flex items-center justify-end gap-1">
              {row.box && (
                <button
                  type="button"
                  onClick={() =>
                    setCropTarget({
                      box: row.box,
                      title: `Student Row: ${row.name || `Roll ${row.roll}`}`,
                      detectedValue: row.name,
                    })
                  }
                  className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700"
                  title={t('photoImport.viewSourceArea')}
                >
                  <SearchIcon className="size-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => deleteRow(row.key)}
                className="rounded p-1.5 text-fail-700 hover:bg-fail-50"
                title={t('photoImport.deleteStudent')}
              >
                <TrashIcon className="size-4" />
              </button>
            </div>
          </td>
        </tr>
        {hasNotes && (
          <tr className="bg-amber-50/30">
            <td />
            <td colSpan={extraCols} className="px-2 pb-2 text-xs">
              {v.duplicate && (
                <div className="mb-1 flex flex-wrap items-center gap-2 text-amber-800">
                  <WarnIcon className="size-4 shrink-0" />
                  <span className="font-semibold">{t('photoImport.possibleDuplicate')}</span>
                  <span>{t('photoImport.possibleDuplicateDetail', { roll: v.duplicate.rollNumber, name: v.duplicate.studentName })}</span>
                  <select
                    aria-label={t('photoImport.possibleDuplicate')}
                    className={cx(
                      'field-input !w-auto !px-2 !py-1 !text-xs',
                      row.duplicateChoice === 'undecided' && submitted && 'border-red-400 bg-fail-50',
                    )}
                    value={row.duplicateChoice}
                    onChange={(e) => updateRow(row.key, (r) => ({ ...r, duplicateChoice: e.target.value as DuplicateChoice }))}
                  >
                    <option value="undecided">{t('photoImport.chooseOption')}</option>
                    <option value="update">{t('photoImport.updateExisting')}</option>
                    <option value="create">{t('photoImport.createNew')}</option>
                  </select>
                </div>
              )}
              {messages.map((m, i) => (
                <p key={i} className={cx('flex items-start gap-1.5', m.tone === 'error' ? 'font-medium text-fail-700' : 'text-amber-800')}>
                  <WarnIcon className="mt-px size-3.5 shrink-0" />
                  {m.text}
                </p>
              ))}
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  const renderGroup = (cat: GroupKey) => {
    const rows = draft.rows.filter((r) => r.category === cat);
    if (rows.length === 0 && cat === '') return null;
    const title = cat === 'boys' ? t('student.boys') : cat === 'girls' ? t('student.girls') : t('photoImport.selectCategory');
    const headTone =
      cat === 'boys'
        ? 'bg-slate-100 text-slate-800'
        : cat === 'girls'
          ? 'bg-pink-50 text-pink-900'
          : 'bg-amber-50 text-amber-900';

    return (
      <section key={cat || 'unknown'} className="card overflow-hidden" aria-label={title}>
        <div className={cx('flex items-center justify-between px-4 py-2 text-xs font-bold uppercase tracking-wider', headTone)}>
          <span>
            {title.toUpperCase()} ({rows.length})
          </span>
          {cat !== '' && (
            <Button variant="secondary" size="sm" icon={<PlusIcon className="size-4" />} onClick={() => addRow(cat)} className="normal-case">
              {t('photoImport.addStudent')}
            </Button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-y border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
              <tr>
                <th scope="col" className="w-8 px-2 py-2" />
                <th scope="col" className="px-2 py-2 text-center">{t('student.rollNumber')}</th>
                <th scope="col" className="px-2 py-2">{t('student.name')}</th>
                <th scope="col" className="px-2 py-2">{t('student.categoryLabel')}</th>
                <th scope="col" className="px-2 py-2 text-center" title={t('photoImport.colAbsentTitle')}>{t('photoImport.colAbsent')}</th>
                {config.normalSubjects.map((s) => (
                  <th key={s.id} scope="col" className="px-2 py-2 text-center">{s.name}</th>
                ))}
                {withQH && (
                  <>
                    <th scope="col" className="bg-brand-50/60 px-2 py-2 text-center">{t('student.quranLabel')}</th>
                    <th scope="col" className="bg-brand-50/60 px-2 py-2 text-center">{t('student.hifzLabel')}</th>
                    <th scope="col" className="bg-brand-100/70 px-2 py-2 text-center">{t('student.quranHifzLabel')}</th>
                  </>
                )}
                <th scope="col" className="px-2 py-2 text-center">{t('results.grandTotal')}</th>
                <th scope="col" className="px-2 py-2 text-center">{t('results.result')}</th>
                <th scope="col" className="px-2 py-2 text-right"><span className="sr-only">{t('photoImport.colActions')}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">{rows.map(renderRow)}</tbody>
          </table>
        </div>
      </section>
    );
  };

  /* -------------------- header info editing -------------------- */

  const setHeader = (patch: Partial<ImportDraft['header']>) => onChange((d) => ({ ...d, header: { ...d.header, ...patch } }));

  const headerField = (
    id: string,
    label: string,
    key: keyof ImportDraft['header'],
    confKey?: string,
    inputMode?: 'numeric',
  ) => {
    const confidence = confKey ? draft.header.confidence[confKey] : undefined;
    const rawVal = draft.header[key];
    const strVal = typeof rawVal === 'string' ? rawVal : '';
    return (
      <div key={id}>
        <div className="mb-1 flex items-center justify-between">
          <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {label}
          </label>
          <ConfidenceBadge confidence={confidence} />
        </div>
        <input
          id={id}
          className="field-input !py-2 !text-sm"
          inputMode={inputMode}
          value={strVal}
          onChange={(e) => setHeader({ [key]: e.target.value })}
        />
      </div>
    );
  };

  const boysCount = draft.rows.filter((r) => r.category === 'boys').length;
  const girlsCount = draft.rows.filter((r) => r.category === 'girls').length;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">
          {isHomeMode ? t('photoImport.modeHomeTitle') : t('photoImport.reviewImportedData')}
        </h2>
        <p className="mt-1 text-sm text-slate-600">{t('photoImport.reviewIntro')}</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.4fr)] lg:items-start">
        {/* Photo Preview Sidepanel (temporary RAM storage only) */}
        <aside className="card p-3 lg:sticky lg:top-4">
          <p className="text-sm font-semibold text-slate-800">{t('photoImport.originalPhoto')}</p>
          <p className="mb-2 text-xs text-slate-500">{t('photoImport.photoTemporary')}</p>
          <a
            href={image.previewUrl}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
          >
            <img
              src={image.previewUrl}
              alt={t('photoImport.originalPhoto')}
              className="max-h-[50vh] w-full object-contain lg:max-h-[75vh]"
              id="import-photo-preview"
            />
          </a>
        </aside>

        <div className="min-w-0 space-y-5">
          {/* Metadata Review Card (Application Fields Only) */}
          <div className="card p-4 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
              1. Class Information
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {headerField('import-institution', t('photoImport.headerInstitution'), 'institutionName', 'institutionName')}
              {headerField('import-location', t('photoImport.headerLocation'), 'institutionLocation', 'location')}
              {headerField('import-range', t('photoImport.headerRange'), 'rangeName', 'range')}
              {headerField('import-class', t('photoImport.headerClass'), 'className', 'className')}

              <div key="import-exam">
                <div className="mb-1 flex items-center justify-between">
                  <label htmlFor="import-exam-select" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {t('photoImport.headerExam')}
                  </label>
                  <ConfidenceBadge confidence={draft.header.confidence.examName} />
                </div>
                <select
                  id="import-exam-select"
                  className="field-input !py-2 !text-sm"
                  value={
                    [
                      'Half-Yearly Examination',
                      'Annual Examination',
                      'Quarterly Examination',
                      'Monthly Examination',
                      'Model Examination',
                    ].includes(draft.header.examName)
                      ? draft.header.examName
                      : draft.header.examName
                        ? 'Custom'
                        : ''
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'Custom') {
                      setHeader({ examName: draft.header.examName || '' });
                    } else {
                      setHeader({ examName: val });
                    }
                  }}
                >
                  <option value="">-- {t('photoImport.selectExamPlaceholder')} --</option>
                  <option value="Half-Yearly Examination">{t('exam.halfYearly')}</option>
                  <option value="Annual Examination">{t('exam.annual')}</option>
                  <option value="Quarterly Examination">{t('exam.quarterly')}</option>
                  <option value="Monthly Examination">{t('exam.monthly')}</option>
                  <option value="Model Examination">{t('exam.model')}</option>
                  <option value="Custom">{t('exam.custom')}</option>
                </select>
                {(![
                  'Half-Yearly Examination',
                  'Annual Examination',
                  'Quarterly Examination',
                  'Monthly Examination',
                  'Model Examination',
                ].includes(draft.header.examName) &&
                  draft.header.examName !== '') ||
                draft.header.examName === 'Custom' ? (
                  <input
                    type="text"
                    className="field-input mt-1.5 !py-1.5 !text-sm"
                    placeholder={t('class.customExamPlaceholder')}
                    value={draft.header.examName}
                    onChange={(e) => setHeader({ examName: e.target.value })}
                  />
                ) : null}
                {!draft.header.examName && (
                  <p className="mt-1 text-[11px] text-amber-700">{t('photoImport.unconfidentExamHint')}</p>
                )}
              </div>

              {headerField('import-year', t('photoImport.headerYear'), 'examYear', 'examYear', 'numeric')}
            </div>
          </div>

          {/* Pre-Save Validation Summary Block */}
          <div className={cx('card p-4 border-2 transition', invalidCount === 0 ? 'border-emerald-200 bg-emerald-50/20' : 'border-amber-300 bg-amber-50/20')}>
            <h3 className="text-sm font-bold text-slate-900 mb-2 flex items-center justify-between">
              <span>Import Validation Summary</span>
              {invalidCount === 0 ? (
                <span className="text-xs font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <CheckIcon className="size-3.5" /> Ready to save
                </span>
              ) : (
                <span className="text-xs font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <WarnIcon className="size-3.5" /> {invalidCount} row(s) need attention
                </span>
              )}
            </h3>

            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 text-slate-700">
              <div><span className="font-semibold">Students:</span> {draft.rows.length} ({boysCount} Boys, {girlsCount} Girls)</div>
              <div><span className="font-semibold">Mapped Subjects:</span> {subjects.length}</div>
              <div><span className="font-semibold">Class Name:</span> {draft.header.className || '⚠ Missing'}</div>
              <div><span className="font-semibold">Exam & Year:</span> {draft.header.examName ? `${draft.header.examName} (${draft.header.examYear})` : '⚠ Missing'}</div>
            </div>
          </div>

          {/* Home Mode Save Options */}
          {isHomeMode && (
            <div className="card p-4 space-y-4 border-2 border-brand-200 bg-brand-50/20">
              <h3 className="text-sm font-bold text-slate-900">2. Select Import Action</h3>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className={cx('card p-3 cursor-pointer border-2 transition', saveOption === 'create' ? 'border-brand-600 bg-brand-50/50' : 'border-slate-200')}>
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="saveOption"
                      checked={saveOption === 'create'}
                      onChange={() => setSaveOption('create')}
                      className="size-4 accent-brand-700"
                    />
                    <span className="font-bold text-slate-900">{t('photoImport.createNewClassOption')}</span>
                  </div>
                </label>

                {existingClasses.length > 0 && (
                  <label className={cx('card p-3 cursor-pointer border-2 transition', saveOption === 'existing' ? 'border-brand-600 bg-brand-50/50' : 'border-slate-200')}>
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="saveOption"
                        checked={saveOption === 'existing'}
                        onChange={() => setSaveOption('existing')}
                        className="size-4 accent-brand-700"
                      />
                      <span className="font-bold text-slate-900">{t('photoImport.importIntoExistingOption')}</span>
                    </div>
                  </label>
                )}
              </div>

              {saveOption === 'existing' && (
                <div className="space-y-2 pt-2">
                  <label className="block text-xs font-semibold text-slate-700">{t('photoImport.selectTargetClass')}</label>
                  <select
                    className="field-input"
                    value={selectedTargetClassId}
                    onChange={(e) => {
                      setSelectedTargetClassId(e.target.value);
                      if (e.target.value && onSelectExistingClass) {
                        void onSelectExistingClass(e.target.value);
                      }
                    }}
                  >
                    <option value="">{t('photoImport.chooseTargetClassPlaceholder')}</option>
                    {existingClasses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.className} {c.institutionName ? `— ${c.institutionName}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Counts & Analysis Warnings */}
          <Alert tone={missing > 0 ? 'warning' : 'info'}>
            <span className="font-semibold">{t('photoImport.studentsDetected', { count: draft.rows.length })}</span>
            {missing > 0 && <> {t('photoImport.studentsMissing', { missing })}</>}
          </Alert>

          {draft.warnings.length > 0 && (
            <Alert tone="info" title={t('photoImport.notesFromAnalysis')}>
              <ul className="list-disc space-y-0.5 pl-5">
                {draft.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </Alert>
          )}

          {/* Detected Subject Column Mapping & Editable Subject Names (Section 9, 10, 11 & 13) */}
          {(() => {
            const subjectMatches = draft.mapping.matches.filter((m) => {
              const col = draft.columns.find((c) => c.index === m.columnIndex);
              return col && (col.kind === 'subject' || col.kind === 'quran' || col.kind === 'hifz');
            });
            if (subjectMatches.length === 0) return null;
            return (
              <div className="card p-4 space-y-3" id="import-column-mapping">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{t('photoImport.detectedSubjectsTitle')}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {isHomeMode && saveOption === 'create'
                      ? 'Detected subject columns from photo. Edit final subject names before saving.'
                      : 'Map detected photo columns to existing class subjects.'}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {subjectMatches.map((m) => {
                    const matchedSubject = subjects.find((s) => s.id === m.subjectId);
                    const isCreatingNew = isHomeMode && saveOption === 'create';
                    return (
                      <div
                        key={m.columnIndex}
                        className={cx(
                          'rounded-lg border p-3 space-y-2',
                          m.subjectId && !m.needsReview ? 'border-slate-200 bg-slate-50' : 'border-amber-300 bg-amber-50',
                        )}
                      >
                        <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                          <span className="flex items-center gap-1 truncate" title={m.header}>
                            {m.subjectId && !m.needsReview ? (
                              <CheckIcon className="size-3.5 text-pass-700 shrink-0" />
                            ) : (
                              <WarnIcon className="size-3.5 text-amber-700 shrink-0" />
                            )}
                            <span>Detected: "{m.header}"</span>
                          </span>
                        </div>

                        {/* Mode A: Create New Class — Editable Subject Name Input (Section 11A) */}
                        {isCreatingNew && m.subjectId && matchedSubject && (
                          <div>
                            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                              Final Subject Name
                            </label>
                            <input
                              type="text"
                              aria-label={`Subject name for ${m.header}`}
                              className="field-input !py-1.5 !px-2.5 !text-xs font-medium"
                              value={matchedSubject.name}
                              onChange={(e) => {
                                const newName = e.target.value;
                                onChange((d) => updateSubjectName(d, detail, m.subjectId!, newName).draft);
                              }}
                            />
                          </div>
                        )}

                        {/* Mode B: Import into Existing Class — Mapping Dropdown (Section 11B) */}
                        {!isCreatingNew && (
                          <div>
                            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                              Map to Existing Subject
                            </label>
                            <select
                              aria-label={m.header}
                              className="field-input !py-1.5 !text-xs"
                              value={m.subjectId ?? ''}
                              onChange={(e) => onChange((d) => remapColumn(d, detail, m.columnIndex, e.target.value || null))}
                            >
                              <option value="">{t('photoImport.columnIgnore')}</option>
                              {subjects.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          <p className="flex items-start gap-2 text-xs text-slate-600">
            <WarnIcon className="mt-px size-4 shrink-0 text-amber-600" />
            {t('photoImport.legend')}
          </p>

          {/* Student Table Groups */}
          {draft.rows.length === 0 && <Alert tone="info">{t('photoImport.noRowsLeft')}</Alert>}
          {renderGroup('boys')}
          {renderGroup('girls')}
          {renderGroup('')}
        </div>
      </div>

      {saveMessage && <Alert tone={saveMessage.tone}>{saveMessage.text}</Alert>}

      {/* Sticky Bottom Actions */}
      <div className="sticky bottom-0 -mx-4 flex flex-col-reverse gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:flex-row sm:justify-end sm:rounded-b-xl z-20">
        <Button variant="secondary" size="lg" icon={<RefreshIcon className="size-5" />} onClick={onTryAgain} disabled={saving} id="import-try-again">
          {t('photoImport.tryAgain')}
        </Button>
        <Button
          size="lg"
          icon={<CheckIcon />}
          loading={saving}
          disabled={draft.rows.length === 0}
          onClick={() => void handleConfirm()}
          id="import-confirm-save"
        >
          {saving
            ? t('photoImport.savingImport')
            : isHomeMode && saveOption === 'create'
              ? t('photoImport.createNewClassOption')
              : t('photoImport.confirmAndSave')}
        </Button>
      </div>

      {/* Interactive Image Cell Verification Modal (Section 16) */}
      {cropTarget && (
        <SourceCropModal
          image={image}
          box={cropTarget.box}
          title={cropTarget.title}
          detectedValue={cropTarget.detectedValue}
          onClose={() => setCropTarget(null)}
        />
      )}
    </div>
  );
}
