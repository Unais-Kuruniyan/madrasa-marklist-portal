/**
 * Types shared by the server API (`/api/import-marklist`) and the React UI.
 * Pure TypeScript – no DOM / Node specific imports.
 */

export type Confidence = 'high' | 'medium' | 'low';
export type ExtractedCategory = 'boys' | 'girls';

/** What kind of column the model believes it is looking at. */
export type ColumnKind = 'subject' | 'quran' | 'hifz' | 'quranHifzTotal' | 'grandTotal' | 'other';

/** What is visibly written in a single mark cell. */
export type CellStatus = 'value' | 'absent' | 'blank' | 'unreadable';

/** Bounding box in normalized coordinates 0..1000: [ymin, xmin, ymax, xmax] */
export type BoundingBox = [number, number, number, number];

export interface ExtractedColumn {
  index: number;
  /** Header exactly as written in the photo. */
  header: string;
  kind: ColumnKind;
  confidence: Confidence;
  box?: BoundingBox | null;
}

export interface ExtractedCell {
  columnIndex: number;
  status: CellStatus;
  /** Numeric value – only when `status === 'value'` and within 0–100. */
  value: number | null;
  confidence: Confidence;
  box?: BoundingBox | null;
}

export interface ExtractedStudent {
  category: ExtractedCategory | null;
  rollNumber: number | null;
  name: string | null;
  categoryConfidence: Confidence;
  rollConfidence: Confidence;
  nameConfidence: Confidence;
  box?: BoundingBox | null;
  cells: ExtractedCell[];
}

export interface DocumentMetadata {
  institutionName: string | null;
  location: string | null;
  range: string | null;
  examName: string | null;
  examYear: number | null;
  className: string | null;
  confidence: {
    institutionName: Confidence;
    location: Confidence;
    range: Confidence;
    examName: Confidence;
    examYear: Confidence;
    className: Confidence;
  };
}

/** Validated output of the extraction API. */
export interface ExtractionResult {
  documentMetadata: DocumentMetadata;
  institution?: { name: string | null; location: string | null; range: string | null };
  exam?: { name: string | null; year: number | null };
  className?: string | null;
  columns: ExtractedColumn[];
  students: ExtractedStudent[];
  warnings: string[];
}

/** Subject configuration sent to the server so the model understands the expected schema (if available). */
export interface ClassSubjectInfo {
  id: string;
  name: string;
  kind: 'normal' | 'quran' | 'hifz';
}

export interface ClassContext {
  className?: string;
  institutionName?: string;
  includeQuranHifz?: boolean;
  subjects?: ClassSubjectInfo[];
}

/** Request body of POST /api/import-marklist */
export interface AnalyzeRequest {
  /** Base64 (no data-URL prefix) of the temporary, already compressed image. */
  imageBase64: string;
  mimeType: string;
  classContext?: ClassContext;
}

export type ImportErrorCode =
  | 'missingApiKey'
  | 'unavailable'
  | 'rateLimited'
  | 'invalidImage'
  | 'imageTooLarge'
  | 'unsupportedType'
  | 'malformedResponse'
  | 'noTable'
  | 'noStudents'
  | 'badRequest'
  | 'generic';

export interface AnalyzeSuccess {
  ok: true;
  result: ExtractionResult;
}

export interface AnalyzeFailure {
  ok: false;
  code: ImportErrorCode;
}

export type AnalyzeResponse = AnalyzeSuccess | AnalyzeFailure;

export class ImportError extends Error {
  readonly code: ImportErrorCode;
  constructor(code: ImportErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ImportError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Limits (shared so client and server agree)                          */
/* ------------------------------------------------------------------ */

export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** Maximum size of the file a teacher may pick (original). */
export const MAX_ORIGINAL_BYTES = 10 * 1024 * 1024;
/** Target for the compressed image that is sent to the server (Vercel body limit is 4.5 MB incl. base64 overhead). */
export const MAX_SEND_BYTES = 2.6 * 1024 * 1024;
/** Server-side hard cap on the base64 string length. */
export const MAX_BASE64_CHARS = 4 * 1024 * 1024;
export const MAX_STUDENTS = 200;
export const MAX_COLUMNS = 40;
export const MAX_NAME_LENGTH = 150;
export const MAX_TEXT_LENGTH = 200;
