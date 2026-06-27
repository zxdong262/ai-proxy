/**
 * Shared capability detection for upstream providers.
 *
 * Probes /v1/messages on first request to detect whether the provider
 * supports the Anthropic Messages API or only OpenAI Chat Completions.
 * Results are cached in .capability-cache.json.
 */

import https from 'node:https'
import http from 'node:http'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CACHE_FILE = resolve(__dirname, '../.capability-cache.json')

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

export function buildAuthHeaders (apiKey, authType) {
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

// ─── Capability detection ──────────────────────────────────────────────────

async function detectCapability (serviceConfig, apiKey, authType) {
  const base = serviceConfig.remote_api_url.replace(/\/+$/, '')
  const url = new URL(`${base}/v1/messages`)
  console.log(`[capability] probing ${url}`)
  const body = { model: 'noop', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }

  try {
    const res = await httpRequest(body, url, apiKey, authType)
    let data = ''
    for await (const chunk of res) {
      data += chunk
    }
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

export async function ensureCapability (serviceConfig, apiKey, authType) {
  // Allow explicit format override in config
  if (serviceConfig.format === 'anthropic' || serviceConfig.format === 'openai') {
    return serviceConfig.format
  }

  const name = serviceConfig.name
  if (capabilityCache[name]) {
    return capabilityCache[name]
  }

  const format = await detectCapability(serviceConfig, apiKey, authType)
  setCapability(name, format)
  return format
}
