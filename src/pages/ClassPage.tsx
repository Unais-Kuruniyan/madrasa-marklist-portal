import { useMemo, useRef, useState } from 'react';
import { useAsyncData } from '../hooks/useAsyncData';
import { paths } from '../hooks/useHashRoute';
import { useTranslation } from '../i18n/context';
import { calculateSummary, evaluateStudent } from '../lib/calculations/marks';
import { deleteStudent, getClassDetail, saveExamination } from '../lib/supabase/api';
import { handleError } from '../lib/supabase/errors';
import type { Student } from '../types';
import { StudentForm } from '../components/StudentForm';
import { ImportMarkListModal } from '../components/import/ImportMarkListModal';
import { StudentTable } from '../components/StudentTable';
import { Alert } from '../components/ui/Alert';
import { Button, LinkButton } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmptyState } from '../components/ui/EmptyState';
import { ArrowLeftIcon, EditIcon, ImageIcon, PlusIcon, PrintIcon } from '../components/ui/Icons';
import { LoadingBlock } from '../components/ui/Spinner';
import { TextField } from '../components/ui/TextField';

export function ClassPage({ classId, examId }: { classId: string; examId?: string }) {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useAsyncData(() => getClassDetail(classId, examId), [classId, examId]);

  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [studentToDelete, setStudentToDelete] = useState<Student | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showPhotoImport, setShowPhotoImport] = useState(false);

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

  if (loading) return <LoadingBlock message={t('common.loading')} />;
  if (error)
    return (
      <Alert tone="error" title={t('dashboard.loadErrorTitle')} action={<Button variant="secondary" size="sm" onClick={() => void reload()}>{t('common.tryAgain')}</Button>}>
        {error}
      </Alert>
    );
  if (!data)
    return (
      <EmptyState
        title={t('class.classNotFoundTitle')}
        description={t('class.classNotFoundDesc')}
        action={<LinkButton href={paths.dashboard()}>{t('dashboard.title')}</LinkButton>}
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
    const categoryText = category === 'boys' ? t('student.boys') : t('student.girls');
    setSuccessMessage(
      wasEdit
        ? t('student.updatedSuccess', { roll: rollNumber, category: categoryText, name })
        : t('student.savedSuccess', { roll: rollNumber, category: categoryText, name }),
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
      setSuccessMessage(t('student.deletedSuccess', { name: studentToDelete.studentName }));
      await reload();
    } catch (err) {
      setActionError(handleError(err, t('student.deleteError')));
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
      setActionError(handleError(err, t('class.createExamError')));
    } finally {
      setSavingExam(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Navigation & Class/Exam Info */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between border-b border-slate-200 pb-5">
        <div className="min-w-0">
          <a
            href={paths.dashboard()}
            className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900 min-h-[36px]"
          >
            <ArrowLeftIcon className="size-3.5" /> {t('class.allClasses')}
          </a>
          <h1 className="text-xl sm:text-3xl font-bold tracking-tight text-slate-900 break-words">{schoolClass.className}</h1>
          {schoolClass.institutionName && (
            <p className="text-xs sm:text-sm font-medium text-slate-700 break-words mt-1">
              {schoolClass.institutionName}
              {schoolClass.institutionLocation ? `, ${schoolClass.institutionLocation}` : ''}
              {schoolClass.rangeName ? ` | ${t('common.range')}: ${schoolClass.rangeName}` : ''}
            </p>
          )}

          {/* Exam Selector Dropdown */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <label htmlFor="select-exam" className="text-xs font-bold uppercase text-slate-500 shrink-0">
                {t('class.examSelectLabel')}
              </label>
              <select
                id="select-exam"
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-brand-900 shadow-xs min-h-[44px] w-full sm:w-auto"
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

            <Button variant="secondary" size="sm" icon={<PlusIcon />} onClick={() => setShowNewExamModal(true)} className="min-h-[44px]">
              {t('class.newExamButton')}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto shrink-0">
          <LinkButton
            href={paths.print(schoolClass.id, examination.id)}
            variant="primary"
            size="md"
            icon={<PrintIcon />}
            id="print-marklist-btn"
            className="flex-1 sm:flex-initial min-h-[44px] justify-center"
          >
            {t('common.printMarkList')}
          </LinkButton>
          <LinkButton href={paths.editClass(schoolClass.id)} variant="secondary" size="md" icon={<EditIcon />} id="edit-class-btn" className="flex-1 sm:flex-initial min-h-[44px] justify-center">
            {t('class.editClass')}
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
                <EditIcon className="size-5 text-brand-600" /> {t('class.editingStudentTitle', {
                  roll: editingStudent.rollNumber,
                  category: editingStudent.category === 'boys' ? t('student.boys') : t('student.girls'),
                  name: editingStudent.studentName,
                })}
              </>
            ) : (
              <>
                <PlusIcon className="size-5 text-brand-600" /> {t('class.enterMarksTitle', { exam: examination.examName, year: examination.examYear })}
              </>
            )}
          </h2>
          {!editingStudent && (
            <Button
              variant="secondary"
              size="sm"
              icon={<ImageIcon className="size-4" />}
              onClick={() => {
                setSuccessMessage(null);
                setShowPhotoImport(true);
              }}
              id="import-from-photo-btn"
            >
              {t('photoImport.importFromPhoto')}
            </Button>
          )}
          {editingStudent && (
            <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
              {t('class.cancelEdit')}
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
            {t('class.markListTitle', { exam: examination.examName, year: examination.examYear, count: students.length })}
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

      {showPhotoImport && (
        <ImportMarkListModal
          detail={data}
          onClose={() => setShowPhotoImport(false)}
          onImported={(count) => {
            setShowPhotoImport(false);
            setSuccessMessage(t('photoImport.importedSuccess', { count }));
            void reload();
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmDialog
        open={studentToDelete !== null}
        title={t('student.deleteConfirmTitle', { name: studentToDelete?.studentName ?? '' })}
        confirmLabel={t('student.deleteConfirmButton')}
        danger
        loading={deleting}
        onCancel={() => setStudentToDelete(null)}
        onConfirm={() => void confirmDeleteStudent()}
      >
        <p>
          {t('student.deleteConfirmBody', {
            roll: studentToDelete?.rollNumber ?? 0,
            category: studentToDelete?.category === 'boys' ? t('student.boys') : t('student.girls'),
            name: studentToDelete?.studentName ?? '',
          })}
        </p>
      </ConfirmDialog>

      {/* Create New Examination Modal */}
      {showNewExamModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-slate-900">{t('class.newExamModalTitle')}</h3>
            <p className="text-xs text-slate-500">
              {t('class.newExamModalDesc', { name: schoolClass.className })}
            </p>

            <TextField
              label={t('exam.name')}
              id="new-exam-name"
              value={newExamName}
              onChange={(e) => setNewExamName(e.target.value)}
              placeholder="e.g. Annual Examination"
            />

            <TextField
              label={t('exam.year')}
              id="new-exam-year"
              value={newExamYear}
              onChange={(e) => setNewExamYear(e.target.value)}
              placeholder="e.g. 2026"
              inputMode="numeric"
            />

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setShowNewExamModal(false)} disabled={savingExam}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" onClick={() => void handleCreateNewExam()} loading={savingExam}>
                {t('class.createExamButton')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
