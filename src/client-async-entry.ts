import { createInterface } from "node:readline/promises";
import { randomUUID } from "node:crypto";
import { stdin, stdout } from "node:process";

import { startA2AAsyncDemoClient } from "./async-client.js";
import { ClientAgent } from "./client-agent.js";
import { parseClientArguments, readClientArguments } from "./client-arguments.js";
import { loadConfig } from "./config.js";
import { createChatModel } from "./model-factory.js";

// 异步入口复用 Client Agent，只将底层 A2A 接入方式替换为 push notification。
const config = loadConfig();
const args = readClientArguments();
const { serverUrl, initialPrompt } = parseClientArguments(args, config.serverUrl);
const asyncRuntime = await startA2AAsyncDemoClient(serverUrl, config.pushHost, config.pushPort, {
  callbackUrl: `${config.pushPublicUrl}/a2a/push`,
  timeoutMs: config.pushTimeoutMs,
});
const clientAgent = new ClientAgent(createChatModel(config), asyncRuntime.client, config.clientSystemPrompt);

console.log(`A2A async push webhook: ${asyncRuntime.callbackUrl}`);

try {
  // 传入位置参数时执行单轮；没有参数时进入可连续发送指令的交互模式。
  if (initialPrompt) {
    await runTurn(initialPrompt);
  } else {
    await runInteractive();
  }
} finally {
  await asyncRuntime.close();
}

/**
 * 执行一轮 Client Agent 对话，并通过 A2A push notification 等待 Server Agent 结果。
 *
 * @param prompt - 当前用户输入。
 * @param contextId - Client Agent 会话标识；首次调用时自动生成。
 * @returns 用于下一轮继续对话的 Client Agent 会话标识。
 */
async function runTurn(prompt: string, contextId: string = randomUUID()): Promise<string> {
  const result = await clientAgent.respond(prompt, contextId);
  console.log(`[route] ${result.delegated ? "Server Agent via A2A push" : "Client Agent local"}`);
  console.log(`assistant > ${result.text}`);
  return contextId;
}

/**
 * 在终端中持续读取用户输入，并复用 contextId 维持多轮 Client Agent 会话。
 *
 * @returns 用户输入 exit 或 quit 后结束交互。
 */
async function runInteractive(): Promise<void> {
  const readline = createInterface({ input: stdin, output: stdout });
  let contextId: string | undefined;
  try {
    while (true) {
      // 读取一轮输入；退出命令和空请求不进入 Agent。
      const prompt = (await readline.question("user > ")).trim();
      if (["exit", "quit"].includes(prompt.toLowerCase())) return;
      if (!prompt) continue;
      contextId = await runTurn(prompt, contextId);
    }
  } finally {
    readline.close();
  }
}
