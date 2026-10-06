import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { ClassDetail, ClassListItem } from '../../types';
import { useTranslation } from '../../i18n/context';
import { analyzeMarkList } from '../../lib/import/client';
import {
  buildDraft,
  createSyntheticDetail,
  importableSubjects,
  toSubjectInfo,
  type ImportDraft,
} from '../../lib/import/draft';
import { blobToBase64, prepareImage, releaseImage, validateImageFile, type PreparedImage } from '../../lib/import/image';
import { ImportError, type ImportErrorCode } from '../../lib/import/types';
import { getClassDetail, listClasses } from '../../lib/supabase/api';
import { cx } from '../../utils/format';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { CameraIcon, CheckIcon, ImageIcon, XIcon } from '../ui/Icons';
import { Spinner } from '../ui/Spinner';
import { ImportReview } from './ImportReview';

interface Props {
  mode?: 'home' | 'class';
  detail?: ClassDetail;
  onClose: () => void;
  /** Called after students were saved. If a new class was created, createdClassId is provided. */
  onImported: (count: number, createdClassId?: string) => void;
}

type Stage = 'upload' | 'analyzing' | 'review';

const MESSAGE_KEYS: Record<ImportErrorCode, string> = {
  imageTooLarge: 'photoImport.imageTooLarge',
  invalidImage: 'photoImport.invalidImage',
  unsupportedType: 'photoImport.unsupportedType',
  noStudents: 'photoImport.noStudentsDetected',
  noTable: 'photoImport.noTableDetected',
  missingApiKey: 'photoImport.errorMissingApiKey',
  unavailable: 'photoImport.errorUnavailable',
  rateLimited: 'photoImport.errorRateLimited',
  malformedResponse: 'photoImport.errorCouldNotAnalyze',
  badRequest: 'photoImport.errorCouldNotAnalyze',
  generic: 'photoImport.errorCouldNotAnalyze',
};

function codeOf(err: unknown): ImportErrorCode {
  if (err instanceof ImportError) return err.code;
  const c = (err as { code?: string } | null)?.code;
  return c && c in MESSAGE_KEYS ? (c as ImportErrorCode) : 'generic';
}

export function ImportMarkListModal({ mode = 'home', detail, onClose, onImported }: Props) {
  const { t } = useTranslation();
  const [stage, setStage] = useState<Stage>('upload');
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [existingClasses, setExistingClasses] = useState<ClassListItem[]>([]);
  const [activeDetail, setActiveDetail] = useState<ClassDetail | undefined>(detail);

  const imageRef = useRef<PreparedImage | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const chooseRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

  /** Fetch existing classes list if in Home Mode so teacher can select target class if desired */
  useEffect(() => {
    if (mode === 'home') {
      listClasses()
        .then(setExistingClasses)
        .catch(() => setExistingClasses([]));
    }
  }, [mode]);

  /** Drop the temporary image (object URL + reference). */
  const discardImage = useCallback(() => {
    releaseImage(imageRef.current);
    imageRef.current = null;
    setImage(null);
  }, []);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      releaseImage(imageRef.current);
      imageRef.current = null;
    },
    [],
  );

  const busy = stage === 'analyzing' || preparing;

  const handleClose = useCallback(() => {
    abortRef.current?.abort();
    discardImage();
    onClose();
  }, [discardImage, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy && stage !== 'review') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, stage, handleClose]);

  const onFileChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);

    const problem = validateImageFile(file);
    if (problem) {
      setError(t(MESSAGE_KEYS[problem]));
      return;
    }

    discardImage();
    setPreparing(true);
    try {
      const prepared = await prepareImage(file);
      imageRef.current = prepared;
      setImage(prepared);
    } catch (err) {
      setError(t(MESSAGE_KEYS[codeOf(err)]));
    } finally {
      setPreparing(false);
    }
  };

  const analyze = async () => {
    if (!image || stage === 'analyzing') return;
    setError(null);
    setStage('analyzing');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const base64 = await blobToBase64(image.blob);

      const classContext = activeDetail
        ? {
            className: activeDetail.schoolClass.className,
            institutionName: activeDetail.schoolClass.institutionName,
            includeQuranHifz: activeDetail.config.includeQuranHifz,
            subjects: toSubjectInfo(importableSubjects(activeDetail)),
          }
        : undefined;

      const extraction = await analyzeMarkList(
        {
          imageBase64: base64,
          mimeType: image.mimeType,
          classContext,
        },
        controller.signal,
      );

      const computedDetail =
        activeDetail ??
        createSyntheticDetail(
          {
            institutionName: extraction.documentMetadata.institutionName ?? '',
            institutionLocation: extraction.documentMetadata.location ?? '',
            rangeName: extraction.documentMetadata.range ?? '',
            className: extraction.documentMetadata.className ?? '',
            division: extraction.documentMetadata.division ?? '',
            examName: extraction.documentMetadata.examName ?? '',
            examYear:
              extraction.documentMetadata.examYear !== null
                ? String(extraction.documentMetadata.examYear)
                : String(new Date().getFullYear()),
            examDate: extraction.documentMetadata.examDate ?? '',
            confidence: extraction.documentMetadata.confidence,
          },
          extraction.columns
            .filter((c) => c.kind === 'subject' || c.kind === 'quran' || c.kind === 'hifz')
            .map((c) => ({
              id: `subj-col-${c.index}`,
              name: c.header,
              kind: c.kind === 'quran' ? 'quran' : c.kind === 'hifz' ? 'hifz' : 'normal',
              columnIndex: c.index,
              confidence: c.confidence,
            })),
        );

      setActiveDetail(computedDetail);
      setDraft(buildDraft(extraction, computedDetail));
      setStage('review');
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      setError(t(MESSAGE_KEYS[codeOf(err)]));
      setStage('upload');
    } finally {
      abortRef.current = null;
    }
  };

  const handleSelectExistingClass = async (targetClassId: string) => {
    const targetDetail = await getClassDetail(targetClassId);
    if (targetDetail && draft) {
      setActiveDetail(targetDetail);
      // Re-build draft matching to target detail
      setDraft((prev) => (prev ? buildDraft({
        documentMetadata: {
          institutionName: prev.header.institutionName,
          location: prev.header.institutionLocation,
          range: prev.header.rangeName,
          examName: prev.header.examName,
          examYear: Number(prev.header.examYear) || null,
          className: prev.header.className,
          division: prev.header.division,
          examDate: prev.header.examDate,
          confidence: prev.header.confidence as any,
        },
        columns: prev.columns,
        students: prev.rows.map((r) => ({
          category: r.category || null,
          categoryConfidence: 'high',
          rollNumber: Number(r.roll) || null,
          rollConfidence: 'high',
          admissionNumber: r.admissionNumber || null,
          admissionConfidence: 'high',
          name: r.name || null,
          nameConfidence: 'high',
          box: r.box,
          cells: Object.values(r.cells),
        })),
        warnings: prev.warnings,
      }, targetDetail) : null));
    }
  };

  const tryAgain = () => {
    discardImage();
    setDraft(null);
    setError(null);
    setStage('upload');
  };

  const imported = (count: number, createdClassId?: string) => {
    discardImage();
    setDraft(null);
    onImported(count, createdClassId);
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-title"
      id="import-photo-modal"
    >
      <div className="mx-auto max-w-[96rem] px-4 pb-6 sm:px-6">
        <header className="sticky top-0 z-10 -mx-4 mb-4 flex items-center justify-between border-b border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <div className="flex items-center gap-2">
            <ImageIcon className="size-5 text-brand-700" />
            <h1 id="import-title" className="text-lg font-bold text-slate-900">
              {mode === 'home' ? t('photoImport.modeHomeTitle') : t('photoImport.title')}
            </h1>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={<XIcon className="size-4" />}
            onClick={handleClose}
            disabled={busy}
            id="import-close"
            aria-label={t('photoImport.close')}
          >
            {t('photoImport.close')}
          </Button>
        </header>

        {stage === 'review' && draft && image && activeDetail ? (
          <ImportReview
            mode={mode}
            detail={activeDetail}
            draft={draft}
            image={image}
            existingClasses={existingClasses}
            onChange={(updater) => setDraft((d) => (d ? updater(d) : d))}
            onTryAgain={tryAgain}
            onImported={imported}
            onSelectExistingClass={handleSelectExistingClass}
          />
        ) : (
          <div className="mx-auto max-w-2xl space-y-4">
            {error && <Alert tone="error">{error}</Alert>}

            <div className="card space-y-4 p-4 sm:p-6">
              <p className="text-base font-medium text-slate-800">{t('photoImport.intro')}</p>

              <input
                ref={chooseRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                id="import-file-input"
                onChange={(e) => void onFileChosen(e)}
              />
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                id="import-camera-input"
                onChange={(e) => void onFileChosen(e)}
              />

              {!image && (
                <div className={cx('grid gap-3', isTouch ? 'grid-cols-1' : 'grid-cols-1')}>
                  <Button
                    size="lg"
                    fullWidth
                    icon={<ImageIcon className="size-5" />}
                    loading={preparing}
                    disabled={stage === 'analyzing'}
                    onClick={() => chooseRef.current?.click()}
                    id="import-choose-photo"
                    className="min-h-14"
                  >
                    {t('photoImport.choosePhoto')}
                  </Button>
                  {isTouch && (
                    <Button
                      size="lg"
                      fullWidth
                      variant="secondary"
                      icon={<CameraIcon className="size-5" />}
                      disabled={preparing || stage === 'analyzing'}
                      onClick={() => cameraRef.current?.click()}
                      id="import-take-photo"
                      className="min-h-14"
                    >
                      {t('photoImport.takePhoto')}
                    </Button>
                  )}
                  <p className="text-center text-xs text-slate-500">
                    {t('photoImport.supportedFormats')} · {t('photoImport.maxSize')}
                  </p>
                </div>
              )}

              {image && (
                <div className="space-y-3">
                  <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                    <img src={image.previewUrl} alt={t('photoImport.originalPhoto')} className="mx-auto max-h-[60vh] w-full object-contain" id="import-photo-preview" />
                  </div>
                  <p className="text-xs text-slate-500">{t('photoImport.tempNotice')}</p>

                  {stage === 'analyzing' ? (
                    <AnalyzingState />
                  ) : (
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button size="lg" fullWidth icon={<CheckIcon />} onClick={() => void analyze()} id="import-analyze" className="min-h-12">
                        {t('photoImport.analyzeMarkList')}
                      </Button>
                      <Button
                        size="lg"
                        variant="secondary"
                        onClick={() => chooseRef.current?.click()}
                        loading={preparing}
                        id="import-change-photo"
                        className="sm:whitespace-nowrap"
                      >
                        {t('photoImport.changePhoto')}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AnalyzingState() {
  const { t } = useTranslation();
  const working = ['photoImport.stepDetectingTable', 'photoImport.stepIdentifyingStudents', 'photoImport.stepIdentifyingSubjects', 'photoImport.stepMatchingMarks'];
  return (
    <div className="rounded-lg border border-brand-100 bg-brand-50/60 p-4" role="status" aria-live="polite" id="import-analyzing">
      <p className="flex items-center gap-2 font-semibold text-brand-900">
        <Spinner className="size-5" /> {t('photoImport.analyzingMarkList')}
      </p>
      <ul className="mt-3 space-y-1.5 text-sm text-slate-700">
        <li className="flex items-center gap-2">
          <CheckIcon className="size-4 text-pass-700" /> {t('photoImport.stepReadingImage')}
        </li>
        {working.map((key) => (
          <li key={key} className="flex items-center gap-2">
            <Spinner className="size-4 text-brand-600" /> {t(key)}
          </li>
        ))}
        <li className="flex items-center gap-2 text-slate-400">
          <span className="inline-block size-4 rounded-full border border-slate-300" /> {t('photoImport.stepPreparingReview')}
        </li>
      </ul>
      <p className="mt-3 text-xs text-slate-500">{t('photoImport.analyzingHint')}</p>
    </div>
  );
}
