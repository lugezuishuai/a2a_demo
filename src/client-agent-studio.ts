import { A2ADemoClient } from "./client.js";
import { createClientAgentGraph, enableLangSmithTracing } from "./client-agent.js";
import { loadConfig } from "./config.js";
import { createChatModel } from "./model-factory.js";

// Studio 入口由 LangGraph CLI 加载；配置从 langgraph.json 指向的 .env 中读取。
const config = loadConfig();

// 在创建模型和图之前启用 tracing，确保 LangSmith SDK 读取到同一份 LANGSMITH_API_KEY。
enableLangSmithTracing({ apiKey: config.langSmithApiKey, projectName: config.langSmithProject });

/**
 * LangSmith Studio 使用的 Client Agent 图。
 *
 * Agent Server 会负责线程持久化与 interrupt 恢复，所以这里不再绑定本地 MemorySaver。
 */
export const graph = createClientAgentGraph(
  createChatModel(config),
  new A2ADemoClient(config.serverUrl),
  config.clientSystemPrompt,
  { useLocalMemorySaver: false },
);
