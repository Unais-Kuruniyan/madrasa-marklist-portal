import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Browser Supabase client.
 * Uses ONLY the public project URL and anon/publishable key.
 * Never put a service_role / secret key in VITE_ variables.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }
  if (!client) {
    client = createClient(url as string, anonKey as string, {
      auth: {
        // No authentication in this app.
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}
