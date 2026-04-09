# Claude Code (claudecode) 源代码结构全景图

> 生成时间: 2026-04-09
> 分析范围: 完整源代码逆向工程分析

---

## 步骤 1：包管理与脚本剖析

### package.json 关键依赖（第1-82行）

**LLM/AI SDK 依赖：**
```json
{
  "@anthropic-ai/sdk": "^0.32.1",                    // 第16行 - Anthropic官方SDK
  "@anthropic-ai/claude-agent-sdk": "latest",         // 第17行 - Anthropic Agent SDK
  "@modelcontextprotocol/sdk": "^1.0.4"              // 第20行 - MCP协议SDK
}
```

**CLI框架依赖：**
```json
{
  "@commander-js/extra-typings": "^12.1.0",          // 第18行 - Commander.js
  "react": "^18.3.1",                                 // 第53行 - UI渲染（Ink框架）
  "ink": (隐式依赖, 使用React渲染CLI)
}
```

**脚本入口映射：**
```json
{
  "build": "bun build src/main.tsx --outfile dist/cli.js",  // → src/main.tsx
  "dev": "bun run src/main.tsx",                           // → src/main.tsx
  "start": "node package/cli.js",                          // → dist/cli.js
  "bin": { "claude-dev": "./dist/cli.js" }                 // 第6-7行
}
```

---

## 步骤 2：入口点梳理

### 主CLI入口：`src/main.tsx`

**CLI框架识别：** `Commander.js` (第22行)
```typescript
import { Command as CommanderCommand, InvalidArgumentError, Option } from '@commander-js/extra-typings';
```

**核心入口函数：** `run()` (第884行)
```typescript
async function run(): Promise<CommanderCommand> {
  const program = new CommanderCommand()
    .configureHelp(createSortedHelpConfig())
    .enablePositionalOptions();

  // 主命令定义 (第968行)
  program.name('claude')
    .description(`Claude Code - starts an interactive session...`)
    .argument('[prompt]', 'Your prompt', String)
    // ... 大量选项定义
}
```

**关键子命令结构：**
```typescript
// MCP 命令组 (第3894行)
const mcp = program.command('mcp').description('Configure and manage MCP servers');
mcp.command('serve')     // 启动MCP服务器
mcp.command('add')       // 添加MCP服务器
mcp.command('list')      // 列出MCP服务器

// 认证命令组 (第4100行)
const auth = program.command('auth').description('Manage authentication');
auth.command('login')    // 登录
auth.command('logout')   // 登出

// Plugin 命令组 (第4148行)
const pluginCmd = program.command('plugin').description('Manage Claude Code plugins');
```

**Agent/Ask/Chat 模式定义位置：**

在 `src/commands.ts` 中注册（第258-300行）：
```typescript
const COMMANDS = memoize((): Command[] => [
  agents,        // Agent 命令
  advisor,       // Advisor 模式
  btw,           // btw 命令
  plan,          // Plan 模式
  fast,          // Fast 模式
  // ... 更多命令
])
```

---

## 步骤 3：依赖倒推法 - API 网关层

### 核心 API 调用位置

**1. API 客户端创建：** `src/services/api/client.ts`

```typescript
// 第88-150行 - getAnthropicClient() 函数
export async function getAnthropicClient({
  apiKey,
  maxRetries,
  model,
  fetchOverride,
  source,
}): Promise<Anthropic> {
  // ...

  // 标准 Anthropic API (第315行)
  return new Anthropic(clientConfig)

  // AWS Bedrock (第189行)
  return new AnthropicBedrock(bedrockArgs) as unknown as Anthropic

  // Azure Foundry (第219行)
  return new AnthropicFoundry(foundryArgs) as unknown as Anthropic

  // GCP Vertex (第297行)
  return new AnthropicVertex(vertexArgs) as unknown as Anthropic
}
```

**2. API 调用执行：** `src/services/api/claude.ts`

**非流式 API 调用（verifyApiKey 函数，第555行）：**
```typescript
await anthropic.beta.messages.create({
  model,
  max_tokens: 1,
  messages,
  temperature: 1,
  ...(betas.length > 0 && { betas }),
  metadata: getAPIMetadata(),
  ...getExtraBodyParams(),
})
```

**流式 API 调用（queryModel 函数，第1822-1836行）：**
```typescript
const result = await anthropic.beta.messages
  .create(
    { ...params, stream: true },
    {
      signal,
      ...(clientRequestId && {
        headers: { [CLIENT_REQUEST_ID_HEADER]: clientRequestId },
      }),
    },
  )
  .withResponse()
```

**3. 查询引擎：** `src/query.ts`

```typescript
// 第114-149行 - yieldMissingToolResultBlocks() 等辅助函数
// 处理工具执行和消息规范化
```

**4. QueryEngine：** `src/QueryEngine.ts`

```typescript
// 第130-150行 - QueryEngineConfig 类型定义
export type QueryEngineConfig = {
  cwd: string
  tools: Tools
  commands: Command[]
  mcpClients: MCPServerConnection[]
  agents: AgentDefinition[]
  canUseTool: CanUseToolFn
  getAppState: () => AppState
  setAppState: (f: (prev: AppState) => AppState) => void
  // ...
}
```

**5. Agent Tool：** `src/tools/AgentTool/AgentTool.tsx`

```typescript
// 第82-125行 - Agent 输入 schema 定义
const baseInputSchema = lazySchema(() => z.object({
  description: z.string(),
  prompt: z.string(),
  subagent_type: z.string().optional(),
  model: z.enum(['sonnet', 'opus', 'haiku']).optional(),
  run_in_background: z.boolean().optional(),
  // ...
}))
```

---

## 步骤 4：代码结构全景图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              入口层 (Entry Layer)                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  src/main.tsx (第884行: run函数)                                            │
│  ├── 使用 Commander.js (@commander-js/extra-typings 第22行)                  │
│  ├── React + Ink 渲染 CLI UI (第28行)                                        │
│  └── 子命令注册:                                                             │
│      ├── mcp (第3894行) - MCP 服务器管理                                      │
│      ├── auth (第4100行) - 认证管理                                          │
│      ├── plugin (第4148行) - 插件管理                                        │
│      ├── agents (第4278行) - Agent 列表                                       │
│      ├── auto-mode (第4289行) - 自动模式                                     │
│      └── ... 更多子命令                                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                           业务逻辑层 (Business Layer)                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  命令系统 (Commands System) - src/commands.ts                       │   │
│  │  src/commands.ts (第258行: COMMANDS 数组)                             │   │
│  │  ├── agents - Agent 管理                                              │   │
│  │  ├── plan - 计划模式                                                   │   │
│  │  ├── fast - 快速模式                                                   │   │
│  │  ├── btw - btw 命令                                                    │   │
│  │  └── ... 60+ 内置命令                                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  查询引擎 (Query Engine) - src/query.ts + src/QueryEngine.ts         │   │
│  │  src/query.ts + src/QueryEngine.ts                                   │   │
│  │  ├── query() - 主查询入口                                             │   │
│  │  ├── normalizeMessagesForAPI() - 消息规范化                            │   │
│  │  └── 处理工具执行和消息流                                              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Tool 执行系统 (Tool Orchestration) - src/services/tools/            │   │
│  │  src/services/tools/toolOrchestration.ts                            │   │
│  │  ├── runTools() - 运行工具                                            │   │
│  │  ├── partitionToolCalls() - 分区工具调用                              │   │
│  │  ├── runToolsConcurrently() - 并发执行                                │   │
│  │  └── runToolsSerially() - 串行执行                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Agent 系统 (Agent System) - src/tools/AgentTool/                   │   │
│  │  src/tools/AgentTool/AgentTool.tsx                                  │   │
│  │  ├── inputSchema - Agent 输入定义 (第82行)                             │   │
│  │  ├── call() - Agent 调用逻辑                                          │   │
│  │  ├── runAgent() - 运行 Agent                                          │   │
│  │  └── 支持多 Agent 协作                                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                         基础设施层 (Infrastructure Layer)                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  API 客户端层 (API Client) - src/services/api/                       │   │
│  │  src/services/api/                                                   │   │
│  │  ├── client.ts (第88行: getAnthropicClient)                          │   │
│  │  │   ├── new Anthropic() - 标准 API (第315行)                         │   │
│  │  │   ├── new AnthropicBedrock() - AWS (第189行)                       │   │
│  │  │   ├── new AnthropicFoundry() - Azure (第219行)                     │   │
│  │  │   └── new AnthropicVertex() - GCP (第297行)                        │   │
│  │  │                                                                    │   │
│  │  └── claude.ts (核心 API 调用)                                        │   │
│  │      ├── verifyApiKey() - 密钥验证 (第555行)                           │   │
│  │      ├── queryModel() - 流式查询 (第1017行)                            │   │
│  │      │   └── anthropic.beta.messages.create() (第1822行)              │   │
│  │      └── executeNonStreamingRequest() - 非流式 (第864行)               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  消息处理层 (Message Layer) - src/utils/messages.ts                  │   │
│  │  src/utils/messages.ts + src/types/message.ts                        │   │
│  │  ├── createUserMessage() - 创建用户消息                                │   │
│  │  ├── createAssistantMessage() - 创建助手消息                           │   │
│  │  ├── normalizeMessagesForAPI() - 规范化消息                            │   │
│  │  └── stripAdvisorBlocks() - 移除 Advisor 块                            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Tool 定义 (Tool Definitions) - src/Tool.ts + src/tools/*.tsx        │   │
│  │  src/Tool.ts + src/tools/*.tsx                                        │   │
│  │  ├── BashTool - Bash 命令执行                                         │   │
│  │  ├── FileReadTool - 文件读取                                          │   │
│  │  ├── FileEditTool - 文件编辑                                          │   │
│  │  ├── FileWriteTool - 文件写入                                         │   │
│  │  ├── AgentTool - Agent 子任务                                         │   │
│  │  └── ... 20+ 内置工具                                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  MCP 集成 (MCP Integration) - src/services/mcp/                      │   │
│  │  src/services/mcp/                                                    │   │
│  │  ├── client.ts - MCP 客户端                                           │   │
│  │  ├── config.ts - MCP 配置解析                                          │   │
│  │  └── types.ts - MCP 类型定义                                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 关键通信协议流程

### LLM 请求流程：
```
用户输入 (stdin)
  ↓
main.tsx (run函数)
  ↓
QueryEngine.ts (query函数)
  ↓
query.ts (queryModel函数)
  ↓
services/api/claude.ts
  ↓
services/api/client.ts (getAnthropicClient)
  ↓
@anthropic-ai/sdk
  ↓
anthropic.beta.messages.create() (流式)
  ↓
API 响应流
  ↓
Tool 执行
  ↓
结果返回
```

### Tool 调用流程：
```
API 返回 tool_use 块
  ↓
services/tools/toolOrchestration.ts (runTools)
  ↓
services/tools/toolExecution.ts (runToolUse)
  ↓
具体 Tool 实现 (src/tools/*/)
  ↓
Tool 结果
  ↓
构建 tool_result 消息
  ↓
发送回 API
```

---

## 核心文件索引

| 功能模块 | 文件路径 | 关键行号/函数 |
|---------|---------|-------------|
| CLI入口 | `src/main.tsx` | 第884行: `run()` |
| 命令注册 | `src/commands.ts` | 第258行: `COMMANDS` |
| API客户端 | `src/services/api/client.ts` | 第88行: `getAnthropicClient()` |
| API调用 | `src/services/api/claude.ts` | 第1822行: `messages.create()` |
| 查询引擎 | `src/query.ts` | - |
| QueryEngine | `src/QueryEngine.ts` | 第130行: `QueryEngineConfig` |
| Agent Tool | `src/tools/AgentTool/AgentTool.tsx` | 第82行: `inputSchema` |
| Tool编排 | `src/services/tools/toolOrchestration.ts` | 第19行: `runTools()` |

---

## 依赖架构图

```
@anthropic-ai/sdk (v0.32.1)
         ↓
    ┌────────────────────────────────┐
    │  services/api/claude.ts         │
    │  - queryModel()                │
    │  - executeNonStreamingRequest()│
    └────────────────────────────────┘
         ↓
    ┌────────────────────────────────┐
    │  query.ts                      │
    │  - query() 主循环               │
    └────────────────────────────────┘
         ↓
    ┌────────────────────────────────┐
    │  QueryEngine.ts                │
    │  - 状态管理                     │
    │  - 消息历史                     │
    └────────────────────────────────┘
         ↓
    ┌────────────────────────────────┐
    │  main.tsx (REPL.tsx)           │
    │  - 用户交互                     │
    │  - UI 渲染                      │
    └────────────────────────────────┘
```

---

*本文档通过源代码静态分析生成，包含所有核心模块的调用链路和行号引用。*
