/**
 * Maps columns detected in a photographed mark list to the CURRENT class's subjects.
 *
 * Order of strategies (first hit wins):
 *   1. exact match
 *   2. normalized text match (case / spacing / punctuation / ZWJ insensitive)
 *   3. controlled alias groups (e.g. "Tazkiya" ≡ "Thazkiya", Malayalam spellings)
 *   4. fuzzy match – only when clearly unambiguous, and always flagged for review
 *
 * Nothing is ever created automatically. Unmatched columns are reported as
 * "unrecognized" and left to the teacher.
 */
import type { ClassSubjectInfo, ExtractedColumn } from './types.js';

export type MatchMethod = 'exact' | 'normalized' | 'alias' | 'fuzzy' | 'kindHint';

export interface ColumnMatch {
  columnIndex: number;
  header: string;
  /** Matched class subject id, or null when not matched. */
  subjectId: string | null;
  method: MatchMethod | null;
  /** True when the teacher should double check this mapping. */
  needsReview: boolean;
}

export interface ColumnMapping {
  matches: ColumnMatch[];
  /** Columns that are totals in the photo (cross-check only, never imported as marks). */
  quranHifzTotalColumn: number | null;
  grandTotalColumn: number | null;
  /** Photo columns that could not be matched and are not totals. */
  unrecognized: ColumnMatch[];
  /** Class subjects that have no column in the photo. */
  missingSubjectIds: string[];
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

export function normalizeSubjectText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, '') // zero-width joiners etc.
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '') // drop spaces & punctuation, keep letters/marks/digits (Malayalam included)
    .trim();
}

/** Controlled alias groups. Every entry is compared in normalized form. */
const ALIAS_GROUPS: string[][] = [
  ['fiqh', 'fiqhu', 'fikh', 'fiqah', 'fiqhh', 'ഫിഖ്ഹ്', 'ഫിഖ്ഹ', 'ഫിഖ്ഹു', 'ഫിഖ്ഹ്'],
  ['aqeedah', 'aqeeda', 'aqidah', 'aqida', 'akeeda', 'akida', 'aqeedha', 'അഖീദ', 'അഖീദ്ദ', 'അഖീദത്ത്'],
  ['tajweed', 'tajwid', 'tajvid', 'tajveed', 'തജ്വീദ്', 'തജ്‌വീദ്'],
  ['thazkiya', 'tazkiya', 'tazkiyah', 'thazkiyah', 'tazkia', 'thazkia', 'tazkiyya', 'thazkiyya', 'തസ്കിയ', 'തസ്കിയ്യ', 'തസ്കിയ്യ്', 'തസ്കിയ്യഃ'],
  ['duroos', 'durus', 'duroosu', 'dhuroos', 'durooss', 'durous', 'ദുറൂസ്', 'ദുറൂസ', 'ദുരൂസ്'],
  ['hadith', 'hadees', 'hadis', 'hadeeth', 'ഹദീസ്', 'ഹദീസ'],
  ['tareekh', 'tarikh', 'thareekh', 'tharikh', 'history', 'താരീഖ്', 'താരീഖ'],
  ['nahv', 'nahw', 'nahu', 'nahvu', 'നഹ്വ്', 'നഹ്‌വ്'],
  ['sarf', 'sarfu', 'സർഫ്', 'സറഫ്'],
  ['arabic', 'arabi', 'അറബി', 'അറബിക്'],
  ['english', 'ഇംഗ്ലീഷ്'],
  ['malayalam', 'മലയാളം'],
  ['urdu', 'ഉർദു', 'ഉറുദു'],
  ['quran', 'qur an', 'quraan', 'khuran', 'khuraan', 'kuran', 'ഖുർആൻ', 'ഖുർആന്‍', 'ഖുർആന്', 'ഖുര്‍ആന്‍', 'ഖുർആൻ', 'ഖുര്‍ആന്'],
  ['hifz', 'hifl', 'hifdh', 'hifzh', 'hiflu', 'ഹിഫ്ള്', 'ഹിഫ്ള', 'ഹിഫ്സ്', 'ഹിഫ്ളു'],
];

const QURAN_ALIASES = new Set(ALIAS_GROUPS[ALIAS_GROUPS.length - 2].map(normalizeSubjectText));
const HIFZ_ALIASES = new Set(ALIAS_GROUPS[ALIAS_GROUPS.length - 1].map(normalizeSubjectText));

const aliasIndex: Map<string, number> = (() => {
  const m = new Map<string, number>();
  ALIAS_GROUPS.forEach((group, i) => {
    for (const a of group) m.set(normalizeSubjectText(a), i);
  });
  return m;
})();

export function isQuranText(text: string): boolean {
  return QURAN_ALIASES.has(normalizeSubjectText(text));
}
export function isHifzText(text: string): boolean {
  return HIFZ_ALIASES.has(normalizeSubjectText(text));
}

/* ------------------------------------------------------------------ */
/* Fuzzy                                                               */
/* ------------------------------------------------------------------ */

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

const FUZZY_MIN_LENGTH = 5;
const FUZZY_THRESHOLD = 0.8;
const FUZZY_MARGIN = 0.1;

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

type Candidate = Pick<ClassSubjectInfo, 'id' | 'name' | 'kind'>;

interface SingleMatch {
  subjectId: string;
  method: MatchMethod;
}

/** Match one header against the available class subjects. */
export function matchHeader(header: string, subjects: Candidate[]): SingleMatch | null {
  const trimmed = header.trim();
  if (!trimmed) return null;

  // 1. exact
  const exact = subjects.filter((s) => s.name === trimmed);
  if (exact.length === 1) return { subjectId: exact[0].id, method: 'exact' };

  const nh = normalizeSubjectText(trimmed);
  if (!nh) return null;

  // 2. normalized
  const norm = subjects.filter((s) => normalizeSubjectText(s.name) === nh);
  if (norm.length === 1) return { subjectId: norm[0].id, method: 'normalized' };
  if (norm.length > 1) return null; // ambiguous – never guess

  // 3. controlled aliases (Quran/Hifz subjects use their kind as alias too)
  const group = aliasIndex.get(nh);
  if (group !== undefined) {
    const hits = subjects.filter((s) => {
      if (s.kind === 'quran' && QURAN_ALIASES.has(nh)) return true;
      if (s.kind === 'hifz' && HIFZ_ALIASES.has(nh)) return true;
      return aliasIndex.get(normalizeSubjectText(s.name)) === group;
    });
    if (hits.length === 1) return { subjectId: hits[0].id, method: 'alias' };
    if (hits.length > 1) return null;
  }

  // 4. fuzzy – Latin-ish names only, long enough, clearly better than the runner-up
  if (nh.length >= FUZZY_MIN_LENGTH && /^[a-z0-9]+$/.test(nh)) {
    const scored = subjects
      .map((s) => ({ s, score: similarity(nh, normalizeSubjectText(s.name)) }))
      .filter((x) => /^[a-z0-9]+$/.test(normalizeSubjectText(x.s.name)))
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    const second = scored[1];
    if (best && best.score >= FUZZY_THRESHOLD && (!second || best.score - second.score >= FUZZY_MARGIN)) {
      return { subjectId: best.s.id, method: 'fuzzy' };
    }
  }
  return null;
}

/**
 * Builds the column → subject mapping. Each class subject can be matched by at most one column;
 * if two columns compete for the same subject the stronger method wins and the other is flagged unrecognized.
 */
export function matchColumns(columns: ExtractedColumn[], subjects: ClassSubjectInfo[]): ColumnMapping {
  const strength: Record<MatchMethod, number> = { exact: 5, normalized: 4, alias: 3, kindHint: 2, fuzzy: 1 };
  const matches: ColumnMatch[] = [];
  let quranHifzTotalColumn: number | null = null;
  let grandTotalColumn: number | null = null;

  const quran = subjects.find((s) => s.kind === 'quran');
  const hifz = subjects.find((s) => s.kind === 'hifz');

  for (const col of columns) {
    if (col.kind === 'grandTotal') {
      if (grandTotalColumn === null) grandTotalColumn = col.index;
      continue;
    }
    if (col.kind === 'quranHifzTotal') {
      if (quranHifzTotalColumn === null) quranHifzTotalColumn = col.index;
      continue;
    }

    let m = matchHeader(col.header, subjects);
    // Quran/Hifz: the model's kind is only a fallback when the header gives no answer.
    if (!m && col.kind === 'quran' && quran) m = { subjectId: quran.id, method: 'kindHint' };
    if (!m && col.kind === 'hifz' && hifz) m = { subjectId: hifz.id, method: 'kindHint' };

    matches.push({
      columnIndex: col.index,
      header: col.header,
      subjectId: m?.subjectId ?? null,
      method: m?.method ?? null,
      needsReview: m ? m.method === 'fuzzy' || m.method === 'kindHint' : true,
    });
  }

  // Resolve duplicates: one column per subject
  const bySubject = new Map<string, ColumnMatch[]>();
  for (const m of matches) {
    if (!m.subjectId) continue;
    bySubject.set(m.subjectId, [...(bySubject.get(m.subjectId) ?? []), m]);
  }
  for (const list of bySubject.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => strength[b.method!] - strength[a.method!]);
    for (const loser of list.slice(1)) {
      loser.subjectId = null;
      loser.method = null;
      loser.needsReview = true;
    }
  }

  const matched = new Set(matches.map((m) => m.subjectId).filter((x): x is string => !!x));
  return {
    matches,
    quranHifzTotalColumn,
    grandTotalColumn,
    unrecognized: matches.filter((m) => m.subjectId === null),
    missingSubjectIds: subjects.filter((s) => !matched.has(s.id)).map((s) => s.id),
  };
}
