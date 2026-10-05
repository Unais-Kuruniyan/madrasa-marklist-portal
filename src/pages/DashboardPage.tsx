import { useMemo, useState } from 'react';
import { useAsyncData } from '../hooks/useAsyncData';
import { navigate, paths } from '../hooks/useHashRoute';
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
      `${c.className} ${c.institutionName} ${c.institutionLocation}`.toLowerCase().includes(q),
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
      setActionError(handleError(err, 'Could not delete the class. Please try again.'));
      setToDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">School Mark List</h1>
          <p className="mt-1 text-sm text-slate-500">Create a class, enter marks, and print the official mark list.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-end">
          <LinkButton href={paths.newClass()} variant="primary" size="lg" icon={<PlusIcon />} id="create-class-button">
            Create New Class
          </LinkButton>

          {classes.length > 0 && (
            <div className="sm:max-w-sm">
              <label htmlFor="select-class" className="mb-1.5 block text-sm font-medium text-slate-700">
                Select existing class
              </label>
              <select
                id="select-class"
                className="field-input"
                value=""
                onChange={(e) => e.target.value && navigate(paths.classPage(e.target.value))}
              >
                <option value="">Choose a class…</option>
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
            Classes {classes.length > 0 && <span className="font-normal text-slate-400">({classes.length})</span>}
          </h2>
          {classes.length > 0 && (
            <div className="relative sm:w-72">
              <label htmlFor="class-search" className="sr-only">
                Search class
              </label>
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
              <input
                id="class-search"
                type="search"
                className="field-input pl-10"
                placeholder="Search class…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
              />
            </div>
          )}
        </div>

        {loading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Loading classes">
            <span className="sr-only">Loading classes…</span>
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
            title="Could not load classes"
            action={
              <Button variant="secondary" size="sm" onClick={() => void reload()} loading={refreshing} icon={<RefreshIcon className="size-4" />}>
                Try again
              </Button>
            }
          >
            {error}
          </Alert>
        )}

        {!loading && !error && classes.length === 0 && (
          <EmptyState
            title="No classes created yet"
            description="Start by creating your first class. You will add its subjects and then enter each student's marks."
            action={
              <LinkButton href={paths.newClass()} variant="primary" icon={<PlusIcon />}>
                Create your first class
              </LinkButton>
            }
          />
        )}

        {!loading && !error && classes.length > 0 && filtered.length === 0 && (
          <EmptyState
            title="No matching classes"
            description={<>No class matches “{query}”. Try a different search.</>}
            action={
              <Button variant="secondary" onClick={() => setQuery('')}>
                Clear search
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
        title={`Delete “${toDelete?.className ?? ''}”?`}
        confirmLabel="Delete class"
        danger
        loading={deleting}
        onCancel={() => setToDelete(null)}
        onConfirm={() => void confirmDelete()}
      >
        <p>
          This will <strong>permanently delete</strong> the class, its subjects, all{' '}
          <strong>{toDelete?.studentCount ?? 0} student(s)</strong> and all their marks.
        </p>
        <p>This cannot be undone.</p>
      </ConfirmDialog>
    </div>
  );
}
