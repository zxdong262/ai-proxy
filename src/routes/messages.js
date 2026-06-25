/**
 * POST /v1/messages — Anthropic-compatible endpoint.
 *
 * Accepts Anthropic Messages API requests. On first request to a provider,
 * probes /v1/messages to detect native Anthropic support and caches the result.
 *
 * - Native Anthropic support: proxies directly to /v1/messages
 * - OpenAI-only: converts Anthropic → OpenAI, forwards to /chat/completions,
 *   converts response back to Anthropic format
 */

import { Router } from 'express'
import https from 'node:https'
import http from 'node:http'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  anthropicToOpenAI,
  openAIToAnthropic,
  openAIChunkToAnthropicEvents
} from '../converter.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CACHE_FILE = resolve(__dirname, '../../.capability-cache.json')

const router = Router()

// Cache: serviceName → 'anthropic' | 'openai'
const capabilityCache = loadCache()

function loadCache () {
  try {
    if (existsSync(CACHE_FILE)) {
      const data = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'))
      console.log(`[capability] loaded cache: ${Object.keys(data).length} entries`)
      return data
    }
  } catch {
    // ignore corrupted cache
  }
  return {}
}

function saveCache () {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify(capabilityCache, null, 2))
  } catch (err) {
    console.error('[capability] failed to save cache:', err.message)
  }
}

function setCapability (serviceName, format) {
  capabilityCache[serviceName] = format
  console.log(`[capability] ${serviceName}: detected as ${format}`)
  saveCache()
}

// ─── HTTP helpers ──────────────────────────────────────────────────────────

function buildAuthHeaders (apiKey, authType) {
  if (authType === 'api-key') {
    return { 'api-key': apiKey }
  }
  return { Authorization: `Bearer ${apiKey}` }
}

async function httpRequest (body, url, apiKey, authType) {
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

async function readBody (res) {
  let data = ''
  for await (const chunk of res) {
    data += chunk
  }
  return data
}

function buildUrl (serviceConfig, path) {
  const base = serviceConfig.remote_api_url.replace(/\/+$/, '')
  return new URL(`${base}${path}`)
}

function sendError (res, statusCode, message) {
  return res.status(statusCode).json({
    type: 'error',
    error: { type: 'api_error', message }
  })
}

// ─── Capability detection ──────────────────────────────────────────────────

async function detectCapability (serviceConfig, apiKey, authType) {
  const url = buildUrl(serviceConfig, '/v1/messages')
  console.log(`[capability] probing ${url}`)
  const body = { model: 'noop', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }

  try {
    const res = await httpRequest(body, url, apiKey, authType)
    await readBody(res)
    console.log(`[capability] probe response: ${res.statusCode}`)

    // 404 or 405 → provider doesn't have /v1/messages
    if (res.statusCode === 404 || res.statusCode === 405) {
      return 'openai'
    }
    // Anything else (200, 400, 401, 429, etc.) means the endpoint exists
    return 'anthropic'
  } catch (err) {
    console.log(`[capability] probe error: ${err.message}`)
    return 'openai'
  }
}

async function ensureCapability (serviceConfig, apiKey, authType) {
  const name = serviceConfig.name
  if (capabilityCache[name]) {
    return capabilityCache[name]
  }

  const format = await detectCapability(serviceConfig, apiKey, authType)
  setCapability(name, format)
  return format
}

// ─── Native Anthropic proxy ───────────────────────────────────────────────

async function handleNativeNonStreaming (req, res) {
  try {
    const serviceConfig = req._serviceConfig
    const url = buildUrl(serviceConfig, '/v1/messages')
    const apiKey = serviceConfig.api_key
    const authType = serviceConfig.auth_type || 'bearer'

    console.log(`[native-non-stream] → ${url}`)
    const upstreamRes = await httpRequest(req.body, url, apiKey, authType)
    const data = await readBody(upstreamRes)
    console.log(`[native-non-stream] ← ${upstreamRes.statusCode} (${data.length} bytes)`)

    res.status(upstreamRes.statusCode)
    res.setHeader('Content-Type', 'application/json')
    res.send(data)
  } catch (err) {
    console.error(`[native-non-stream] ERROR: ${err.message}`)
    return sendError(res, 500, err.message)
  }
}

async function handleNativeStreaming (req, res) {
  try {
    const serviceConfig = req._serviceConfig
    const url = buildUrl(serviceConfig, '/v1/messages')
    const apiKey = serviceConfig.api_key
    const authType = serviceConfig.auth_type || 'bearer'

    console.log(`[native-stream] → ${url}`)
    const body = { ...req.body, stream: true }
    const upstreamRes = await httpRequest(body, url, apiKey, authType)

    if (upstreamRes.statusCode !== 200) {
      const data = await readBody(upstreamRes)
      console.error(`[native-stream] upstream error ${upstreamRes.statusCode}: ${data.slice(0, 500)}`)
      return sendError(res, upstreamRes.statusCode, `Upstream returned ${upstreamRes.statusCode}: ${data}`)
    }

    console.log(`[native-stream] ← 200, streaming...`)
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    for await (const chunk of upstreamRes) {
      res.write(chunk)
    }

    res.end()
  } catch (err) {
    console.error(`[native-stream] ERROR: ${err.message}`)
    if (!res.headersSent) {
      return sendError(res, 500, err.message)
    }
    res.end()
  }
}

// ─── OpenAI conversion ────────────────────────────────────────────────────

async function handleConvertedNonStreaming (req, res) {
  try {
    const serviceConfig = req._serviceConfig
    const url = buildUrl(serviceConfig, '/chat/completions')
    const apiKey = serviceConfig.api_key
    const authType = serviceConfig.auth_type || 'bearer'

    console.log(`[converted-non-stream] → ${url}`)
    const openaiBody = anthropicToOpenAI(req.body)
    console.log(`[converted-non-stream] converted body model: ${openaiBody.model}`)
    const upstreamRes = await httpRequest(openaiBody, url, apiKey, authType)
    const data = await readBody(upstreamRes)
    console.log(`[converted-non-stream] ← ${upstreamRes.statusCode} (${data.length} bytes)`)

    if (upstreamRes.statusCode !== 200) {
      console.error(`[converted-non-stream] upstream error: ${data.slice(0, 500)}`)
      return sendError(res, upstreamRes.statusCode, `Upstream returned ${upstreamRes.statusCode}: ${data}`)
    }

    const openaiRes = JSON.parse(data)
    const anthropicRes = openAIToAnthropic(openaiRes, req.body.model)
    return res.json(anthropicRes)
  } catch (err) {
    console.error(`[converted-non-stream] ERROR: ${err.message}`)
    return sendError(res, 500, err.message)
  }
}

async function handleConvertedStreaming (req, res) {
  try {
    const serviceConfig = req._serviceConfig
    const url = buildUrl(serviceConfig, '/chat/completions')
    const apiKey = serviceConfig.api_key
    const authType = serviceConfig.auth_type || 'bearer'

    console.log(`[converted-stream] → ${url}`)
    const openaiBody = anthropicToOpenAI(req.body)
    openaiBody.stream = true
    console.log(`[converted-stream] converted body model: ${openaiBody.model}`)

    const upstreamRes = await httpRequest(openaiBody, url, apiKey, authType)

    if (upstreamRes.statusCode !== 200) {
      const data = await readBody(upstreamRes)
      console.error(`[converted-stream] upstream error ${upstreamRes.statusCode}: ${data.slice(0, 500)}`)
      return sendError(res, upstreamRes.statusCode, `Upstream returned ${upstreamRes.statusCode}: ${data}`)
    }

    console.log(`[converted-stream] ← 200, streaming...`)

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const state = { started: false, outputTokens: 0, model: req.body.model }
    let buffer = ''

    for await (const chunk of upstreamRes) {
      buffer += chunk.toString()

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue

        const payload = trimmed.slice(6)
        if (payload === '[DONE]') continue

        try {
          const openaiChunk = JSON.parse(payload)
          const events = openAIChunkToAnthropicEvents(openaiChunk, state)
          for (const evt of events) {
            res.write(`event: ${evt.event}\ndata: ${evt.data}\n\n`)
          }
        } catch {
          // skip unparseable chunks
        }
      }
    }

    res.end()
  } catch (err) {
    if (!res.headersSent) {
      return sendError(res, 500, err.message)
    }
    res.end()
  }
}

// ─── Capability-aware fallback ─────────────────────────────────────────────

async function handleWithFallback (req, res, handleNative, handleConverted) {
  const serviceConfig = req._serviceConfig
  const apiKey = serviceConfig.api_key
  const authType = serviceConfig.auth_type || 'bearer'

  console.log(`[messages] ${req.method} ${req.originalUrl}`)
  console.log(`[messages] service: ${serviceConfig.name}`)
  console.log(`[messages] remote_api_url: ${serviceConfig.remote_api_url}`)
  console.log(`[messages] model: ${req.body?.model}`)
  console.log(`[messages] stream: ${req.body?.stream}`)
  console.log(`[messages] auth_type: ${authType}`)

  const format = await ensureCapability(serviceConfig, apiKey, authType)
  console.log(`[messages] capability format: ${format}`)

  if (format === 'anthropic') {
    console.log(`[messages] → using native Anthropic handler`)
    return handleNative(req, res)
  }

  console.log(`[messages] → using OpenAI conversion handler`)
  return handleConverted(req, res)
}

// ─── Router ───────────────────────────────────────────────────────────────

router.post('/', (req, res) => {
  if (req.body.stream) {
    return handleWithFallback(req, res, handleNativeStreaming, handleConvertedStreaming)
  }
  return handleWithFallback(req, res, handleNativeNonStreaming, handleConvertedNonStreaming)
})

export default router
