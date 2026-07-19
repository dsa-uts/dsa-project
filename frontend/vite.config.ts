/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// dev server の proxy 先 backend。
const backendOrigin = 'http://localhost:8080'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // dev server は backend へ API を proxy する。
    // 本番では Ingress が同じパスを backend Service へルーティングする想定。
    proxy: {
      '/health': backendOrigin,
      '/api': backendOrigin,
    },
  },
  test: {
    environment: 'happy-dom',
  },
})
