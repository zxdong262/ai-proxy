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
 * When SECRET and UNIFIED_TOKEN env vars are set: verifies the bearer token as
 * a JWT signed with SECRET, and checks that the payload contains
 * { "token": UNIFIED_TOKEN }. This secures all config routes for public deployment.
 */

import jwt from 'jsonwebtoken'

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

  // When SECRET and UNIFIED_TOKEN are set, verify the JWT before proceeding.
  const secret = process.env.SECRET
  const unifiedToken = process.env.UNIFIED_TOKEN
  if (secret && unifiedToken) {
    try {
      const decoded = jwt.verify(token, secret)
      if (decoded.token !== unifiedToken) {
        return res.status(401).json({ error: 'Invalid token' })
      }
    } catch {
      return res.status(401).json({ error: 'Invalid or expired JWT' })
    }
  }

  // When the service has no api_key configured, store the client's token for passthrough.
  const serviceConfig = req._serviceConfig
  if (!serviceConfig || !serviceConfig.api_key) {
    req._passthroughToken = token
  }

  next()
}
