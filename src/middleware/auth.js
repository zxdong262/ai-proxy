/**
 * Authentication middleware.
 *
 * Validates client requests against UNIFIED_TOKEN (validated at startup).
 * Uses constant-time comparison to prevent timing attacks.
 *
 * The real provider API keys stay on the server and are never exposed to clients.
 */

import { timingSafeEqual } from 'node:crypto'

function safeCompare (a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export function authMiddleware (req, res, next) {
  // Support both Authorization: Bearer <token> and x-api-key: <token>
  const authHeader = req.headers.authorization
  const xApiKey = req.headers['x-api-key']

  console.log(`[auth] ${req.method} ${req.originalUrl}`)
  console.log(`[auth] x-api-key: ${xApiKey ? xApiKey.slice(0, 8) + '...' : 'none'}`)
  console.log(`[auth] authorization: ${authHeader ? authHeader.slice(0, 20) + '...' : 'none'}`)

  let token

  if (xApiKey) {
    // Claude/Anthropic SDK style: x-api-key header
    token = xApiKey
  } else if (authHeader) {
    const [scheme, t] = authHeader.split(' ')
    if (scheme !== 'Bearer' || !t) {
      console.log(`[auth] REJECT: bad Authorization format`)
      return res
        .status(401)
        .json({ error: 'Invalid Authorization format. Expected "Bearer <token>"' })
    }
    token = t
  } else {
    console.log(`[auth] REJECT: no auth header`)
    return res.status(401).json({ error: 'Missing Authorization header (use "Authorization: Bearer <token>" or "x-api-key: <token>")' })
  }

  if (!safeCompare(token, process.env.UNIFIED_TOKEN)) {
    console.log(`[auth] REJECT: token mismatch (got ${token.slice(0, 8)}...)`)
    return res.status(401).json({ error: 'Invalid token' })
  }

  console.log(`[auth] OK`)
  next()
}
