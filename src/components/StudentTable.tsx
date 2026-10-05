import { useMemo, useState, Fragment } from 'react';
import type { ClassConfig, ClassSummary, Student } from '../types';
import { useTranslation } from '../i18n/context';
import { evaluateStudent, formatCombinedCount, isPassingMark, PASS_MARK } from '../lib/calculations/marks';
import { cx, formatMark, formatPercent } from '../utils/format';
import { EditIcon, TrashIcon } from './ui/Icons';
import { ResultBadge } from './ui/ResultBadge';

interface StudentTableProps {
  config: ClassConfig;
  students: Student[];
  summary: ClassSummary;
  onEditStudent: (student: Student) => void;
  onDeleteStudent: (student: Student) => void;
}

type Filter = 'all' | 'P' | 'F' | 'absent' | 'boys' | 'girls';

export function StudentTable({ config, students, summary, onEditStudent, onDeleteStudent }: StudentTableProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const evaluated = useMemo(() => {
    return students.map((s) => ({
      student: s,
      result: evaluateStudent(config, s),
    }));
  }, [students, config]);

  const filtered = useMemo(() => {
    return evaluated.filter(({ student, result }) => {
      if (filter === 'P' && result.result !== 'P') return false;
      if (filter === 'F' && result.result !== 'F') return false;
      if (filter === 'absent' && result.status !== 'absent') return false;
      if (filter === 'boys' && student.category !== 'boys') return false;
      if (filter === 'girls' && student.category !== 'girls') return false;
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        const matchName = student.studentName.toLowerCase().includes(q);
        const matchRoll = String(student.rollNumber).includes(q);
        if (!matchName && !matchRoll) return false;
      }
      return true;
    });
  }, [evaluated, filter, query]);

  // Group filtered students by category (Boys first, Girls second)
  const boysGroup = useMemo(() => filtered.filter((item) => item.student.category === 'boys'), [filtered]);
  const girlsGroup = useMemo(() => filtered.filter((item) => item.student.category === 'girls'), [filtered]);

  const withQH = config.includeQuranHifz && config.quranSubject && config.hifzSubject;
  const colSpanCount = (config.normalSubjects.length || 0) + (withQH ? 3 : 0) + 5;

  const renderStudentRow = (student: Student, result: ReturnType<typeof evaluateStudent>) => (
    <tr key={student.id} className="hover:bg-slate-50/80 transition-colors">
      <td className="px-3 py-3 text-center font-semibold text-slate-900 tabular-nums">
        {student.rollNumber}
      </td>
      <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">
        {student.studentName}
      </td>
      {config.normalSubjects.map((s, idx) => {
        const m = result.normalMarks[idx];
        const failed = m !== null && !isPassingMark(m);
        return (
          <td
            key={s.id}
            className={cx(
              'px-3 py-3 text-center tabular-nums font-medium',
              failed ? 'bg-red-50/80 text-fail-700 font-bold' : 'text-slate-700',
            )}
          >
            {formatMark(m)}
          </td>
        );
      })}
      {withQH && (
        <>
          <td className="px-3 py-3 text-center tabular-nums text-slate-700 bg-brand-50/30 border-l border-brand-100">
            {formatMark(result.quran)}
          </td>
          <td className="px-3 py-3 text-center tabular-nums text-slate-700 bg-brand-50/30">
            {formatMark(result.hifz)}
          </td>
          <td
            className={cx(
              'px-3 py-3 text-center tabular-nums font-bold border-r border-brand-200',
              result.quranHifzTotal !== null && !isPassingMark(result.quranHifzTotal)
                ? 'bg-red-50 text-fail-700'
                : 'bg-brand-50/60 text-brand-900',
            )}
          >
            {formatMark(result.quranHifzTotal)}
          </td>
        </>
      )}
      <td className="px-3 py-3 text-center font-bold text-slate-900 tabular-nums">
        {formatMark(result.grandTotal)}
      </td>
      <td className="px-3 py-3 text-center">
        <ResultBadge result={result} />
      </td>
      <td className="px-3 py-3 text-xs text-slate-500">
        {result.status === 'absent' ? (
          <span className="italic text-slate-400">{t('student.absentLabel')}</span>
        ) : result.status === 'incomplete' ? (
          <span className="text-amber-700">{t('studentTable.incompleteMarks')}</span>
        ) : result.result === 'F' && result.failedSubjects.length > 0 ? (
          <span className="text-fail-700 font-medium">
            {t('studentTable.needsMin', { pass: PASS_MARK, subjects: result.failedSubjects.join(', ') })}
          </span>
        ) : (
          <span className="text-pass-700 font-medium">{t('student.pass')}</span>
        )}
      </td>
      <td className="px-3 py-3 text-right no-print whitespace-nowrap">
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={() => onEditStudent(student)}
            className="rounded p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            title={`${t('common.edit')} ${student.studentName}`}
          >
            <EditIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => onDeleteStudent(student)}
            className="rounded p-1.5 text-fail-700 hover:bg-fail-50 hover:text-red-800"
            title={`${t('common.delete')} ${student.studentName}`}
          >
            <TrashIcon className="size-4" />
          </button>
        </div>
      </td>
    </tr>
  );

  return (
    <div className="space-y-4">
      {/* Search & Filter Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="mr-1 font-medium text-slate-500">{t('studentTable.show')}</span>
          {(
            [
              { key: 'all', label: t('studentTable.allWithCount', { count: students.length }) },
              { key: 'boys', label: t('studentTable.boysWithCount', { count: summary.totalBoys }) },
              { key: 'girls', label: t('studentTable.girlsWithCount', { count: summary.totalGirls }) },
              { key: 'P', label: t('studentTable.passedWithCount', { count: summary.totalPassed }) },
              { key: 'F', label: t('studentTable.failedWithCount', { count: summary.totalFailed }) },
              { key: 'absent', label: t('studentTable.absentFilter') },
            ] as const
          ).map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cx(
                'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                filter === f.key
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {students.length > 5 && (
          <div className="sm:w-64">
            <input
              type="search"
              className="field-input py-2 text-sm"
              placeholder={t('studentTable.searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Table with Boys and Girls Section Headers */}
      <div className="card overflow-hidden">
        <div className="print-scroll overflow-x-auto">
          <table className="w-full text-left text-sm" aria-label={t('class.openMarkList')}>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-600 font-semibold">
              <tr>
                <th scope="col" className="px-3 py-3 text-center w-16">
                  {t('student.rollNumber')}
                </th>
                <th scope="col" className="px-4 py-3 min-w-[140px]">
                  {t('student.name')}
                </th>
                {config.normalSubjects.map((s) => (
                  <th key={s.id} scope="col" className="px-3 py-3 text-center min-w-[80px]">
                    {s.name}
                  </th>
                ))}
                {withQH && (
                  <>
                    <th scope="col" className="px-3 py-3 text-center bg-brand-50/60 text-brand-900 border-l border-brand-100 min-w-[70px]">
                      {t('student.quranLabel')}
                    </th>
                    <th scope="col" className="px-3 py-3 text-center bg-brand-50/60 text-brand-900 min-w-[70px]">
                      {t('student.hifzLabel')}
                    </th>
                    <th scope="col" className="px-3 py-3 text-center bg-brand-100/70 text-brand-900 font-bold border-r border-brand-200 min-w-[90px]">
                      {t('student.quranHifzLabel')}
                    </th>
                  </>
                )}
                <th scope="col" className="px-3 py-3 text-center font-bold text-slate-900 min-w-[90px]">
                  {t('results.grandTotal')}
                </th>
                <th scope="col" className="px-3 py-3 text-center min-w-[75px]">
                  {t('results.result')}
                </th>
                <th scope="col" className="px-3 py-3 text-center min-w-[120px] max-w-[200px]">
                  {t('studentTable.remarks')}
                </th>
                <th scope="col" className="px-3 py-3 text-right no-print min-w-[80px]">
                  {t('common.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={colSpanCount} className="px-4 py-8 text-center text-slate-500">
                    {students.length === 0 ? t('studentTable.emptyList') : t('studentTable.noMatches')}
                  </td>
                </tr>
              ) : (
                <>
                  {/* BOYS SECTION HEADER & ROWS */}
                  {boysGroup.length > 0 && (
                    <Fragment>
                      <tr className="bg-slate-100/90 font-bold text-slate-800 text-xs uppercase tracking-wider">
                        <td colSpan={colSpanCount} className="px-4 py-2 border-y border-slate-200">
                          ── {t('student.boys').toUpperCase()} ({boysGroup.length}) ──
                        </td>
                      </tr>
                      {boysGroup.map(({ student, result }) => renderStudentRow(student, result))}
                    </Fragment>
                  )}

                  {/* GIRLS SECTION HEADER & ROWS */}
                  {girlsGroup.length > 0 && (
                    <Fragment>
                      <tr className="bg-pink-50/90 font-bold text-pink-900 text-xs uppercase tracking-wider">
                        <td colSpan={colSpanCount} className="px-4 py-2 border-y border-pink-200">
                          ── {t('student.girls').toUpperCase()} ({girlsGroup.length}) ──
                        </td>
                      </tr>
                      {girlsGroup.map(({ student, result }) => renderStudentRow(student, result))}
                    </Fragment>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary Statistics Card formatted mathematically as: Boys + Girls = Total */}
      <div className="card p-4 sm:p-5 bg-slate-900 text-white shadow-md">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
          {t('results.summary')}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-center sm:text-left">
          <div>
            <p className="text-xs text-slate-400 font-medium">{t('results.totalParticipants')}</p>
            <p className="text-xl font-bold tabular-nums mt-0.5">
              {formatCombinedCount(summary.totalBoys, summary.totalGirls, summary.totalParticipants)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-400 font-medium">{t('results.appeared')}</p>
            <p className="text-xl font-bold tabular-nums mt-0.5">
              {formatCombinedCount(summary.appearedBoys, summary.appearedGirls, summary.totalAppeared)}
            </p>
          </div>
          <div>
            <p className="text-xs text-green-400 font-medium">{t('results.passed')}</p>
            <p className="text-xl font-bold text-green-300 tabular-nums mt-0.5">
              {formatCombinedCount(summary.passedBoys, summary.passedGirls, summary.totalPassed)}
            </p>
          </div>
          <div>
            <p className="text-xs text-red-400 font-medium">{t('results.failed')}</p>
            <p className="text-xl font-bold text-red-300 tabular-nums mt-0.5">
              {formatCombinedCount(summary.failedBoys, summary.failedGirls, summary.totalFailed)}
            </p>
          </div>
          <div className="col-span-2 sm:col-span-1 border-t border-slate-800 sm:border-t-0 sm:border-l sm:border-slate-800 pt-3 sm:pt-0 sm:pl-4">
            <p className="text-xs text-brand-300 font-medium">{t('results.passPercentage')}</p>
            <p className="text-2xl font-extrabold text-white tabular-nums mt-0.5">
              {formatPercent(summary.passPercentage)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
