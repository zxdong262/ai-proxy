# AI Proxy

一个统一的 LLM API 代理服务器。同时接受 [Anthropic Messages API](https://docs.anthropic.com/en/api/messages) 和 [OpenAI Chat Completions API](https://platform.openai.com/docs/api-reference/chat) 格式的请求，路由到任何兼容 OpenAI 或 Anthropic 的服务商。自动检测上游是否原生支持 Anthropic API，无需手动配置。

[English](./README.md)

## 工作原理

```
客户端（Anthropic 或 OpenAI 格式）  ──▶  AI Proxy  ──▶  上游 LLM 服务商
(Claude Code, Claude CLI,                (本项目)          (OpenAI, DeepSeek, vLLM,
 Anthropic SDK, OpenAI SDK,                               Ollama, LiteLLM 等)
 任何兼容 OpenAI 的客户端)
```

1. 客户端使用 `UNIFIED_TOKEN` 认证（服务商 API 密钥保留在服务器上）
2. 客户端发送请求到 `/<name>/v1/messages`（Anthropic 格式）或 `/<name>/v1/chat/completions`（OpenAI 格式）
3. 首次请求时，代理探测上游的 `/v1/messages` 端点以检测是否原生支持 Anthropic
4. **如果上游支持 Anthropic**：直接代理 `/messages` 请求（无需转换）
5. **如果上游仅支持 OpenAI**：将 Anthropic → OpenAI 格式转换后转发，再将响应转回 Anthropic 格式
6. 所有 OpenAI 格式的请求（`/chat/completions`、`/models` 等）始终直接代理

检测结果缓存在 `.capability-cache.json` 中，启动时加载。

## 快速开始

```bash
# 克隆并安装
git clone https://github.com/zxdong262/ai-proxy.git && cd ai-proxy
npm install

# 配置
cp sample.env .env
# 编辑 .env 设置 UNIFIED_TOKEN
cp config.sample.js config.js
# 编辑 config.js 填入服务商 API 密钥

# 启动
npm start
```

代理默认监听 `http://0.0.0.0:8088`。

## 配置

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `HOST` | `0.0.0.0` | 服务器绑定地址 |
| `PORT` | `8088` | 服务器端口 |
| `UNIFIED_TOKEN` | **必填** | 客户端访问令牌。所有请求必须包含 `Authorization: Bearer <UNIFIED_TOKEN>`。 |

通过 `.env` 文件或环境变量设置。

### 服务配置

从模板创建 `config.js`：

```bash
cp config.sample.js config.js
```

编辑 `config.js` 定义你的服务：

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

每个服务暴露在 `/<name>/v1/*`：

| 服务 | Anthropic 端点 | OpenAI 端点 |
|---|---|---|
| `openai` | `POST /openai/v1/messages` | `POST /openai/v1/chat/completions` |
| `deepseek` | `POST /deepseek/v1/messages` | `POST /deepseek/v1/chat/completions` |

### 路由字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | 路由名称，用作 URL 前缀（如 `openai` → `/openai/v1/*`） |
| `remote_api_url` | 是 | 远程 API 的基础 URL |
| `api_key` | 是 | 远程服务商的 API 密钥 |
| `auth_type` | 否 | 认证类型：`'bearer'`（默认）或 `'api-key'`。对使用 `api-key` 头的服务商（如 Azure OpenAI）使用 `'api-key'`。 |

### 支持的服务商

支持任何兼容 OpenAI 或 Anthropic API 的服务商：

- **OpenAI**: `https://api.openai.com/v1`
- **DeepSeek**: `https://api.deepseek.com`（原生 Anthropic 支持，自动检测）
- **Azure OpenAI**: 使用 `auth_type: 'api-key'`
- **Ollama**（本地）: `http://localhost:11434/v1`
- **vLLM**（本地）: `http://localhost:8000/v1`
- **LiteLLM**: `http://localhost:4000/v1`
- **Together AI**: `https://api.together.xyz/v1`
- **Groq**: `https://api.groq.com/openai/v1`

## 配合 Claude Code 使用

```bash
export ANTHROPIC_BASE_URL=http://localhost:8088/openai
export ANTHROPIC_AUTH_TOKEN=your-unified-token

claude
```

或在 Claude Code 设置中配置：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:8088/openai",
    "ANTHROPIC_AUTH_TOKEN": "your-unified-token"
  }
}
```

## 使用 PM2 部署到生产环境

```bash
# 启动
npm run pm2:start

# 停止
npm run pm2:stop

# 重启
npm run pm2:restart

# 查看日志
npm run pm2:logs
```

日志文件位于 `logs/error.log` 和 `logs/out.log`。

## API

### `POST /<name>/v1/messages`

接受 [Anthropic Messages API](https://docs.anthropic.com/en/api/messages) 格式。自动检测上游是否原生支持 Anthropic 或需要 OpenAI 转换。支持：

- 非流式和流式（`stream: true`）
- 系统提示词（需要时转换为 OpenAI system 消息）
- 多模态内容（文本 + 图片）
- 工具调用（需要时双向转换）
- 参数：`model`、`max_tokens`、`temperature`、`top_p`、`stop_sequences`

### `POST /<name>/v1/chat/completions`

接受 [OpenAI Chat Completions API](https://platform.openai.com/docs/api-reference/chat) 格式。直接代理到上游，无需转换。

### `GET /<name>/v1/models`（及其他 `/<name>/v1/*` 端点）

直接代理到远程 API。可用于列出可用模型。

### `GET /health`

返回 `{ "status": "ok" }`。

## 测试

```bash
# 运行所有测试
npm test

# 仅单元测试（不需要远程 API）
npm run test:unit

# 集成测试（需要有效的 config.js）
npm run test:integration
```

## 许可证

MIT
