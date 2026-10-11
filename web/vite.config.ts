import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// During development, run the agent on :8000 and `npm run dev`; API and WebSocket
// calls are proxied so cookies stay same-origin.
const agent = process.env.AGENT_URL ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    proxy: {
      '/api/ws': { target: agent.replace(/^http/, 'ws'), ws: true, changeOrigin: false },
      '/api': { target: agent, changeOrigin: false },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: { xterm: ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-web-links'] },
      },
    },
  },
})
