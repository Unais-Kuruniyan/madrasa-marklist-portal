import { useMemo, useState } from 'react';
import { useAsyncData } from '../hooks/useAsyncData';
import { navigate, paths } from '../hooks/useHashRoute';
import { useTranslation } from '../i18n/context';
import { deleteClass, listClasses } from '../lib/supabase/api';
import { handleError } from '../lib/supabase/errors';
import type { ClassListItem } from '../types';
import { ClassCard } from '../components/ClassCard';
import { Alert } from '../components/ui/Alert';
import { Button, LinkButton } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmptyState } from '../components/ui/EmptyState';
import { PlusIcon, RefreshIcon, SearchIcon } from '../components/ui/Icons';
import { Skeleton } from '../components/ui/Spinner';

export function DashboardPage() {
  const { t } = useTranslation();
  const { data, loading, error, reload, refreshing } = useAsyncData(listClasses, []);
  const [query, setQuery] = useState('');
  const [toDelete, setToDelete] = useState<ClassListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const classes = useMemo(() => data ?? [], [data]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return classes;
    return classes.filter((c) =>
      `${c.className} ${c.institutionName} ${c.institutionLocation} ${c.rangeName}`.toLowerCase().includes(q),
    );
  }, [classes, query]);

  const sortedForSelect = useMemo(
    () => [...classes].sort((a, b) => a.className.localeCompare(b.className, undefined, { numeric: true })),
    [classes],
  );

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    setActionError(null);
    try {
      await deleteClass(toDelete.id);
      setToDelete(null);
      await reload();
    } catch (err) {
      setActionError(handleError(err, t('dashboard.deleteError')));
      setToDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{t('dashboard.title')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('dashboard.subtitle')}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-end">
          <LinkButton href={paths.newClass()} variant="primary" size="lg" icon={<PlusIcon />} id="create-class-button">
            {t('dashboard.createNewClass')}
          </LinkButton>

          {classes.length > 0 && (
            <div className="sm:max-w-sm">
              <label htmlFor="select-class" className="mb-1.5 block text-sm font-medium text-slate-700">
                {t('dashboard.selectExistingClass')}
              </label>
              <select
                id="select-class"
                className="field-input"
                value=""
                onChange={(e) => e.target.value && navigate(paths.classPage(e.target.value))}
              >
                <option value="">{t('dashboard.chooseClassPlaceholder')}</option>
                {sortedForSelect.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.className}
                    {c.institutionName ? ` — ${c.institutionName}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </section>

      {actionError && <Alert tone="error">{actionError}</Alert>}

      <section aria-labelledby="classes-heading" className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="classes-heading" className="text-lg font-semibold text-slate-900">
            {t('dashboard.existingClasses')} {classes.length > 0 && <span className="font-normal text-slate-400">({classes.length})</span>}
          </h2>
          {classes.length > 0 && (
            <div className="relative sm:w-72">
              <label htmlFor="class-search" className="sr-only">
                {t('dashboard.searchPlaceholder')}
              </label>
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
              <input
                id="class-search"
                type="search"
                className="field-input pl-10"
                placeholder={t('dashboard.searchPlaceholder')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
              />
            </div>
          )}
        </div>

        {loading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label={t('common.loading')}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="card space-y-3 p-5">
                <Skeleton className="h-6 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-11 w-full" />
              </div>
            ))}
          </div>
        )}

        {!loading && error && (
          <Alert
            tone="error"
            title={t('dashboard.loadErrorTitle')}
            action={
              <Button variant="secondary" size="sm" onClick={() => void reload()} loading={refreshing} icon={<RefreshIcon className="size-4" />}>
                {t('common.tryAgain')}
              </Button>
            }
          >
            {error}
          </Alert>
        )}

        {!loading && !error && classes.length === 0 && (
          <EmptyState
            title={t('dashboard.noClassesTitle')}
            description={t('dashboard.noClassesDescription')}
            action={
              <LinkButton href={paths.newClass()} variant="primary" icon={<PlusIcon />}>
                {t('dashboard.createFirstClass')}
              </LinkButton>
            }
          />
        )}

        {!loading && !error && classes.length > 0 && filtered.length === 0 && (
          <EmptyState
            title={t('dashboard.noMatchingClassesTitle')}
            description={t('dashboard.noMatchingClassesDescription', { query })}
            action={
              <Button variant="secondary" onClick={() => setQuery('')}>
                {t('dashboard.clearSearch')}
              </Button>
            }
          />
        )}

        {filtered.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((item) => (
              <ClassCard key={item.id} item={item} onDelete={setToDelete} />
            ))}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={toDelete !== null}
        title={t('dashboard.deleteConfirmTitle', { name: toDelete?.className ?? '' })}
        confirmLabel={t('dashboard.deleteConfirmButton')}
        danger
        loading={deleting}
        onCancel={() => setToDelete(null)}
        onConfirm={() => void confirmDelete()}
      >
        <p>{t('dashboard.deleteConfirmBody')}</p>
      </ConfirmDialog>
    </div>
  );
}
