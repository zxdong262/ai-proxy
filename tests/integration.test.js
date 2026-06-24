/**
 * Integration tests — these hit the real remote API.
 * Requires a valid config.js.
 */

import { describe, test, expect, beforeAll } from 'vitest'
import request from 'supertest'

const AUTH_HEADER = 'Bearer test-token-for-proxy'
// Use a cheap, fast model that exists on the remote API
const TEST_MODEL = 'deepseek-ai/deepseek-v4-flash'

let app
let prefix

beforeAll(async () => {
  // Dynamic import to get fresh server with current config.js
  const serverModule = await import('../src/server.js')
  app = serverModule.default

  const configModule = await import('../src/config.js')
  const routes = configModule.loadConfig()
  prefix = `/${routes[0].name}/v1`
})

describe('Authentication', () => {
  test('rejects request without Authorization header', async () => {
    const res = await request(app)
      .post(`${prefix}/messages`)
      .send({ model: 'test', max_tokens: 1, messages: [] })
    expect(res.status).toBe(401)
    expect(res.body.error).toBeDefined()
  })

  test('rejects malformed Authorization header', async () => {
    const res = await request(app)
      .post(`${prefix}/messages`)
      .set('Authorization', 'Basic abc')
      .send({ model: 'test', max_tokens: 1, messages: [] })
    expect(res.status).toBe(401)
  })
})

describe('POST messages (non-streaming)', () => {
  test('returns Anthropic-compatible response format', async () => {
    const res = await request(app)
      .post(`${prefix}/messages`)
      .set('Authorization', AUTH_HEADER)
      .send({
        model: TEST_MODEL,
        max_tokens: 50,
        messages: [{ role: 'user', content: 'Say exactly: hello world' }]
      })

    expect(res.status).toBe(200)
    expect(res.body.type).toBe('message')
    expect(res.body.role).toBe('assistant')
    expect(res.body.content).toBeDefined()
    expect(Array.isArray(res.body.content)).toBe(true)
    expect(res.body.content[0].type).toBe('text')
    expect(typeof res.body.content[0].text).toBe('string')
    expect(res.body.stop_reason).toBeDefined()
    expect(res.body.usage).toBeDefined()
    expect(res.body.usage.input_tokens).toBeGreaterThan(0)
    expect(res.body.usage.output_tokens).toBeGreaterThan(0)
    expect(res.body.model).toBeDefined()
  })

  test('includes system prompt in conversion', async () => {
    const res = await request(app)
      .post(`${prefix}/messages`)
      .set('Authorization', AUTH_HEADER)
      .send({
        model: TEST_MODEL,
        max_tokens: 50,
        system: "You are a pirate. Always say 'arr'.",
        messages: [{ role: 'user', content: 'Greet me' }]
      })

    expect(res.status).toBe(200)
    expect(res.body.content[0].text.toLowerCase()).toContain('arr')
  })
})

describe('POST messages (streaming)', () => {
  test('returns Anthropic SSE events', () => {
    return new Promise((resolve) => {
      const chunks = []
      const eventTypes = []

      request(app)
        .post(`${prefix}/messages`)
        .set('Authorization', AUTH_HEADER)
        .send({
          model: TEST_MODEL,
          max_tokens: 30,
          stream: true,
          messages: [{ role: 'user', content: "Say 'streaming works'" }]
        })
        .buffer(false)
        .parse((res, callback) => {
          res.setEncoding('utf8')
          let buffer = ''
          res.on('data', (chunk) => {
            buffer += chunk
            const parts = buffer.split('\n\n')
            buffer = parts.pop()
            for (const part of parts) {
              const lines = part.trim().split('\n')
              let eventType = null
              let data = null
              for (const line of lines) {
                if (line.startsWith('event: ')) eventType = line.slice(7)
                if (line.startsWith('data: ')) data = line.slice(6)
              }
              if (eventType && data) {
                eventTypes.push(eventType)
                try {
                  chunks.push(JSON.parse(data))
                } catch {
                  // skip unparseable
                }
              }
            }
          })
          res.on('end', () => callback(null, chunks))
        })
        .end((err) => {
          if (err) return resolve(err)
          try {
            expect(eventTypes).toContain('message_start')
            expect(eventTypes).toContain('content_block_start')
            expect(eventTypes).toContain('content_block_stop')
            expect(eventTypes).toContain('message_delta')
            expect(eventTypes).toContain('message_stop')

            const msgStart = chunks.find((c) => c.type === 'message_start')
            expect(msgStart.message.type).toBe('message')
            expect(msgStart.message.role).toBe('assistant')

            const deltas = chunks.filter((c) => c.type === 'content_block_delta')
            expect(deltas.length).toBeGreaterThan(0)
            expect(deltas[0].delta.type).toBe('text_delta')

            resolve()
          } catch (e) {
            resolve(e)
          }
        })
    })
  }, 30000)
})

describe('GET models (proxy)', () => {
  test('forwards to remote API and returns model list', async () => {
    const res = await request(app)
      .get(`${prefix}/models`)
      .set('Authorization', AUTH_HEADER)

    expect(res.status).toBe(200)
    expect(res.body).toBeDefined()
    expect(res.body.data || res.body.object).toBeDefined()
  })
})

describe('Health check', () => {
  test('GET /health returns ok', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
  })
})

describe('Home page', () => {
  test('GET / returns HTML with route info', async () => {
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.text).toContain('AI Proxy')
    expect(res.text).toContain('Configured Routes')
    expect(res.text).toContain('Claude Code Configuration')
  })
})

describe('Unknown service routing', () => {
  test('unknown service returns 404', async () => {
    const res = await request(app)
      .post('/unknown-service/v1/messages')
      .set('Authorization', AUTH_HEADER)
      .send({ model: 'test', max_tokens: 1, messages: [] })
    expect(res.status).toBe(404)
  })
})
