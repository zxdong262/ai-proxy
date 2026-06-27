/**
 * Multi-service configuration.
 *
 * Copy this file to config.js and edit to configure multiple remote AI services.
 * Each route is exposed as /<name>/v1/messages and /<name>/v1/*.
 *
 * Fields:
 *   name           - Route name, used as URL prefix (e.g. 'openai' -> /openai/v1/*)
 *   remote_api_url - Base URL of the remote API
 *   api_key        - API key for the remote provider (required)
 *   auth_type      - 'bearer' (default) or 'api-key'. Use 'api-key' for providers
 *                    that use an api-key header instead of Authorization (e.g. Azure).
 *   format         - 'openai' or 'anthropic'. Optional. Force the provider format
 *                    instead of auto-detecting. Use 'anthropic' for providers that
 *                    only support /v1/messages (e.g. some open model providers).
 *
 * The proxy auto-detects whether the upstream supports the Anthropic Messages API
 * (/v1/messages) or only OpenAI (/chat/completions) and routes accordingly.
 * When a provider is Anthropic-native, OpenAI-format requests to /chat/completions
 * are automatically converted to /v1/messages format.
 *
 * Client authentication uses UNIFIED_TOKEN (see .env). The real provider API keys
 * never leave the server.
 */
export default {
  routes: [
    {
      name: 'openai',
      remote_api_url: 'https://api.openai.com/v1',
      api_key: 'sk-your-openai-key'
    },
    {
      name: 'deepseek',
      remote_api_url: 'https://api.deepseek.com',
      api_key: 'sk-your-deepseek-key'
    },
    {
      name: 'azure',
      remote_api_url: 'https://your-resource.openai.azure.com/openai/deployments/your-deployment',
      auth_type: 'api-key',
      api_key: 'your_azure_api_key'
    },
    {
      name: 'anthropic-native',
      remote_api_url: 'https://api.example.com',
      format: 'anthropic',
      api_key: 'your-api-key'
    }
  ]
}
