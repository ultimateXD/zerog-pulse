import path from 'node:path'
import { pathToFileURL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// Server-side key names read by api/medai.js. They are copied into the Node
// process for `vite` / `vite preview` only and are never exposed to client code.
const SERVER_VARS = [
  'GROQ_API_KEY', 'VITE_GROQ_API_KEY',
  'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'VITE_GEMINI_API_KEY',
  'OPENROUTER_API_KEY', 'VITE_OPENROUTER_API_KEY',
  'HUGGINGFACE_API_KEY', 'HF_TOKEN', 'VITE_HUGGINGFACE_API_KEY', 'VITE_HF_API_KEY',
  'MEDAI_ALLOWED_ORIGINS',
]

// Same cap as api/medai.js (MAX_BODY_BYTES); enforced while the body is read.
const MAX_BODY_BYTES = 64 * 1024

// Runs the same Web-standard handler that Vercel deploys from api/medai.js,
// so `npm run dev` and `npm run preview` behave like production.
function medaiApi(root) {
  let handler
  const load = async () => {
    if (!handler) {
      const mod = await import(pathToFileURL(path.resolve(root, 'api/medai.js')).href)
      handler = mod.default
    }
    return handler
  }

  const middleware = async (req, res, next) => {
    if (!req.url || !/^\/api\/medai(?:[/?]|$)/.test(req.url)) return next()
    const controller = new AbortController()
    res.on('close', () => { if (!res.writableEnded) controller.abort() })
    try {
      const chunks = []
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        // Enforce the function's body cap while reading, not after buffering.
        const tooLarge = () => {
          res.statusCode = 413
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('connection', 'close')
          res.end(JSON.stringify({ error: 'Payload too large' }), () => req.destroy())
        }
        if (Number(req.headers['content-length'] || 0) > MAX_BODY_BYTES) return tooLarge()
        let size = 0
        for await (const chunk of req) {
          size += chunk.length
          if (size > MAX_BODY_BYTES) return tooLarge()
          chunks.push(chunk)
        }
      }
      const headers = new Headers()
      for (const [name, value] of Object.entries(req.headers)) {
        if (name.startsWith(':') || value == null) continue
        if (Array.isArray(value)) value.forEach((v) => headers.append(name, v))
        else headers.set(name, String(value))
      }
      const request = new Request(new URL(req.url, 'http://' + (req.headers.host || 'localhost')), {
        method: req.method,
        headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
        signal: controller.signal,
      })
      const response = await (await load()).fetch(request)
      res.statusCode = response.status
      response.headers.forEach((value, name) => res.setHeader(name, value))
      if (!response.body) return res.end()
      const reader = response.body.getReader()
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        res.write(value)
      }
      res.end()
    } catch (err) {
      if (controller.signal.aborted) return
      if (!res.headersSent) {
        res.statusCode = 500
        res.setHeader('content-type', 'application/json')
      }
      res.end(JSON.stringify({ error: 'MED-AI dev bridge error', detail: String((err && err.message) || err).slice(0, 200) }))
    }
  }

  return {
    name: 'zerog-medai-api',
    configureServer(server) { server.middlewares.use(middleware) },
    configurePreviewServer(server) { server.middlewares.use(middleware) },
  }
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const root = process.cwd()
  if (command === 'serve') {
    const env = loadEnv(mode, root, '')
    for (const name of SERVER_VARS) {
      if (env[name] && !process.env[name]) process.env[name] = env[name]
    }
    // Local dev / preview only: preview proxies rewrite Origin, so the origin check is relaxed here.
    process.env.MEDAI_DEV = '1'
  }
  return {
    plugins: [react(), medaiApi(root)],
  }
})
