# API 调用日志拦截器

## 文件说明

| 文件 | 说明 |
|------|------|
| `api_interceptor.mjs` | fetch 拦截模块，记录所有 Anthropic API 调用细节 |
| `package/cli.js` | 原始可执行文件（未修改） |
| `run.sh` | 启动脚本，自动加载拦截器 |
| `running.log` | 日志输出文件，每次启动自动清空 |

## 使用方式

```bash
# 方式 1：使用 run.sh（推荐，自动记录日志并清空旧文件）
./run.sh "你的问题"

# 方式 2：手动加载拦截器
node --import ./api_interceptor.mjs package/cli.js "你的问题"

# 方式 3：不记录日志（原始行为）
node package/cli.js "你的问题"
```

## 日志文件位置

```
/media/sf_host/dev/claude_code_src/running.log
```

通过 `run.sh` 启动时会自动清空旧日志。手动启动时日志会追加到文件末尾。

## 日志内容

每次大模型 API 调用记录以下完整信息：

### 请求侧
- URL、HTTP 方法
- 模型名称、max_tokens、stream、temperature 等参数
- thinking 配置、tool_choice、betas、metadata
- **完整 System Prompt**（按分段展示，含缓存标记）
- **完整 Messages 数组**（逐条展示，含 role、text、tool_use、tool_result、thinking 等）
- **工具定义列表**（名称、描述）

### 响应侧（SSE 流式）
- `message_start` 事件（模型、初始 token 用量）
- `content_block_start` 事件（文本块 / thinking 块 / 工具调用块）
- `message_delta` 事件（stop_reason、output_tokens）
- 重构后的完整响应内容：
  - **TEXT RESPONSE** — 模型输出的文本
  - **THINKING** — 思考过程（如有）
  - **TOOL_USE** — 工具调用名称、ID、完整输入参数
  - **FINAL USAGE** — token 用量（input、output、cache_creation、cache_read）

### 响应侧（非流式）
- 完整 JSON 响应体，格式化展示

## 日志格式示例

```
════════════════════════════════════════════════════════════════════════════════════════════════
  API CALL #1 — 2026-04-16T06:30:00.000Z
════════════════════════════════════════════════════════════════════════════════════════════════

URL: https://api.anthropic.com/v1/messages

────────────────────────────────────────────────────────────────────────────────────────────────
  MODEL & PARAMS (call #1)
────────────────────────────────────────────────────────────────────────────────────────────────
  model:          claude-sonnet-4-6
  max_tokens:     8192
  stream:         true
  thinking:       { "type": "enabled", "budget_tokens": 10000 }
  betas:          ["prompt-caching-scope-2026-01-05", ...]

────────────────────────────────────────────────────────────────────────────────────────────────
  SYSTEM PROMPT (call #1)
────────────────────────────────────────────────────────────────────────────────────────────────
  [0] text [cache: {"type":"ephemeral","scope":"global"}]:
    x-anthropic-billing-header: claude-code-cli-v2.1.88
  [1] text [cache: {"type":"ephemeral","scope":"global"}]:
    You are Claude Code, Anthropic's official CLI for Claude.
  ...

────────────────────────────────────────────────────────────────────────────────────────────────
  MESSAGES (call #1, 1 msgs)
────────────────────────────────────────────────────────────────────────────────────────────────
  [0] role: user
      [0] text: 修复 src/utils/helper.js 第 42 行的 undefined 报错

────────────────────────────────────────────────────────────────────────────────────────────────
  SSE STREAM RESPONSE (call #1)
────────────────────────────────────────────────────────────────────────────────────────────────
  [message_start] model=claude-sonnet-4-6
    initial usage: input=15234, cache_create=2778
  [block_start] idx=0 type=thinking
    [thinking started]
  [block_start] idx=1 type=text
  [block_start] idx=2 type=tool_use
    tool: Read (id=toolu_xxx)
  [message_delta] stop_reason=tool_use
    output_tokens=89
  [message_stop]

────────────────────────────────────────────────────────────────────────────────────────────────
  RECONSTRUCTED RESPONSE (call #1)
────────────────────────────────────────────────────────────────────────────────────────────────
  model: claude-sonnet-4-6  stop_reason: tool_use

  [THINKING]:
  让我先读取文件，看看第 42 行附近的代码...

  [TEXT RESPONSE]:
  我来看看这个文件。

  [TOOL_USE #0]: Read (id=toolu_xxx)
    input: {
      "file_path": "/media/sf_host/dev/claude_code_src/src/utils/helper.js",
      "offset": 35,
      "limit": 15
    }

  [FINAL USAGE]: input=15234, output=89, cache_create=2778

  ✓ Call #1 complete 2026-04-16T06:30:05.000Z

════════════════════════════════════════════════════════════════════════════════════════════════
  API CALL #2 — 2026-04-16T06:30:06.000Z
════════════════════════════════════════════════════════════════════════════════════════════════
  ...第二轮调用（包含工具返回结果）...
```

## 工作原理

拦截器通过 Node.js `--import` 预加载，在 `globalThis.fetch` 上包装一层代理：

1. 检测所有发往 `/v1/messages` 的请求
2. 记录完整请求体（system prompt、messages、tools）
3. 拦截 SSE 流式响应，解析所有事件类型
4. 重构并记录完整的助手响应（文本、思考、工具调用）
5. 原始请求/响应完全透传，不影响正常功能

## 注意事项

- `run.sh` 启动时会清空 `running.log`；如需保留旧日志，请先手动备份
- 长文本（超过 3000 字符）会被截断，日志中标注 `[TRUNCATED]` 及原文长度
- `redacted_thinking` 类型仅记录 `[REDACTED]`，不记录内容
- 通过 `node package/cli.js` 直接运行时不加载拦截器，行为与原版完全一致
