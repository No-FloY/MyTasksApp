import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA({
    registerType: 'prompt',
    injectRegister: false,
    manifest: {
      id: '/', name: 'Задачник', short_name: 'Задачник', lang: 'ru',
      description: 'Привычки, задачи и цели в своём ритме.',
      start_url: '/#today', scope: '/', display: 'standalone',
      theme_color: '#214f3d', background_color: '#f8f9f5',
      icons: [
        { src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{html,js,css,svg,png,webmanifest}'],
      navigateFallback: 'index.html',
      navigateFallbackAllowlist: [/^\/(?:index\.html)?$/],
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      skipWaiting: false,
      importScripts: ['/pwa-activation.js'],
      runtimeCaching: [],
    },
  })],
  build: { target: ['es2022', 'safari16.4'] },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
