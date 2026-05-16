import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Spot Explorer',
        short_name: 'Spots',
        description: 'Encuentra el lugar perfecto analizando topografía, sol, agua y discreción',
        theme_color: '#111118',
        background_color: '#111118',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/spot-explorer/',
        scope: '/spot-explorer/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  base: '/spot-explorer/',
})
