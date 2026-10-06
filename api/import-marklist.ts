import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleAnalyzeRequest, isRateLimited } from './_lib/importMarklist.js';

/**
 * POST /api/import-marklist
 *
 * Receives a temporary, compressed mark-list photo (base64 inline), asks Gemini to extract structured data,
 * validates the response and returns it. The image is never stored or logged. GEMINI_API_KEY stays server-side.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, code: 'badRequest' });
  }

  const forwarded = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ ok: false, code: 'rateLimited' });
  }

  const { status, body } = await handleAnalyzeRequest(req.body, {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
  });
  return res.status(status).json(body);
}
