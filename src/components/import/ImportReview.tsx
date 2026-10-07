import { Fragment, useMemo, useState } from 'react';
import type { ClassDetail, ClassListItem, StudentCategory } from '../../types';
import { useTranslation } from '../../i18n/context';
import {
  buildPhotoSaveBatch,
  evaluateRow,
  findTotalMismatches,
  importableSubjects,
  newBlankRow,
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
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { CheckIcon, PlusIcon, RefreshIcon, SearchIcon, TrashIcon, WarnIcon, XIcon } from '../ui/Icons';
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
  const [savingProgressText, setSavingProgressText] = useState<string>('');
  const [saveMessage, setSaveMessage] = useState<{ tone: 'error' | 'warning'; text: string } | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  // Lightbox modal state for photo preview on mobile
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // Row deletion confirmation state
  const [toDeleteRow, setToDeleteRow] = useState<DraftRow | null>(null);

  // Success state after saving
  const [savedSuccessData, setSavedSuccessData] = useState<{
    count: number;
    createdClassId?: string;
    boys: number;
    girls: number;
    subjects: number;
  } | null>(null);

  // Crop Modal state for Image-Cell Verification
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

  const boysCount = draft.rows.filter((r) => r.category === 'boys').length;
  const girlsCount = draft.rows.filter((r) => r.category === 'girls').length;

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
      if (first) {
        const el = document.getElementById(`import-card-${first.key}`) || document.getElementById(`import-row-${first.key}`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
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

        setSavingProgressText(t('photoImport.savingStepCreatingClass'));

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

        setSavingProgressText(t('photoImport.savingStepCreatingSubjects'));
        console.log('[ImportSave] STEP 2: Fetching created class detail from database...');
        const realDetail = await getClassDetail(result.classId, result.examId);
        if (!realDetail) {
          throw new Error('Could not fetch newly created class detail from database.');
        }

        console.log('[ImportSave] STEP 3: Mapping temporary subject IDs to real database UUIDs...');
        targetRows = remapRowsToSavedDetail(draft.rows, detail, realDetail);
        activeClassDetail = realDetail;

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

      setSavingProgressText(t('photoImport.savingStepSavingStudents'));
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
          console.log(`[ImportSave]   Saving student ${i + 1}/${batch.length}: ${studentDesc}...`);
          const savedStudentId = await saveStudent(item.input);
          console.log(`[ImportSave]     -> Saved: studentId = "${savedStudentId}"`);
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
          console.warn(`[ImportSave] Rolling back newly created class ${createdClassId}...`);
          await deleteClass(createdClassId);
          createdClassId = undefined;
        }
        const firstErr = Object.values(failures)[0];
        setSaving(false);
        setRowErrors(failures);
        setSaveMessage({ tone: 'error', text: `Import failed: ${firstErr}. The newly created class was rolled back.` });
        return;
      }

      setSavingProgressText(t('photoImport.savingStepFinishing'));
      console.log(`[ImportSave] ALL ${savedKeys.length} STUDENTS SAVED SUCCESSFULLY!`);
      setSaving(false);
      setSavedSuccessData({
        count: savedKeys.length,
        createdClassId,
        boys: boysCount,
        girls: girlsCount,
        subjects: subjects.length,
      });
    } catch (err: any) {
      console.error('[ImportSave] Critical exception during import save:', err);
      if (createdClassId) {
        try {
          await deleteClass(createdClassId);
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
            className={cx(cellClass(v.errors.marks[subjectId], rawVal, isFlagged), 'w-14 text-center min-h-[36px]')}
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
              className="text-slate-400 hover:text-brand-700 p-1 rounded min-h-[36px] min-w-[28px] flex items-center justify-center"
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
                  className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700 min-h-[36px] min-w-[36px] flex items-center justify-center"
                  title={t('photoImport.viewSourceArea')}
                >
                  <SearchIcon className="size-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setToDeleteRow(row)}
                className="rounded p-1.5 text-fail-700 hover:bg-fail-50 min-h-[36px] min-w-[36px] flex items-center justify-center"
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

  const renderMobileStudentCard = (row: DraftRow) => {
    const v = validations.get(row.key)!;
    const res = evaluateRow(row, detail);
    const flagged =
      row.review.category ||
      row.review.roll ||
      row.review.name ||
      (!row.absent && Object.values(row.review.marks).some(Boolean)) ||
      v.duplicate !== null;

    return (
      <div
        key={row.key}
        id={`import-card-${row.key}`}
        className={cx(
          'card p-4 space-y-3.5 border-2 transition',
          flagged ? 'border-amber-300 bg-amber-50/30' : 'border-slate-200 bg-white',
          v.errors.roll || v.errors.name || v.errors.category ? 'border-red-300' : '',
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
          <div className="flex items-center gap-2 min-w-0">
            {flagged ? (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                <WarnIcon className="size-3.5 shrink-0" /> {t('photoImport.needsReview')}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                <CheckIcon className="size-3.5 shrink-0" /> {t('photoImport.highConfidence')}
              </span>
            )}
            <span className="text-xs font-bold text-slate-700 uppercase truncate">
              {row.category === 'boys' ? t('student.boys') : row.category === 'girls' ? t('student.girls') : t('photoImport.selectCategory')} • Roll {row.roll || '?'}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {row.box && (
              <button
                type="button"
                onClick={() =>
                  setCropTarget({
                    box: row.box,
                    title: `Student: ${row.name || `Roll ${row.roll}`}`,
                    detectedValue: row.name,
                  })
                }
                className="p-2 text-slate-500 hover:text-brand-700 rounded-lg min-h-[40px] min-w-[40px] flex items-center justify-center"
                title={t('photoImport.viewSourceArea')}
              >
                <SearchIcon className="size-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setToDeleteRow(row)}
              className="p-2 text-fail-700 hover:bg-fail-50 rounded-lg min-h-[40px] min-w-[40px] flex items-center justify-center"
              title={t('photoImport.deleteStudent')}
            >
              <TrashIcon className="size-4" />
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
            {t('student.name')}
          </label>
          <input
            type="text"
            maxLength={150}
            autoComplete="off"
            className={cx(
              'field-input min-h-[44px] text-base font-semibold',
              submitted && v.errors.name && 'border-red-400 bg-fail-50',
            )}
            value={row.name}
            onChange={(e) =>
              updateRow(row.key, (r) => ({ ...r, name: e.target.value, review: { ...r.review, name: false } }))
            }
            placeholder={t('student.fullNamePlaceholder')}
          />
          {submitted && v.errors.name && <p className="mt-1 text-xs text-fail-700">{v.errors.name}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
              Category
            </label>
            <div className="flex items-center rounded-lg border border-slate-300 p-0.5 bg-slate-100 min-h-[44px]">
              <button
                type="button"
                onClick={() =>
                  updateRow(row.key, (r) => ({ ...r, category: 'boys', review: { ...r.review, category: false } }))
                }
                className={cx(
                  'flex-1 min-h-[38px] rounded-md text-xs font-bold transition-all',
                  row.category === 'boys' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-700 hover:text-slate-900',
                )}
              >
                {t('student.boys')}
              </button>
              <button
                type="button"
                onClick={() =>
                  updateRow(row.key, (r) => ({ ...r, category: 'girls', review: { ...r.review, category: false } }))
                }
                className={cx(
                  'flex-1 min-h-[38px] rounded-md text-xs font-bold transition-all',
                  row.category === 'girls' ? 'bg-pink-600 text-white shadow-xs' : 'text-slate-700 hover:text-slate-900',
                )}
              >
                {t('student.girls')}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
              {t('student.rollNumber')}
            </label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={5}
              className={cx(
                'field-input min-h-[44px] text-center text-base font-bold tabular-nums',
                submitted && v.errors.roll && 'border-red-400 bg-fail-50',
              )}
              value={row.roll}
              onChange={(e) =>
                updateRow(row.key, (r) => ({
                  ...r,
                  roll: e.target.value,
                  rollAssigned: false,
                  review: { ...r.review, roll: false },
                }))
              }
            />
            {submitted && v.errors.roll && <p className="mt-1 text-xs text-fail-700">{v.errors.roll}</p>}
          </div>
        </div>

        <label className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5 cursor-pointer">
          <input
            type="checkbox"
            className="size-5 accent-brand-700 rounded"
            checked={row.absent}
            onChange={(e) => updateRow(row.key, (r) => ({ ...r, absent: e.target.checked }))}
          />
          <span className="text-xs font-bold text-slate-800">{t('student.absentLabel')} (AB)</span>
        </label>

        {!row.absent && (
          <div className="space-y-2 pt-1 border-t border-slate-100">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t('student.marksLegend')}</p>
            <div className="grid grid-cols-2 gap-2.5">
              {config.normalSubjects.map((s) => {
                const rawVal = row.marks[s.id] ?? '';
                const err = v.errors.marks[s.id];
                const isFlaggedMark = row.review.marks[s.id] === true;
                return (
                  <div key={s.id} className="rounded-lg border border-slate-200 p-2 bg-slate-50/60">
                    <label className="block text-[11px] font-bold text-slate-700 truncate" title={s.name}>
                      {s.name}
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      maxLength={6}
                      className={cx(
                        'field-input mt-1 min-h-[44px] text-center font-bold text-base tabular-nums',
                        submitted && err && 'border-red-400 bg-fail-50',
                        !err && isFlaggedMark && 'border-amber-400 bg-amber-50',
                      )}
                      value={rawVal}
                      onChange={(e) =>
                        updateRow(row.key, (r) => ({
                          ...r,
                          marks: { ...r.marks, [s.id]: e.target.value },
                          review: { ...r.review, marks: { ...r.review.marks, [s.id]: false } },
                        }))
                      }
                      placeholder="0-100"
                    />
                  </div>
                );
              })}

              {withQH && config.quranSubject && config.hifzSubject && (
                <>
                  <div className="rounded-lg border border-brand-200 p-2 bg-brand-50/40">
                    <label className="block text-[11px] font-bold text-brand-900 truncate">
                      {t('student.quranLabel')}
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      maxLength={6}
                      className="field-input mt-1 min-h-[44px] text-center font-bold text-base tabular-nums"
                      value={row.marks[config.quranSubject.id] ?? ''}
                      onChange={(e) =>
                        updateRow(row.key, (r) => ({
                          ...r,
                          marks: { ...r.marks, [config.quranSubject!.id]: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div className="rounded-lg border border-brand-200 p-2 bg-brand-50/40">
                    <label className="block text-[11px] font-bold text-brand-900 truncate">
                      {t('student.hifzLabel')}
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      maxLength={6}
                      className="field-input mt-1 min-h-[44px] text-center font-bold text-base tabular-nums"
                      value={row.marks[config.hifzSubject.id] ?? ''}
                      onChange={(e) =>
                        updateRow(row.key, (r) => ({
                          ...r,
                          marks: { ...r.marks, [config.hifzSubject!.id]: e.target.value },
                        }))
                      }
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-slate-200 text-xs font-bold text-slate-800">
          {withQH && (
            <div>
              <span className="text-slate-500 font-normal">Quran+Hifz: </span>
              <span className="text-brand-900">{row.absent ? '—' : formatMark(res.quranHifzTotal)}</span>
            </div>
          )}
          <div>
            <span className="text-slate-500 font-normal">{t('results.grandTotal')}: </span>
            <span>{row.absent ? '—' : res.status === 'complete' ? formatMark(res.grandTotal) : '—'}</span>
          </div>
          <div>
            {row.absent ? (
              <ResultBadge result={{ status: 'absent', result: null }} />
            ) : res.status === 'complete' ? (
              <ResultBadge result={res} />
            ) : (
              <span className="text-slate-400">—</span>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderGroup = (cat: GroupKey) => {
    const rows = draft.rows.filter((r) => r.category === cat);
    if (rows.length === 0 && cat === '') return null;
    const title = cat === 'boys' ? t('student.boys') : cat === 'girls' ? t('student.girls') : t('photoImport.selectCategory');
    const addLabel = cat === 'boys' ? t('photoImport.addBoy') : cat === 'girls' ? t('photoImport.addGirl') : t('photoImport.addStudent');
    const headTone =
      cat === 'boys'
        ? 'bg-slate-100 text-slate-800 border-slate-200'
        : cat === 'girls'
          ? 'bg-pink-50 text-pink-900 border-pink-200'
          : 'bg-amber-50 text-amber-900 border-amber-200';

    return (
      <section key={cat || 'unknown'} className="space-y-3" aria-label={title}>
        <div className={cx('flex items-center justify-between px-4 py-2.5 rounded-xl border font-bold text-xs uppercase tracking-wider', headTone)}>
          <span>
            {title.toUpperCase()} ({rows.length})
          </span>
          {cat !== '' && (
            <Button
              variant="secondary"
              size="sm"
              icon={<PlusIcon className="size-4" />}
              onClick={() => addRow(cat)}
              className="normal-case font-bold min-h-[36px]"
            >
              {addLabel}
            </Button>
          )}
        </div>

        {/* Mobile View: Cards Grid */}
        <div className="space-y-3 lg:hidden">
          {rows.map((row) => renderMobileStudentCard(row))}
          {cat !== '' && (
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              icon={<PlusIcon className="size-5" />}
              onClick={() => addRow(cat)}
              className="min-h-12 text-sm font-bold justify-center border-dashed border-2"
            >
              + {addLabel}
            </Button>
          )}
        </div>

        {/* Desktop View: Table */}
        <div className="hidden lg:block card overflow-hidden">
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
          className="field-input !py-2 !text-sm min-h-[44px]"
          inputMode={inputMode}
          value={strVal}
          onChange={(e) => setHeader({ [key]: e.target.value })}
        />
      </div>
    );
  };

  if (savedSuccessData) {
    return (
      <div className="card p-6 text-center space-y-5 max-w-md mx-auto my-8 animate-fade-in border-2 border-emerald-300 bg-emerald-50/40 shadow-lg">
        <div className="size-16 rounded-full bg-emerald-500 text-white flex items-center justify-center mx-auto text-3xl shadow-md font-bold">
          ✓
        </div>
        <div className="space-y-1">
          <h2 className="text-2xl font-extrabold text-slate-900">{t('photoImport.importSuccessTitle')}</h2>
          <p className="text-base font-bold text-emerald-800">
            {t('photoImport.importSuccessCount', { count: savedSuccessData.count })}
          </p>
          <p className="text-xs text-slate-600">
            {t('photoImport.importSuccessBreakdown', {
              boys: savedSuccessData.boys,
              girls: savedSuccessData.girls,
              subjects: savedSuccessData.subjects,
            })}
          </p>
        </div>

        <div className="flex flex-col gap-2.5 pt-2">
          <Button
            size="lg"
            variant="primary"
            onClick={() => {
              onImported(savedSuccessData.count, savedSuccessData.createdClassId);
            }}
            className="min-h-12 text-base font-bold justify-center shadow-md bg-brand-700 hover:bg-brand-800 text-white"
          >
            {t('photoImport.openCreatedClass')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Top Mobile Stepper Header (Requirement #13) */}
      <div className="flex items-center justify-between border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-600 rounded-xl overflow-x-auto shadow-xs gap-1.5">
        <span className="flex items-center gap-1.5 text-brand-800 font-bold whitespace-nowrap">
          <span className="flex size-5 items-center justify-center rounded-full bg-brand-800 text-[10px] text-white">1</span>
          {t('photoImport.stepPhoto')}
        </span>
        <span className="text-slate-300">›</span>
        <span className="flex items-center gap-1.5 text-brand-800 font-bold whitespace-nowrap">
          <span className="flex size-5 items-center justify-center rounded-full bg-brand-800 text-[10px] text-white">2</span>
          {t('photoImport.stepDetails')}
        </span>
        <span className="text-slate-300">›</span>
        <span className="flex items-center gap-1.5 text-brand-800 font-bold whitespace-nowrap">
          <span className="flex size-5 items-center justify-center rounded-full bg-brand-800 text-[10px] text-white">3</span>
          {t('photoImport.stepSubjects')}
        </span>
        <span className="text-slate-300">›</span>
        <span className="flex items-center gap-1.5 text-brand-800 font-bold whitespace-nowrap">
          <span className="flex size-5 items-center justify-center rounded-full bg-brand-800 text-[10px] text-white">4</span>
          {t('photoImport.stepStudents')}
        </span>
        <span className="text-slate-300">›</span>
        <span className="flex items-center gap-1.5 text-slate-500 font-semibold whitespace-nowrap">
          <span className="flex size-5 items-center justify-center rounded-full bg-slate-200 text-[10px] text-slate-700">5</span>
          {t('photoImport.stepSave')}
        </span>
      </div>

      {/* Top Review Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">
          {isHomeMode ? t('photoImport.modeHomeTitle') : t('photoImport.reviewImportedData')}
        </h2>
        <p className="mt-1 text-sm text-slate-600">{t('photoImport.reviewIntro')}</p>
      </div>

      {/* Mobile Compact Summary Bar (Requirement #37) */}
      <div className="card p-3 bg-brand-50/50 border-brand-200 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-3 font-semibold text-slate-800">
          <span>👥 {draft.rows.length} {t('dashboard.students')} ({boysCount} {t('student.boys')}, {girlsCount} {t('student.girls')})</span>
          <span>📚 {subjects.length} {t('dashboard.subjects')}</span>
        </div>
        {withQH && (
          <span className="rounded-full bg-brand-100 px-2.5 py-0.5 font-bold text-brand-900 text-[11px]">
            {t('class.quranHifzLabel')}
          </span>
        )}
      </div>

      {/* Collapsible Photo Preview on Mobile (Requirement #14) */}
      <div className="lg:hidden card p-3 flex items-center justify-between gap-3 bg-white shadow-xs">
        <div className="flex items-center gap-3 min-w-0">
          <img
            src={image.previewUrl}
            alt={t('photoImport.originalPhoto')}
            className="size-12 rounded-lg object-cover border border-slate-200 shrink-0 bg-slate-900"
          />
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-900 truncate">{t('photoImport.originalPhoto')}</p>
            <p className="text-[11px] text-slate-500 truncate">{t('photoImport.photoTemporary')}</p>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setLightboxOpen(true)}
          className="min-h-[40px] whitespace-nowrap shrink-0 font-bold"
        >
          🔍 {t('photoImport.viewFullImage')}
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.4fr)] lg:items-start">
        {/* Desktop Sticky Photo Preview Sidepanel */}
        <aside className="hidden lg:block card p-3 sticky top-4">
          <p className="text-sm font-semibold text-slate-800">{t('photoImport.originalPhoto')}</p>
          <p className="mb-2 text-xs text-slate-500">{t('photoImport.photoTemporary')}</p>
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="block w-full text-left overflow-hidden rounded-lg border border-slate-200 bg-slate-100 focus:outline-none"
          >
            <img
              src={image.previewUrl}
              alt={t('photoImport.originalPhoto')}
              className="max-h-[70vh] w-full object-contain"
              id="import-photo-preview-desktop"
            />
          </button>
        </aside>

        <div className="min-w-0 space-y-5">
          {/* Metadata Review Card (Requirement #15) */}
          <div className="card p-4 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
              1. Class Information
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                  className="field-input !py-2 !text-sm min-h-[44px]"
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
                    className="field-input mt-1.5 !py-1.5 !text-sm min-h-[44px]"
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
                    className="field-input min-h-[44px]"
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

          {/* Analysis Warnings */}
          {draft.warnings.length > 0 && (
            <Alert tone="info" title={t('photoImport.notesFromAnalysis')}>
              <ul className="list-disc space-y-0.5 pl-5 text-xs">
                {draft.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </Alert>
          )}

          {/* Subject Review Cards (Requirement #17 & #18) */}
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
                      ? 'Edit final subject names before saving.'
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
                          'rounded-xl border p-3.5 space-y-2.5 shadow-xs',
                          m.subjectId && !m.needsReview ? 'border-slate-200 bg-slate-50/70' : 'border-amber-300 bg-amber-50/70',
                        )}
                      >
                        <div className="text-xs font-bold text-slate-700">
                          <span className="block text-[10px] text-slate-400 uppercase tracking-wider">{t('photoImport.detectedFromPhoto')}</span>
                          <span className="flex items-center gap-1 mt-0.5 truncate" title={m.header}>
                            {m.subjectId && !m.needsReview ? (
                              <CheckIcon className="size-3.5 text-pass-700 shrink-0" />
                            ) : (
                              <WarnIcon className="size-3.5 text-amber-700 shrink-0" />
                            )}
                            <span className="text-sm font-bold text-slate-900">"{m.header}"</span>
                          </span>
                        </div>

                        {/* Mode A: Create New Class — Editable Subject Name Input (Requirement #17) */}
                        {isCreatingNew && m.subjectId && matchedSubject && (
                          <div>
                            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                              {t('photoImport.finalSubjectName')}
                            </label>
                            <input
                              type="text"
                              aria-label={`Subject name for ${m.header}`}
                              className="field-input min-h-[44px] !py-1.5 !px-2.5 text-sm font-bold"
                              value={matchedSubject.name}
                              onChange={(e) => {
                                const newName = e.target.value;
                                onChange((d) => updateSubjectName(d, detail, m.subjectId!, newName).draft);
                              }}
                            />
                          </div>
                        )}

                        {/* Mode B: Import into Existing Class — Mapping Dropdown (Requirement #18) */}
                        {!isCreatingNew && (
                          <div>
                            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                              {t('photoImport.mapToExistingSubject')}
                            </label>
                            <select
                              aria-label={m.header}
                              className="field-input min-h-[44px] !py-1.5 text-xs font-semibold"
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

          {/* Student Cards / Table Groups */}
          {draft.rows.length === 0 && <Alert tone="info">{t('photoImport.noRowsLeft')}</Alert>}
          {renderGroup('boys')}
          {renderGroup('girls')}
          {renderGroup('')}
        </div>
      </div>

      {saveMessage && <Alert tone={saveMessage.tone}>{saveMessage.text}</Alert>}

      {/* Sticky Bottom Actions Bar (Requirement #26) */}
      <div className="sticky bottom-0 -mx-3 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur shadow-lg z-30 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 max-w-7xl">
          <Button
            variant="secondary"
            size="lg"
            icon={<RefreshIcon className="size-5" />}
            onClick={onTryAgain}
            disabled={saving}
            id="import-try-again"
            className="w-full sm:w-auto min-h-[48px] justify-center"
          >
            {t('photoImport.tryAgain')}
          </Button>
          <Button
            size="lg"
            icon={<CheckIcon />}
            loading={saving}
            disabled={draft.rows.length === 0}
            onClick={() => void handleConfirm()}
            id="import-confirm-save"
            className="w-full sm:w-auto min-h-[48px] font-bold text-base justify-center bg-brand-700 hover:bg-brand-800 text-white shadow-md"
          >
            {saving
              ? savingProgressText || t('photoImport.savingImport')
              : isHomeMode && saveOption === 'create'
                ? t('photoImport.createNewClassOption')
                : t('photoImport.confirmAndSave')}
          </Button>
        </div>
      </div>

      {/* Lightbox Photo View Modal (Requirement #14) */}
      {lightboxOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-3 sm:p-6 backdrop-blur-xs">
          <div className="relative max-h-[95vh] max-w-5xl w-full flex flex-col items-center">
            <button
              type="button"
              onClick={() => setLightboxOpen(false)}
              className="absolute top-2 right-2 z-10 rounded-full bg-slate-800/90 p-2 text-white hover:bg-slate-700 focus:outline-none min-h-[44px] min-w-[44px] flex items-center justify-center shadow-lg"
              aria-label={t('photoImport.closeLightbox')}
            >
              <XIcon className="size-6" />
            </button>
            <img
              src={image.previewUrl}
              alt={t('photoImport.originalPhoto')}
              className="max-h-[90vh] w-full object-contain rounded-lg shadow-2xl"
            />
          </div>
        </div>
      )}

      {/* Student Deletion Confirmation Modal (Requirement #25) */}
      <ConfirmDialog
        open={toDeleteRow !== null}
        title={t('photoImport.confirmDeleteStudentTitle')}
        confirmLabel={t('common.delete')}
        danger
        onCancel={() => setToDeleteRow(null)}
        onConfirm={() => {
          if (toDeleteRow) deleteRow(toDeleteRow.key);
          setToDeleteRow(null);
        }}
      >
        <p>{t('photoImport.confirmDeleteStudentBody')}</p>
        {toDeleteRow && (
          <p className="mt-2 text-xs font-bold text-slate-800 bg-slate-100 p-2 rounded">
            Roll {toDeleteRow.roll || '?'} ({toDeleteRow.category === 'boys' ? t('student.boys') : t('student.girls')}) — {toDeleteRow.name || 'Unnamed'}
          </p>
        )}
      </ConfirmDialog>

      {/* Interactive Image Cell Verification Modal */}
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
