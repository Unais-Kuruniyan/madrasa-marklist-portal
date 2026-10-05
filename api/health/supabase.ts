import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

/**
 * Vercel Serverless API function for Supabase keep-alive.
 * Hit periodically by Vercel Cron (configured in vercel.json).
 *
 * Performs a lightweight SELECT 1 query on the classes table to generate
 * legitimate periodic database activity and prevent Free Tier auto-pause.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 1. Verify authorization secret
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.authorization;
    const urlSecret = req.query.secret;
    const bearerMatch = authHeader === `Bearer ${cronSecret}`;
    const queryMatch = urlSecret === cronSecret;

    if (!bearerMatch && !queryMatch) {
      return res.status(401).json({ error: 'Unauthorized: Invalid cron secret token' });
    }
  }

  // 2. Resolve Supabase credentials (server-side environment variables)
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: 'Supabase URL or Anon Key is missing in environment variables' });
  }

  try {
    // 3. Create a lightweight server-side client with public anon key
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
    });

    // 4. Run a minimal read query
    const { data, error } = await supabase.from('classes').select('id').limit(1);

    if (error) {
      return res.status(500).json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }

    return res.status(200).json({
      ok: true,
      status: 'alive',
      classesChecked: data?.length ?? 0,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({
      ok: false,
      error: message,
      timestamp: new Date().toISOString(),
    });
  }
}
