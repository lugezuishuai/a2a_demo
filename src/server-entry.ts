import { loadConfig } from "./config.js";
import { ServerAgent } from "./server-agent.js";
import { LangGraphAgentExecutor } from "./langgraph-executor.js";
import { createChatModel } from "./model-factory.js";
import { createA2AServer } from "./server.js";

// 初始化 Server 运行所需的配置、模型、LangGraph Agent 和 A2A SDK runtime。
const config = loadConfig();
const model = createChatModel(config);
const agent = new ServerAgent(model, config.systemPrompt);
const runtime = createA2AServer(config, new LangGraphAgentExecutor(agent));

// 绑定配置的监听地址，并输出调试时需要的 Agent Card 地址。
const server = runtime.app.listen(config.serverPort, config.serverHost, () => {
  console.log(`A2A server: ${config.publicUrl}`);
  console.log(`Agent Card: ${config.publicUrl}/.well-known/agent-card.json`);
  console.log(`Provider/model: ${config.modelProvider}/${config.model}`);
});

// 接收终止信号时优雅关闭 HTTP Server，避免本地调试残留监听端口。
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close((error) => {
      if (error) {
        console.error(error);
        process.exitCode = 1;
      }
    });
  });
}
