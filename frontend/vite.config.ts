import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const target =
    env.TRACEBACK_API_ORIGIN ||
    env.VITE_GATEWAY_PROXY ||
    'http://127.0.0.1:8000'
  const proxy = {
    '/api': { target, changeOrigin: true },
    '/health': { target, changeOrigin: true },
  }
  return { plugins: [react(), tailwind()], server: { proxy }, preview: { proxy } }
})
