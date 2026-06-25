# AI Proxy

A unified API proxy for LLM providers. Accepts both [Anthropic Messages API](https://docs.anthropic.com/en/api/messages) and [OpenAI Chat Completions API](https://platform.openai.com/docs/api-reference/chat) requests, and routes them to any OpenAI or Anthropic-compatible provider. Auto-detects whether the upstream supports Anthropic natively or needs OpenAI conversion.

[中文文档](./README_CN.md)

## How It Works

```
Client (Anthropic or OpenAI format)  ──▶  AI Proxy  ──▶  Upstream LLM Provider
(Claude Code, Claude CLI,                (this repo)      (OpenAI, DeepSeek, vLLM,
 Anthropic SDK, OpenAI SDK,                               Ollama, LiteLLM, etc.)
 any OpenAI-compatible client)
```

1. Client authenticates with `UNIFIED_TOKEN` (provider API keys stay on the server)
2. Client sends a request to `/<name>/v1/messages` (Anthropic format) or `/<name>/v1/chat/completions` (OpenAI format)
3. On first request, the proxy probes the upstream `/v1/messages` endpoint to detect native Anthropic support
4. **If upstream supports Anthropic**: proxies `/messages` requests directly (no conversion)
5. **If upstream is OpenAI-only**: converts Anthropic → OpenAI format, forwards, and converts the response back
6. All OpenAI-format requests (`/chat/completions`, `/models`, etc.) are always proxied directly

The detection result is cached in `.capability-cache.json` and loaded on startup.

## Quick Start

```bash
# Clone and install
git clone https://github.com/zxdong262/ai-proxy.git && cd ai-proxy
npm install

# Configure
cp sample.env .env
# Edit .env and set UNIFIED_TOKEN
cp config.sample.js config.js
# Edit config.js with your provider API keys

# Run
npm start
```

The proxy starts on `http://0.0.0.0:8088` by default.

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `HOST` | `0.0.0.0` | Server bind address |
| `PORT` | `8088` | Server port |
| `UNIFIED_TOKEN` | **required** | Client access token. All requests must include `Authorization: Bearer <UNIFIED_TOKEN>`. |

Set these in a `.env` file or as environment variables.

### Service Config

Create `config.js` from the template:

```bash
cp config.sample.js config.js
```

Edit `config.js` to define your services:

```js
export default {
  routes: [
    {
      name: "openai",
      remote_api_url: "https://api.openai.com/v1",
      api_key: "sk-your-openai-key",
    },
    {
      name: "deepseek",
      remote_api_url: "https://api.deepseek.com",
      api_key: "sk-your-deepseek-key",
    },
    {
      name: "azure",
      remote_api_url: "https://your-resource.openai.azure.com/openai/deployments/your-deployment",
      auth_type: "api-key",
      api_key: "your-azure-api-key",
    },
  ],
};
```

Each service is exposed at `/<name>/v1/*`:

| Service | Anthropic Endpoint | OpenAI Endpoint |
|---|---|---|
| `openai` | `POST /openai/v1/messages` | `POST /openai/v1/chat/completions` |
| `deepseek` | `POST /deepseek/v1/messages` | `POST /deepseek/v1/chat/completions` |

### Route Fields

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Route name, used as URL prefix (e.g. `openai` → `/openai/v1/*`) |
| `remote_api_url` | Yes | Base URL of the remote API |
| `api_key` | Yes | API key for the remote provider |
| `auth_type` | No | Authentication type: `'bearer'` (default) or `'api-key'`. Use `'api-key'` for providers that use an `api-key` header (e.g. Azure OpenAI). |

### Supported Providers

Works with any provider that supports the OpenAI or Anthropic API:

- **OpenAI**: `https://api.openai.com/v1`
- **DeepSeek**: `https://api.deepseek.com` (native Anthropic support, auto-detected)
- **Azure OpenAI**: use `auth_type: 'api-key'`
- **Ollama** (local): `http://localhost:11434/v1`
- **vLLM** (local): `http://localhost:8000/v1`
- **LiteLLM**: `http://localhost:4000/v1`
- **Together AI**: `https://api.together.xyz/v1`
- **Groq**: `https://api.groq.com/openai/v1`

## Usage with Claude Code

```bash
export ANTHROPIC_BASE_URL=http://localhost:8088/openai
export ANTHROPIC_AUTH_TOKEN=your-unified-token

claude
```

Or in your Claude Code settings:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:8088/openai",
    "ANTHROPIC_AUTH_TOKEN": "your-unified-token"
  }
}
```

## Production Deployment with PM2

```bash
# Start
npm run pm2:start

# Stop
npm run pm2:stop

# Restart
npm run pm2:restart

# View logs
npm run pm2:logs
```

Logs are written to `logs/error.log` and `logs/out.log`.

## API

### `POST /<name>/v1/messages`

Accepts [Anthropic Messages API](https://docs.anthropic.com/en/api/messages) format. Auto-detects whether the upstream supports Anthropic natively or requires OpenAI conversion. Supports:

- Non-streaming and streaming (`stream: true`)
- System prompts (converted to OpenAI system messages when needed)
- Multimodal content (text + images)
- Tool use (converted bidirectionally when needed)
- Parameters: `model`, `max_tokens`, `temperature`, `top_p`, `stop_sequences`

### `POST /<name>/v1/chat/completions`

Accepts [OpenAI Chat Completions API](https://platform.openai.com/docs/api-reference/chat) format. Proxied directly to the upstream with no conversion.

### `GET /<name>/v1/models` (and other `/<name>/v1/*` endpoints)

Proxied directly to the remote API. Useful for listing available models.

### `GET /health`

Returns `{ "status": "ok" }`.

## Testing

```bash
# Run all tests
npm test

# Unit tests only (no remote API needed)
npm run test:unit

# Integration tests (requires valid config.js)
npm run test:integration
```

## License

MIT
