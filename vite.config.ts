/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

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
  plugins: [
    react(),
    tailwindcss(),
    devImportMarklistApi(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png', 'fonts/*.ttf'],
      manifest: {
        name: 'School Mark List Portal',
        short_name: 'Mark List',
        description: 'School & Madrasa class mark list management portal.',
        theme_color: '#1e3a8a',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ttf}'],
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Supabase API requests -> NetworkOnly (Zero caching of student records)
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: 'NetworkOnly',
          },
          {
            // Gemini API & Backend import marklist endpoint -> NetworkOnly (Zero caching of Gemini or imported mark data)
            urlPattern: /\/api\/import-marklist/i,
            handler: 'NetworkOnly',
          },
          {
            // Any other /api/ routes -> NetworkOnly
            urlPattern: /^\/api\/.*/i,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
