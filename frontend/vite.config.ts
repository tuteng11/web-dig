import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const proxy = { '/api': { target: env.TRACEBACK_API_ORIGIN || 'http://127.0.0.1:8000', changeOrigin: true } }
  return { plugins: [react(), tailwind()], server: { proxy }, preview: { proxy } }
})
