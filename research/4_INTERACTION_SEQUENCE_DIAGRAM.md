# Claude Code 完整交互链路时序图

> **文档类型**: 交互流程可视化
> **生成时间**: 2026-04-09

---

## 1. 完整时序图 (Sequence Diagram)

从用户输入 `"修复这个 Bug"` 到最终输出的完整交互链路：

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 用户
    participant REPL as 🔄 REPL.tsx
    participant QueryEngine as 🧠 QueryEngine
    participant Query as 📡 query()
    participant Context as 📚 Context Loader
    participant PromptBuilder as 📝 Prompt Builder
    participant API as ☁️ Anthropic API
    participant StreamParser as 🔍 Stream Parser
    participant ToolOrch as 🛠️ Tool Orchestrator
    participant Permission as 🔐 Permission System
    participant BashTool as 🔧 BashTool
    participant Shell as 🐚 Shell Provider
    participant Process as ⚙️ 子进程
    participant UI as 🖥️ UI Renderer

    Note over User,UI: === 阶段 1: 用户输入与初始化 ===

    User->>REPL: 输入: "修复这个 Bug"
    REPL->>QueryEngine: query(userInput)
    
    QueryEngine->>Context: getUserContext()
    Context->>Context: getGitStatus() [并发]
    Context->>Context: getClaudeMds() [并发]
    Context-->>QueryEngine: { gitStatus, claudeMd, currentDate }
    
    QueryEngine->>PromptBuilder: getSystemPrompt(tools, model)
    PromptBuilder-->>QueryEngine: systemPrompt[]

    Note over User,UI: === 阶段 2: 构造 API 请求 ===

    QueryEngine->>Query: query(messages, systemPrompt)
    Query->>Query: 检查是否需要压缩
    Query->>Query: 预取 Memory/Skills
    
    Query->>API: POST /v1/messages (stream: true)
    Note over Query,API: 包含:<br/>- system: [...]<br/>- messages: [...]<br/>- tools: [...]<br/>- betas: ["advanced-tool-use-2025-11-20", ...]

    Note over User,UI: === 阶段 3: API 流式响应 ===

    loop API 流式循环
        API-->>StreamParser: SSE Event
        StreamParser->>StreamParser: 解析事件类型

        alt 事件类型: text_delta
            API-->>StreamParser: content_block_delta (text)
            StreamParser->>StreamParser: 累积文本内容
            StreamParser-->>Query: AssistantMessage (text 流)
            Query-->>UI: 实时显示文本输出
        and 事件类型: content_block_start (tool_use)
            API-->>StreamParser: content_block_start (tool_use)
            StreamParser->>StreamParser: 初始化 tool_use 块
            StreamParser-->>Query: AssistantMessage (tool_use)
        and 事件类型: input_json_delta
            API-->>StreamParser: content_block_delta (input_json_delta)
            Note over StreamParser: 关键优化: 字符串累积 O(n)<br/>而非 JSON.parse O(n²)
            StreamParser->>StreamParser: contentBlock.input += delta.partial_json
            StreamParser-->>Query: 更新 tool_use 显示
            Query-->>UI: 显示工具调用参数 (实时更新)
        and 事件类型: content_block_stop
            API-->>StreamParser: content_block_stop
            StreamParser-->>Query: 完整 AssistantMessage
        end

        API-->>StreamParser: message_delta (usage, stop_reason)
        StreamParser-->>Query: 更新 usage 统计
    end

    Note over User,UI: === 阶段 4: 工具执行 ===

    Query->>ToolOrch: runTools(toolUseBlocks)
    
    par 并发执行只读工具
        ToolOrch->>FileRead: call({file_path})
        FileRead-->>ToolOrch: 文件内容
        and
        ToolOrch->>Grep: call({pattern})
        Grep-->>ToolOrch: 匹配结果
    end
    
    Note over ToolOrch,BashTool: === 串行执行写入工具 ===

    ToolOrch->>Permission: canUseTool(BashTool, input)
    
    alt 权限自动允许
        Permission-->>ToolOrch: allow
    else 需要用户确认
        Permission-->>UI: 显示权限对话框
        User->>Permission: 点击 Allow
        Permission-->>ToolOrch: allow
    end

    ToolOrch->>BashTool: call({command: "npm test"})
    
    Note over BashTool,Shell: === 命令执行流程 ===

    BashTool->>BashTool: runShellCommand()
    BashTool->>Shell: buildExecCommand(command)
    Shell-->>BashTool: commandString, cwdFilePath
    
    BashTool->>Process: spawn(shellPath, ['-c', commandString])
    
    loop 进程输出流
        Process-->>BashTool: stdout chunk
        BashTool->>BashTool: 累积输出
        BashTool->>QueryEngine: onProgress(output)
        QueryEngine-->>UI: 显示进度 (实时)
    end
    
    Process-->>BashTool: exit code
    BashTool-->>ToolOrch: {stdout, stderr, exitCode}
    
    ToolOrch->>ToolOrch: mapToolResultToToolResultBlockParam()
    ToolOrch-->>Query: UserMessage (tool_result)

    Note over User,UI: === 阶段 5: 结果返回与下一轮 ===

    Query->>Query: messages.append(tool_result)
    
    alt API 还有更多内容
        Query->>API: 继续处理流式响应
        API-->>Query: 更多 AssistantMessage
    else 完成
        Query-->>QueryEngine: 最终结果
    end

    QueryEngine-->>REPL: final AssistantMessage
    REPL-->>User: 显示最终输出
```

---

## 2. 组件职责泳道图 (Swimlane Diagram)

```mermaid
flowchart TD
    subgraph 用户交互层
        A1[用户输入] --> A2[REPL 渲染]
        A2 --> A3[UI 显示]
    end

    subgraph 查询引擎层
        B1[QueryEngine] --> B2[query 函数]
        B2 --> B3[消息历史管理]
        B3 --> B4[Token 计算]
    end

    subgraph 上下文层
        C1[Context Loader] --> C2[getSystemContext<br/>Git 状态]
        C1 --> C3[getUserContext<br/>CLAUDE.md]
        C1 --> C4[Memory Loader]
    end

    subgraph Prompt 构建层
        D1[Prompt Builder] --> D2[getSystemPrompt]
        D2 --> D3[addDynamicSections]
        D3 --> D4[构建缓存边界]
    end

    subgraph API 通信层
        E1[API Client] --> E2[getAnthropicClient]
        E2 --> E3[设置 Beta Headers]
        E3 --> E4[发送请求]
    end

    subgraph 流式解析层
        F1[Stream Parser] --> F2[解析 SSE 事件]
        F2 --> F3[处理 text_delta]
        F2 --> F4[处理 input_json_delta]
        F4 --> F5[字符串累积 O n]
    end

    subgraph 工具执行层
        G1[Tool Orchestrator] --> G2[partitionToolCalls]
        G2 --> G3[并发: 只读工具]
        G2 --> G4[串行: 写入工具]
        G4 --> G5[权限检查]
        G5 --> G6[Bash Tool]
    end

    subgraph 命令执行层
        H1[Shell Provider] --> H2[buildExecCommand]
        H2 --> H3[spawn 子进程]
        H3 --> H4[捕获输出]
        H4 --> H5[返回结果]
    end

    A1 --> B1
    B1 --> C1
    B1 --> D1
    B1 --> E1
    E1 --> F1
    F1 --> B2
    B2 --> G1
    G1 --> H1
    H5 --> G1
    G1 --> B3
    B3 --> A3
```

---

## 3. 核心流程详细时序 (关键步骤放大)

### 3.1 工具调用实时渲染流程

```mermaid
sequenceDiagram
    autonumber
    participant API as Anthropic API
    participant Parser as Stream Parser
    participant UI as UI Renderer
    participant User as 👤 用户

    Note over API,User: T=0ms: 开始工具调用

    API->>Parser: content_block_start<br/>(type: tool_use, name: Bash, id: tool_1)
    Parser->>Parser: contentBlocks[0] = {type: 'tool_use', input: '', id: 'tool_1'}
    
    Note over API,User: T=10ms: 开始参数流式传输

    API->>Parser: input_json_delta<br/>(partial_json: '{"command"')
    Parser->>Parser: contentBlocks[0].input = '{"command"'
    
    API->>Parser: input_json_delta<br/>(partial_json: ': "npm')
    Parser->>Parser: contentBlocks[0].input = '{"command": "npm'
    
    API->>Parser: input_json_delta<br/>(partial_json: ' test"}')
    Parser->>Parser: contentBlocks[0].input = '{"command": "npm test"}'
    
    Parser->>UI: streamingToolUses 更新
    UI->>User: 显示: 🔄 正在运行 npm test...
    
    Note over API,User: T=50ms: 用户已看到工具调用<br/>无需等待完整 JSON!

    API->>Parser: content_block_stop
    Parser->>Parser: yield AssistantMessage
    
    Note over API,User: T=100ms: 工具调用完全接收
```

### 3.2 并发工具执行流程

```mermaid
sequenceDiagram
    autonumber
    participant Orch as Tool Orchestrator
    participant P1 as FileRead
    participant P2 as Grep
    participant P3 as Bash
    participant Queue as 执行队列

    Note over Orch,Queue: 收到 3 个工具调用

    Orch->>Orch: partitionToolCalls([tool1, tool2, tool3])
    
    Note over Orch,Queue: 分区结果:<br/>只读组: [FileRead, Grep]<br/>写入组: [Bash]
    
    Orch->>Queue: 开始并发执行只读组
    
    par 并发执行 FileRead
        Orch->>P1: call({file_path: "src/main.ts"})
        P1->>P1: fs.readFile()
        P1-->>Orch: FileContent
    and 并发执行 Grep
        Orch->>P2: call({pattern: "BugFix"})
        P2->>P2: exec("grep")
        P2-->>Orch: MatchResults
    end
    
    Note over Orch,Queue: 只读工具完成

    Orch->>Queue: 开始串行执行写入组
    
    Orch->>P3: call({command: "npm test"})
    P3->>P3: spawn("npm test")
    P3-->>Orch: {stdout, exitCode}
    
    Note over Orch,Queue: 所有工具执行完成
```

### 3.3 权限检查介入点

```mermaid
sequenceDiagram
    autonumber
    participant Tool as Tool Orchestrator
    participant Perm as Permission System
    participant Dialog as 权限对话框
    participant User as 👤 用户

    Tool->>Perm: canUseTool(BashTool, {command: "rm -rf /"})
    
    Perm->>Perm: 检查配置的权限模式
    
    alt 模式: default (默认确认)
        Perm->>Dialog: 显示确认对话框
        Note over Dialog,User: 对话框内容:<br/>⚠️ 危险操作: rm -rf<br/>📍 将删除: /<br/>确认执行?
        Dialog->>User: 显示对话框
        User->>Dialog: 点击 [Allow]
        Dialog-->>Perm: allow
    and 模式: auto (自动模式)
        Perm->>Perm: 运行分类器
        alt 分类器: 高置信度 + 安全命令
            Perm-->>Tool: allow
        else 分类器: 低置信度或危险命令
            Perm->>Dialog: 显示确认对话框
            User->>Dialog: 用户选择
            Dialog-->>Perm: allow/deny
        end
    else 模式: plan (计划模式)
        Perm-->>Tool: allow (计划阶段已确认)
    end
    
    Perm-->>Tool: PermissionResult
```

---

## 4. 数据流图 (Data Flow)

```mermaid
flowchart LR
    Start([用户输入:<br/>"修复这个 Bug"]) --> Init[初始化<br/>QueryEngine]
    
    Init --> LoadCtx[加载上下文]
    LoadCtx --> |gitStatus| BuildGit[Git 状态]
    LoadCtx --> |claudeMd| BuildDocs[CLAUDE.md]
    
    BuildGit --> BuildSys[构建 System Prompt]
    BuildDocs --> BuildSys
    
    BuildSys --> Cache{启用缓存:<br/>cache_control}
    
    Cache --> API[发送 API 请求]
    
    API --> Stream[流式响应]
    
    Stream --> |text_delta| TextMsg[文本消息]
    Stream --> |tool_use| ToolMsg[工具消息]
    
    ToolMsg --> ParseJSON[解析工具参数<br/>input_json_delta 累积]
    
    ParseJSON --> |实时显示| UI1[UI 渲染:<br/>"正在运行..."]
    
    ToolMsg --> CheckPerm[权限检查]
    CheckPerm --> |需要确认| Dialog[权限对话框]
    Dialog --> |用户确认| ExecTool[执行工具]
    
    ExecTool --> |并发| ReadOnly[只读工具<br/>FileRead, Grep]
    ExecTool --> |串行| WriteTool[写入工具<br/>Bash, FileEdit]
    
    ReadOnly --> Accumulate[累积结果]
    WriteTool --> Accumulate
    
    Accumulate --> ToolResult[构建 tool_result]
    ToolResult --> NextTurn[下一轮 API 请求]
    
    NextTurn --> CheckToken{检查 Token 限制}
    
    CheckToken --> |超过阈值| Compact[压缩上下文]
    CheckToken --> |正常| Continue[继续]
    
    Compact --> NextTurn
    Continue --> API
    
    API --> |stop_reason| End[响应结束]
    End --> Final[最终结果]
    Final --> Display[显示输出]
```

---

## 5. 组件通信模式图

```mermaid
graph LR
    subgraph "前端层"
        REPL[REPL.tsx<br/>主循环]
        UI[UI 组件<br/>Messages.tsx]
    end
    
    subgraph "业务逻辑层"
        Query[QueryEngine.ts<br/>查询引擎]
        Tool[ToolOrchestration.ts<br/>工具编排]
        Exec[ToolExecution.ts<br/>工具执行]
    end
    
    subgraph "API 层"
        Client[client.ts<br/>API 客户端]
        Stream[claude.ts<br/>流式处理]
        Cache[缓存管理<br/>Latches]
    end
    
    subgraph "系统层"
        Context[context.ts<br/>上下文加载]
        Prompt[prompts.ts<br/>Prompt 构建]
        Shell[bashProvider.ts<br/>Shell 执行]
    end
    
    REPL --> Query
    Query --> Context
    Query --> Prompt
    Query --> Client
    Client --> Stream
    Stream --> Cache
    Stream --> Tool
    Tool --> Exec
    Exec --> Shell
    Shell --> Process[子进程]
    
    Process --> Exec
    Exec --> Tool
    Tool --> Query
    Query --> UI
    UI --> REPL
```

---

## 6. 关键时序指标

| 阶段 | 耗时 | 说明 |
|------|------|------|
| **用户输入到 API 请求** | ~50-100ms | 上下文加载 + Prompt 构建 |
| **API 首字节时间 (TTFB)** | ~500-2000ms | 取决于模型和复杂度 |
| **工具调用显示延迟** | ~10-50ms | FGTS 增量传输 |
| **工具执行时间** | 变化 | 取决于具体命令 |
| **结果返回到 UI** | ~10-100ms | 消息传递 + 渲染 |

**关键优化点**：
1. **FGTS (细粒度工具流)**: 10-50ms 即可显示工具调用
2. **Sticky Latches**: 防止缓存破坏，节省 50-70K tokens
3. **并发工具执行**: 只读工具并行执行
4. **增量 JSON 累积**: O(n) 复杂度 vs O(n²) 解析

---

*本文档展示了 Claude Code 从用户输入到最终输出的完整交互链路，包括所有关键组件的职责划分和数据流向。*
