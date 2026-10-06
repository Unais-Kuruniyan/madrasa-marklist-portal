/** Browser → our own API (never Gemini directly). */
import { ImportError, type AnalyzeRequest, type AnalyzeResponse, type ExtractionResult, type ImportErrorCode } from './types';

const ENDPOINT = '/api/import-marklist';

export async function analyzeMarkList(request: AnalyzeRequest, signal?: AbortSignal): Promise<ExtractionResult> {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      cache: 'no-store',
      signal,
    });
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') throw err;
    throw new ImportError('unavailable');
  }

  let data: AnalyzeResponse | null = null;
  try {
    data = (await response.json()) as AnalyzeResponse;
  } catch {
    /* non-JSON body (e.g. platform error page) */
  }

  if (data && data.ok) return data.result;
  const code: ImportErrorCode =
    data && !data.ok
      ? data.code
      : response.status === 413
        ? 'imageTooLarge'
        : response.status === 429
          ? 'rateLimited'
          : response.status === 404
            ? 'unavailable'
            : 'generic';
  throw new ImportError(code);
}
