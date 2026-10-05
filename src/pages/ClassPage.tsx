import { useMemo, useRef, useState } from 'react';
import { useAsyncData } from '../hooks/useAsyncData';
import { paths } from '../hooks/useHashRoute';
import { calculateSummary, evaluateStudent } from '../lib/calculations/marks';
import { deleteStudent, getClassDetail, saveExamination } from '../lib/supabase/api';
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
import { TextField } from '../components/ui/TextField';

export function ClassPage({ classId, examId }: { classId: string; examId?: string }) {
  const { data, loading, error, reload } = useAsyncData(() => getClassDetail(classId, examId), [classId, examId]);

  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [studentToDelete, setStudentToDelete] = useState<Student | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // New Exam Modal state
  const [showNewExamModal, setShowNewExamModal] = useState(false);
  const [newExamName, setNewExamName] = useState('Annual Examination');
  const [newExamYear, setNewExamYear] = useState(String(new Date().getFullYear()));
  const [savingExam, setSavingExam] = useState(false);

  const formCardRef = useRef<HTMLDivElement>(null);

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

  const { schoolClass, examination, allExaminations, config, students } = data;

  const handleEditStudent = (student: Student) => {
    setEditingStudent(student);
    setSuccessMessage(null);
    formCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleCancelEdit = () => {
    setEditingStudent(null);
  };

  const handleStudentSaved = ({ name, rollNumber, category, wasEdit }: { name: string; rollNumber: number; category: string; wasEdit: boolean }) => {
    setSuccessMessage(
      wasEdit
        ? `Updated Roll ${rollNumber} (${category === 'boys' ? 'Boys' : 'Girls'}) — ${name}`
        : `Saved Roll ${rollNumber} (${category === 'boys' ? 'Boys' : 'Girls'}) — ${name}`,
    );
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

  const handleCreateNewExam = async () => {
    if (!newExamName.trim()) return;
    setSavingExam(true);
    setActionError(null);
    try {
      const yr = Number(newExamYear) || new Date().getFullYear();
      const createdExamId = await saveExamination(schoolClass.id, newExamName.trim(), yr);
      setShowNewExamModal(false);
      window.location.hash = paths.classPage(schoolClass.id, createdExamId);
    } catch (err) {
      setActionError(handleError(err, 'Could not create new examination.'));
    } finally {
      setSavingExam(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Navigation & Class/Exam Info */}
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
            <p className="text-sm font-medium text-slate-700">
              {schoolClass.institutionName}
              {schoolClass.institutionLocation ? `, ${schoolClass.institutionLocation}` : ''}
              {schoolClass.rangeName ? ` | Range: ${schoolClass.rangeName}` : ''}
            </p>
          )}

          {/* Exam Selector Dropdown */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <label htmlFor="select-exam" className="text-xs font-bold uppercase text-slate-500">
                Exam:
              </label>
              <select
                id="select-exam"
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-brand-900 shadow-xs"
                value={examination.id}
                onChange={(e) => {
                  window.location.hash = paths.classPage(schoolClass.id, e.target.value);
                }}
              >
                {allExaminations.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.examName} — {ex.examYear}
                  </option>
                ))}
              </select>
            </div>

            <Button variant="secondary" size="sm" icon={<PlusIcon />} onClick={() => setShowNewExamModal(true)}>
              New Exam
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <LinkButton
            href={paths.print(schoolClass.id, examination.id)}
            variant="primary"
            size="md"
            icon={<PrintIcon />}
            id="print-marklist-btn"
          >
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
                <EditIcon className="size-5 text-brand-600" /> Editing Roll {editingStudent.rollNumber} ({editingStudent.category === 'boys' ? 'Boys' : 'Girls'}): {editingStudent.studentName}
              </>
            ) : (
              <>
                <PlusIcon className="size-5 text-brand-600" /> Enter Student Marks ({examination.examName} — {examination.examYear})
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
            {examination.examName} — {examination.examYear} Mark List <span className="text-sm font-normal text-slate-500">({students.length} entered)</span>
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
          This will permanently delete <strong>Roll {studentToDelete?.rollNumber} ({studentToDelete?.category === 'boys' ? 'Boys' : 'Girls'}) — {studentToDelete?.studentName}</strong> and all their entered marks for this examination.
        </p>
      </ConfirmDialog>

      {/* Create New Examination Modal */}
      {showNewExamModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Create New Examination</h3>
            <p className="text-xs text-slate-500">
              Create another examination (e.g. Annual Exam) under {schoolClass.className}. Previous exam results will be preserved!
            </p>

            <TextField
              label="Examination Name"
              id="new-exam-name"
              value={newExamName}
              onChange={(e) => setNewExamName(e.target.value)}
              placeholder="e.g. Annual Examination"
            />

            <TextField
              label="Exam Year"
              id="new-exam-year"
              value={newExamYear}
              onChange={(e) => setNewExamYear(e.target.value)}
              placeholder="e.g. 2026"
              inputMode="numeric"
            />

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setShowNewExamModal(false)} disabled={savingExam}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void handleCreateNewExam()} loading={savingExam}>
                Create Exam
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
