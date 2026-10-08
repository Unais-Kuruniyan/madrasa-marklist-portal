import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, '../.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const match = line.match(/^\s*([\w]+)\s*=\s*(.*)\s*$/);
  if (match) {
    env[match[1]] = match[2].trim();
  }
}

const url = env.VITE_SUPABASE_URL;
const anonKey = env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(url, anonKey);

async function verifyFullEditWorkflow() {
  console.log('==================================================');
  console.log('VERIFYING EDIT CLASS WORKFLOW WITH SUPABASE BACKEND');
  console.log('==================================================');

  // Step 1: Fetch initial classes
  const { data: initialClasses, error: listErr } = await supabase
    .from('classes')
    .select('*, subjects(*), examinations(*)')
    .order('updated_at', { ascending: false });

  if (listErr) throw listErr;
  console.log(`[Step 1] Loaded ${initialClasses.length} existing classes.`);

  const testClass = initialClasses[0];
  console.log(`[Step 2] Selected class: ID=${testClass.id}, Name="${testClass.class_name}"`);

  // Step 3: Mutate fields
  const timestamp = Date.now().toString().slice(-4);
  const newClassName = `2A-${timestamp}`;
  const newInstName = `Darussalam Madrasa ${timestamp}`;
  const newInstLoc = `Munambath ${timestamp}`;
  const newRangeName = `Othukkungal ${timestamp}`;
  const newTotalStudents = 32;

  const normalSubjects = testClass.subjects.filter(s => s.kind === 'normal').map(s => ({ id: s.id, name: s.name }));
  const existingExam = testClass.examinations[0];

  console.log(`[Step 3] Editing fields -> ClassName="${newClassName}", InstName="${newInstName}", Location="${newInstLoc}", Range="${newRangeName}"`);

  // Step 4: Perform save (calling save_class + save_examination update)
  const { data: saveRes, error: saveErr } = await supabase.rpc('save_class', {
    p_class_id: testClass.id,
    p_institution_name: newInstName,
    p_institution_location: newInstLoc,
    p_range_name: newRangeName,
    p_class_name: newClassName,
    p_total_students: newTotalStudents,
    p_include_quran_hifz: testClass.include_quran_hifz,
    p_subjects: normalSubjects,
    p_exam_name: existingExam.exam_name,
    p_exam_year: existingExam.exam_year,
  });

  if (saveErr) throw saveErr;

  if (existingExam?.id) {
    await supabase.rpc('save_examination', {
      p_class_id: testClass.id,
      p_exam_id: existingExam.id,
      p_exam_name: existingExam.exam_name,
      p_exam_year: existingExam.exam_year,
    });
  }

  console.log('[Step 5] Save successful. Response:', saveRes);

  // Step 6: Fresh DB Query (Simulate Page Reload / Dashboard open)
  console.log('[Step 6] Performing FRESH database query to verify persistence...');
  const { data: freshClass, error: fetchErr } = await supabase
    .from('classes')
    .select('*, subjects(*), examinations(*)')
    .eq('id', testClass.id)
    .single();

  if (fetchErr) throw fetchErr;

  console.log('[Step 7] Freshly retrieved record from Supabase:');
  console.log('  - Class Name:', freshClass.class_name);
  console.log('  - Institution Name:', freshClass.institution_name);
  console.log('  - Location:', freshClass.institution_location);
  console.log('  - Range:', freshClass.range_name);
  console.log('  - Total Students:', freshClass.total_students);

  // Assertions
  if (freshClass.class_name !== newClassName) throw new Error(`Class name mismatch! Expected ${newClassName}, got ${freshClass.class_name}`);
  if (freshClass.institution_name !== newInstName) throw new Error(`Institution mismatch!`);
  if (freshClass.institution_location !== newInstLoc) throw new Error(`Location mismatch!`);
  if (freshClass.range_name !== newRangeName) throw new Error(`Range mismatch!`);
  if (freshClass.total_students !== newTotalStudents) throw new Error(`Total students mismatch!`);

  // Step 8: Verify students & marks under existing exam
  const { data: studentRecords, error: stErr } = await supabase
    .from('students')
    .select('*, marks(*)')
    .eq('exam_id', existingExam.id);

  if (stErr) throw stErr;
  console.log(`[Step 8] Verified existing examination (ID=${existingExam.id}). Student count: ${studentRecords.length}`);

  console.log('\n==================================================');
  console.log('✅ ALL VERIFICATION STEPS PASSED SUCCESSFULLY!');
  console.log('==================================================');
}

verifyFullEditWorkflow().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
