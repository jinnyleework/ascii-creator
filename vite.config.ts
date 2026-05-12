import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Production-only CSP: keep traffic on this origin except ML asset host for in-browser background removal (weights only, not user photos). */
function productionCspPlugin() {
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    "upgrade-insecure-requests",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self' https://staticimgly.com",
    "worker-src 'self' blob:",
    "media-src 'self' blob: data:",
  ].join('; ')

  return {
    name: 'production-csp-meta',
    transformIndexHtml(html: string) {
      if (process.env.NODE_ENV !== 'production') return html
      return html.replace(
        /<head>\n(\s*)<meta charset="UTF-8" \/>/,
        `<head>\n$1<meta charset="UTF-8" />\n$1<meta http-equiv="Content-Security-Policy" content="${csp}" />`
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), productionCspPlugin()],
  optimizeDeps: {
    include: ['@imgly/background-removal', 'onnxruntime-web'],
  },
})
