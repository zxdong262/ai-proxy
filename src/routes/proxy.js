/**
 * Catch-all proxy for /v1/* requests.
 *
 * For OpenAI-native providers: forwards the request as-is.
 * For Anthropic-native providers: converts /chat/completions requests
 * to Anthropic /v1/messages format and converts the response back.
 */

import { Router } from 'express'
import https from 'node:https'
import http from 'node:http'
import {
  openAIToAnthropicRequest,
  anthropicToOpenAIResponse,
  anthropicStreamToOpenAIEvents
} from '../converter.js'
import { ensureCapability, buildAuthHeaders } from '../capability.js'

const router = Router()

// ─── HTTP helpers ──────────────────────────────────────────────────────────

function buildUrl (serviceConfig, path) {
  const base = serviceConfig.remote_api_url.replace(/\/+$/, '')
  return new URL(`${base}${path}`)
}

function sendError (res, statusCode, message) {
  return res.status(statusCode).json({
    error: { type: 'api_error', message }
  })
}

async function readBody (res) {
  let data = ''
  for await (const chunk of res) {
    data += chunk
  }
  return data
}

async function httpPost (body, url, apiKey, authType) {
  const isHttps = url.protocol === 'https:'
  const transport = isHttps ? https : http
  const payload = JSON.stringify(body)

  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildAuthHeaders(apiKey, authType),
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (res) => resolve(res)
    )

    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

// ─── Anthropic-native conversion handlers ──────────────────────────────────

async function handleAnthropicNonStreaming (req, res) {
  try {
    const serviceConfig = req._serviceConfig
    const url = buildUrl(serviceConfig, '/v1/messages')
    const apiKey = serviceConfig.api_key
    const authType = serviceConfig.auth_type || 'bearer'

    console.log(`[proxy-anthropic-non-stream] → ${url}`)
    const anthropicBody = openAIToAnthropicRequest(req.body)
    console.log(`[proxy-anthropic-non-stream] converted model: ${anthropicBody.model}`)

    const upstreamRes = await httpPost(anthropicBody, url, apiKey, authType)
    const data = await readBody(upstreamRes)
    console.log(`[proxy-anthropic-non-stream] ← ${upstreamRes.statusCode} (${data.length} bytes)`)

    if (upstreamRes.statusCode !== 200) {
      console.error(`[proxy-anthropic-non-stream] upstream error: ${data.slice(0, 500)}`)
      return sendError(res, upstreamRes.statusCode, `Upstream returned ${upstreamRes.statusCode}: ${data}`)
    }

    const anthropicRes = JSON.parse(data)
    const openaiRes = anthropicToOpenAIResponse(anthropicRes, req.body.model)
    return res.json(openaiRes)
  } catch (err) {
    console.error(`[proxy-anthropic-non-stream] ERROR: ${err.message}`)
    return sendError(res, 500, err.message)
  }
}

async function handleAnthropicStreaming (req, res) {
  try {
    const serviceConfig = req._serviceConfig
    const url = buildUrl(serviceConfig, '/v1/messages')
    const apiKey = serviceConfig.api_key
    const authType = serviceConfig.auth_type || 'bearer'

    console.log(`[proxy-anthropic-stream] → ${url}`)
    const anthropicBody = openAIToAnthropicRequest({ ...req.body, stream: true })
    console.log(`[proxy-anthropic-stream] converted model: ${anthropicBody.model}`)

    const upstreamRes = await httpPost(anthropicBody, url, apiKey, authType)

    if (upstreamRes.statusCode !== 200) {
      const data = await readBody(upstreamRes)
      console.error(`[proxy-anthropic-stream] upstream error ${upstreamRes.statusCode}: ${data.slice(0, 500)}`)
      return sendError(res, upstreamRes.statusCode, `Upstream returned ${upstreamRes.statusCode}: ${data}`)
    }

    console.log(`[proxy-anthropic-stream] ← 200, streaming...`)

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const state = { started: false, model: req.body.model }
    let buffer = ''

    for await (const chunk of upstreamRes) {
      buffer += chunk.toString()

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        if (trimmed.startsWith('event: ')) {
          state._currentEvent = trimmed.slice(7)
          continue
        }

        if (trimmed.startsWith('data: ')) {
          const eventType = state._currentEvent
          const payload = trimmed.slice(6)

          try {
            const eventData = JSON.parse(payload)
            const openaiChunks = anthropicStreamToOpenAIEvents(eventType, eventData, state)
            for (const openaiChunk of openaiChunks) {
              res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`)
            }
          } catch {
            // skip unparseable data
          }

          state._currentEvent = undefined
        }
      }
    }

    res.write('data: [DONE]\n\n')
    res.end()
  } catch (err) {
    console.error(`[proxy-anthropic-stream] ERROR: ${err.message}`)
    if (!res.headersSent) {
      return sendError(res, 500, err.message)
    }
    res.end()
  }
}

// ─── OpenAI pass-through (for OpenAI-native providers) ────────────────────

function proxyOpenAIRequest (req, res) {
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
    Accept: 'application/json',
    ...buildAuthHeaders(apiKey, authType)
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

// ─── Capability-aware router ───────────────────────────────────────────────

router.all('/{*splat}', async (req, res) => {
  const serviceConfig = req._serviceConfig
  const apiKey = serviceConfig.api_key
  const authType = serviceConfig.auth_type || 'bearer'
  const remotePath = req.originalUrl
  const prefix = `/${serviceConfig.name}/v1`
  const upstreamPath = remotePath.replace(new RegExp(`^${prefix}`), '')

  // Only convert for /chat/completions requests — everything else passes through
  if (upstreamPath === '/chat/completions' && req.method === 'POST') {
    const format = await ensureCapability(serviceConfig, apiKey, authType)

    if (format === 'anthropic') {
      console.log(`[proxy] ${serviceConfig.name} is Anthropic-native, converting /chat/completions`)
      if (req.body.stream) {
        return handleAnthropicStreaming(req, res)
      }
      return handleAnthropicNonStreaming(req, res)
    }
  }

  // Default: pass through to OpenAI-native provider
  return proxyOpenAIRequest(req, res)
})

export default router
