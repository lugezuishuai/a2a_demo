# LangGraph A2A Demo (TypeScript + Node.js)

一个可本地运行和验证的 A2A 1.0 Client/Server demo。Server 使用
[LangChain.js](https://js.langchain.com/) 统一模型接口，使用 LangGraph 保存同一
`contextId` 的多轮对话状态，并通过官方 `@a2a-js/sdk` 暴露 Agent Card、JSON-RPC 与 SSE。
Client 同样是一个 LangGraph Agent：它先理解用户语义，再决定本地回答或通过
`delegate_to_server_agent` 工具调用远端 Server Agent。

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

## 本地验证

```bash
npm run check
npm test
npm run build
```

集成测试会启动一个真实的本地 Express 随机端口，使用官方 A2A Client 完成：

1. 读取 `/.well-known/agent-card.json`；
2. 通过 JSON-RPC 发送消息；
3. 消费 SSE 的 task / status / artifact 事件；
4. 验证任务最终为 `TASK_STATE_COMPLETED`。

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
  graph-agent.ts          LangGraph 对话图与 MemorySaver
  langgraph-executor.ts   LangGraph 到 A2A task lifecycle 的适配
  server.ts               Agent Card 与 A2A Express Server
  client.ts               可复用的底层 A2A Client transport
  server-entry.ts         Server CLI 入口
  client-entry.ts         单次/交互式 Client 入口
tests/
  a2a-integration.test.ts  真实本地协议闭环测试
```
