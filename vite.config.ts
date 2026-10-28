import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Expose VITE_* and the NEXT_PUBLIC_* vars that Vercel's Supabase integration creates.
  // NEVER add 'SUPABASE_' or 'POSTGRES_' here: those hold the secret key and DB password.
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Glee-Along',
        short_name: 'Glee-Along',
        description: 'A two-person Glee rewatch. Jazz hands optional, opinions mandatory.',
        theme_color: '#cc252a',
        background_color: '#faf6f6',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        // Never cache Supabase API traffic; drafts are handled by our own sync queue.
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false, // DB tests share one Postgres cluster (roles are cluster-global)
  },
})
