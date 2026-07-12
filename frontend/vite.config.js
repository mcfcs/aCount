import process from 'node:process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// getUserMedia (barcode scanner camera) only works in secure contexts.
// localhost is always secure; to scan from a phone on the LAN, start with
// VITE_HTTPS=1 so the dev server serves HTTPS on all interfaces.
const enableHttps = ['1', 'true'].includes(String(process.env.VITE_HTTPS).toLowerCase())

export default defineConfig({
  plugins: [react(), ...(enableHttps ? [basicSsl()] : [])],
  server: {
    proxy: {
      '/api': 'http://localhost:5000'
    },
    allowedHosts: true,
    ...(enableHttps ? { host: true } : {}),
  },
})
