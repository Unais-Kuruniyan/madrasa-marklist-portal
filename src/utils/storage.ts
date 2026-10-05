/**
 * Optional UI convenience: remember the last institution name/location so
 * teachers don't retype it for every class. Supabase remains the source of truth.
 */
const KEY = 'marklist:last-institution';

export interface InstitutionMemory {
  name: string;
  location: string;
}

export function loadInstitution(): InstitutionMemory {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { name: '', location: '' };
    const parsed = JSON.parse(raw) as Partial<InstitutionMemory>;
    return { name: parsed.name ?? '', location: parsed.location ?? '' };
  } catch {
    return { name: '', location: '' };
  }
}

export function saveInstitution(value: InstitutionMemory): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* storage unavailable — ignore */
  }
}
