import { useMemo, useState, Fragment } from 'react';
import { useAsyncData } from '../hooks/useAsyncData';
import { paths } from '../hooks/useHashRoute';
import { calculateSummary, evaluateStudent, formatCombinedCount, isPassingMark } from '../lib/calculations/marks';
import { getClassDetail } from '../lib/supabase/api';
import { cx, formatMark, formatPercent } from '../utils/format';
import { Alert } from '../components/ui/Alert';
import { Button, LinkButton } from '../components/ui/Button';
import { ArrowLeftIcon, PrintIcon } from '../components/ui/Icons';
import { LoadingBlock } from '../components/ui/Spinner';

export function PrintPage({ classId, examId }: { classId: string; examId?: string }) {
  const { data, loading, error, reload } = useAsyncData(() => getClassDetail(classId, examId), [classId, examId]);
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('landscape');

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

  if (loading) return <LoadingBlock message="Preparing printable document..." />;
  if (error)
    return (
      <div className="p-6">
        <Alert tone="error" title="Could not load print document" action={<Button variant="secondary" size="sm" onClick={() => void reload()}>Try again</Button>}>
          {error}
        </Alert>
      </div>
    );
  if (!data)
    return (
      <div className="p-6">
        <Alert tone="error">Class not found for printing.</Alert>
      </div>
    );

  const { schoolClass, examination, config, students } = data;
  const withQH = config.includeQuranHifz && config.quranSubject && config.hifzSubject;
  const colSpanCount = (config.normalSubjects.length || 0) + (withQH ? 3 : 0) + 4;

  const handlePrint = () => {
    window.print();
  };

  const renderPrintRow = (student: typeof students[0], res: ReturnType<typeof evaluateStudent>) => (
    <tr key={student.id}>
      <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{student.rollNumber}</td>
      <td style={{ fontWeight: '500' }}>{student.studentName}</td>
      {config.normalSubjects.map((s, idx) => {
        const m = res.normalMarks[idx];
        const fail = m !== null && !isPassingMark(m);
        return (
          <td
            key={s.id}
            style={{
              textAlign: 'center',
              fontWeight: fail ? 'bold' : 'normal',
              color: fail ? '#b91c1c' : '#000',
            }}
          >
            {formatMark(m)}
          </td>
        );
      })}
      {withQH && (
        <>
          <td style={{ textAlign: 'center' }}>{formatMark(res.quran)}</td>
          <td style={{ textAlign: 'center' }}>{formatMark(res.hifz)}</td>
          <td
            style={{
              textAlign: 'center',
              fontWeight: 'bold',
              color: res.quranHifzTotal !== null && !isPassingMark(res.quranHifzTotal) ? '#b91c1c' : '#000',
            }}
          >
            {formatMark(res.quranHifzTotal)}
          </td>
        </>
      )}
      <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{formatMark(res.grandTotal)}</td>
      <td
        style={{
          textAlign: 'center',
          fontWeight: 'bold',
          color: res.result === 'P' ? '#15803d' : res.result === 'F' ? '#b91c1c' : '#666',
        }}
      >
        {res.result ?? (res.status === 'absent' ? 'AB' : '-')}
      </td>
      <td style={{ fontSize: '10px' }}>
        {res.status === 'absent' ? (
          'Absent'
        ) : res.status === 'incomplete' ? (
          'Incomplete'
        ) : res.result === 'F' && res.failedSubjects.length > 0 ? (
          `Needs 40 in ${res.failedSubjects.join(', ')}`
        ) : (
          'Passed'
        )}
      </td>
    </tr>
  );

  return (
    <div className="min-h-screen bg-slate-100 pb-12">
      {/* On-screen controls */}
      <header className="no-print sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur px-4 py-3 shadow-xs">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <LinkButton href={paths.classPage(schoolClass.id, examination.id)} variant="ghost" size="sm" icon={<ArrowLeftIcon />}>
            Back to Class
          </LinkButton>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              Orientation:
              <select
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800"
                value={orientation}
                onChange={(e) => setOrientation(e.target.value as 'portrait' | 'landscape')}
              >
                <option value="landscape">Landscape (Recommended)</option>
                <option value="portrait">Portrait</option>
              </select>
            </label>

            <Button variant="primary" size="md" icon={<PrintIcon />} onClick={handlePrint} id="print-now-btn">
              Print Now
            </Button>
          </div>
        </div>
      </header>

      {/* Printable Paper Document */}
      <main className="p-4 sm:p-8">
        <div
          className={cx(
            'print-paper print-sheet animate-fade-in bg-white border border-slate-300 relative',
            orientation === 'landscape' ? 'print-paper--landscape' : 'print-paper--portrait',
          )}
        >
          {/* Header Layout: Institution Name (Center), Class Box (Right), Location/Range & Exam Subtitles */}
          <div className="relative mb-6 pt-2 pb-4 border-b-2 border-black">
            {/* Prominent Class Box on the RIGHT */}
            <div className="absolute right-0 top-0 border-2 border-black px-4 py-2 bg-slate-50 text-center min-w-[100px]">
              <span className="block text-[9px] font-bold uppercase tracking-widest text-slate-600">CLASS</span>
              <strong className="text-xl font-extrabold uppercase text-black">{schoolClass.className}</strong>
            </div>

            <div className="text-center pr-28 pl-4">
              <h1 className="text-2xl font-bold uppercase tracking-wider text-black font-serif">
                {schoolClass.institutionName || 'SCHOOL / MADRASA MARK LIST'}
              </h1>

              <div className="mt-1 text-xs font-semibold text-slate-800 font-serif flex items-center justify-center gap-4">
                {schoolClass.institutionLocation && <span>Location: {schoolClass.institutionLocation}</span>}
                {schoolClass.rangeName && <span>Range: {schoolClass.rangeName}</span>}
              </div>

              <div className="mt-2 inline-block border-b border-black pb-0.5">
                <h2 className="text-sm font-bold uppercase tracking-widest text-black font-serif">
                  {examination.examName} — {examination.examYear}
                </h2>
              </div>
            </div>
          </div>

          {/* Mark Table */}
          <div className="mb-6">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '45px' }}>Roll No</th>
                  <th style={{ textAlign: 'left', minWidth: '130px' }}>Student Name</th>
                  {config.normalSubjects.map((s) => (
                    <th key={s.id} style={{ minWidth: '60px' }}>
                      {s.name}
                    </th>
                  ))}
                  {withQH && (
                    <>
                      <th style={{ minWidth: '55px' }}>Quran</th>
                      <th style={{ minWidth: '55px' }}>Hifz</th>
                      <th style={{ minWidth: '75px' }}>Quran + Hifz</th>
                    </>
                  )}
                  <th style={{ minWidth: '75px' }}>Grand Total</th>
                  <th style={{ width: '55px' }}>Result</th>
                  <th style={{ textAlign: 'left', minWidth: '110px' }}>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {students.length === 0 ? (
                  <tr>
                    <td colSpan={colSpanCount} style={{ textAlign: 'center', padding: '20px', fontStyle: 'italic' }}>
                      No student record entered for this examination.
                    </td>
                  </tr>
                ) : (
                  <>
                    {/* BOYS SECTION */}
                    {boysGroup.length > 0 && (
                      <Fragment>
                        <tr style={{ background: '#f1f5f9', fontWeight: 'bold', textTransform: 'uppercase', fontSize: '10px' }}>
                          <td colSpan={colSpanCount} style={{ padding: '4px 8px', textAlign: 'left' }}>
                            ── BOYS ({boysGroup.length}) ──
                          </td>
                        </tr>
                        {boysGroup.map(({ student, result }) => renderPrintRow(student, result))}
                      </Fragment>
                    )}

                    {/* GIRLS SECTION */}
                    {girlsGroup.length > 0 && (
                      <Fragment>
                        <tr style={{ background: '#fdf2f8', fontWeight: 'bold', textTransform: 'uppercase', fontSize: '10px' }}>
                          <td colSpan={colSpanCount} style={{ padding: '4px 8px', textAlign: 'left' }}>
                            ── GIRLS ({girlsGroup.length}) ──
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

          {/* Print Result Summary (Mathematical Boys + Girls = Total format) */}
          <div className="border border-black p-3 mb-8 bg-slate-50">
            <h3 className="text-xs font-bold uppercase tracking-wider border-b border-black pb-1 mb-2">
              RESULT SUMMARY
            </h3>
            <div className="grid grid-cols-5 gap-2 text-center text-xs font-serif">
              <div>
                <span className="block text-slate-600">Total Participants</span>
                <strong className="text-sm">
                  {formatCombinedCount(summary.totalBoys, summary.totalGirls, summary.totalParticipants)}
                </strong>
              </div>
              <div>
                <span className="block text-slate-600">Appeared</span>
                <strong className="text-sm">
                  {formatCombinedCount(summary.appearedBoys, summary.appearedGirls, summary.totalAppeared)}
                </strong>
              </div>
              <div>
                <span className="block text-slate-600">Passed</span>
                <strong className="text-sm text-green-900">
                  {formatCombinedCount(summary.passedBoys, summary.passedGirls, summary.totalPassed)}
                </strong>
              </div>
              <div>
                <span className="block text-slate-600">Failed</span>
                <strong className="text-sm text-red-900">
                  {formatCombinedCount(summary.failedBoys, summary.failedGirls, summary.totalFailed)}
                </strong>
              </div>
              <div>
                <span className="block text-slate-600">Pass Percentage</span>
                <strong className="text-sm font-bold text-black">{formatPercent(summary.passPercentage)}</strong>
              </div>
            </div>
          </div>

          {/* Signatures Footer */}
          <div className="mt-12 grid grid-cols-2 gap-8 text-xs font-serif pt-6">
            <div className="text-left">
              <p className="mb-8">Date: ________________________</p>
              <p>Class Teacher Signature: ________________________________</p>
            </div>
            <div className="text-right">
              <p className="mb-8">Seal / Stamp</p>
              <p>Principal / Head Signature: ________________________________</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
