/**
 * Server-side core of "Import Mark List from Photo".
 *
 * PRIVACY: the image arrives inline (base64), is forwarded once to Gemini as inline data, and is never
 * written to disk, a database, a bucket or a log. Only the validated structured JSON is returned.
 * This module deliberately never logs the request body.
 *
 * Framework-agnostic: the Vercel function (api/import-marklist.ts) and the Vite dev middleware both call
 * `handleAnalyzeRequest`. The Gemini call is injectable so tests can mock the AI response.
 */
import { GoogleGenAI, Type } from '@google/genai';
import {
  ALLOWED_MIME_TYPES,
  ImportError,
  MAX_BASE64_CHARS,
  type AnalyzeResponse,
  type ClassContext,
  type ClassSubjectInfo,
} from '../../src/lib/import/types.js';
import { parseModelJson, validateExtraction } from '../../src/lib/import/validateExtraction.js';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';
export const FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'];

export interface HandlerEnv {
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_FALLBACK_MODEL?: string;
}

export interface GenerateArgs {
  apiKey: string;
  model: string;
  imageBase64: string;
  mimeType: string;
  prompt: string;
}

export type GenerateFn = (args: GenerateArgs) => Promise<string | undefined>;

export interface HandlerResult {
  status: number;
  body: AnalyzeResponse;
}

/* ------------------------------------------------------------------ */
/* Multi-stage document extraction prompt                              */
/* ------------------------------------------------------------------ */

export function buildPrompt(ctx?: ClassContext): string {
  const hasConfig = ctx && (ctx.className || ctx.institutionName || (ctx.subjects && ctx.subjects.length > 0));
  const configJson = hasConfig
    ? JSON.stringify(
        {
          className: ctx.className || '',
          institutionName: ctx.institutionName || '',
          includeQuranAndHifz: ctx.includeQuranHifz ?? false,
          subjects: (ctx.subjects || []).map((s) => ({ name: s.name, kind: s.kind })),
        },
        null,
        2,
      )
    : null;

  return `You are performing advanced document analysis and mark list extraction on a school or madrasa examination mark list photograph FOR AN EXISTING MARK LIST APPLICATION.

Perform multi-stage visual document analysis:
STAGE 1: DOCUMENT BOUNDARIES & LAYOUT ANALYSIS
- Identify the document header, institution metadata, exam title, class name, and exam year.
- Identify the subject table header region, column boundaries, student rows, and section headers (Boys / Girls).

STAGE 2: DOCUMENT METADATA EXTRACTION
- Extract ONLY institution name, location, range, exam name, exam year (4-digit number), and class name.
- Assign honest confidence ("high", "medium", "low") for each metadata field.
- Ignore document dates, division labels, and generic document metadata that are not supported.

STAGE 3: SUBJECT COLUMNS EXTRACTION
- Extract every subject column header exactly as written (in English, Malayalam, or mixed text).
- "kind": "subject" for normal subjects, "quran" for Quran, "hifz" for Hifz, "quranHifzTotal" for printed Quran+Hifz total, "grandTotal" for printed Grand Total, "other" for rank/percentage/remarks.
- Include bounding box "box" [ymin, xmin, ymax, xmax] in 0..1000 scale for each column header if visible.

STAGE 4: STUDENT ROWS & MARKS EXTRACTION
- Identify sections: BOYS / GIRLS (or Malayalam equivalents: ആൺകുട്ടികൾ / പെൺകുട്ടികൾ). Set category to "boys" or "girls". If no clear section heading or uncertain, use null.
- Extract student roll number (rollNumber) and student name (name).
- Preserve Malayalam names and text EXACTLY as written. Do NOT translate or transliterate names.
- Extract marks into "cells" array matched to the column indices:
  - status "value": visible numeric mark (0-100). Do NOT round or guess.
  - status "absent": cell explicitly says AB, Ab, Absent, or അബ്സന്റ്.
  - status "blank": empty cell or dash (- / —). NEVER convert blank into 0.
  - status "unreadable": written text/digit is illegible or ambiguous (e.g. 3 vs 8). Set value to null.
- Assign honest confidence ("high", "medium", "low") to each field and cell.
- Include bounding box "box" [ymin, xmin, ymax, xmax] in 0..1000 scale for student rows and low-confidence cells when visible.

STAGE 5: RECONCILIATION & WARNINGS
- Add document warnings for any cut-off text, blurry regions, ambiguous alignment, or unreadable entries.

CRITICAL RULES:
1. NEVER INVENT DATA. Do not guess names, marks, class, or year.
2. Return null for unreadable or missing values.
3. Blank cells MUST stay status "blank" (never convert to 0).
4. Do not calculate totals or final pass/fail results. The system performs all business rules.
${configJson ? `\nTARGET CLASS HINT (use for matching subject columns if applicable):\n${configJson}` : ''}`;
}

/* ------------------------------------------------------------------ */
/* Gemini schema + default generate implementation                     */
/* ------------------------------------------------------------------ */

const confidenceSchema = { type: Type.STRING, enum: ['high', 'medium', 'low'] };
const nullableString = { type: Type.STRING, nullable: true };
const nullableInt = { type: Type.INTEGER, nullable: true };
const boxSchema = {
  type: Type.ARRAY,
  items: { type: Type.INTEGER },
  nullable: true,
};

export const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    documentMetadata: {
      type: Type.OBJECT,
      properties: {
        institutionName: nullableString,
        location: nullableString,
        range: nullableString,
        examName: nullableString,
        examYear: nullableInt,
        className: nullableString,
        confidence: {
          type: Type.OBJECT,
          properties: {
            institutionName: confidenceSchema,
            location: confidenceSchema,
            range: confidenceSchema,
            examName: confidenceSchema,
            examYear: confidenceSchema,
            className: confidenceSchema,
          },
          required: ['institutionName', 'location', 'range', 'examName', 'examYear', 'className'],
        },
      },
      required: ['institutionName', 'location', 'range', 'examName', 'examYear', 'className', 'confidence'],
    },
    columns: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          index: { type: Type.INTEGER },
          header: { type: Type.STRING },
          kind: { type: Type.STRING, enum: ['subject', 'quran', 'hifz', 'quranHifzTotal', 'grandTotal', 'other'] },
          confidence: confidenceSchema,
          box: boxSchema,
        },
        required: ['index', 'header', 'kind', 'confidence'],
      },
    },
    students: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          category: { type: Type.STRING, enum: ['boys', 'girls'], nullable: true },
          categoryConfidence: confidenceSchema,
          rollNumber: nullableInt,
          rollConfidence: confidenceSchema,
          name: nullableString,
          nameConfidence: confidenceSchema,
          box: boxSchema,
          cells: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                columnIndex: { type: Type.INTEGER },
                status: { type: Type.STRING, enum: ['value', 'absent', 'blank', 'unreadable'] },
                value: { type: Type.NUMBER, nullable: true },
                confidence: confidenceSchema,
                box: boxSchema,
              },
              required: ['columnIndex', 'status', 'value', 'confidence'],
            },
          },
        },
        required: [
          'category',
          'categoryConfidence',
          'rollNumber',
          'rollConfidence',
          'name',
          'nameConfidence',
          'cells',
        ],
      },
    },
    warnings: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['documentMetadata', 'columns', 'students', 'warnings'],
};

/** Real Gemini call (inline image data only – the File API is deliberately NOT used). */
export const generateWithGemini: GenerateFn = async ({ apiKey, model, imageBase64, mimeType, prompt }) => {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data: imageBase64 } }, { text: prompt }] }],
    config: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0,
      maxOutputTokens: 32768,
    },
  });
  return response.text;
};

/* ------------------------------------------------------------------ */
/* Request validation                                                  */
/* ------------------------------------------------------------------ */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function sanitizeContext(raw: unknown): ClassContext | undefined {
  if (!isObj(raw)) return undefined;
  const subjectsRaw = Array.isArray(raw.subjects) ? raw.subjects : [];
  if (subjectsRaw.length > 40) return undefined;
  const subjects: ClassSubjectInfo[] = [];
  for (const s of subjectsRaw) {
    if (!isObj(s)) continue;
    const kind = s.kind === 'quran' || s.kind === 'hifz' ? s.kind : 'normal';
    subjects.push({ id: str(s.id, 80), name: str(s.name, 100), kind });
  }
  return {
    className: str(raw.className, 100),
    institutionName: str(raw.institutionName, 200),
    includeQuranHifz: raw.includeQuranHifz === true,
    subjects,
  };
}

/** Cheap magic-byte check so we reject obviously-not-an-image payloads before spending an API call. */
export function matchesImageSignature(base64: string, mime: string): boolean {
  let head: string;
  try {
    head = atob(base64.slice(0, 24));
  } catch {
    return false;
  }
  const bytes = Array.from(head, (c) => c.charCodeAt(0));
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/png') return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (mime === 'image/webp') {
    return head.slice(0, 4) === 'RIFF' && head.slice(8, 12) === 'WEBP';
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Main entry                                                          */
/* ------------------------------------------------------------------ */

function mapProviderError(err: unknown): ImportError {
  if (err instanceof ImportError) return err;
  const status = (err as { status?: number } | null)?.status;
  const message = String((err as { message?: string } | null)?.message ?? '');
  if (status === 429) return new ImportError('rateLimited');
  if (status === 500 || status === 502 || status === 503 || status === 504) return new ImportError('unavailable');
  if (status === 400 && /image|inline|mime/i.test(message) && !/api key/i.test(message)) return new ImportError('invalidImage');
  if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|network/i.test(message)) return new ImportError('unavailable');
  return new ImportError('generic');
}

export async function handleAnalyzeRequest(
  body: unknown,
  env: HandlerEnv,
  generate: GenerateFn = generateWithGemini,
): Promise<HandlerResult> {
  try {
    const apiKey = env.GEMINI_API_KEY?.trim();
    console.log(`[importMarklist] API key configured: ${Boolean(apiKey)}`);
    if (!apiKey) throw new ImportError('missingApiKey');

    const primaryModel = env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
    const configuredFallback = env.GEMINI_FALLBACK_MODEL?.trim();
    const candidateModels = Array.from(
      new Set([primaryModel, ...(configuredFallback ? [configuredFallback] : []), ...FALLBACK_MODELS]),
    );

    if (!isObj(body)) throw new ImportError('badRequest');
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType : '';
    if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType)) throw new ImportError('unsupportedType');

    const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : '';
    if (!imageBase64) throw new ImportError('invalidImage');
    if (imageBase64.length > MAX_BASE64_CHARS) throw new ImportError('imageTooLarge');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64) || !matchesImageSignature(imageBase64, mimeType)) {
      throw new ImportError('invalidImage');
    }

    console.log(`[importMarklist] Image MIME: ${mimeType}, base64 length: ${imageBase64.length}`);

    const classContext = sanitizeContext(body.classContext);
    const prompt = buildPrompt(classContext);

    let text: string | undefined;
    let lastError: unknown;

    for (const modelToTry of candidateModels) {
      try {
        console.log(`[importMarklist] Attempting Gemini request with model: ${modelToTry}...`);
        text = await generate({ apiKey, model: modelToTry, imageBase64, mimeType, prompt });
        if (text) {
          console.log(`[importMarklist] Gemini request succeeded with ${modelToTry}! Response text length: ${text.length}`);
          break;
        }
      } catch (err: any) {
        console.warn(`[importMarklist] Model ${modelToTry} failed:`, err?.message || err);
        lastError = err;
      }
    }

    if (!text) {
      console.error('[importMarklist] All candidate models failed!');
      throw mapProviderError(lastError);
    }

    const parsedJson = parseModelJson(text);
    const result = validateExtraction(parsedJson);
    console.log(
      `[importMarklist] Extraction validation successful! Students: ${result.students.length}, Columns: ${result.columns.length}`,
    );

    return { status: 200, body: { ok: true, result } };
  } catch (err: any) {
    console.error('[importMarklist] Request failed with code:', err instanceof ImportError ? err.code : 'generic', err?.message);
    const e = err instanceof ImportError ? err : new ImportError('generic');
    return { status: statusFor(e.code), body: { ok: false, code: e.code } };
  }
}

function statusFor(code: ImportError['code']): number {
  switch (code) {
    case 'missingApiKey':
      return 503;
    case 'unavailable':
      return 503;
    case 'rateLimited':
      return 429;
    case 'imageTooLarge':
      return 413;
    case 'unsupportedType':
      return 415;
    case 'invalidImage':
    case 'badRequest':
      return 400;
    case 'noTable':
    case 'noStudents':
      return 422;
    case 'malformedResponse':
      return 502;
    default:
      return 500;
  }
}

/* ------------------------------------------------------------------ */
/* Tiny best-effort per-IP limiter (protects the free Gemini quota)    */
/* ------------------------------------------------------------------ */

const hits = new Map<string, number[]>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS = 12;

export function isRateLimited(key: string, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_HITS) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 500) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
  }
  return false;
}
