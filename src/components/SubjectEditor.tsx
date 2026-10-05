import { useEffect, useRef } from 'react';
import type { SubjectDraft } from '../types';
import { useTranslation } from '../i18n/context';
import { cx } from '../utils/format';
import { Button } from './ui/Button';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from './ui/Icons';

const SUGGESTIONS = ['Fiqh', 'Thaskiya', 'Arabic', 'English', 'History', 'Aqeeda', 'Akhlaq', 'Tajweed', 'Mathematics'];

interface SubjectEditorProps {
  subjects: SubjectDraft[];
  errors: Record<string, string>;
  /** subject key → number of students who already have marks for it */
  markCounts: Record<string, number>;
  onChange: (subjects: SubjectDraft[]) => void;
  onAdd: (name?: string) => void;
  onRequestRemove: (subject: SubjectDraft) => void;
  focusKey: string | null;
}

export function SubjectEditor({ subjects, errors, markCounts, onChange, onAdd, onRequestRemove, focusKey }: SubjectEditorProps) {
  const { t } = useTranslation();
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (focusKey) inputRefs.current[focusKey]?.focus();
  }, [focusKey]);

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= subjects.length) return;
    const next = [...subjects];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const rename = (key: string, name: string) => {
    onChange(subjects.map((s) => (s.key === key ? { ...s, name } : s)));
  };

  const existing = new Set(subjects.map((s) => s.name.trim().toLowerCase()));
  const suggestions = SUGGESTIONS.filter((s) => !existing.has(s.toLowerCase()));

  return (
    <div className="space-y-3">
      {subjects.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
          {t('class.noSubjectsText')}
        </p>
      )}

      <ol className="space-y-2.5">
        {subjects.map((subject, index) => {
          const error = errors[subject.key];
          const count = markCounts[subject.key] ?? 0;
          const inputId = `subject-${subject.key}`;
          return (
            <li key={subject.key} className="animate-fade-in">
              <div className="flex items-start gap-2">
                <span className="mt-3.5 w-6 shrink-0 text-right text-sm font-medium tabular-nums text-slate-400" aria-hidden="true">
                  {index + 1}.
                </span>
                <div className="min-w-0 flex-1">
                  <label htmlFor={inputId} className="sr-only">
                    {t('class.subjectIndex', { index: index + 1 })}
                  </label>
                  <input
                    id={inputId}
                    ref={(el) => {
                      inputRefs.current[subject.key] = el;
                    }}
                    className="field-input"
                    value={subject.name}
                    placeholder={t('class.subjectPlaceholder')}
                    maxLength={100}
                    autoComplete="off"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${inputId}-error` : count > 0 ? `${inputId}-count` : undefined}
                    onChange={(e) => rename(subject.key, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (index === subjects.length - 1) onAdd();
                        else inputRefs.current[subjects[index + 1].key]?.focus();
                      }
                    }}
                  />
                  {error && (
                    <p id={`${inputId}-error`} className="mt-1 text-sm font-medium text-fail-700" role="alert">
                      {error}
                    </p>
                  )}
                  {!error && count > 0 && (
                    <p id={`${inputId}-count`} className="mt-1 text-xs text-slate-500">
                      {t('class.marksEnteredCount', { count })}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    className="flex size-12 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-35 disabled:hover:bg-white"
                    aria-label={`Move ${subject.name || `subject ${index + 1}`} up`}
                  >
                    <ArrowUpIcon />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === subjects.length - 1}
                    className="flex size-12 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-35 disabled:hover:bg-white"
                    aria-label={`Move ${subject.name || `subject ${index + 1}`} down`}
                  >
                    <ArrowDownIcon />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRequestRemove(subject)}
                    className={cx(
                      'flex size-12 items-center justify-center rounded-lg border border-slate-300 bg-white text-fail-700 hover:bg-fail-50',
                    )}
                    aria-label={`Remove ${subject.name || `subject ${index + 1}`}`}
                  >
                    <XIcon />
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <Button variant="secondary" onClick={() => onAdd()} icon={<PlusIcon />} fullWidth id="add-subject-button">
        {t('class.addSubject')}
      </Button>

      {suggestions.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">{t('class.quickAdd')}</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => onAdd(name)}
                className="min-h-9 rounded-full border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 hover:border-brand-500 hover:text-brand-700"
              >
                + {name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
