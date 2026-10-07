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
  const [errorInfo, setErrorInfo] = useState<{ code: ImportErrorCode; title: string; message: string } | null>(null);
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

  const setErrorFromCode = (code: ImportErrorCode) => {
    if (code === 'noTable' || code === 'noStudents') {
      setErrorInfo({
        code,
        title: t('photoImport.errPartMissingTitle'),
        message: t('photoImport.errPartMissingDesc'),
      });
    } else if (code === 'imageTooLarge' || code === 'invalidImage' || code === 'unsupportedType') {
      setErrorInfo({
        code,
        title: t('photoImport.errUnsupportedTitle'),
        message: t('photoImport.errUnsupportedDesc'),
      });
    } else if (code === 'rateLimited') {
      setErrorInfo({
        code,
        title: t('photoImport.errServerTitle'),
        message: t('photoImport.errorRateLimited'),
      });
    } else {
      setErrorInfo({
        code,
        title: t('photoImport.errServerTitle'),
        message: t('photoImport.errServerDesc'),
      });
    }
  };

  const onFileChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErrorInfo(null);

    const problem = validateImageFile(file);
    if (problem) {
      setErrorFromCode(problem);
      return;
    }

    discardImage();
    setPreparing(true);
    try {
      const prepared = await prepareImage(file);
      imageRef.current = prepared;
      setImage(prepared);
    } catch (err) {
      setErrorFromCode(codeOf(err));
    } finally {
      setPreparing(false);
    }
  };

  const analyze = async () => {
    if (!image || stage === 'analyzing') return;
    setErrorInfo(null);
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
            examName: extraction.documentMetadata.examName ?? '',
            examYear:
              extraction.documentMetadata.examYear !== null
                ? String(extraction.documentMetadata.examYear)
                : String(new Date().getFullYear()),
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
      setErrorFromCode(codeOf(err));
      setStage('upload');
    } finally {
      abortRef.current = null;
    }
  };

  const handleSelectExistingClass = async (targetClassId: string) => {
    const targetDetail = await getClassDetail(targetClassId);
    if (targetDetail && draft) {
      setActiveDetail(targetDetail);
      setDraft((prev) => (prev ? buildDraft({
        documentMetadata: {
          institutionName: prev.header.institutionName,
          location: prev.header.institutionLocation,
          range: prev.header.rangeName,
          examName: prev.header.examName,
          examYear: Number(prev.header.examYear) || null,
          className: prev.header.className,
          confidence: prev.header.confidence as any,
        },
        columns: prev.columns,
        students: prev.rows.map((r) => ({
          category: r.category || null,
          categoryConfidence: 'high',
          rollNumber: Number(r.roll) || null,
          rollConfidence: 'high',
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
    setErrorInfo(null);
    setStage('upload');
  };

  const imported = (count: number, createdClassId?: string) => {
    discardImage();
    setDraft(null);
    onImported(count, createdClassId);
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-50 min-h-dvh"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-title"
      id="import-photo-modal"
    >
      <div className="mx-auto max-w-[96rem] px-3 pb-6 sm:px-6">
        <header className="sticky top-0 z-30 -mx-3 mb-4 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 shadow-xs">
          <div className="flex items-center gap-2 min-w-0">
            <ImageIcon className="size-5 shrink-0 text-brand-700" />
            <h1 id="import-title" className="text-base sm:text-lg font-bold text-slate-900 truncate">
              {mode === 'home' ? t('photoImport.modeHomeTitle') : t('photoImport.title')}
            </h1>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={<XIcon className="size-5" />}
            onClick={handleClose}
            disabled={busy}
            id="import-close"
            aria-label={t('photoImport.close')}
            className="min-h-[44px] px-3 text-slate-600 hover:text-slate-900"
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
          <div className="mx-auto max-w-xl space-y-4">
            {errorInfo && (
              <div className="rounded-xl border-2 border-red-200 bg-red-50 p-4 space-y-3 shadow-xs">
                <div className="flex items-start gap-2.5">
                  <span className="text-xl">⚠️</span>
                  <div>
                    <h3 className="font-bold text-fail-700 text-sm">{errorInfo.title}</h3>
                    <p className="mt-0.5 text-xs text-slate-700">{errorInfo.message}</p>
                  </div>
                </div>
                <div className="pt-2 flex justify-end">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setErrorInfo(null);
                      if (errorInfo.code === 'noTable' || errorInfo.code === 'noStudents') {
                        if (isTouch && cameraRef.current) cameraRef.current.click();
                        else chooseRef.current?.click();
                      } else {
                        chooseRef.current?.click();
                      }
                    }}
                  >
                    {errorInfo.code === 'noTable' || errorInfo.code === 'noStudents'
                      ? t('photoImport.retakePhoto')
                      : t('photoImport.chooseAnotherPhoto')}
                  </Button>
                </div>
              </div>
            )}

            <div className="card space-y-5 p-4 sm:p-6 shadow-sm">
              {!image && (
                <div className="space-y-4">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">{t('photoImport.title')}</h2>
                    <p className="mt-1 text-sm text-slate-600">{t('photoImport.intro')}</p>
                  </div>

                  {/* Photo Guidance Box (Requirement #7) */}
                  <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-4 space-y-2.5">
                    <p className="text-xs font-bold uppercase tracking-wider text-brand-900">
                      {t('photoImport.guidanceTitle')}
                    </p>
                    <ul className="space-y-1.5 text-xs text-slate-700 font-medium">
                      <li className="flex items-center gap-2">
                        <CheckIcon className="size-4 text-emerald-600 shrink-0" /> {t('photoImport.guidanceKeepVisible')}
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckIcon className="size-4 text-emerald-600 shrink-0" /> {t('photoImport.guidanceHoldStraight')}
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckIcon className="size-4 text-emerald-600 shrink-0" /> {t('photoImport.guidanceMakeReadable')}
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckIcon className="size-4 text-emerald-600 shrink-0" /> {t('photoImport.guidanceGoodLighting')}
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckIcon className="size-4 text-emerald-600 shrink-0" /> {t('photoImport.guidanceAvoidGlare')}
                      </li>
                    </ul>
                  </div>

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

                  <div className="flex flex-col gap-3 pt-2">
                    {isTouch && (
                      <Button
                        size="lg"
                        fullWidth
                        variant="primary"
                        icon={<CameraIcon className="size-5" />}
                        disabled={preparing || stage === 'analyzing'}
                        onClick={() => cameraRef.current?.click()}
                        id="import-take-photo"
                        className="min-h-14 text-base font-bold justify-center"
                      >
                        📷 {t('photoImport.takePhoto')}
                      </Button>
                    )}

                    <Button
                      size="lg"
                      fullWidth
                      variant={isTouch ? 'secondary' : 'primary'}
                      icon={<ImageIcon className="size-5" />}
                      loading={preparing}
                      disabled={stage === 'analyzing'}
                      onClick={() => chooseRef.current?.click()}
                      id="import-choose-photo"
                      className="min-h-14 text-base font-bold justify-center"
                    >
                      🖼 {t('photoImport.choosePhoto')}
                    </Button>

                    <p className="text-center text-xs text-slate-500 pt-1">
                      {t('photoImport.supportedFormats')} · {t('photoImport.maxSize')}
                    </p>
                  </div>
                </div>
              )}

              {image && (
                <div className="space-y-4 animate-fade-in">
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-900/95 shadow-inner">
                    <img
                      src={image.previewUrl}
                      alt={t('photoImport.originalPhoto')}
                      className="mx-auto max-h-[50vh] w-full object-contain"
                      id="import-photo-preview"
                    />
                  </div>

                  {stage === 'analyzing' ? (
                    <AnalyzingState />
                  ) : (
                    <div className="space-y-3">
                      <p className="text-center text-xs text-slate-500">{t('photoImport.tempNotice')}</p>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                        <p className="text-sm font-bold text-slate-900 text-center">{t('photoImport.photoLooksGood')}</p>
                        <Button
                          size="lg"
                          fullWidth
                          icon={<CheckIcon />}
                          onClick={() => void analyze()}
                          id="import-analyze"
                          className="min-h-14 text-base font-bold justify-center shadow-md bg-brand-700 hover:bg-brand-800 text-white"
                        >
                          {t('photoImport.analyzeMarkList')}
                        </Button>
                        <div className="flex gap-2">
                          <Button
                            size="md"
                            variant="secondary"
                            fullWidth
                            onClick={() => chooseRef.current?.click()}
                            loading={preparing}
                            id="import-change-photo"
                            className="min-h-11 justify-center"
                          >
                            {t('photoImport.changePhoto')}
                          </Button>
                          {isTouch && (
                            <Button
                              size="md"
                              variant="secondary"
                              fullWidth
                              onClick={() => cameraRef.current?.click()}
                              loading={preparing}
                              id="import-retake-camera"
                              className="min-h-11 justify-center"
                            >
                              📷 {t('photoImport.retakePhoto')}
                            </Button>
                          )}
                        </div>
                      </div>
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
  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/80 p-5 space-y-4 shadow-sm" role="status" aria-live="polite" id="import-analyzing">
      <div className="flex items-center gap-3">
        <Spinner className="size-6 text-brand-700 shrink-0" />
        <div>
          <h3 className="font-bold text-base text-brand-950">{t('photoImport.analyzingMarkList')}</h3>
          <p className="text-xs text-brand-700">{t('photoImport.analyzingHint')}</p>
        </div>
      </div>

      <div className="space-y-2 pt-3 border-t border-brand-200/60 text-sm">
        <p className="font-bold text-xs uppercase tracking-wider text-slate-500">Detecting:</p>
        <ul className="space-y-2 text-slate-800 font-medium text-xs sm:text-sm">
          <li className="flex items-center gap-2 text-emerald-700 font-semibold">
            <CheckIcon className="size-4 shrink-0 text-emerald-600" /> {t('photoImport.stepReadingImage')}
          </li>
          <li className="flex items-center gap-2">
            <Spinner className="size-4 shrink-0 text-brand-600" /> {t('photoImport.stepDetectingTable')}
          </li>
          <li className="flex items-center gap-2">
            <Spinner className="size-4 shrink-0 text-brand-600" /> {t('photoImport.stepIdentifyingSubjects')}
          </li>
          <li className="flex items-center gap-2">
            <Spinner className="size-4 shrink-0 text-brand-600" /> {t('photoImport.stepIdentifyingStudents')}
          </li>
          <li className="flex items-center gap-2 text-slate-400">
            <span className="inline-block size-4 rounded-full border-2 border-slate-300" /> {t('photoImport.stepMatchingMarks')}
          </li>
        </ul>
      </div>
    </div>
  );
}
