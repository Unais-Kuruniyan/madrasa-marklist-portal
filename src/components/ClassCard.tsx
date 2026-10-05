import type { ClassListItem } from '../types';
import { paths } from '../hooks/useHashRoute';
import { LinkButton, Button } from './ui/Button';
import { BookIcon, EditIcon, PrintIcon, TrashIcon, UsersIcon } from './ui/Icons';

interface ClassCardProps {
  item: ClassListItem;
  onDelete: (item: ClassListItem) => void;
}

export function ClassCard({ item, onDelete }: ClassCardProps) {
  const progress = item.totalStudents > 0 ? Math.min(100, Math.round((item.studentCount / item.totalStudents) * 100)) : 0;

  return (
    <article className="card animate-fade-in flex flex-col p-4 sm:p-5" aria-labelledby={`class-${item.id}-title`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`class-${item.id}-title`} className="break-words text-lg font-semibold text-slate-900">
            <a href={paths.classPage(item.id)} className="rounded hover:text-brand-700">
              {item.className}
            </a>
          </h3>
          {item.institutionName && (
            <p className="mt-0.5 truncate text-sm text-slate-500" title={item.institutionName}>
              {item.institutionName}
            </p>
          )}
        </div>
        {item.includeQuranHifz ? (
          <span className="shrink-0 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 ring-1 ring-brand-100">
            Quran + Hifz
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
            No Quran/Hifz
          </span>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="flex items-center gap-2 text-slate-600">
          <UsersIcon className="size-4 shrink-0 text-slate-400" />
          <div>
            <dt className="sr-only">Students entered</dt>
            <dd>
              <span className="font-semibold text-slate-900">{item.studentCount}</span> / {item.totalStudents} students
            </dd>
          </div>
        </div>
        <div className="flex items-center gap-2 text-slate-600">
          <BookIcon className="size-4 shrink-0 text-slate-400" />
          <div>
            <dt className="sr-only">Subjects</dt>
            <dd>
              <span className="font-semibold text-slate-900">
                {item.normalSubjectCount + (item.includeQuranHifz ? 1 : 0)}
              </span>{' '}
              subject{item.normalSubjectCount + (item.includeQuranHifz ? 1 : 0) === 1 ? '' : 's'}
            </dd>
          </div>
        </div>
      </dl>

      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-label="Students entered"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${progress}%` }} />
      </div>

      <div className="mt-5 grid grid-cols-[1fr_auto_auto_auto] gap-2">
        <LinkButton href={paths.classPage(item.id)} variant="primary" id={`open-class-${item.id}`}>
          Open Mark List
        </LinkButton>
        <LinkButton href={paths.print(item.id)} variant="secondary" aria-label={`Print ${item.className}`} id={`print-class-${item.id}`} className="px-3">
          <PrintIcon />
        </LinkButton>
        <LinkButton href={paths.editClass(item.id)} variant="secondary" aria-label={`Edit ${item.className}`} id={`edit-class-${item.id}`} className="px-3">
          <EditIcon />
        </LinkButton>
        <Button variant="secondary" onClick={() => onDelete(item)} aria-label={`Delete ${item.className}`} id={`delete-class-${item.id}`} className="px-3 text-fail-700">
          <TrashIcon />
        </Button>
      </div>
    </article>
  );
}
