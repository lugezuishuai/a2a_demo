# LangGraph A2A Demo (TypeScript + Node.js)

一个可本地运行和验证的 A2A 1.0 Client/Server demo。Server 使用
[LangChain.js](https://js.langchain.com/) 统一模型接口，使用 LangGraph 保存同一
`contextId` 的多轮对话状态，并通过官方 `@a2a-js/sdk` 暴露 Agent Card、JSON-RPC 与 SSE。
Client 同样是一个 LangGraph Agent：它先理解用户语义，再决定本地回答或通过
`delegate_to_server_agent` 工具调用远端 Server Agent。

当前示例入口默认以批式方式展示最终回答：Server Agent 使用 `respond()` 获取完整模型结果，
再发布一次完整 `artifactUpdate` 和 `completed` 状态。项目同时保留 `ServerAgent.stream()`、
`ClientAgent.stream()` 以及 Client 侧 artifact 分片解析能力，便于后续切换为真正的模型 token
级流式输出。

## 支持的模型

| `MODEL_PROVIDER` | LangChain 适配器 | 示例 `MODEL` | Key |
| --- | --- | --- | --- |
| `openai` / `gpt` | `ChatOpenAI` | `gpt-4o-mini` | `API_KEY` 或 `OPENAI_API_KEY` |
| `deepseek` | `ChatOpenAI`（Responses / Chat Completions compatible） | `deepseek-v4-flash` | `API_KEY` 或 `DEEPSEEK_API_KEY` |
| `anthropic` / `claude` | `ChatAnthropic` | `claude-sonnet-4-6` | `API_KEY` 或 `ANTHROPIC_API_KEY` |

`MODEL`、`API_KEY`、`BASE_URL`、`MAX_TOKENS`、超时、重试次数、Server 地址等均由环境变量注入，
不会写入源码或 Agent Card。

DeepSeek 官方目前仅为 `deepseek-v4-flash` 开放 Responses API，因此该模型会设置
`useResponsesApi: true`；其他 DeepSeek 模型继续使用 Chat Completions。

## 快速开始

要求 Node.js 20+（本项目已在 Node.js 22 验证）。

```bash
npm install
npm run env:init
```

`env:init` 从 `.env.example` 创建 `.env`；如果 `.env` 已存在则保持原文件不变。

编辑 `.env` 后启动 Server：

```bash
npm run doctor
npm run dev
```

另开终端运行 Client Agent。Client Agent 会根据语义决定是否通过 A2A 委派：

```bash
npm run client -- "用三句话解释 A2A 协议"
```

不传消息时进入多轮交互模式（输入 `exit` 或 `quit` 退出）：

```bash
npm run client
```

指定其他 Server：

```bash
npm run client -- --url http://127.0.0.1:10000 "hello"
```

### LangSmith Studio

项目已按 LangGraph JavaScript 应用结构配置 `langgraph.json`，Studio 会加载
`client_agent` 图并通过同一个 `.env` 复用 `LANGSMITH_API_KEY`。Client Agent 的 traces
仍写入固定项目 `a2a_demo_client`。

先启动 A2A Server，确保 Studio 中的 `delegate_to_server_agent` 工具可以连到远端 Server Agent：

```bash
npm run dev
```

另开终端启动 LangGraph 本地 Agent Server：

```bash
npm run studio:client
```

命令就绪后会输出本地 API 地址和 Studio Web UI 链接，默认类似：

```text
API: http://localhost:2024
Studio Web UI: https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024
```

在 Studio 中选择 assistant `client_agent`。图入口在 `src/client-agent-studio.ts`，它会关闭图内
`MemorySaver`，让 LangGraph Agent Server 接管线程状态与 human-in-the-loop interrupt 恢复。

### 异步推送模式

同步命令 `npm run client` 使用 `sendMessageStream` 在同一条请求连接上消费 A2A 事件，
但 CLI 会聚合事件并打印最终回答。
如果需要由 Server 后台处理并通过 push notification 回调 Client，可以使用异步入口：

```bash
npm run client:async -- "用三句话解释 A2A 协议"
```

异步入口会在本地启动 push webhook，并在发送请求时附带
`taskPushNotificationConfig` 与 `returnImmediately: true`。默认回调地址为
`http://127.0.0.1:10001/a2a/push`，可通过以下环境变量调整：

```bash
A2A_PUSH_HOST=127.0.0.1
A2A_PUSH_PORT=10001
A2A_PUSH_PUBLIC_URL=http://127.0.0.1:10001
A2A_PUSH_TIMEOUT_MS=120000
```

## 本地验证

```bash
npm run check
npm run format:check
npm test
npm run build
```

集成测试会启动真实的本地 Express 随机端口，覆盖同步 SSE 与异步 push 两条协议路径：

1. 读取 `/.well-known/agent-card.json`；
2. 通过 JSON-RPC 发送消息；
3. 同步路径消费 SSE 的 task / status / artifact 事件；
4. 异步路径注册本地 `/a2a/push` webhook 并等待 push 事件；
5. 验证任务最终为 `TASK_STATE_COMPLETED`。

测试模型使用 LangChain 的 deterministic fake model，不需要真实 API Key；实际 Server 启动时会校验 Key。

## 常用端点

- Agent Card: `http://127.0.0.1:10000/.well-known/agent-card.json`
- A2A JSON-RPC: `http://127.0.0.1:10000/`
- Health: `http://127.0.0.1:10000/healthz`

如果 Server 绑定地址和外部可访问地址不同，请设置 `A2A_PUBLIC_URL`；Client 目标通过
`A2A_SERVER_URL` 或 `--url` 设置。

## 项目结构

```text
src/
  config.ts               环境变量解析与校验
  model-factory.ts        OpenAI / DeepSeek / Claude 模型工厂
  client-agent.ts         Client LangGraph Agent 与 A2A 委派工具
  client-agent-studio.ts  LangSmith Studio 专用 Client Agent 图导出
  client-arguments.ts     Client CLI 参数解析
  langgraph-executor.ts   LangGraph 到 A2A task lifecycle 的适配
  langchain-stream-helpers.ts
                          LangChain / LangGraph 流式 chunk 文本提取
  server-agent.ts         Server LangGraph Agent 与 MemorySaver 会话状态
  server.ts               Agent Card 与 A2A Express Server
  client.ts               可复用的底层 A2A Client transport
  async-client.ts         A2A push notification 异步接入封装
  server-entry.ts         Server CLI 入口
  client-entry.ts         单次/交互式 Client 入口
  client-async-entry.ts   单次/交互式异步 Client 入口
  a2a-helpers.ts          A2A Message / Part 文本辅助函数
  doctor.ts               本地配置诊断入口
langgraph.json            LangGraph CLI / LangSmith Studio 本地配置
tests/
  a2a-integration.test.ts  真实本地协议闭环测试
  client-agent.test.ts     Client Agent 语义路由测试
  client-arguments.test.ts CLI 参数解析测试
  config.test.ts           环境变量解析测试
  graph-agent.test.ts      Server Agent LangGraph 测试
  model-factory.test.ts    模型工厂测试
```

## 调试配置

VS Code 已提供三组 launch 配置：

- `A2A: Debug Server`：启动 A2A Server。
- `A2A: Debug Client`：启动同步 Client，使用 `sendMessageStream` 消费 A2A SSE 事件。
- `A2A: Debug Async Client`：启动异步 Client，本地监听 `/a2a/push` 接收 push notification。

Compound 配置：

- `A2A: Debug Client + Server`
- `A2A: Debug Async Client + Server`

Client 调试配置会先执行 `A2A: Wait for Server`，等待 `/healthz` 就绪后再启动。

## 实现说明

- `server.ts` 只注册 SDK handler：Agent Card 路由、JSON-RPC 主入口和健康检查。
- JSON-RPC 方法分发、SSE 写出、TaskStore 合并、push notification 发送由 `@a2a-js/sdk` 负责。
- `langgraph-executor.ts` 是协议事件和业务 Agent 的适配层，当前默认发布完整回答产物。
- `server-agent.ts` 用 `contextId` 作为 LangGraph `thread_id` 维护多轮上下文。
- `client-agent.ts` 为每个 Client 会话保存远端 A2A `contextId`，避免多轮上下文串线。
- `async-client.ts` 使用每次请求生成的 push token 在本地 `pendingByToken` 中匹配回调事件。
