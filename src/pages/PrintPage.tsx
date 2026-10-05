import { useMemo, useState, Fragment } from 'react';
import { useAsyncData } from '../hooks/useAsyncData';
import { paths } from '../hooks/useHashRoute';
import { useTranslation } from '../i18n/context';
import { calculateSummary, evaluateStudent, formatCombinedCount, isPassingMark } from '../lib/calculations/marks';
import { getClassDetail } from '../lib/supabase/api';
import { cx, formatMark, formatPercent } from '../utils/format';
import { Alert } from '../components/ui/Alert';
import { Button, LinkButton } from '../components/ui/Button';
import { ArrowLeftIcon, PrintIcon } from '../components/ui/Icons';
import { LoadingBlock } from '../components/ui/Spinner';

export function PrintPage({ classId, examId }: { classId: string; examId?: string }) {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useAsyncData(() => getClassDetail(classId, examId), [classId, examId]);
  
  // Default orientation is PORTRAIT per requirement #2
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');

  const evaluated = useMemo(() => {
    if (!data) return [];
    return data.students.map((s) => evaluateStudent(data.config, s));
  }, [data]);

  const summary = useMemo(() => {
    if (!data)
      return {
        totalStudents: 0,
        totalBoys: 0,
        totalGirls: 0,
        appearedBoys: 0,
        appearedGirls: 0,
        passedBoys: 0,
        passedGirls: 0,
        failedBoys: 0,
        failedGirls: 0,
        totalParticipants: 0,
        totalAppeared: 0,
        totalPassed: 0,
        totalFailed: 0,
        passPercentage: 0,
      };
    return calculateSummary(data.schoolClass.totalStudents, evaluated);
  }, [data, evaluated]);

  const boysGroup = useMemo(() => {
    if (!data) return [];
    return data.students
      .filter((s) => s.category === 'boys')
      .map((s) => ({ student: s, result: evaluateStudent(data.config, s) }));
  }, [data]);

  const girlsGroup = useMemo(() => {
    if (!data) return [];
    return data.students
      .filter((s) => s.category === 'girls')
      .map((s) => ({ student: s, result: evaluateStudent(data.config, s) }));
  }, [data]);

  if (loading) return <LoadingBlock message={t('common.loading')} />;
  if (error)
    return (
      <div className="p-6">
        <Alert tone="error" title={t('dashboard.loadErrorTitle')} action={<Button variant="secondary" size="sm" onClick={() => void reload()}>{t('common.tryAgain')}</Button>}>
          {error}
        </Alert>
      </div>
    );
  if (!data)
    return (
      <div className="p-6">
        <Alert tone="error">{t('class.classNotFoundTitle')}</Alert>
      </div>
    );

  const { schoolClass, examination, config, students } = data;
  const withQH = config.includeQuranHifz && config.quranSubject && config.hifzSubject;
  
  // Total columns = Roll No (1) + Student Name (1) + Normal Subjects (N) + Quran/Hifz/Total (3 or 0) + Grand Total (1) + Result (1)
  const colSpanCount = 1 + 1 + (config.normalSubjects.length || 0) + (withQH ? 3 : 0) + 1 + 1;

  const handlePrint = () => {
    window.print();
  };

  const renderPrintRow = (student: typeof students[0], res: ReturnType<typeof evaluateStudent>) => (
    <tr key={student.id}>
      <td style={{ textAlign: 'center', fontWeight: '600' }}>{student.rollNumber}</td>
      <td style={{ fontWeight: '500', paddingLeft: '8px' }}>{student.studentName}</td>
      {config.normalSubjects.map((s, idx) => {
        const m = res.normalMarks[idx];
        const fail = m !== null && !isPassingMark(m);
        return (
          <td
            key={s.id}
            style={{
              textAlign: 'center',
              fontWeight: fail ? '700' : '500',
              color: fail ? '#b91c1c' : '#1e293b',
              backgroundColor: fail ? '#fef2f2' : 'transparent',
            }}
          >
            {formatMark(m)}
          </td>
        );
      })}
      {withQH && (
        <>
          <td style={{ textAlign: 'center', fontWeight: '500' }}>{formatMark(res.quran)}</td>
          <td style={{ textAlign: 'center', fontWeight: '500' }}>{formatMark(res.hifz)}</td>
          <td
            style={{
              textAlign: 'center',
              fontWeight: '700',
              color: res.quranHifzTotal !== null && !isPassingMark(res.quranHifzTotal) ? '#b91c1c' : '#0f172a',
              backgroundColor: res.quranHifzTotal !== null && !isPassingMark(res.quranHifzTotal) ? '#fef2f2' : '#f8fafc',
            }}
          >
            {formatMark(res.quranHifzTotal)}
          </td>
        </>
      )}
      <td style={{ textAlign: 'center', fontWeight: '700', color: '#0f172a' }}>{formatMark(res.grandTotal)}</td>
      <td
        style={{
          textAlign: 'center',
          fontWeight: '700',
          fontSize: '13px',
          color: res.result === 'P' ? '#15803d' : res.result === 'F' ? '#dc2626' : '#64748b',
        }}
      >
        {res.result ?? (res.status === 'absent' ? 'AB' : '-')}
      </td>
    </tr>
  );

  return (
    <div className="min-h-screen bg-slate-100 pb-12">
      {/* On-screen controls */}
      <header className="no-print sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur px-4 py-3 shadow-xs">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <LinkButton href={paths.classPage(schoolClass.id, examination.id)} variant="ghost" size="sm" icon={<ArrowLeftIcon />}>
            {t('class.backToMarkList')}
          </LinkButton>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              {t('print.orientation')}
              <select
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800"
                value={orientation}
                onChange={(e) => setOrientation(e.target.value as 'portrait' | 'landscape')}
              >
                <option value="portrait">{t('print.portraitDefault')}</option>
                <option value="landscape">{t('print.landscape')}</option>
              </select>
            </label>

            <Button variant="primary" size="md" icon={<PrintIcon />} onClick={handlePrint} id="print-now-btn">
              {t('print.printNow')}
            </Button>
          </div>
        </div>
      </header>

      {/* Printable Paper Document */}
      <main className="p-4 sm:p-8">
        <div
          className={cx(
            'print-paper print-sheet animate-fade-in bg-white border border-slate-300 relative flex flex-col justify-between',
            orientation === 'landscape' ? 'print-paper--landscape' : 'print-paper--portrait',
          )}
        >
          <div>
            {/* Header Layout: Institution Name (Center), Class Box (Right), Location/Range & Exam Subtitles */}
            <div className="relative mb-5 pt-1 pb-3 border-b-2 border-slate-900">
              {/* Prominent Class Box on the RIGHT */}
              <div className="absolute right-0 top-0 border-2 border-black px-4 py-1.5 bg-slate-50 text-center min-w-[95px]">
                <span className="block text-[9px] font-bold uppercase tracking-widest text-slate-600">{t('print.classBoxLabel')}</span>
                <strong className="text-xl font-extrabold uppercase text-black">{schoolClass.className}</strong>
              </div>

              <div className="text-center pr-28 pl-4">
                <h1 className="text-2xl font-bold uppercase tracking-wider text-black">
                  {schoolClass.institutionName || t('print.defaultTitle')}
                </h1>

                <div className="mt-1 text-xs font-medium text-slate-700 flex items-center justify-center gap-4">
                  {schoolClass.institutionLocation && <span>{t('print.locationLabel')} {schoolClass.institutionLocation}</span>}
                  {schoolClass.rangeName && <span>{t('print.rangeLabel')} {schoolClass.rangeName}</span>}
                </div>

                <div className="mt-2 inline-block border-b border-black pb-0.5">
                  <h2 className="text-sm font-bold uppercase tracking-widest text-black">
                    {examination.examName} — {examination.examYear}
                  </h2>
                </div>
              </div>
            </div>

            {/* Mark Table (Remarks column completely removed per requirement #1) */}
            <div className="mb-6">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '50px' }}>{t('student.rollNumber')}</th>
                    <th style={{ textAlign: 'left', paddingLeft: '8px', minWidth: '140px' }}>{t('student.name')}</th>
                    {config.normalSubjects.map((s) => (
                      <th key={s.id} style={{ minWidth: '65px' }}>
                        {s.name}
                      </th>
                    ))}
                    {withQH && (
                      <>
                        <th style={{ minWidth: '55px' }}>{t('student.quranLabel')}</th>
                        <th style={{ minWidth: '55px' }}>{t('student.hifzLabel')}</th>
                        <th style={{ minWidth: '80px', backgroundColor: '#e2e8f0' }}>{t('student.quranHifzLabel')}</th>
                      </>
                    )}
                    <th style={{ minWidth: '80px', backgroundColor: '#e2e8f0' }}>{t('results.grandTotal')}</th>
                    <th style={{ width: '60px' }}>{t('results.result')}</th>
                  </tr>
                </thead>
                <tbody>
                  {students.length === 0 ? (
                    <tr>
                      <td colSpan={colSpanCount} style={{ textAlign: 'center', padding: '20px', fontStyle: 'italic', color: '#64748b' }}>
                        {t('print.noStudents')}
                      </td>
                    </tr>
                  ) : (
                    <>
                      {/* BOYS SECTION */}
                      {boysGroup.length > 0 && (
                        <Fragment>
                          <tr style={{ background: '#f1f5f9', fontWeight: '700', textTransform: 'uppercase', fontSize: '10.5px' }}>
                            <td colSpan={colSpanCount} style={{ padding: '4px 8px', textAlign: 'left' }}>
                              ── {t('student.boys').toUpperCase()} ({boysGroup.length}) ──
                            </td>
                          </tr>
                          {boysGroup.map(({ student, result }) => renderPrintRow(student, result))}
                        </Fragment>
                      )}

                      {/* GIRLS SECTION */}
                      {girlsGroup.length > 0 && (
                        <Fragment>
                          <tr style={{ background: '#fdf2f8', fontWeight: '700', textTransform: 'uppercase', fontSize: '10.5px' }}>
                            <td colSpan={colSpanCount} style={{ padding: '4px 8px', textAlign: 'left' }}>
                              ── {t('student.girls').toUpperCase()} ({girlsGroup.length}) ──
                            </td>
                          </tr>
                          {girlsGroup.map(({ student, result }) => renderPrintRow(student, result))}
                        </Fragment>
                      )}
                    </>
                  )}
                </tbody>
              </table>
            </div>

            {/* Print Result Summary Box (Mathematical format, clean sans-serif numbers) */}
            <div className="border border-black p-3 mb-6 bg-slate-50">
              <h3 className="text-xs font-bold uppercase tracking-wider border-b border-black pb-1 mb-2">
                {t('results.summary')}
              </h3>
              <div className="grid grid-cols-5 gap-2 text-center text-xs">
                <div>
                  <span className="block text-slate-600 font-medium">{t('results.totalParticipants')}</span>
                  <strong className="text-sm font-bold text-black">
                    {formatCombinedCount(summary.totalBoys, summary.totalGirls, summary.totalParticipants)}
                  </strong>
                </div>
                <div>
                  <span className="block text-slate-600 font-medium">{t('results.appeared')}</span>
                  <strong className="text-sm font-bold text-black">
                    {formatCombinedCount(summary.appearedBoys, summary.appearedGirls, summary.totalAppeared)}
                  </strong>
                </div>
                <div>
                  <span className="block text-slate-600 font-medium">{t('results.passed')}</span>
                  <strong className="text-sm font-bold text-green-800">
                    {formatCombinedCount(summary.passedBoys, summary.passedGirls, summary.totalPassed)}
                  </strong>
                </div>
                <div>
                  <span className="block text-slate-600 font-medium">{t('results.failed')}</span>
                  <strong className="text-sm font-bold text-red-800">
                    {formatCombinedCount(summary.failedBoys, summary.failedGirls, summary.totalFailed)}
                  </strong>
                </div>
                <div>
                  <span className="block text-slate-600 font-medium">{t('results.passPercentage')}</span>
                  <strong className="text-sm font-extrabold text-black">{formatPercent(summary.passPercentage)}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Signatures Footer Section */}
          <div className="mt-8 grid grid-cols-2 gap-8 text-xs pt-4 border-t border-slate-300">
            <div className="text-left space-y-6">
              <p className="font-medium">{t('print.date')}: ________________________</p>
              <p className="font-semibold">{t('print.teacherSignature')}: ________________________________</p>
            </div>
            <div className="text-right space-y-6">
              <p className="font-medium">{t('print.sealStamp')}</p>
              <p className="font-semibold">{t('print.principalSignature')}: ________________________________</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
