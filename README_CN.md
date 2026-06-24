# AI Proxy

一个轻量级代理服务器，将 [Anthropic Messages API](https://docs.anthropic.com/en/api/messages) 请求转换为 [OpenAI Chat Completions API](https://platform.openai.com/docs/api-reference/chat) 格式，使你可以在期望 Anthropic API 的工具（如 Claude Code、Anthropic SDK）中使用任何兼容 OpenAI 的 LLM 服务商。

[English](./README.md)

## 工作原理

```
Anthropic 客户端  ──▶  AI Proxy  ──▶  任何兼容 OpenAI 的 API
(Claude Code,         (本项目)          (OpenAI, DeepSeek, vLLM,
 Anthropic SDK,                        Ollama, LiteLLM 等)
 Claude CLI)
```

1. 客户端发送 Anthropic Messages API 请求（`POST /<name>/v1/messages`）
2. 代理将请求转换为 OpenAI Chat Completions 格式
3. 转发到该服务配置的远程 API
4. 将响应转换回 Anthropic 格式（包括流式 SSE 事件）

所有其他 `/<name>/v1/*` 请求（如 `GET /<name>/v1/models`）直接代理到远程 API。

## 快速开始

```bash
# 克隆并安装
git clone https://github.com/zxdong262/ai-proxy.git && cd ai-proxy
npm install

# 配置
cp config.sample.js config.js
# 编辑 config.js 填入你的服务配置

# 启动
npm start
```

代理默认监听 `http://0.0.0.0:8088`。

## 配置

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
      messages_endpoint: "/chat/completions",
      auth_type: "bearer",
      api_key: "sk-your-openai-key",
    },
    {
      name: "deepseek",
      remote_api_url: "https://api.deepseek.com/v1",
      messages_endpoint: "/chat/completions",
      auth_type: "bearer",
      api_key: "",  // 空 = 透传模式
    },
  ],
};
```

每个服务暴露在 `/<name>/v1/messages` 和 `/<name>/v1/*`：

| 服务 | 消息端点 | 模型端点 |
|---|---|---|
| `openai` | `POST /openai/v1/messages` | `GET /openai/v1/models` |
| `deepseek` | `POST /deepseek/v1/messages` | `GET /deepseek/v1/models` |

### 路由字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | 路由名称，用作 URL 前缀（如 `openai` → `/openai/v1/*`） |
| `remote_api_url` | 是 | OpenAI 兼容 API 的基础 URL |
| `messages_endpoint` | 否 | 聊天补全路径（默认：`/chat/completions`） |
| `auth_type` | 否 | 认证类型（默认：`bearer`） |
| `api_key` | 否 | API 密钥。为空或省略时运行在透传模式。 |

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `HOST` | `0.0.0.0` | 服务器绑定地址 |
| `PORT` | `8088` | 服务器端口 |
| `SECRET` | *(可选)* | JWT 签名密钥。设置后启用所有配置路由的 JWT 验证。 |
| `UNIFIED_TOKEN` | *(可选)* | 必需的访问令牌声明。JWT 载荷必须包含 `{ "token": "<UNIFIED_TOKEN>" }`。 |

通过 `.env` 文件或环境变量设置。

### 支持的服务商

支持任何兼容 OpenAI 的服务商：

- **OpenAI**: `https://api.openai.com/v1`
- **DeepSeek**: `https://api.deepseek.com/v1`
- **Ollama**（本地）: `http://localhost:11434/v1`
- **vLLM**（本地）: `http://localhost:8000/v1`
- **LiteLLM**: `http://localhost:4000/v1`
- **Together AI**: `https://api.together.xyz/v1`
- **Groq**: `https://api.groq.com/openai/v1`

## 认证模式

每个服务支持两种认证模式：

### API 密钥

在路由配置中设置 `api_key`。代理使用此密钥与远程服务认证。客户端的 `Authorization` 头会被接受但不会转发。

### 透传模式（不设置 api_key）

当 `api_key` 为空或省略时，代理运行在透传模式。客户端的 `Authorization` 头会直接转发到远程服务。

适用场景：
- 你想通过 Claude CLI 使用 `ANTHROPIC_AUTH_TOKEN` 直接连接到远程兼容 Anthropic 的服务
- 你不想在代理服务器上存储 API 密钥
- 你希望每个客户端独立与上游服务认证

**重要提示：** 使用透传模式时，请确保你的远程服务支持请求中的 `Authorization` 头，并且与 Anthropic API 兼容。

### 公共部署安全（JWT）

当部署到公共服务器时，设置 `SECRET` 和 `UNIFIED_TOKEN` 环境变量，要求所有配置路由使用 JWT 认证。这可以防止对代理的未授权访问。

**工作原理：**

1. 在 `.env` 中设置 `SECRET`（JWT 签名密钥）和 `UNIFIED_TOKEN`（必需的访问令牌）
2. 客户端必须在 `Authorization: Bearer <jwt>` 头中发送 JWT
3. JWT 必须使用 `SECRET` 签名，并在载荷中包含 `{ "token": "<UNIFIED_TOKEN>" }`
4. 无效、过期或缺少 JWT 的请求将被拒绝，返回 `401`

**客户端示例（生成 JWT）：**

```js
import jwt from "jsonwebtoken";

const token = jwt.sign(
  { token: process.env.UNIFIED_TOKEN },
  process.env.SECRET,
  { expiresIn: "30d" }
);
// 在 Authorization: Bearer <token> 中使用 token
```

**Claude Code 示例：**

```bash
# 为 Claude Code 生成长期有效的 JWT
export ANTHROPIC_AUTH_TOKEN=$(node -e "
  const jwt = require('jsonwebtoken');
  console.log(jwt.sign({token: process.env.UNIFIED_TOKEN}, process.env.SECRET, {expiresIn: '365d'}));
")
export ANTHROPIC_BASE_URL=http://your-server:8088/openai

claude
```

当 `SECRET` 或 `UNIFIED_TOKEN` 未设置时，JWT 验证将被跳过，代理行为与之前相同（接受任何 Bearer 令牌）。

## 配合 Claude Code 使用

将 Claude Code 指向特定服务：

```bash
export ANTHROPIC_BASE_URL=http://localhost:8088/openai
export ANTHROPIC_AUTH_TOKEN=your-token

claude
```

或在 Claude Code 设置中配置：

```json
{
  "apiBaseUrl": "http://localhost:8088/openai"
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

接受 [Anthropic Messages API](https://docs.anthropic.com/en/api/messages) 格式。支持：

- 非流式和流式（`stream: true`）
- 系统提示词（转换为 OpenAI system 消息）
- 多模态内容（文本 + 图片）
- 工具调用（双向转换）
- 参数：`model`、`max_tokens`、`temperature`、`top_p`、`stop_sequences`

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
