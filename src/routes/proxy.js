/**
 * Catch-all proxy for /v1/* requests.
 * Forwards the request method, headers, and body to the remote OpenAI-compatible API.
 */

import { Router } from 'express'
import https from 'node:https'
import http from 'node:http'

const router = Router()

/**
 * Forward any request to the remote API, preserving method and body.
 * Uses service config from req._serviceConfig for URL and auth.
 */
function proxyRequest (req, res) {
  const serviceConfig = req._serviceConfig
  const remotePath = req.originalUrl

  // Strip the route prefix (/<name>/v1) to get the upstream path
  const prefix = `/${serviceConfig.name}/v1`
  const upstreamPath = remotePath.replace(new RegExp(`^${prefix}`), '')
  const url = new URL(`${serviceConfig.remote_api_url}${upstreamPath}`)
  const isHttps = url.protocol === 'https:'
  const transport = isHttps ? https : http

  console.log(`[proxy] ${req.method} ${remotePath} → ${url}`)

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  const payload = hasBody ? JSON.stringify(req.body) : null

  const apiKey = serviceConfig.api_key
  const authType = serviceConfig.auth_type || 'bearer'
  const headers = {
    Accept: 'application/json'
  }

  if (authType === 'api-key') {
    headers['api-key'] = apiKey
  } else {
    headers.Authorization = `Bearer ${apiKey}`
  }
  if (hasBody) {
    headers['Content-Type'] = 'application/json'
    headers['Content-Length'] = Buffer.byteLength(payload)
  }

  const upstreamReq = transport.request(
    url,
    {
      method: req.method,
      headers
    },
    (upstreamRes) => {
      console.log(`[proxy] ← ${upstreamRes.statusCode} from ${url}`)
      res.status(upstreamRes.statusCode)
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        // Skip hop-by-hop headers
        if (key === 'transfer-encoding') continue
        res.setHeader(key, value)
      }
      upstreamRes.pipe(res)
    }
  )

  upstreamReq.on('error', (err) => {
    console.error(`[proxy] ERROR: ${err.message}`)
    if (!res.headersSent) {
      res.status(502).json({ error: { type: 'proxy_error', message: err.message } })
    }
  })

  if (hasBody) {
    upstreamReq.write(payload)
  }
  upstreamReq.end()
}

// Handle all HTTP methods
router.all('/{*splat}', proxyRequest)

export default router
