import { createInterface, type Interface } from "node:readline/promises";
import { randomUUID } from "node:crypto";
import { stdin, stdout } from "node:process";

import { ClientAgent, enableLangSmithTracing, type ApprovalDecision } from "./client-agent.js";
import { A2ADemoClient } from "./client.js";
import { parseClientArguments, readClientArguments } from "./client-arguments.js";
import { loadConfig } from "./config.js";
import { createChatModel } from "./model-factory.js";

// 启动时一次性创建配置、模型和 Client Agent，交互轮次共享同一个 Agent 实例。
const config = loadConfig();
enableLangSmithTracing({ apiKey: config.langSmithApiKey, projectName: config.langSmithProject });
const args = readClientArguments();
const { serverUrl, initialPrompt } = parseClientArguments(args, config.serverUrl);
const clientAgent = new ClientAgent(createChatModel(config), new A2ADemoClient(serverUrl), config.clientSystemPrompt);

// 传入位置参数时执行单轮；没有参数时进入可连续发送指令的交互模式。
if (initialPrompt) {
  await runTurn(initialPrompt);
} else {
  await runInteractive();
}

/**
 * 执行一轮 Client Agent 对话并打印路由结果与最终回答。
 *
 * 若 Server Agent 结果需要人审核，会展示待审核内容并等待用户输入
 * y/n 及可选的拒绝反馈，然后调用 resume() 恢复图执行。
 *
 * @param prompt - 当前用户输入。
 * @param contextId - Client Agent 会话标识；首次调用时自动生成。
 * @param readline - 交互模式复用同一 readline；单轮模式临时创建。
 * @returns 用于下一轮继续对话的 Client Agent 会话标识。
 */
async function runTurn(prompt: string, contextId: string = randomUUID(), readline?: Interface): Promise<string> {
  let result = await clientAgent.respond(prompt, contextId);
  while (result.pendingApproval) {
    const approvalLine = readline ?? createInterface({ input: stdin, output: stdout });
    console.log("\n[approval] Server Agent response awaiting human review:");
    console.log(result.pendingApproval.content);
    const answer = (await approvalLine.question("[approval] Approve? (y/n) > ")).trim().toLowerCase();
    const decision: ApprovalDecision = { approved: answer === "y" };
    if (!decision.approved) {
      const feedback = (await approvalLine.question("[approval] Feedback (optional, Enter to skip) > ")).trim();
      if (feedback) decision.feedback = feedback;
    }
    if (!readline) approvalLine.close();
    result = await clientAgent.resume(contextId, decision);
  }
  console.log(`[route] ${result.delegated ? "Server Agent via A2A" : "Client Agent local"}`);
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
      contextId = await runTurn(prompt, contextId, readline);
    }
  } finally {
    readline.close();
  }
}
