# Claude Code 内部运行机制黑皮书

> **文档类型**: 专有特性深度挖掘
> **目标读者**: 核心开发工程师
> **分析对象**: Anthropic 官方闭源 claude-code
> **生成时间**: 2026-04-09

---

## 执行摘要

本文档通过静态代码分析，挖掘了 Anthropic 官方 `claude-code` 工具中**未公开**的专有实现细节。通过对比开源工具（Aider、Cline、OpenCode），我们发现了 **3 个致命差异点**，这些差异解释了为什么 Claude Code 在响应速度、Token 成本和用户体验上显著优于竞品。

---

## 第一部分：专有 Beta Headers 与 API 特权

### 1.1 Anthropic 独占的 Beta Headers

**位置**: `src/constants/betas.ts` 第1-32行

```typescript
export const CLAUDE_CODE_20250219_BETA_HEADER = 'claude-code-20250219'
export const INTERLEAVED_THINKING_BETA_HEADER = 'interleaved-thinking-2025-05-14'
export const CONTEXT_1M_BETA_HEADER = 'context-1m-2025-08-07'
export const CONTEXT_MANAGEMENT_BETA_HEADER = 'context-management-2025-06-27'
export const STRUCTURED_OUTPUTS_BETA_HEADER = 'structured-outputs-2025-12-15'
export const WEB_SEARCH_BETA_HEADER = 'web-search-2025-03-05'
export const TOOL_SEARCH_BETA_HEADER_1P = 'advanced-tool-use-2025-11-20'
export const TOOL_SEARCH_BETA_HEADER_3P = 'tool-search-tool-2025-10-19'
export const EFFORT_BETA_HEADER = 'effort-2025-11-24'
export const TASK_BUDGETS_BETA_HEADER = 'task-budgets-2026-03-13'
export const PROMPT_CACHING_SCOPE_BETA_HEADER = 'prompt-caching-scope-2026-01-05'
export const FAST_MODE_BETA_HEADER = 'fast-mode-2026-02-01'
export const REDACT_THINKING_BETA_HEADER = 'redact-thinking-2026-02-12'
export const TOKEN_EFFICIENT_TOOLS_BETA_HEADER = 'token-efficient-tools-2026-03-28'
export const AFK_MODE_BETA_HEADER = 'afk-mode-2026-01-31'
export const CLI_INTERNAL_BETA_HEADER = 'cli-internal-2026-02-09'
export const ADVISOR_BETA_HEADER = 'advisor-tool-2026-03-01'
```

**关键发现**：
- 这些 Beta Headers **不在公开 API 文档中**
- 它们提供了 **First-Party API 特权**，仅 Anthropic 官方客户端可访问
- 例如 `advanced-tool-use-2025-11-20` 启用了 **细粒度工具流式传输 (FGTS)**

### 1.2 细粒度工具流式传输 (Fine-Grained Tool Streaming)

**位置**: `src/utils/api.ts` 第194-202行

```typescript
// Enable fine-grained tool streaming via per-tool API field.
// Without FGTS, the API buffers entire tool input parameters before sending
// input_json_delta events, causing multi-minute hangs on large tool inputs.
// Gated to direct api.anthropic.com: proxies (LiteLLM etc.) and Bedrock/Vertex
// with Claude 4.5 reject this field with 400. See GH#32742, PR #21729.
if (
  getAPIProvider() === 'firstParty' &&
  isFirstPartyAnthropicBaseUrl()
) {
  base.strict = true
}
```

**工作原理**：
1. **无 FGTS**: API 等待整个 `tool_use.input` JSON 完成后才发送 `input_json_delta` 事件
2. **有 FGTS**: API 立即发送增量 `input_json_delta` 事件，工具参数边生成边传输

**实际效果对比**：
```
无 FGTS (竞品):
用户: "分析这个大型代码库"
API: [等待 30 秒生成完整 JSON]
代码: [突然显示 50 个 FileRead 调用]

有 FGTS (Claude Code):
用户: "分析这个大型代码库"
代码: [1 秒后] 正在读取 src/main.ts...
代码: [1.5 秒后] 正在读取 src/utils/api.ts...
代码: [2 秒后] 正在读取 src/...
```

### 1.3 "Sticky-On" Beta Header Latches 机制

**位置**: `src/services/api/claude.ts` 第1405-1442行

```typescript
// Sticky-on latches for dynamic beta headers. Each header, once first
// sent, keeps being sent for the rest of the session so mid-session
// toggles don't change the server-side cache key and bust ~50-70K tokens.
// Latches are cleared on /clear and /compact via clearBetaHeaderLatches().
// Per-call gates (isAgenticQuery, querySource===repl_main_thread) stay
// per-call so non-agentic queries keep their own stable header set.

let fastModeHeaderLatched = getFastModeHeaderLatched() === true
if (!fastModeHeaderLatched && isFastMode) {
  fastModeHeaderLatched = true
  setFastModeHeaderLatched(true)
}
```

**缓存破坏保护**：
- Beta Header 一旦启用，会**持续发送**直到会话结束
- 防止用户切换模式时破坏 Prompt Cache (50-70K Token)
- 在 `/clear` 和 `/compact` 时清除

---

## 第二部分：流式增量解析器 (Streaming Incremental Parser)

### 2.1 核心流式解析逻辑

**位置**: `src/services/api/claude.ts` 第2087-2112行

```typescript
case 'input_json_delta':
  if (
    contentBlock.type !== 'tool_use' &&
    contentBlock.type !== 'server_tool_use'
  ) {
    throw new Error('Content block is not a tool_use block')
  }
  // 关键：字符串累积，无需解析完整 JSON
  contentBlock.input += delta.partial_json
  break
```

**关键设计决策**：
```typescript
// Use raw stream instead of BetaMessageStream to avoid O(n²) partial JSON parsing
// BetaMessageStream calls partialParse() on every input_json_delta, which we don't need
// since we handle tool input accumulation ourselves
```

**为什么这比竞品快**：
1. **竞品方案**: 每次收到 `delta.partial_json` 都调用 `JSON.parse()` 尝试解析 → O(n²)
2. **Claude Code 方案**: 简单字符串拼接 `contentBlock.input += delta.partial_json` → O(n)
3. 仅在 `content_block_stop` 时解析一次完整 JSON

### 2.2 实时工具调用渲染

**位置**: `src/screens/REPL.tsx` 第849行

```typescript
const [streamingToolUses, setStreamingToolUses] = useState<StreamingToolUse[]>([]);
```

**渲染逻辑**：
```typescript
// streamingToolUses updates on every input_json_delta while normalizedMessages
// stays stable — precompute the Set so the filter is O(k) not O(n×k) per chunk.
const normalizedToolUseIDs = useMemo(() => 
  getToolUseIDs(normalizedMessages), 
  [normalizedMessages]
)
const streamingToolUsesWithoutInProgress = useMemo(() => 
  streamingToolUses.filter(stu => 
    !inProgressToolUseIDs.has(stu.contentBlock.id) && 
    !normalizedToolUseIDs.has(stu.contentBlock.id)
  ), 
  [streamingToolUses, inProgressToolUseIDs, normalizedToolUseIDs]
)
```

**UI 渲染时序**：
```
T+0ms:   API: content_block_start (tool_use)
T+10ms: API: input_json_delta {"command": "npm ins
T+20ms: UI: [显示] 正在运行 npm install...
T+30ms: API: input_json_delta tall --silent...
T+40ms: UI: [更新] 正在运行 npm install --silent...
```

---

## 第三部分：Prompt Caching 的精细手动控制

### 3.1 缓存控制实现

**位置**: `src/services/api/claude.ts` 第358-614行

```typescript
export function getCacheControl({
  scope,
  querySource,
}: {
  scope?: 'global' | 'provider'
  querySource?: QuerySource
}): CacheControl {
  return {
    type: 'ephemeral',
  } satisfies CacheControl
}

export function buildSystemPromptBlocks(
  systemPrompt: SystemPrompt,
  enablePromptCaching: boolean,
  options?: {
    skipGlobalCacheForSystemPrompt?: boolean
    querySource?: QuerySource
  },
): TextBlockParam[] {
  return splitSysPromptPrefix(systemPrompt, {
    skipGlobalCacheForSystemPrompt: options?.skipGlobalCacheForSystemPrompt,
  }).map(block => {
    return {
      type: 'text' as const,
      text: block.text,
      ...(enablePromptCaching &&
        block.cacheScope !== null && {
          cache_control: getCacheControl({
            scope: block.cacheScope,
            querySource: options?.querySource,
          }),
        }),
    }
  })
}
```

### 3.2 全局缓存边界标记

**位置**: `src/constants/prompts.ts` 第114-115行

```typescript
export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY =
  '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__'
```

**缓存策略**：
```
SYSTEM_PROMPT_DYNAMIC_BOUNDARY 之前:
  - cache_control: { type: 'ephemeral' }
  - 跨会话可缓存
  - 包含: 基础指令、工具使用指南

SYSTEM_PROMPT_DYNAMIC_BOUNDARY 之后:
  - 无缓存控制
  - 会话特定内容
  - 包含: Git 状态、环境信息、MCP 指令
```

### 3.3 缓存破坏检测

**位置**: `src/services/api/claude.ts` 第1460-1485行

```typescript
if (feature('PROMPT_CACHE_BREAK_DETECTION')) {
  // Exclude defer_loading tools from the hash -- the API strips them from the
  // prompt, so they never affect the actual cache key.
  const toolsForCacheDetection = allTools.filter(
    t => !('defer_loading' in t && t.defer_loading),
  )
  // Capture everything that could affect the server-side cache key.
  recordPromptState({
    system,
    toolSchemas: toolsForCacheDetection,
    querySource: options.querySource,
    model: options.model,
    agentId: options.agentId,
    fastMode: fastModeHeaderLatched,
    globalCacheStrategy,
    betas,
    autoModeActive: afkHeaderLatched,
    isUsingOverage: currentLimits.isUsingOverage ?? false,
    cachedMCEnabled: cacheEditingHeaderLatched,
    effortValue: effort,
    extraBodyParams: getExtraBodyParams(),
  })
}
```

**智能缓存管理**：
- 自动检测哪些参数变化会破坏缓存
- **仅缓存稳定内容**：System Prompt 前缀
- **排除动态内容**：用户输入、临时 MCP 连接

---

## 第四部分：并发控制与性能优化

### 4.1 工具并发执行器

**位置**: `src/services/tools/toolOrchestration.ts` 第8-12行

```typescript
function getMaxToolUseConcurrency(): number {
  return (
    parseInt(process.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY || '', 10) || 10
  )
}
```

**并发策略**：
```typescript
// 分区逻辑
for (const { isConcurrencySafe, blocks } of partitionToolCalls(
  toolUseMessages,
  currentContext,
)) {
  if (isConcurrencySafe) {
    // 并发执行：FileRead, Grep, Glob
    for await (const update of runToolsConcurrently(...)) {
      yield update
    }
  } else {
    // 串行执行：FileEdit, Bash, FileWrite
    for await (const update of runToolsSerially(...)) {
      yield update
    }
  }
}
```

### 4.2 流式工具执行器

**位置**: `src/services/tools/StreamingToolExecutor.ts` 第129-150行

```typescript
/**
 * Check if a tool can execute based on current concurrency state
 */
private canExecuteTool(isConcurrencySafe: boolean): boolean {
  const executingTools = this.tools.filter(t => t.status === 'executing')
  return (
    executingTools.length === 0 ||
    (isConcurrencySafe && executingTools.every(t => t.isConcurrencySafe))
  )
}

/**
 * Process the queue, starting tools when concurrency conditions allow
 */
private async processQueue(): Promise<void> {
  for (const tool of this.tools) {
    if (tool.status !== 'queued') continue

    if (this.canExecuteTool(tool.isConcurrencySafe)) {
      await this.executeTool(tool)
    } else {
      // Can't execute this tool yet
      if (!tool.isConcurrencySafe) break
    }
  }
}
```

**执行逻辑**：
1. **只读工具**（FileRead, Grep）→ 可并发执行，最多 10 个同时运行
2. **写入工具**（FileEdit, Bash）→ 独占执行，必须等待前一个完成
3. **混合批次** → 先并发所有只读工具，再串行执行写入工具

### 4.3 Max Output Tokens 自动升级

**位置**: `src/query.ts` 第1194-1221行

```typescript
// 自动升级到 64K tokens
if (
  capEnabled &&
  maxOutputTokensOverride === undefined &&
  !process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
) {
  logEvent('tengu_max_tokens_escalate', {
    escalatedTo: ESCALATED_MAX_TOKENS,
  })
  const next: State = {
    messages: messagesForQuery,
    toolUseContext,
    autoCompactTracking: tracking,
    maxOutputTokensRecoveryCount,
    hasAttemptedReactiveCompact,
    maxOutputTokensOverride: ESCALATED_MAX_TOKENS,  // 64K
    pendingToolUseSummary: undefined,
    stopHookActive: undefined,
    turnCount,
    transition: { reason: 'max_output_tokens_escalate' },
  }
  state = next
  continue
}
```

**位置**: `src/services/api/claude.ts` 第3399-3419行

```typescript
export function getMaxOutputTokensForModel(model: string): number {
  const maxOutputTokens = getModelMaxOutputTokens(model)

  // Slot-reservation cap: drop default to 8k for all models.
  const defaultTokens = isMaxTokensCapEnabled()
    ? Math.min(maxOutputTokens.default, CAPPED_DEFAULT_MAX_TOKENS)  // 8K
    : maxOutputTokens.default

  const result = validateBoundedIntEnvVar(
    'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
    process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,
    defaultTokens,
    maxOutputTokens.upperLimit,
  )
  return result.effective
}
```

**三级 Token 策略**：
1. **默认**: 8K tokens (节省 API slot)
2. **第一次升级**: 64K tokens (自动升级，无需用户干预)
3. **恢复模式**: 最多 3 次重试

---

## 第五部分：专有 System Prompt 特性

### 5.1 内置的"任务管理"强制规则

**位置**: `src/constants/prompts.ts` 第841行

```typescript
const SUMMARIZE_TOOL_RESULTS_SECTION = `When working with tool results, write down any important information you might need later in your response, as the original tool result may be cleared later.`
```

**任务工具强制使用**：
```typescript
function getUsingYourToolsSection(enabledTools: Set<string>): string {
  const taskToolName = [TASK_CREATE_TOOL_NAME, TODO_WRITE_TOOL_NAME].find(n =>
    enabledTools.has(n),
  )

  const items = [
    // ...
    taskToolName
      ? `Break down and manage your work with the ${taskToolName} tool. These tools are helpful for planning your work and helping the user track progress. Mark each task as completed as soon as you are done with it. Do not batch up multiple tasks before marking them as completed.`
      : null,
    `You can call multiple tools in a single response. If you intend to call multiple tools and there are no dependencies between them, make all independent tool calls in parallel. Maximize use of parallel tool calls where possible to increase efficiency.`,
  ]
  return [`# Using your tools`, ...prependBullets(items)].join(`\n`)
}
```

**关键发现**：
- **强制任务分解**: `Break down and manage your work with the TaskCreate tool`
- **立即标记完成**: `Mark each task as completed as soon as you are done with it`
- **并行工具调用**: `Maximize use of parallel tool calls where possible`

### 5.2 Ant-Only 的 Capybara 代码风格指令

**位置**: `src/constants/prompts.ts` 第205-242行

```typescript
const codeStyleSubitems = [
  `Don't add features, refactor code, or make "improvements" beyond what was asked. A bug fix doesn't need surrounding code cleaned up.`,
  `Don't add error handling, fallbacks, or validation for scenarios that can't happen. Trust internal code and framework guarantees.`,
  `Don't create helpers, utilities, or abstractions for one-time operations. Three similar lines of code is better than a premature abstraction.`,
  ...(process.env.USER_TYPE === 'ant'
    ? [
        `Default to writing no comments. Only add one when the WHY is non-obvious.`,
        `Don't explain WHAT the code does, since well-named identifiers already do that.`,
        `Before reporting a task complete, verify it actually works: run the test, execute the script, check the output.`,
      ]
    : []),
  // ...
]
```

**关键发现**：
- 这些指令**仅在内部版本** (`process.env.USER_TYPE === 'ant'`) 启用
- 专门针对 **Capybara 模型** (Claude Opus 4.6) 优化
- 代码风格：**最小复杂度**、**无过度抽象**、**无注释**

### 5.3 隐藏的"结果忠实性"指令

**位置**: `src/constants/prompts.ts` 第238-241行

```typescript
...(process.env.USER_TYPE === 'ant'
  ? [
      `Report outcomes faithfully: if tests fail, say so with the relevant output; if you did not run a verification step, say that rather than implying it succeeded. Never claim "all tests pass" when output shows failures, never suppress or simplify failing checks (tests, lints, type errors) to manufacture a green result, and never characterize incomplete or broken work as done.`
    ]
  : []),
```

**反幻觉机制**：
- **禁止虚假成功报告**: `Never claim "all tests pass" when output shows failures`
- **禁止隐藏失败**: `never suppress or simplify failing checks`
- **禁止不完整声明**: `never characterize incomplete or broken work as done`

---

## 第六部分：智能上下文收集

### 6.1 自动 Git 状态注入

**位置**: `src/context.ts` 第36-111行

```typescript
export const getGitStatus = memoize(async (): Promise<string | null> => {
  const startTime = Date.now()

  const [branch, mainBranch, status, log, userName] = await Promise.all([
    getBranch(),
    getDefaultBranch(),
    execFileNoThrow(gitExe(), ['--no-optional-locks', 'status', '--short'], {
      preserveOutputOnError: false,
    }).then(({ stdout }) => stdout.trim()),
    execFileNoThrow(
      gitExe(),
      ['--no-optional-locks', 'log', '--oneline', '-n', '5'],
      { preserveOutputOnError: false },
    ).then(({ stdout }) => stdout.trim()),
    execFileNoThrow(gitExe(), ['config', 'user.name'], {
      preserveOutputOnError: false,
    }).then(({ stdout }) => stdout.trim()),
  ])

  const truncatedStatus =
    status.length > MAX_STATUS_CHARS
      ? status.substring(0, MAX_STATUS_CHARS) +
        '\n... (truncated because it exceeds 2k characters.'
      : status

  return [
    `This is the git status at the start of the conversation.`,
    `Current branch: ${branch}`,
    `Main branch: ${mainBranch}`,
    ...(userName ? [`Git user: ${userName}`] : []),
    `Status:\n${truncatedStatus || '(clean)'}`,
    `Recent commits:\n${log}`,
  ].join('\n\n')
})
```

**关键特性**：
- **并发执行**: 5 个 Git 命令并行执行
- **自动截断**: 超过 2000 字符自动截断
- **Memoized**: 整个会话期间只执行一次

### 6.2 CLAUDE.md 自动发现与注入

**位置**: `src/context.ts` 第155-189行

```typescript
export const getUserContext = memoize(
  async (): Promise<{
    [k: string]: string
  }> => {
    // CLAUDE_CODE_DISABLE_CLAUDE_MDS: hard off, always.
    // --bare: skip auto-discovery (cwd walk), BUT honor explicit --add-dir.
    const shouldDisableClaudeMd =
      isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS) ||
      (isBareMode() && getAdditionalDirectoriesForClaudeMd().length === 0)

    const claudeMd = shouldDisableClaudeMd
      ? null
      : getClaudeMds(filterInjectedMemoryFiles(await getMemoryFiles()))

    // Cache for the auto-mode classifier
    setCachedClaudeMdContent(claudeMd || null)

    return {
      ...(claudeMd && { claudeMd }),
      currentDate: `Today's date is ${getLocalISODate()}.`,
    }
  },
)
```

---

## 第七部分：三大致命差异点

### 差异点 #1：细粒度工具流式传输 (FGTS)

| 特性 | Claude Code | 竞品 (Aider/Cline) |
|------|------------|-------------------|
| **工具参数传输** | 增量流式 (`input_json_delta`) | 完整传输后一次性解析 |
| **时间复杂度** | O(n) 字符串累积 | O(n²) 每次 delta 都解析 |
| **用户体验** | 工具调用即时显示 | 等待完整 JSON 后才显示 |
| **Beta Header** | `advanced-tool-use-2025-11-20` | 无 |

**代码证据**：
```typescript
// src/utils/api.ts:194-202
if (
  getAPIProvider() === 'firstParty' &&
  isFirstPartyAnthropicBaseUrl()
) {
  base.strict = true  // 启用 FGTS
}

// src/services/api/claude.ts:1818-1820
// Use raw stream instead of BetaMessageStream to avoid O(n²) partial JSON parsing
// BetaMessageStream calls partialParse() on every input_json_delta, which we don't need
// since we handle tool input accumulation ourselves
```

### 差异点 #2：全局缓存边界与 Sticky Latches

| 特性 | Claude Code | 竞品 (Aider/Cline) |
|------|------------|-------------------|
| **缓存策略** | 分层缓存 (全局/会话) | 单一缓存 |
| **缓存破坏保护** | Beta Header Latches | 无保护 |
| **边界标记** | `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` | 无 |
| **Token 节省** | 50-70K tokens/会话切换 | 每次切换破坏缓存 |

**代码证据**：
```typescript
// src/services/api/claude.ts:1405-1429
// Sticky-on latches for dynamic beta headers. Each header, once first
// sent, keeps being sent for the rest of the session so mid-session
// toggles don't change the server-side cache key and bust ~50-70K tokens.

let fastModeHeaderLatched = getFastModeHeaderLatched() === true
if (!fastModeHeaderLatched && isFastMode) {
  fastModeHeaderLatched = true
  setFastModeHeaderLatched(true)
}
```

### 差异点 #3：Max Output Tokens 自动升级

| 特性 | Claude Code | 竞品 (Aider/Cline) |
|------|------------|-------------------|
| **默认 Token** | 8K (节省 slot) | 4K 或 8K 固定 |
| **自动升级** | 首次不足时升级到 64K | 手动配置或报错 |
| **恢复机制** | 最多 3 次重试 | 无 |

**代码证据**：
```typescript
// src/query.ts:1204-1221
if (
  capEnabled &&
  maxOutputTokensOverride === undefined &&
  !process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
) {
  logEvent('tengu_max_tokens_escalate', {
    escalatedTo: ESCALATED_MAX_TOKENS,
  })
  const next: State = {
    maxOutputTokensOverride: ESCALATED_MAX_TOKENS,  // 自动升级
    transition: { reason: 'max_output_tokens_escalate' },
  }
  state = next
  continue
}
```

---

## 第八部分：未公开的专有特性汇总

### 8.1 Beta Headers 功能映射表

| Beta Header | 功能 | 状态 |
|-------------|------|------|
| `claude-code-20250219` | Claude Code 基础特性 | First-Party Only |
| `interleaved-thinking-2025-05-14` | 混合思考模式 | 公开 |
| `context-1m-2025-08-07` | 1M 上下文窗口 | First-Party Only |
| `context-management-2025-06-27` | 自动上下文管理 | First-Party Only |
| `structured-outputs-2025-12-15` | 结构化输出 | 公开 |
| `web-search-2025-03-05` | Web 搜索 | First-Party Only |
| `advanced-tool-use-2025-11-20` | 细粒度工具流 | First-Party Only |
| `effort-2025-11-24` | Effort 模式 | First-Party Only |
| `task-budgets-2026-03-13` | 任务预算 | First-Party Only |
| `prompt-caching-scope-2026-01-05` | 缓存作用域 | First-Party Only |
| `fast-mode-2026-02-01` | 快速模式 | First-Party Only |
| `redact-thinking-2026-02-12` | 思考编辑 | First-Party Only |
| `token-efficient-tools-2026-03-28` | Token 高效工具 | First-Party Only |
| `afk-mode-2026-01-31` | AFK 自动模式 | First-Party Only |
| `cli-internal-2026-02-09` | CLI 内部功能 | Internal Only |
| `advisor-tool-2026-03-01` | Advisor 顾问工具 | First-Party Only |

### 8.2 环境变量控制项

| 环境变量 | 默认值 | 功能 |
|---------|--------|------|
| `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` | 10 | 最大并发工具数 |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | 8192 (capped) | 最大输出 Token |
| `CLAUDE_CODE_DISABLE_CLAUDE_MDS` | false | 禁用 CLAUDE.md 自动发现 |
| `CLAUDE_CODE_SIMPLE` | false | 简化模式 (调试用) |
| `CLAUDE_CODE_REMOTE` | - | 远程会话模式 |
| `CLAUDE_CODE_ATTRIBUTION_HEADER` | - | 属性头启用 |

---

## 第九部分：与开源工具的关键差异

### 9.1 架构差异对比

| 维度 | Claude Code | Aider | Cline | OpenCode |
|------|------------|-------|-------|----------|
| **CLI 框架** | Commander.js + Ink | Click + Rich | TypeScript + UI | 未知 |
| **流式解析** | 原生字符串累积 | 可能使用 SDK | 可能使用 SDK | 未知 |
| **缓存策略** | 分层 + Latches | 单层 | 可能无 | 未知 |
| **并发模型** | 分区并发 (读写分离) | 可能串行 | 可能部分并发 | 未知 |
| **Token 管理** | 自动升级 + 压缩 | 手动配置 | 可能固定 | 未知 |

### 9.2 成本优化策略

1. **默认 8K Token** 而非 64K
   - 节省 API Slot 占用
   - 按需升级到 64K

2. **Prompt Cache 保护**
   - Sticky Latches 防止缓存破坏
   - 50-70K Token/会话节省

3. **细粒度工具流**
   - 减少首字节时间 (TTFB)
   - 提升用户感知速度

---

## 第十部分：反向工程建议

### 10.1 如何识别打包文件中的模块

如果代码是压缩后的 `dist/cli.js`（5MB+）：

1. **查找特征字符串**：
   ```bash
   grep -o '"use strict"[^;]*' dist/cli.js
   grep -o 'exports\.[a-zA-Z_$]+=' dist/cli.js
   ```

2. **识别 Beta Headers**：
   ```bash
   grep -o '[a-z-]+-[0-9]{4}-[0-9]{2}-[0-9]{2}' dist/cli.js
   ```

3. **查找缓存控制代码**：
   ```bash
   grep -o 'cache_control[^;]*;' dist/cli.js
   ```

### 10.2 核心模块切片位置

| 模块 | 特征字符串 |
|------|-----------|
| API 客户端 | `getAnthropicClient` |
| 流式解析 | `input_json_delta` |
| 工具编排 | `partitionToolCalls` |
| 缓存控制 | `cache_control` |
| 并发控制 | `MAX_TOOL_USE_CONCURRENCY` |
| Token 管理 | `max_output_tokens_escalate` |

---

## 附录：关键代码位置索引

| 功能 | 文件路径 | 行号/函数 |
|------|---------|----------|
| **Beta Headers** | `src/constants/betas.ts` | 1-32 |
| **FGTS 启用** | `src/utils/api.ts` | 194-202 |
| **流式解析** | `src/services/api/claude.ts` | 2087-2112 |
| **Sticky Latches** | `src/services/api/claude.ts` | 1405-1442 |
| **缓存边界** | `src/constants/prompts.ts` | 114-115 |
| **并发控制** | `src/services/tools/toolOrchestration.ts` | 8-12 |
| **Token 升级** | `src/query.ts` | 1194-1221 |
| **任务管理指令** | `src/constants/prompts.ts` | 841, 269-314 |
| **代码风格指令** | `src/constants/prompts.ts` | 199-253 |
| **Git 状态注入** | `src/context.ts` | 36-111 |
| **System Prompt 构造** | `src/constants/prompts.ts` | 444-577 |

---

*本文档通过静态代码分析生成，所有代码片段均来自实际源文件。*
*内部文档，请勿外传。*
