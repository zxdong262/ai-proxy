/**
 * Load multi-service config from config.js.
 *
 * Returns an array of route objects:
 *   { name, remote_api_url, messages_endpoint, auth_type, api_key }
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

const __dirname = dirname(new URL(import.meta.url).pathname);

export function loadConfig() {
  const configPath = resolve(__dirname, "../config.js");

  if (!existsSync(configPath)) {
    throw new Error(
      "config.js not found. Copy config.sample.js to config.js and edit it."
    );
  }

  const content = readFileSync(configPath, "utf-8");

  // Parse config.js — supports both `export default { ... }` and `module.exports = { ... }`
  let cfg;
  try {
    // Try ESM-style: extract the object after `export default`
    const match = content.match(/export\s+default\s+(\{[\s\S]*\})/);
    if (match) {
      cfg = new Function(`return ${match[1]}`)();
    } else {
      // Try CommonJS-style: extract the object after `module.exports =`
      const cjsMatch = content.match(/module\.exports\s*=\s*(\{[\s\S]*\})/);
      if (cjsMatch) {
        cfg = new Function(`return ${cjsMatch[1]}`)();
      } else {
        throw new Error("Could not parse config.js — expected 'export default { ... }' or 'module.exports = { ... }'");
      }
    }
  } catch (err) {
    if (err.message.startsWith("Could not parse")) throw err;
    throw new Error(`Failed to parse config.js: ${err.message}`);
  }

  if (!cfg.routes || !Array.isArray(cfg.routes) || cfg.routes.length === 0) {
    throw new Error("config.js must export a non-empty routes array.");
  }

  return cfg.routes;
}
