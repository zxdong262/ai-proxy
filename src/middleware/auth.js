/**
 * Authentication middleware.
 *
 * The Anthropic CLI sends requests with:
 *   Authorization: Bearer <ANTHROPIC_AUTH_TOKEN>
 *
 * When the service has an api_key configured: accepts any bearer token from the
 * client, and uses the service's api_key to authenticate with the upstream.
 *
 * When the service has no api_key (passthrough mode): forwards the client's
 * Authorization header directly to the upstream remote service.
 *
 * When UNIFIED_TOKEN is set: compares the bearer token against it using
 * constant-time comparison to prevent timing attacks.
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
  const authHeader = req.headers.authorization
  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header' })
  }

  const [scheme, token] = authHeader.split(' ')
  if (scheme !== 'Bearer' || !token) {
    return res
      .status(401)
      .json({ error: 'Invalid Authorization format. Expected "Bearer <token>"' })
  }

  // When UNIFIED_TOKEN is set, verify the token with constant-time comparison.
  const unifiedToken = process.env.UNIFIED_TOKEN
  if (unifiedToken) {
    if (!safeCompare(token, unifiedToken)) {
      return res.status(401).json({ error: 'Invalid token' })
    }
  }

  // When the service has no api_key configured, store the client's token for passthrough.
  const serviceConfig = req._serviceConfig
  if (!serviceConfig || !serviceConfig.api_key) {
    req._passthroughToken = token
  }

  next()
}
