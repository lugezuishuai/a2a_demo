import { TaskState } from "@a2a-js/sdk";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { tool, type ToolRuntime } from "@langchain/core/tools";
import {
  Command,
  END,
  INTERRUPT,
  MemorySaver,
  MessagesAnnotation,
  START,
  StateGraph,
  type InterruptPayload,
  type LangGraphRunnableConfig,
  interrupt,
} from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { z } from "zod";

import type { A2AResult } from "./client.js";
import { extractLangChainStreamText } from "./langchain-stream-helpers.js";

export interface ServerAgentClient {
  send(prompt: string, contextId?: string): Promise<A2AResult>;
}

export interface ClientAgentResult {
  text: string;
  delegated: boolean;
  /** 非空表示图已中断，等待人工审核；调用方读取后需用 resume() 继续。 */
  pendingApproval?: PendingApproval;
}

export interface PendingApproval {
  threadId: string;
  /** 等待审核的内容，即 Server Agent 返回的结果。 */
  content: string;
}

export interface ApprovalDecision {
  approved: boolean;
  feedback?: string;
}

export interface LangSmithTracingOptions {
  apiKey: string | undefined;
  projectName: string;
}

export interface ClientAgentGraphOptions {
  /**
   * 是否在图内启用本地 MemorySaver。
   *
   * CLI 直接调用图时需要它保存多轮与 interrupt 状态；LangGraph Agent Server
   * 会注入自己的持久化能力，因此 Studio 入口会关闭本地图内 checkpointer。
   */
  useLocalMemorySaver?: boolean;
}

/**
 * 启用 Client Agent 的 LangSmith 链路追踪。
 *
 * LangSmith Client 是惰性单例，首次图执行时才从 process.env 读取配置，
 * 因此必须在创建 ClientAgent 之前调用。未配置 API Key 时不启用并提示。
 *
 * @param options - 从环境变量读取的 LangSmith API Key 与项目名。
 * @returns 是否成功启用追踪。
 */
export function enableLangSmithTracing(options: LangSmithTracingOptions): boolean {
  if (!options.apiKey) {
    console.log("[trace] LANGSMITH_API_KEY 未配置，跳过 LangSmith tracing");
    return false;
  }
  process.env.LANGSMITH_TRACING = "true";
  process.env.LANGSMITH_API_KEY = options.apiKey;
  process.env.LANGSMITH_PROJECT = options.projectName;
  console.log(`[trace] LangSmith tracing enabled for project: ${options.projectName}`);
  return true;
}

/**
 * 负责理解用户意图、决定本地回答或通过 A2A 委派到 Server Agent 的 LangGraph Client Agent。
 */
export class ClientAgent {
  private readonly graph: ReturnType<typeof createClientAgentGraph>;

  /**
   * 创建 Client Agent 并构建包含 A2A 工具节点的 LangGraph。
   *
   * @param model - 支持 tool calling 的 LangChain 聊天模型。
   * @param serverClient - 向远端 Server Agent 发送 A2A 请求的客户端。
   * @param systemPrompt - 指导语义路由决策的系统提示词。
   */
  constructor(model: BaseChatModel, serverClient: ServerAgentClient, systemPrompt: string) {
    this.graph = createClientAgentGraph(model, serverClient, systemPrompt);
  }

  /**
   * 处理一轮用户请求，并返回最终文本及是否发生 A2A 委派。
   *
   * @param prompt - 当前用户请求。
   * @param contextId - Client Agent 多轮会话标识。
   * @param signal - 可选取消信号，会透传给 LangGraph 调用。
   * @returns Client Agent 的最终回答和委派标记。
   */
  async respond(prompt: string, contextId: string, signal?: AbortSignal): Promise<ClientAgentResult> {
    // thread_id 让同一 Client 会话在 MemorySaver 中复用历史消息。
    const result = await this.invokeGraph({ messages: [new HumanMessage(prompt)] }, contextId, signal);
    return this.toResult(result, contextId);
  }

  /**
   * 使用人的审核决定恢复被 submit_for_approval 中断的图执行。
   *
   * resume 值会成为工具内 interrupt() 的返回值；若再次中断则继续返回 pendingApproval。
   *
   * @param contextId - 与中断时相同的 Client Agent 会话标识。
   * @param decision - 人的审核结果：是否通过，以及可选的修改反馈。
   * @param signal - 可选取消信号，会透传给 LangGraph 调用。
   * @returns 恢复后的最终回答和委派标记，或再次等待审核的中断信息。
   */
  async resume(contextId: string, decision: ApprovalDecision, signal?: AbortSignal): Promise<ClientAgentResult> {
    const result = await this.invokeGraph(new Command({ resume: decision }), contextId, signal);
    return this.toResult(result, contextId);
  }

  /**
   * 以指定会话上下文调用图，thread_id 用于定位 checkpointer 中的 checkpoint。
   *
   * @param input - 图的初始状态或用于恢复的 Command。
   * @param contextId - Client Agent 多轮会话标识，作为 LangGraph thread_id。
   * @param signal - 可选取消信号。
   * @returns LangGraph 返回的最终状态，可能包含 __interrupt__。
   */
  private async invokeGraph(
    input: Record<string, unknown> | Command,
    contextId: string,
    signal?: AbortSignal,
  ): Promise<{ messages: import("@langchain/core/messages").BaseMessage[] }> {
    return this.graph.invoke(input as Parameters<typeof this.graph.invoke>[0], {
      configurable: { thread_id: contextId },
      ...(signal ? { signal } : {}),
    });
  }

  /**
   * 将图最终状态转换为对外结果；若存在 __interrupt__ 则返回待审核信息。
   *
   * @param result - LangGraph 调用返回的状态。
   * @param threadId - 当前会话标识，供调用方在 resume 时复用。
   * @returns 最终回答或等待审核的中断信息。
   */
  private toResult(
    result: { messages: import("@langchain/core/messages").BaseMessage[] },
    threadId: string,
  ): ClientAgentResult {
    const interrupts = (result as unknown as { [INTERRUPT]?: InterruptPayload[] })[INTERRUPT];
    if (interrupts && interrupts.length > 0) {
      const interruptInfo = interrupts[0] as InterruptPayload | { value?: unknown };
      // 运行时 __interrupt__ 元素为 { id, value }，类型声明为 { interruptId, payload }，两种都兼容。
      const payload = (interruptInfo as { value?: unknown }).value ?? (interruptInfo as InterruptPayload).payload;
      const content =
        typeof payload === "object" && payload !== null && "content" in payload
          ? String((payload as { content: unknown }).content)
          : String(payload ?? "");
      return {
        text: "",
        delegated: result.messages.some(ToolMessage.isInstance),
        pendingApproval: { threadId, content },
      };
    }

    const text = result.messages.at(-1)?.text.trim();
    if (!text) throw new Error("The Client Agent returned an empty response");

    return {
      text,
      delegated: result.messages.some(ToolMessage.isInstance),
    };
  }

  /**
   * 流式处理一轮用户请求，并逐步返回 Client Agent 的可见文本输出。
   *
   * @param prompt - 当前用户请求。
   * @param contextId - Client Agent 多轮会话标识。
   * @param signal - 可选取消信号，会透传给 LangGraph 调用。
   * @yields Client Agent 最终回答的文本片段。
   */
  async *stream(prompt: string, contextId: string, signal?: AbortSignal): AsyncGenerator<string> {
    const stream = await this.graph.stream(
      { messages: [new HumanMessage(prompt)] },
      {
        configurable: { thread_id: contextId },
        streamMode: "messages",
        ...(signal ? { signal } : {}),
      },
    );
    let hasTextChunk = false;

    // 工具调用 chunk 可能没有可见文本；仅把真正的文本片段返回给上层调用方。
    for await (const chunk of stream) {
      const text = extractLangChainStreamText(chunk);
      if (!text) continue;
      hasTextChunk = true;
      yield text;
    }

    if (!hasTextChunk) throw new Error("The Client Agent returned an empty response stream");
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
export function createClientAgentGraph(
  model: BaseChatModel,
  serverClient: ServerAgentClient,
  systemPrompt: string,
  options: ClientAgentGraphOptions = {},
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
  const submitForApproval = tool(
    /**
     * 将 Server Agent 的返回内容提交给人审核；审核前图会通过 interrupt 挂起。
     *
     * resume 后中断点返回人的决定，工具据此给出继续执行的指引。
     *
     * @param content - 需要人审核的内容，即 Server Agent 返回的最终结果。
     * @returns 审核结果摘要，供模型决定后续流程。
     */
    async ({ content }) => {
      const decision = interrupt({
        type: "approval_request",
        content,
        question: "Approve this response before it is returned to the user?",
      }) as ApprovalDecision;

      if (decision.approved) {
        return "Human approved the response. Return the approved content to the user as-is.";
      }
      return decision.feedback
        ? `Human rejected the response with feedback: ${decision.feedback}. Do not return the rejected content; revise it or ask the user how to proceed.`
        : "Human rejected the response. Do not return the rejected content; revise it or ask the user how to proceed.";
    },
    {
      name: "submit_for_approval",
      description:
        "Submit the Server Agent's final response for human approval before returning it to the user. " +
        "Call this after delegation completes; the graph pauses until a human reviews the content.",
      schema: z.object({
        content: z
          .string()
          .min(1)
          .describe("The final response content from the Server Agent that requires human approval."),
      }),
    },
  );
  // 委派后必须经人审核才能返回给用户，因此同时暴露委派与审批两个工具。
  const tools = [delegateToServerAgent, submitForApproval];
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
  const callModel = async (state: typeof MessagesAnnotation.State, runnableConfig?: LangGraphRunnableConfig) => {
    const response = await modelWithTools.invoke(
      [
        new SystemMessage(systemPrompt),
        new SystemMessage(
          "After the Server Agent returns a result, you MUST call submit_for_approval with that result " +
            "before giving the final answer to the user. Do not return the Server Agent's content without approval.",
        ),
        ...state.messages,
      ],
      runnableConfig,
    );
    return { messages: [response] };
  };

  // toolsCondition 根据模型输出是否包含 tool_calls 决定走工具节点还是结束。
  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("client_agent", callModel)
    .addNode("a2a_tools", new ToolNode(tools))
    .addEdge(START, "client_agent")
    .addConditionalEdges("client_agent", toolsCondition, {
      tools: "a2a_tools",
      [END]: END,
    })
    .addEdge("a2a_tools", "client_agent");

  if (options.useLocalMemorySaver === false) {
    // Studio/Agent Server 会在运行时提供 checkpointer，避免和本地 MemorySaver 冲突。
    return workflow.compile();
  }

  return workflow.compile({ checkpointer: new MemorySaver() });
}
