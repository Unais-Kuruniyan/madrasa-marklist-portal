/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Dev-only: serves POST /api/import-marklist from `npm run dev` using the very same handler that the Vercel
 * serverless function uses, so the photo-import flow can be tested locally. The Gemini key is read from
 * .env.local on the server side of the dev server and is never exposed to the browser bundle.
 */
function devImportMarklistApi(): Plugin {
  return {
    name: 'dev-import-marklist-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/import-marklist', async (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(body));
        };
        if (req.method !== 'POST') return send(405, { ok: false, code: 'badRequest' });
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          let parsed: unknown = null;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            return send(400, { ok: false, code: 'badRequest' });
          }
          const env = loadEnv('development', process.cwd(), '');
          const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
          const model = env.GEMINI_MODEL || process.env.GEMINI_MODEL;
          const fallbackModel = env.GEMINI_FALLBACK_MODEL || process.env.GEMINI_FALLBACK_MODEL;

          console.log('[devImportMarklistApi] Incoming POST /api/import-marklist');
          console.log(`[devImportMarklistApi] GEMINI_API_KEY configured: ${Boolean(apiKey)}`);
          if (model) console.log(`[devImportMarklistApi] GEMINI_MODEL: ${model}`);

          const mod = await server.ssrLoadModule('/api/_lib/importMarklist.ts');
          const out = await mod.handleAnalyzeRequest(parsed, {
            GEMINI_API_KEY: apiKey,
            GEMINI_MODEL: model,
            GEMINI_FALLBACK_MODEL: fallbackModel,
          });
          return send(out.status, out.body);
        } catch (err: any) {
          console.error('[devImportMarklistApi] Server Exception:', err?.name, err?.message);
          if (err?.stack) console.error(err.stack);
          return send(500, {
            ok: false,
            code: 'generic',
            error: {
              name: err?.name || 'Error',
              message: err?.message || 'Server processing error',
            },
          });
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), devImportMarklistApi()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
