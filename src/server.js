import 'dotenv/config'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import { authMiddleware } from './middleware/auth.js'
import messagesRouter from './routes/messages.js'
import proxyRouter from './routes/proxy.js'
import { loadConfig } from './config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── Validate environment ─────────────────────────────────────────────────

if (!process.env.UNIFIED_TOKEN) {
  console.error('Error: UNIFIED_TOKEN is required. Set it in .env or as an environment variable.')
  process.exit(1)
}

// ─── Load config ──────────────────────────────────────────────────────────

const routes = loadConfig()

for (const route of routes) {
  if (!route.api_key) {
    console.error(`Error: Route "${route.name}" is missing api_key. Each route must have an api_key configured.`)
    process.exit(1)
  }
}

// ─── Express app ──────────────────────────────────────────────────────────

const app = express()

app.use(cors())
app.use(express.json({ limit: '50mb' }))

// Request logger
app.use((req, _res, next) => {
  console.log(`\n[req] ${new Date().toISOString()} ${req.method} ${req.originalUrl}`)
  console.log(`[req] headers: ${JSON.stringify({
    'content-type': req.headers['content-type'],
    'x-api-key': req.headers['x-api-key'] ? req.headers['x-api-key'].slice(0, 8) + '...' : undefined,
    authorization: req.headers.authorization ? req.headers.authorization.slice(0, 20) + '...' : undefined,
    'user-agent': req.headers['user-agent']
  })}`)
  if (req.body && Object.keys(req.body).length > 0) {
    console.log(`[req] body keys: ${Object.keys(req.body).join(', ')}`)
    if (req.body.model) console.log(`[req] model: ${req.body.model}`)
    if (req.body.stream !== undefined) console.log(`[req] stream: ${req.body.stream}`)
  }
  next()
})

app.set('view engine', 'pug')
app.set('views', `${__dirname}/views`)

routes.forEach((route) => {
  const serviceMiddleware = (req, _res, next) => {
    req._serviceConfig = route
    next()
  }

  const prefix = `/${route.name}/v1`

  app.use(`${prefix}/messages`, serviceMiddleware, authMiddleware, messagesRouter)
  app.use(prefix, serviceMiddleware, authMiddleware, proxyRouter)
})

app.get('/health', (_req, res) => res.json({ status: 'ok' }))

app.get('/', (_req, res) => {
  const host = process.env.HOST || '0.0.0.0'
  const port = parseInt(process.env.PORT, 10) || 8088
  const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host
  const baseUrl = `http://${displayHost}:${port}`

  res.render('index', { routes, baseUrl })
})

// Start server if run directly (not imported for testing)
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const HOST = process.env.HOST || '0.0.0.0'
  const PORT = parseInt(process.env.PORT, 10) || 8088
  app.listen(PORT, HOST, () => {
    const displayHost = HOST === '0.0.0.0' ? '127.0.0.1' : HOST
    console.log(`AI proxy listening on ${HOST}:${PORT}`)
    for (const route of routes) {
      console.log(`  ${route.name}:`)
      console.log(`    ANTHROPIC_BASE_URL=http://${displayHost}:${PORT}/${route.name}`)
      console.log(`    Anthropic: POST http://${displayHost}:${PORT}/${route.name}/v1/messages`)
      console.log(`    OPENAI_BASE_URL=http://${displayHost}:${PORT}/${route.name}/v1`)
      console.log(`    OpenAI:    POST http://${displayHost}:${PORT}/${route.name}/v1/chat/completions`)
    }
  })
}

export default app
