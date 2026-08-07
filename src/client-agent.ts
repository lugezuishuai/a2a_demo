import { TaskState } from "@a2a-js/sdk";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { tool, type ToolRuntime } from "@langchain/core/tools";
import {
  END,
  MemorySaver,
  MessagesAnnotation,
  START,
  StateGraph,
  type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { z } from "zod";

import type { A2AResult } from "./client.js";

export interface ServerAgentClient {
  send(prompt: string, contextId?: string): Promise<A2AResult>;
}

export interface ClientAgentResult {
  text: string;
  delegated: boolean;
}

/**
 * 负责理解用户意图、决定本地回答或通过 A2A 委派到 Server Agent 的 LangGraph Client Agent。
 */
export class ClientAgent {
  private readonly graph: ReturnType<typeof buildClientAgentGraph>;

  /**
   * 创建 Client Agent 并构建包含 A2A 工具节点的 LangGraph。
   *
   * @param model - 支持 tool calling 的 LangChain 聊天模型。
   * @param serverClient - 向远端 Server Agent 发送 A2A 请求的客户端。
   * @param systemPrompt - 指导语义路由决策的系统提示词。
   */
  constructor(model: BaseChatModel, serverClient: ServerAgentClient, systemPrompt: string) {
    this.graph = buildClientAgentGraph(model, serverClient, systemPrompt);
  }

  /**
   * 处理一轮用户请求，并返回最终文本及是否发生 A2A 委派。
   *
   * @param prompt - 当前用户请求。
   * @param contextId - Client Agent 多轮会话标识。
   * @param signal - 可选取消信号，会透传给 LangGraph 调用。
   * @returns Client Agent 的最终回答和委派标记。
   */
  async respond(
    prompt: string,
    contextId: string,
    signal?: AbortSignal,
  ): Promise<ClientAgentResult> {
    // thread_id 让同一 Client 会话在 MemorySaver 中复用历史消息。
    const result = await this.graph.invoke(
      { messages: [new HumanMessage(prompt)] },
      {
        configurable: { thread_id: contextId },
        ...(signal ? { signal } : {}),
      },
    );
    const text = result.messages.at(-1)?.text.trim();
    if (!text) throw new Error("The Client Agent returned an empty response");

    return {
      text,
      delegated: result.messages.some(ToolMessage.isInstance),
    };
  }
}

/**
 * 构建“Client Agent → A2A 工具（可选）→ Client Agent”的 LangGraph 路由图。
 *
 * @param model - 用于语义判断和最终回答的聊天模型。
 * @param serverClient - 执行实际 A2A 委派的客户端。
 * @param systemPrompt - 约束 Client Agent 路由行为的系统提示词。
 * @returns 已启用会话记忆的可执行 LangGraph。
 */
function buildClientAgentGraph(
  model: BaseChatModel,
  serverClient: ServerAgentClient,
  systemPrompt: string,
) {
  // 为每个 Client 会话保存一个远端 A2A contextId，避免多轮上下文串线。
  const remoteContexts = new Map<string, string>();
  const delegateToServerAgent = tool(
    /**
     * 将模型生成的完整请求转发给 Server Agent，并记录远端会话上下文。
     *
     * @param request - 需要委派给 Server Agent 的独立完整请求。
     * @param runtime - LangGraph 工具运行时，用于读取当前 Client thread_id。
     * @returns Server Agent 的最终文本回答。
     */
    async ({ request }, runtime: ToolRuntime) => {
      const clientContextId = String(runtime.config.configurable?.thread_id ?? "default");
      // 同一 Client thread 后续调用会携带上一次 A2A contextId。
      const result = await serverClient.send(request, remoteContexts.get(clientContextId));
      if (result.state !== TaskState.TASK_STATE_COMPLETED) {
        throw new Error(`Server Agent did not complete the task: ${TaskState[result.state]}`);
      }
      remoteContexts.set(clientContextId, result.contextId);
      return result.text;
    },
    {
      name: "delegate_to_server_agent",
      description:
        "Delegate a substantive user request to the remote general-purpose Server Agent over A2A. " +
        "Use it for questions, analysis, coding, planning, or other tasks needing the Server Agent. " +
        "Do not use it for greetings or when asking the user for missing information.",
      schema: z.object({
        request: z
          .string()
          .min(1)
          .describe("A complete standalone request containing all context needed by the Server Agent."),
      }),
    },
  );
  // 只暴露一个委派工具，保持 Client Agent 的职责边界清晰。
  const tools = [delegateToServerAgent];
  if (!model.bindTools) {
    throw new Error("The configured Client Agent model does not support tool calling");
  }
  const modelWithTools = model.bindTools(tools);
  /**
   * 调用绑定工具后的模型，让模型决定结束回答或请求 A2A 工具。
   *
   * @param state - 当前 LangGraph 消息状态。
   * @param runnableConfig - LangGraph 运行配置及取消信号。
   * @returns 新增到消息状态的模型响应。
   */
  const callModel = async (
    state: typeof MessagesAnnotation.State,
    runnableConfig?: LangGraphRunnableConfig,
  ) => {
    const response = await modelWithTools.invoke(
      [new SystemMessage(systemPrompt), ...state.messages],
      runnableConfig,
    );
    return { messages: [response] };
  };

  // toolsCondition 根据模型输出是否包含 tool_calls 决定走工具节点还是结束。
  return new StateGraph(MessagesAnnotation)
    .addNode("client_agent", callModel)
    .addNode("a2a_tools", new ToolNode(tools))
    .addEdge(START, "client_agent")
    .addConditionalEdges("client_agent", toolsCondition, {
      tools: "a2a_tools",
      [END]: END,
    })
    .addEdge("a2a_tools", "client_agent")
    .compile({ checkpointer: new MemorySaver() });
}
