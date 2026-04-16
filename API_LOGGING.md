# API 调用日志拦截器

## 文件说明

| 文件 | 说明 |
|------|------|
| `api_interceptor.mjs` | fetch 拦截模块，记录所有 Anthropic API 调用细节 |
| `package/cli.js` | 原始可执行文件（未修改） |
| `run.sh` | 启动脚本，自动加载拦截器 |
| `prompt_log.md` | 默认日志输出文件（当前工作目录下） |

## 使用方式

```bash
# 方式 1：使用 run.sh（推荐）
./run.sh "你的问题"                          # 日志写入 ./prompt_log.md
./run.sh --api-log /tmp/my_log.md "你的问题"  # 日志写入指定路径
API_LOG_FILE=~/logs/api.md ./run.sh "你的问题" # 通过环境变量指定

# 方式 2：手动加载拦截器
node --import ./api_interceptor.mjs package/cli.js "你的问题"
node --import ./api_interceptor.mjs --api-log /tmp/log.md package/cli.js "你的问题"
API_LOG_FILE=/tmp/log.md node --import ./api_interceptor.mjs package/cli.js "你的问题"

# 方式 3：不记录日志（原始行为）
node package/cli.js "你的问题"
```

## 日志路径配置

优先级从高到低：

| 优先级 | 方式 | 示例 |
|--------|------|------|
| 1 | `--api-log` 参数 | `./run.sh --api-log /tmp/debug.md` |
| 2 | `API_LOG_FILE` 环境变量 | `API_LOG_FILE=./log.md ./run.sh` |
| 3 | 默认值 | `./prompt_log.md`（当前工作目录） |

## 日志格式

日志为合法 Markdown 文件，API 通信以原始 JSON 代码块呈现，可直接用 Markdown 阅读器查看。

每次 API 调用包含三个部分：

1. **Request** — 完整的请求体 JSON（system prompt、messages、tools 全部原样展示）
2. **SSE Events (raw)** — 逐条原始 SSE 事件 JSON（流式响应时）
3. **Reconstructed Response** — 从 SSE 流重组的完整响应 JSON（等价于非流式 API 返回格式）

非流式调用只记录 Request 和 Response。

### 示例

````markdown
# API CALL #1

> **Time:** 2026-04-16T06:30:00.000Z
> **URL:** `https://api.anthropic.com/v1/messages`

## Request

```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 8192,
  "stream": true,
  "system": [
    {
      "type": "text",
      "text": "x-anthropic-billing-header: claude-code-cli-v2.1.88",
      "cache_control": { "type": "ephemeral", "scope": "global" }
    },
    {
      "type": "text",
      "text": "You are Claude Code, Anthropic's official CLI for Claude.",
      "cache_control": { "type": "ephemeral", "scope": "global" }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "修复 src/utils/helper.js 第 42 行的 undefined 报错"
    }
  ],
  "tools": [
    {
      "name": "Read",
      "description": "Reads the contents of a file...",
      "input_schema": { "type": "object", "properties": { "file_path": { "type": "string" } }, "required": ["file_path"] }
    }
  ]
}
```

## SSE Events (raw)

```json
{ "type": "message_start", "message": { "id": "msg_xxx", "model": "claude-sonnet-4-6", "usage": { "input_tokens": 15234 } } }
```

## Reconstructed Response

```json
{
  "id": "msg_xxx",
  "type": "message",
  "role": "assistant",
  "content": [
    { "type": "thinking", "thinking": "让我先看看这个文件..." },
    { "type": "text", "text": "我来看看这个文件。" },
    { "type": "tool_use", "id": "toolu_xxx", "name": "Read", "input": { "file_path": "...", "offset": 35, "limit": 15 } }
  ],
  "model": "claude-sonnet-4-6",
  "stop_reason": "tool_use",
  "usage": { "input_tokens": 15234, "output_tokens": 89, "cache_creation_input_tokens": 2778 }
}
```

---
````

## 注意事项

- `run.sh` 启动时会清空日志文件；如需保留旧日志，请先手动备份
- 日志文件是合法 Markdown，可用任何 Markdown 阅读器查看
- 通过 `node package/cli.js` 直接运行时不加载拦截器，行为与原版完全一致
