import { useMemo, useRef, useState } from 'react';
import { useAsyncData } from '../hooks/useAsyncData';
import { paths } from '../hooks/useHashRoute';
import { calculateSummary, evaluateStudent } from '../lib/calculations/marks';
import { deleteStudent, getClassDetail } from '../lib/supabase/api';
import { handleError } from '../lib/supabase/errors';
import type { Student } from '../types';
import { StudentForm } from '../components/StudentForm';
import { StudentTable } from '../components/StudentTable';
import { Alert } from '../components/ui/Alert';
import { Button, LinkButton } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmptyState } from '../components/ui/EmptyState';
import { ArrowLeftIcon, EditIcon, PlusIcon, PrintIcon } from '../components/ui/Icons';
import { LoadingBlock } from '../components/ui/Spinner';

export function ClassPage({ classId }: { classId: string }) {
  const { data, loading, error, reload } = useAsyncData(() => getClassDetail(classId), [classId]);

  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [studentToDelete, setStudentToDelete] = useState<Student | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const formCardRef = useRef<HTMLDivElement>(null);

  const evaluated = useMemo(() => {
    if (!data) return [];
    return data.students.map((s) => evaluateStudent(data.config, s));
  }, [data]);

  const summary = useMemo(() => {
    if (!data) return { totalStudents: 0, appeared: 0, passed: 0, failed: 0, absent: 0, incomplete: 0, passPercentage: 0 };
    return calculateSummary(data.schoolClass.totalStudents, evaluated);
  }, [data, evaluated]);

  if (loading) return <LoadingBlock message="Loading mark list..." />;
  if (error)
    return (
      <Alert tone="error" title="Could not load class" action={<Button variant="secondary" size="sm" onClick={() => void reload()}>Try again</Button>}>
        {error}
      </Alert>
    );
  if (!data)
    return (
      <EmptyState
        title="Class not found"
        description="This class might have been deleted or the link is invalid."
        action={<LinkButton href={paths.dashboard()}>Back to Dashboard</LinkButton>}
      />
    );

  const { schoolClass, config, students } = data;

  const handleEditStudent = (student: Student) => {
    setEditingStudent(student);
    setSuccessMessage(null);
    formCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleCancelEdit = () => {
    setEditingStudent(null);
  };

  const handleStudentSaved = ({ name, rollNumber, wasEdit }: { name: string; rollNumber: number; wasEdit: boolean }) => {
    setSuccessMessage(wasEdit ? `Updated marks for Roll ${rollNumber} (${name})` : `Saved Roll ${rollNumber} (${name})`);
    if (wasEdit) setEditingStudent(null);
    void reload();
  };

  const confirmDeleteStudent = async () => {
    if (!studentToDelete) return;
    setDeleting(true);
    setActionError(null);
    try {
      await deleteStudent(studentToDelete.id);
      setStudentToDelete(null);
      if (editingStudent?.id === studentToDelete.id) setEditingStudent(null);
      setSuccessMessage(`Deleted student ${studentToDelete.studentName}`);
      await reload();
    } catch (err) {
      setActionError(handleError(err, 'Could not delete student.'));
      setStudentToDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header Navigation & Meta */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between border-b border-slate-200 pb-5">
        <div>
          <a
            href={paths.dashboard()}
            className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900"
          >
            <ArrowLeftIcon className="size-3.5" /> All Classes
          </a>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{schoolClass.className}</h1>
          {schoolClass.institutionName && (
            <p className="text-sm font-medium text-slate-600">
              {schoolClass.institutionName}
              {schoolClass.institutionLocation ? `, ${schoolClass.institutionLocation}` : ''}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-md bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">
              {schoolClass.totalStudents} Max Students
            </span>
            <span className="rounded-md bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">
              {config.normalSubjects.length} Normal Subject{config.normalSubjects.length === 1 ? '' : 's'}
            </span>
            {config.includeQuranHifz && (
              <span className="rounded-md bg-brand-100 px-2.5 py-1 font-bold text-brand-800">
                + Quran &amp; Hifz Enabled
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <LinkButton href={paths.print(schoolClass.id)} variant="primary" size="md" icon={<PrintIcon />} id="print-marklist-btn">
            Print Mark List
          </LinkButton>
          <LinkButton href={paths.editClass(schoolClass.id)} variant="secondary" size="md" icon={<EditIcon />} id="edit-class-btn">
            Edit Class
          </LinkButton>
        </div>
      </div>

      {actionError && <Alert tone="error">{actionError}</Alert>}
      {successMessage && <Alert tone="success">{successMessage}</Alert>}

      {/* Student Entry Card */}
      <div ref={formCardRef} className="card p-4 sm:p-6 bg-slate-50/50 border-brand-200 shadow-sm">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-200">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            {editingStudent ? (
              <>
                <EditIcon className="size-5 text-brand-600" /> Editing Roll {editingStudent.rollNumber}: {editingStudent.studentName}
              </>
            ) : (
              <>
                <PlusIcon className="size-5 text-brand-600" /> Enter Student Marks
              </>
            )}
          </h2>
          {editingStudent && (
            <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
              Cancel Edit
            </Button>
          )}
        </div>

        <StudentForm
          detail={data}
          editing={editingStudent}
          onSaved={handleStudentSaved}
          onCancelEdit={handleCancelEdit}
        />
      </div>

      {/* Mark List Table & Statistics */}
      <section className="space-y-3" aria-labelledby="marklist-heading">
        <div className="flex items-center justify-between">
          <h2 id="marklist-heading" className="text-xl font-bold text-slate-900">
            Class Mark List <span className="text-sm font-normal text-slate-500">({students.length} entered)</span>
          </h2>
        </div>

        <StudentTable
          config={config}
          students={students}
          summary={summary}
          onEditStudent={handleEditStudent}
          onDeleteStudent={setStudentToDelete}
        />
      </section>

      {/* Delete Confirmation Modal */}
      <ConfirmDialog
        open={studentToDelete !== null}
        title={`Delete student "${studentToDelete?.studentName}"?`}
        confirmLabel="Delete Student"
        danger
        loading={deleting}
        onCancel={() => setStudentToDelete(null)}
        onConfirm={() => void confirmDeleteStudent()}
      >
        <p>
          This will permanently delete <strong>Roll {studentToDelete?.rollNumber} ({studentToDelete?.studentName})</strong> and all their entered marks.
        </p>
        <p>This action cannot be undone.</p>
      </ConfirmDialog>
    </div>
  );
}
