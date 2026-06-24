import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import jwt from 'jsonwebtoken'

const TEST_SECRET = 'test-jwt-secret'
const TEST_UNIFIED_TOKEN = 'test-unified-token'

function loadMiddleware () {
  // Dynamic import to get fresh module
  return import('../src/middleware/auth.js').then((m) => m.authMiddleware)
}

function mockReqRes (authHeader, serviceConfig) {
  const req = {
    headers: authHeader ? { authorization: authHeader } : {},
    _serviceConfig: serviceConfig !== undefined ? serviceConfig : { name: 'test', api_key: 'test-key' }
  }
  const res = {
    _status: null,
    _body: null,
    status (code) {
      this._status = code
      return this
    },
    json (body) {
      this._body = body
      return this
    }
  }
  return { req, res }
}

describe('authMiddleware', () => {
  test('rejects request without Authorization header', async () => {
    const authMiddleware = await loadMiddleware()
    const { req, res } = mockReqRes(null)
    const next = vi.fn()

    authMiddleware(req, res, next)

    expect(res._status).toBe(401)
    expect(res._body.error).toContain('Missing Authorization header')
    expect(next).not.toHaveBeenCalled()
  })

  test('rejects malformed Authorization header', async () => {
    const authMiddleware = await loadMiddleware()
    const { req, res } = mockReqRes('Basic abc')
    const next = vi.fn()

    authMiddleware(req, res, next)

    expect(res._status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  test('accepts Bearer token and calls next when service has api_key', async () => {
    const authMiddleware = await loadMiddleware()
    const { req, res } = mockReqRes('Bearer client-token', {
      name: 'test',
      api_key: 'service-key'
    })
    const next = vi.fn()

    authMiddleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req._passthroughToken).toBeUndefined()
  })

  test('sets _passthroughToken when service has no api_key', async () => {
    const authMiddleware = await loadMiddleware()
    const { req, res } = mockReqRes('Bearer my-anthropic-token', {
      name: 'test',
      api_key: ''
    })
    const next = vi.fn()

    authMiddleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req._passthroughToken).toBe('my-anthropic-token')
  })

  test('sets _passthroughToken when api_key is omitted', async () => {
    const authMiddleware = await loadMiddleware()
    const { req, res } = mockReqRes('Bearer my-token', {
      name: 'test'
    })
    const next = vi.fn()

    authMiddleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req._passthroughToken).toBe('my-token')
  })

  test('sets _passthroughToken when no service config is present', async () => {
    const authMiddleware = await loadMiddleware()
    const { req, res } = mockReqRes('Bearer my-token', null)
    const next = vi.fn()

    authMiddleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req._passthroughToken).toBe('my-token')
  })

  test('still requires Authorization header in passthrough mode', async () => {
    const authMiddleware = await loadMiddleware()
    const { req, res } = mockReqRes(null, { name: 'test', api_key: '' })
    const next = vi.fn()

    authMiddleware(req, res, next)

    expect(res._status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })
})

describe('authMiddleware with JWT verification (SECRET + UNIFIED_TOKEN)', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.SECRET = TEST_SECRET
    process.env.UNIFIED_TOKEN = TEST_UNIFIED_TOKEN
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  test('accepts valid JWT with correct token claim', async () => {
    const authMiddleware = await loadMiddleware()
    const token = jwt.sign({ token: TEST_UNIFIED_TOKEN }, TEST_SECRET)
    const { req, res } = mockReqRes(`Bearer ${token}`)
    const next = vi.fn()

    authMiddleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(res._status).toBeNull()
  })

  test('rejects JWT with wrong token claim', async () => {
    const authMiddleware = await loadMiddleware()
    const token = jwt.sign({ token: 'wrong-token' }, TEST_SECRET)
    const { req, res } = mockReqRes(`Bearer ${token}`)
    const next = vi.fn()

    authMiddleware(req, res, next)

    expect(res._status).toBe(401)
    expect(res._body.error).toBe('Invalid token')
    expect(next).not.toHaveBeenCalled()
  })

  test('rejects JWT signed with wrong secret', async () => {
    const authMiddleware = await loadMiddleware()
    const token = jwt.sign({ token: TEST_UNIFIED_TOKEN }, 'wrong-secret')
    const { req, res } = mockReqRes(`Bearer ${token}`)
    const next = vi.fn()

    authMiddleware(req, res, next)

    expect(res._status).toBe(401)
    expect(res._body.error).toContain('Invalid or expired JWT')
    expect(next).not.toHaveBeenCalled()
  })

  test('rejects expired JWT', async () => {
    const authMiddleware = await loadMiddleware()
    const token = jwt.sign({ token: TEST_UNIFIED_TOKEN }, TEST_SECRET, { expiresIn: '-1s' })
    const { req, res } = mockReqRes(`Bearer ${token}`)
    const next = vi.fn()

    authMiddleware(req, res, next)

    expect(res._status).toBe(401)
    expect(res._body.error).toContain('Invalid or expired JWT')
    expect(next).not.toHaveBeenCalled()
  })

  test('rejects plain string token when JWT is required', async () => {
    const authMiddleware = await loadMiddleware()
    const { req, res } = mockReqRes(`Bearer ${TEST_UNIFIED_TOKEN}`)
    const next = vi.fn()

    authMiddleware(req, res, next)

    expect(res._status).toBe(401)
    expect(res._body.error).toContain('Invalid or expired JWT')
    expect(next).not.toHaveBeenCalled()
  })

  test('rejects request without Authorization header when JWT is required', async () => {
    const authMiddleware = await loadMiddleware()
    const { req, res } = mockReqRes(null)
    const next = vi.fn()

    authMiddleware(req, res, next)

    expect(res._status).toBe(401)
    expect(res._body.error).toContain('Missing Authorization header')
    expect(next).not.toHaveBeenCalled()
  })

  test('sets _passthroughToken for passthrough service with valid JWT', async () => {
    const authMiddleware = await loadMiddleware()
    const token = jwt.sign({ token: TEST_UNIFIED_TOKEN }, TEST_SECRET)
    const { req, res } = mockReqRes(`Bearer ${token}`, { name: 'test', api_key: '' })
    const next = vi.fn()

    authMiddleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req._passthroughToken).toBe(token)
  })

  test('skips JWT verification when SECRET is not set', async () => {
    delete process.env.SECRET
    const authMiddleware = await loadMiddleware()
    const { req, res } = mockReqRes('Bearer plain-token')
    const next = vi.fn()

    authMiddleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(res._status).toBeNull()
  })

  test('skips JWT verification when UNIFIED_TOKEN is not set', async () => {
    delete process.env.UNIFIED_TOKEN
    const authMiddleware = await loadMiddleware()
    const { req, res } = mockReqRes('Bearer plain-token')
    const next = vi.fn()

    authMiddleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(res._status).toBeNull()
  })

  test('accepts JWT with extra claims beyond token', async () => {
    const authMiddleware = await loadMiddleware()
    const token = jwt.sign({ token: TEST_UNIFIED_TOKEN, role: 'admin', iat: Math.floor(Date.now() / 1000) }, TEST_SECRET)
    const { req, res } = mockReqRes(`Bearer ${token}`)
    const next = vi.fn()

    authMiddleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(res._status).toBeNull()
  })
})
