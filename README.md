# AI Proxy

A lightweight proxy that translates [Anthropic Messages API](https://docs.anthropic.com/en/api/messages) requests into [OpenAI Chat Completions API](https://platform.openai.com/docs/api-reference/chat) format, allowing you to use any OpenAI-compatible LLM provider with tools that expect the Anthropic API (e.g. Claude Code, Anthropic SDKs).

[中文文档](./README_CN.md)

## How It Works

```
Anthropic Client  ──▶  AI Proxy  ──▶  Any OpenAI-compatible API
(Claude Code,         (this repo)      (OpenAI, DeepSeek, vLLM,
 Anthropic SDK,                        Ollama, LiteLLM, etc.)
 Claude CLI)
```

1. Client sends an Anthropic Messages API request (`POST /<name>/v1/messages`)
2. Proxy converts the request to OpenAI Chat Completions format
3. Forwards to the configured remote API for that service
4. Converts the response back to Anthropic format (including streaming SSE events)

All other `/<name>/v1/*` requests (e.g. `GET /<name>/v1/models`) are proxied directly to the remote API.

## Quick Start

```bash
# Clone and install
git clone https://github.com/zxdong262/ai-proxy.git && cd ai-proxy
npm install

# Configure
cp config.sample.js config.js
# Edit config.js with your services

# Run
npm start
```

The proxy starts on `http://0.0.0.0:8088` by default.

## Configuration

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
      messages_endpoint: "/chat/completions",
      auth_type: "bearer",
      api_key: "sk-your-openai-key",
    },
    {
      name: "deepseek",
      remote_api_url: "https://api.deepseek.com/v1",
      messages_endpoint: "/chat/completions",
      auth_type: "bearer",
      api_key: "",  // empty = passthrough mode
    },
  ],
};
```

Each service is exposed at `/<name>/v1/messages` and `/<name>/v1/*`:

| Service | Messages Endpoint | Models Endpoint |
|---|---|---|
| `openai` | `POST /openai/v1/messages` | `GET /openai/v1/models` |
| `deepseek` | `POST /deepseek/v1/messages` | `GET /deepseek/v1/models` |

### Route Fields

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Route name, used as URL prefix (e.g. `openai` → `/openai/v1/*`) |
| `remote_api_url` | Yes | Base URL of the OpenAI-compatible API |
| `messages_endpoint` | No | Path for chat completions (default: `/chat/completions`) |
| `auth_type` | No | Authentication type (default: `bearer`) |
| `api_key` | No | API key. When empty or omitted, runs in passthrough mode. |

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `HOST` | `0.0.0.0` | Server bind address |
| `PORT` | `8088` | Server port |

Set these in a `.env` file or as environment variables.

### Supported Providers

Works with any OpenAI-compatible provider:

- **OpenAI**: `https://api.openai.com/v1`
- **DeepSeek**: `https://api.deepseek.com/v1`
- **Ollama** (local): `http://localhost:11434/v1`
- **vLLM** (local): `http://localhost:8000/v1`
- **LiteLLM**: `http://localhost:4000/v1`
- **Together AI**: `https://api.together.xyz/v1`
- **Groq**: `https://api.groq.com/openai/v1`

## Auth Modes

Each service supports two authentication modes:

### API Key

Set `api_key` in the route config. The proxy uses this key to authenticate with the remote service. The client's `Authorization` header is accepted but not forwarded.

### Passthrough (no api_key)

When `api_key` is empty or omitted, the proxy runs in passthrough mode. The client's `Authorization` header is forwarded directly to the remote service.

This is useful when:
- You want to use Claude CLI with `ANTHROPIC_AUTH_TOKEN` pointing directly at a remote Anthropic-compatible service
- You don't want to store API keys on the proxy server
- You want each client to authenticate independently with the upstream service

**Important:** When using passthrough mode, make sure your remote service supports the `Authorization` header from the request and is compatible with the Anthropic API.

## Usage with Claude Code

Point Claude Code at a specific service:

```bash
export ANTHROPIC_BASE_URL=http://localhost:8088/openai
export ANTHROPIC_AUTH_TOKEN=your-token

claude
```

Or in your Claude Code settings:

```json
{
  "apiBaseUrl": "http://localhost:8088/openai"
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

Accepts [Anthropic Messages API](https://docs.anthropic.com/en/api/messages) format. Supports:

- Non-streaming and streaming (`stream: true`)
- System prompts (converted to OpenAI system messages)
- Multimodal content (text + images)
- Tool use (converted bidirectionally)
- Parameters: `model`, `max_tokens`, `temperature`, `top_p`, `stop_sequences`

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
