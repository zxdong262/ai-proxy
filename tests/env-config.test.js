/**
 * Integration tests: concurrent .env + config.js loading.
 *
 * Verifies that:
 * 1. .env variables (UNIFIED_TOKEN) are loaded and used for auth
 * 2. config.js routes are parsed and registered with their own api_keys
 * 3. Both work together — auth uses .env token, routing uses config.js
 * 4. process.env.X references inside config.js work (since loadConfig now uses import())
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const configPath = resolve(__dirname, '../config.js')

// Save original config for restoration
let savedConfig = null

function saveConfig () {
  if (existsSync(configPath)) savedConfig = readFileSync(configPath, 'utf-8')
}

function restoreConfig () {
  if (savedConfig !== null) writeFileSync(configPath, savedConfig)
}

describe('Concurrent .env + config.js loading', () => {
  beforeEach(() => {
    saveConfig()
    vi.resetModules()
  })

  afterEach(() => {
    restoreConfig()
    vi.restoreAllMocks()
  })

  test('.env UNIFIED_TOKEN is loaded and used for auth', async () => {
    process.env.UNIFIED_TOKEN = 'test-env-token-abc'

    writeFileSync(configPath, `export default {
      routes: [{
        name: "testsvc",
        remote_api_url: "https://httpbin.org",
        api_key: "sk-test"
      }]
    }`)

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {})
    const { default: app } = await import('../src/server.js')
    expect(exitSpy).not.toHaveBeenCalled()

    // Should reject with wrong token
    const wrongRes = await request(app)
      .post('/testsvc/v1/messages')
      .set('Authorization', 'Bearer wrong-token')
      .send({ model: 'test', max_tokens: 1, messages: [] })
    expect(wrongRes.status).toBe(401)

    // Auth should pass with the correct token
    const authRes = await request(app)
      .post('/testsvc/v1/messages')
      .set('Authorization', 'Bearer test-env-token-abc')
      .send({ model: 'test', max_tokens: 1, messages: [] })
    expect(authRes.status).not.toBe(401)
  })

  test('config.js routes are registered and accessible', async () => {
    process.env.UNIFIED_TOKEN = 'my-token'

    writeFileSync(configPath, `export default {
      routes: [
        { name: "alpha", remote_api_url: "https://httpbin.org", api_key: "k1" },
        { name: "beta", remote_api_url: "https://httpbin.org", api_key: "k2" }
      ]
    }`)

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {})
    const { default: app } = await import('../src/server.js')
    expect(exitSpy).not.toHaveBeenCalled()

    // Both routes should exist (401 = route found, auth required)
    const resAlpha = await request(app)
      .post('/alpha/v1/messages')
      .send({ model: 'test', max_tokens: 1, messages: [] })
    expect(resAlpha.status).toBe(401)

    const resBeta = await request(app)
      .post('/beta/v1/messages')
      .send({ model: 'test', max_tokens: 1, messages: [] })
    expect(resBeta.status).toBe(401)

    // Unknown route should be 404
    const resUnknown = await request(app)
      .post('/gamma/v1/messages')
      .send({ model: 'test', max_tokens: 1, messages: [] })
    expect(resUnknown.status).toBe(404)
  })

  test('each route forwards its own api_key to upstream', async () => {
    process.env.UNIFIED_TOKEN = 'tok'

    writeFileSync(configPath, `export default {
      routes: [{
        name: "svc",
        remote_api_url: "https://httpbin.org",
        api_key: "sk-route-specific-key"
      }]
    }`)

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {})
    const { default: app } = await import('../src/server.js')
    expect(exitSpy).not.toHaveBeenCalled()

    // Hit /anything which echoes request headers back
    const res = await request(app)
      .get('/svc/v1/anything')
      .set('Authorization', 'Bearer tok')

    // If httpbin is reachable, verify the Authorization header was forwarded
    if (res.status === 200 && res.body.headers) {
      expect(res.body.headers.Authorization).toBe('Bearer sk-route-specific-key')
    } else {
      // If httpbin is down, verify proxy attempted (not a 401 from us)
      expect(res.status).not.toBe(401)
    }
  })

  test('config.js with hardcoded values works', async () => {
    process.env.UNIFIED_TOKEN = 'direct-test'

    writeFileSync(configPath, `export default {
      routes: [{
        name: "direct",
        remote_api_url: "https://httpbin.org",
        api_key: "sk-hardcoded-value"
      }]
    }`)

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {})
    const { default: app } = await import('../src/server.js')
    expect(exitSpy).not.toHaveBeenCalled()

    const res = await request(app)
      .post('/direct/v1/messages')
      .set('Authorization', 'Bearer direct-test')
      .send({ model: 'test', max_tokens: 1, messages: [] })

    expect(res.status).not.toBe(500)
  })

  test('process.env.X in config.js works (import() has access to process.env)', async () => {
    process.env.UNIFIED_TOKEN = 'env-test'
    process.env.MY_API_KEY = 'sk-from-env-var'

    writeFileSync(configPath, `export default {
      routes: [{
        name: "envref",
        remote_api_url: "https://httpbin.org",
        api_key: process.env.MY_API_KEY
      }]
    }`)

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {})
    const { default: app } = await import('../src/server.js')

    // With import(), process.env IS accessible — so api_key resolves and exit is NOT called
    expect(exitSpy).not.toHaveBeenCalled()

    const res = await request(app)
      .post('/envref/v1/messages')
      .set('Authorization', 'Bearer env-test')
      .send({ model: 'test', max_tokens: 1, messages: [] })

    // Should NOT fail due to config — may fail at upstream
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(500)
  })

  test('config.js missing throws helpful error', async () => {
    process.env.UNIFIED_TOKEN = 'test'
    if (existsSync(configPath)) unlinkSync(configPath)

    const { loadConfig } = await import('../src/config.js')
    expect(() => loadConfig()).toThrow('config.js not found')
  })

  test('config.js empty routes throws helpful error', async () => {
    process.env.UNIFIED_TOKEN = 'test'
    writeFileSync(configPath, 'export default { routes: [] }')

    const { loadConfig } = await import('../src/config.js')
    expect(() => loadConfig()).toThrow('non-empty routes array')
  })

  test('env token is NOT exposed to client via any endpoint', async () => {
    process.env.UNIFIED_TOKEN = 'super-secret-token'

    writeFileSync(configPath, `export default {
      routes: [{
        name: "leaktest",
        remote_api_url: "https://httpbin.org",
        api_key: "sk-test"
      }]
    }`)

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {})
    const { default: app } = await import('../src/server.js')
    expect(exitSpy).not.toHaveBeenCalled()

    // Check home page doesn't leak the token
    const homeRes = await request(app).get('/')
    expect(homeRes.text).not.toContain('super-secret-token')

    // Check health doesn't leak
    const healthRes = await request(app).get('/health')
    expect(JSON.stringify(healthRes.body)).not.toContain('super-secret-token')

    // Check error responses don't leak
    const errRes = await request(app)
      .post('/leaktest/v1/messages')
      .set('Authorization', 'Bearer wrong')
      .send({ model: 'test', max_tokens: 1, messages: [] })
    expect(JSON.stringify(errRes.body)).not.toContain('super-secret-token')
  })
})
