import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  build: {
    // Output React SPA into bot/public/ so Express can serve it.
    // Path is relative to project root (where vite.config.ts lives).
    outDir: 'bot/public',
    emptyOutDir: true,
  },
  server: {
    // Proxy /api and /auth to the local bot server during development
    proxy: {
      '/api': 'http://localhost:3001',
      '/auth': 'http://localhost:3001',
    },
  },
})
