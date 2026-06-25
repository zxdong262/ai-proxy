import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

const TEST_UNIFIED_TOKEN = 'test-unified-token-abc123'

function loadMiddleware () {
  return import('../src/middleware/auth.js').then((m) => m.authMiddleware)
}

function mockReqRes (authHeader) {
  const req = {
    headers: authHeader ? { authorization: authHeader } : {}
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
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.UNIFIED_TOKEN = TEST_UNIFIED_TOKEN
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

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

  test('accepts request with correct token', async () => {
    const authMiddleware = await loadMiddleware()
    const { req, res } = mockReqRes(`Bearer ${TEST_UNIFIED_TOKEN}`)
    const next = vi.fn()

    authMiddleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(res._status).toBeNull()
  })

  test('rejects request with wrong token', async () => {
    const authMiddleware = await loadMiddleware()
    const { req, res } = mockReqRes('Bearer wrong-token')
    const next = vi.fn()

    authMiddleware(req, res, next)

    expect(res._status).toBe(401)
    expect(res._body.error).toBe('Invalid token')
    expect(next).not.toHaveBeenCalled()
  })

  test('rejects token with same prefix but different length', async () => {
    const authMiddleware = await loadMiddleware()
    const { req, res } = mockReqRes(`Bearer ${TEST_UNIFIED_TOKEN}x`)
    const next = vi.fn()

    authMiddleware(req, res, next)

    expect(res._status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  test('rejects empty token', async () => {
    const authMiddleware = await loadMiddleware()
    const { req, res } = mockReqRes('Bearer ')
    const next = vi.fn()

    authMiddleware(req, res, next)

    expect(res._status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })
})
