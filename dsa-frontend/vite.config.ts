import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.')
  return {
    // Public base path where the app is served (e.g. "/dsa/" for https://example.com/dsa/)
    base: env.VITE_BASE_PATH || '/',
    plugins: [react(),
    tailwindcss(),
    ],
  }
})
