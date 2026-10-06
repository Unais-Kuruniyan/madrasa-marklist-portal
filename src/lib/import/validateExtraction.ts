/**
 * Strict server-side validation of the model's JSON output.
 *
 * The model response is NEVER trusted just because it is "valid JSON":
 * structure, enums, numeric ranges, lengths and column references are all
 * re-checked here. Structurally broken output is rejected with an ImportError;
 * individually bad values (e.g. a mark of 105) are neutralised and surfaced as
 * "unreadable" so the teacher must review them.
 */
import {
  ImportError,
  MAX_COLUMNS,
  MAX_NAME_LENGTH,
  MAX_STUDENTS,
  MAX_TEXT_LENGTH,
  type BoundingBox,
  type CellStatus,
  type ColumnKind,
  type Confidence,
  type DocumentMetadata,
  type ExtractedCategory,
  type ExtractedCell,
  type ExtractedColumn,
  type ExtractedStudent,
  type ExtractionResult,
} from './types.js';

const COLUMN_KINDS: ColumnKind[] = ['subject', 'quran', 'hifz', 'quranHifzTotal', 'grandTotal', 'other'];
const CELL_STATUSES: CellStatus[] = ['value', 'absent', 'blank', 'unreadable'];
const CONFIDENCES: Confidence[] = ['high', 'medium', 'low'];
const MAX_WARNINGS = 20;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Parses the model's text into JSON (tolerates ``` fences). */
export function parseModelJson(text: string | undefined | null): unknown {
  if (!text || !text.trim()) throw new ImportError('malformedResponse', 'Empty model response');
  let body = text.trim();
  const fence = body.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) body = fence[1];
  try {
    return JSON.parse(body);
  } catch {
    throw new ImportError('malformedResponse', 'Model response is not valid JSON');
  }
}

function cleanText(v: unknown, max = MAX_TEXT_LENGTH): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

function confidenceOf(v: unknown): Confidence {
  return typeof v === 'string' && (CONFIDENCES as string[]).includes(v) ? (v as Confidence) : 'low';
}

/** Normalized bounding box 0..1000: [ymin, xmin, ymax, xmax] */
function parseBox(v: unknown): BoundingBox | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const numbers = v.map((n) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1000, Math.round(n))) : null));
  if (numbers.some((n) => n === null)) return null;
  const [ymin, xmin, ymax, xmax] = numbers as BoundingBox;
  if (ymax <= ymin || xmax <= xmin) return null;
  return [ymin, xmin, ymax, xmax];
}

/** Whole number in [min, max] or null. Accepts numeric strings like "12". */
function intInRange(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v;
  if (typeof n !== 'number' || !Number.isInteger(n)) return null;
  return n >= min && n <= max ? n : null;
}

/** Valid mark: finite number between 0 and 100 with at most 2 decimals. */
export function isValidMarkValue(v: unknown): v is number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  if (v < 0 || v > 100) return false;
  return Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
}

export function validateExtraction(raw: unknown): ExtractionResult {
  if (!isObj(raw)) throw new ImportError('malformedResponse', 'Root is not an object');
  if (!Array.isArray(raw.columns) || !Array.isArray(raw.students)) {
    throw new ImportError('malformedResponse', 'columns/students missing');
  }
  if (raw.columns.length > MAX_COLUMNS || raw.students.length > MAX_STUDENTS) {
    throw new ImportError('malformedResponse', 'Too many columns or students');
  }

  const warnings: string[] = [];
  if (Array.isArray(raw.warnings)) {
    for (const w of raw.warnings) {
      const text = cleanText(w, 300);
      if (text && warnings.length < MAX_WARNINGS) warnings.push(text);
    }
  }

  /* ---- columns ---- */
  const columns: ExtractedColumn[] = [];
  const seenIndexes = new Set<number>();
  for (const c of raw.columns) {
    if (!isObj(c)) throw new ImportError('malformedResponse', 'Column is not an object');
    const index = intInRange(c.index, 0, 999);
    const header = cleanText(c.header, 100);
    const kind = typeof c.kind === 'string' && (COLUMN_KINDS as string[]).includes(c.kind) ? (c.kind as ColumnKind) : null;
    const confidence = confidenceOf(c.confidence);
    const box = parseBox(c.box);
    if (index === null || !header || kind === null) {
      throw new ImportError('malformedResponse', 'Column has invalid index/header/kind');
    }
    if (seenIndexes.has(index)) throw new ImportError('malformedResponse', 'Duplicate column index');
    seenIndexes.add(index);
    columns.push({ index, header, kind, confidence, box });
  }
  if (columns.length === 0) throw new ImportError('noTable');

  /* ---- students ---- */
  const students: ExtractedStudent[] = [];
  let invalidCellCount = 0;
  for (const s of raw.students) {
    if (!isObj(s)) throw new ImportError('malformedResponse', 'Student is not an object');
    if (s.cells !== undefined && !Array.isArray(s.cells)) {
      throw new ImportError('malformedResponse', 'Student cells is not an array');
    }

    const category: ExtractedCategory | null = s.category === 'boys' || s.category === 'girls' ? s.category : null;
    const rollNumber = intInRange(s.rollNumber, 1, 99999);
    const name = cleanText(s.name, MAX_NAME_LENGTH);
    const studentBox = parseBox(s.box);

    const cells: ExtractedCell[] = [];
    const usedColumns = new Set<number>();
    for (const c of (s.cells as unknown[] | undefined) ?? []) {
      if (!isObj(c)) throw new ImportError('malformedResponse', 'Cell is not an object');
      const columnIndex = intInRange(c.columnIndex, 0, 999);
      if (columnIndex === null || !seenIndexes.has(columnIndex) || usedColumns.has(columnIndex)) {
        invalidCellCount++;
        continue;
      }
      usedColumns.add(columnIndex);

      let status: CellStatus =
        typeof c.status === 'string' && (CELL_STATUSES as string[]).includes(c.status) ? (c.status as CellStatus) : 'unreadable';
      let value: number | null = null;
      let confidence = confidenceOf(c.confidence);
      const box = parseBox(c.box);

      if (status === 'value') {
        if (isValidMarkValue(c.value)) {
          value = c.value;
        } else {
          // out of range / wrong type → never accept silently
          status = 'unreadable';
          confidence = 'low';
          invalidCellCount++;
        }
      }
      if (status === 'unreadable') confidence = 'low';
      cells.push({ columnIndex, status, value, confidence, box });
    }

    // Skip rows that carry no information at all
    if (name === null && rollNumber === null && cells.every((c) => c.status === 'blank')) continue;

    students.push({
      category,
      rollNumber,
      name,
      categoryConfidence: category === null ? 'low' : confidenceOf(s.categoryConfidence),
      rollConfidence: rollNumber === null ? 'low' : confidenceOf(s.rollConfidence),
      nameConfidence: name === null ? 'low' : confidenceOf(s.nameConfidence),
      box: studentBox,
      cells,
    });
  }
  if (students.length === 0) throw new ImportError('noStudents');
  if (invalidCellCount > 0 && warnings.length < MAX_WARNINGS) {
    warnings.push(`${invalidCellCount} cell(s) had invalid values and were marked unreadable.`);
  }

  /* ---- header metadata ---- */
  const inst = isObj(raw.institution) ? raw.institution : isObj(raw.documentMetadata) && isObj(raw.documentMetadata.institution) ? raw.documentMetadata.institution : raw;
  const exam = isObj(raw.exam) ? raw.exam : isObj(raw.documentMetadata) && isObj(raw.documentMetadata.exam) ? raw.documentMetadata.exam : raw;
  const meta = isObj(raw.documentMetadata) ? raw.documentMetadata : raw;
  const confObj = isObj(meta.confidence) ? meta.confidence : isObj(raw.confidence) ? raw.confidence : {};

  const instName = cleanText(inst.institutionName ?? inst.name);
  const loc = cleanText(inst.location);
  const rng = cleanText(inst.range);
  const exName = cleanText(exam.examName ?? exam.name, 100);
  const exYr = intInRange(exam.examYear ?? exam.year, 2000, 2100);
  const clsName = cleanText(meta.className ?? raw.className, 100);

  const documentMetadata: DocumentMetadata = {
    institutionName: instName,
    location: loc,
    range: rng,
    examName: exName,
    examYear: exYr,
    className: clsName,
    confidence: {
      institutionName: instName === null ? 'low' : confidenceOf(confObj.institutionName),
      location: loc === null ? 'low' : confidenceOf(confObj.location),
      range: rng === null ? 'low' : confidenceOf(confObj.range),
      examName: exName === null ? 'low' : confidenceOf(confObj.examName),
      examYear: exYr === null ? 'low' : confidenceOf(confObj.examYear),
      className: clsName === null ? 'low' : confidenceOf(confObj.className),
    },
  };

  return {
    documentMetadata,
    institution: { name: instName, location: loc, range: rng },
    exam: { name: exName, year: exYr },
    className: clsName,
    columns,
    students,
    warnings,
  };
}
