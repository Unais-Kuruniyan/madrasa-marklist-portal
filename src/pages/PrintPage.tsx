import { useMemo, useState } from 'react';
import { useAsyncData } from '../hooks/useAsyncData';
import { paths } from '../hooks/useHashRoute';
import { calculateSummary, evaluateStudent, isPassingMark } from '../lib/calculations/marks';
import { getClassDetail } from '../lib/supabase/api';
import { cx, formatMark, formatPercent } from '../utils/format';
import { Alert } from '../components/ui/Alert';
import { Button, LinkButton } from '../components/ui/Button';
import { ArrowLeftIcon, PrintIcon } from '../components/ui/Icons';
import { LoadingBlock } from '../components/ui/Spinner';

export function PrintPage({ classId }: { classId: string }) {
  const { data, loading, error, reload } = useAsyncData(() => getClassDetail(classId), [classId]);
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('landscape');

  const evaluated = useMemo(() => {
    if (!data) return [];
    return data.students.map((s) => evaluateStudent(data.config, s));
  }, [data]);

  const summary = useMemo(() => {
    if (!data) return { totalStudents: 0, appeared: 0, passed: 0, failed: 0, absent: 0, incomplete: 0, passPercentage: 0 };
    return calculateSummary(data.schoolClass.totalStudents, evaluated);
  }, [data, evaluated]);

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

  const { schoolClass, config, students } = data;
  const withQH = config.includeQuranHifz && config.quranSubject && config.hifzSubject;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-slate-100 pb-12">
      {/* On-screen control bar (Hidden when printing) */}
      <header className="no-print sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur px-4 py-3 shadow-xs">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <LinkButton href={paths.classPage(schoolClass.id)} variant="ghost" size="sm" icon={<ArrowLeftIcon />}>
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
                <option value="landscape">Landscape (Recommended for wide tables)</option>
                <option value="portrait">Portrait</option>
              </select>
            </label>

            <Button variant="primary" size="md" icon={<PrintIcon />} onClick={handlePrint} id="print-now-btn">
              Print Now
            </Button>
          </div>
        </div>
      </header>

      {/* Printable Sheet */}
      <main className="p-4 sm:p-8">
        <div
          className={cx(
            'print-paper print-sheet animate-fade-in bg-white border border-slate-300',
            orientation === 'landscape' ? 'print-paper--landscape' : 'print-paper--portrait',
          )}
        >
          {/* Print Document Header */}
          <div className="text-center mb-6">
            {schoolClass.institutionName ? (
              <h1 className="text-2xl font-bold uppercase tracking-wider text-black font-serif">
                {schoolClass.institutionName}
              </h1>
            ) : (
              <h1 className="text-xl font-bold uppercase tracking-wider text-black font-serif">
                SCHOOL / MADRASA MARK LIST
              </h1>
            )}

            {schoolClass.institutionLocation && (
              <p className="text-sm font-medium text-slate-800 font-serif mt-0.5">
                {schoolClass.institutionLocation}
              </p>
            )}

            {/* Boxed Class Heading */}
            <div className="mt-4 inline-block border-2 border-black px-6 py-1.5 bg-slate-50">
              <h2 className="text-xl font-extrabold uppercase tracking-widest text-black font-serif">
                {schoolClass.className}
              </h2>
            </div>

            <p className="mt-2 text-xs font-bold uppercase tracking-widest text-slate-700">
              CLASS MARK LIST &amp; EXAMINATION RESULT
            </p>
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
                    <td colSpan={100} style={{ textAlign: 'center', padding: '20px', fontStyle: 'italic' }}>
                      No student record entered for this class.
                    </td>
                  </tr>
                ) : (
                  students.map((student) => {
                    const res = evaluateStudent(config, student);
                    return (
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
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Print Summary Statistics */}
          <div className="border border-black p-3 mb-8 bg-slate-50">
            <h3 className="text-xs font-bold uppercase tracking-wider border-b border-black pb-1 mb-2">
              RESULT SUMMARY
            </h3>
            <div className="grid grid-cols-5 gap-2 text-center text-xs font-serif">
              <div>
                <span className="block text-slate-600">Total Strength</span>
                <strong className="text-sm">{summary.totalStudents}</strong>
              </div>
              <div>
                <span className="block text-slate-600">Appeared</span>
                <strong className="text-sm">{summary.appeared}</strong>
              </div>
              <div>
                <span className="block text-slate-600">Passed</span>
                <strong className="text-sm text-green-800">{summary.passed}</strong>
              </div>
              <div>
                <span className="block text-slate-600">Failed</span>
                <strong className="text-sm text-red-800">{summary.failed}</strong>
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
