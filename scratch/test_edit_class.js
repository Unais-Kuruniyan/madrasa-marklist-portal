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

async function testSaveExaminationUpdate() {
  console.log('--- Test save_examination update ---');
  const { data: classes } = await supabase.from('classes').select('*, examinations(*)').limit(1);
  if (!classes || classes.length === 0) return;

  const target = classes[0];
  const exam = target.examinations[0];
  console.log('Existing Exam before update:', exam);

  const { data: updatedExamId, error: examErr } = await supabase.rpc('save_examination', {
    p_class_id: target.id,
    p_exam_id: exam.id,
    p_exam_name: 'Updated Exam Title',
    p_exam_year: 2026,
  });

  if (examErr) {
    console.error('save_examination error:', examErr);
  } else {
    console.log('save_examination returned ID:', updatedExamId);
  }

  const { data: checkExam } = await supabase.from('examinations').select('*').eq('id', exam.id).single();
  console.log('Existing Exam after update:', checkExam);
}

testSaveExaminationUpdate();
