import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // 本番環境では https://example.com/dsa/ 配下で公開する
  base: mode === 'production' ? '/dsa/' : '/',
  plugins: [react(),
  tailwindcss(),
  ],
}))
