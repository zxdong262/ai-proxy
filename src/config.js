/**
 * Load multi-service config from config.js.
 *
 * Returns an array of route objects:
 *   { name, remote_api_url, auth_type, api_key }
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

const __dirname = dirname(new URL(import.meta.url).pathname)

export function loadConfig () {
  const configPath = resolve(__dirname, '../config.js')

  if (!existsSync(configPath)) {
    throw new Error(
      'config.js not found. Copy config.sample.js to config.js and edit it.'
    )
  }

  const content = readFileSync(configPath, 'utf-8')

  // Extract object from `export default { ... }` or `module.exports = { ... }`
  let body
  const esmMatch = content.match(/export\s+default\s+([\s\S]+)/)
  if (esmMatch) {
    body = esmMatch[1].replace(/;?\s*$/, '')
  } else {
    const cjsMatch = content.match(/module\.exports\s*=\s*([\s\S]+)/)
    if (cjsMatch) {
      body = cjsMatch[1].replace(/;?\s*$/, '')
    } else {
      throw new Error("Could not parse config.js — expected 'export default { ... }' or 'module.exports = { ... }'")
    }
  }

  // Pass `process` so config.js can reference process.env.X
  let cfg
  try {
    cfg = new Function('process', `return (${body})`)(process) // eslint-disable-line no-new-func
  } catch (err) {
    throw new Error(`Failed to parse config.js: ${err.message}`)
  }

  if (!cfg.routes || !Array.isArray(cfg.routes) || cfg.routes.length === 0) {
    throw new Error('config.js must export a non-empty routes array.')
  }

  return cfg.routes
}
