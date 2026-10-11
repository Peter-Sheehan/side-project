import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Where `pnpm dev` sends /api: the local stack by default, or a remote one,
// e.g. VITE_API_PROXY=https://203-0-113-10.sslip.io in frontend/.env.local.
// Read from the shell or frontend/.env*.local; the proxy only exists in dev.
const apiTarget =
  loadEnv('development', process.cwd(), '').VITE_API_PROXY ||
  'http://localhost:3000'

// https://vite.dev/config/
export default defineConfig({
  server: {
    // The target's Caddy routes /api/auth to the auth service and the rest of
    // /api to the backend. To the browser it's all this origin, so no CORS.
    proxy: {
      '/api': {
        target: apiTarget,
        // Send the target's own Host header: a Caddy serving HTTPS for a
        // hostname only answers requests addressed to that hostname.
        changeOrigin: true,
        configure: (proxy) => {
          console.log(`  [api proxy] /api -> ${apiTarget}`)
          proxy.on('error', (err) =>
            console.error(`[api proxy] ${apiTarget}: ${err.message}`),
          )
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Caddy serves the API on this origin, so keep the SPA fallback off /api
      // (otherwise navigating to /api/docs gets index.html from the service worker)
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
      },
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        // TODO: replace placeholder name and colours
        name: 'Side Project',
        short_name: 'Side Project',
        description: 'Side Project',
        theme_color: '#863bff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
