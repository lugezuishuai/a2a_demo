import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  END,
  MemorySaver,
  MessagesAnnotation,
  START,
  StateGraph,
  type LangGraphRunnableConfig,
} from "@langchain/langgraph";

/**
 * 封装 Server 侧单模型对话图，并通过 contextId 保存多轮消息历史。
 */
export class LangGraphAgent {
  private readonly graph: ReturnType<typeof buildConversationGraph>;

  /**
   * 创建 Server Agent 的 LangGraph 对话图。
   *
   * @param model - 用于生成 Server Agent 回答的聊天模型。
   * @param systemPrompt - 每轮请求前注入的 Server Agent 系统提示词。
   */
  constructor(model: BaseChatModel, systemPrompt: string) {
    this.graph = buildConversationGraph(model, systemPrompt);
  }

  /**
   * 在指定会话中执行一轮 Server Agent 对话。
   *
   * @param prompt - 用户或 Client Agent 转发的文本请求。
   * @param contextId - A2A 会话标识，同时作为 LangGraph thread_id。
   * @param signal - 可选取消信号，由 A2A Executor 传入。
   * @returns 模型生成的非空最终文本。
   */
  async respond(prompt: string, contextId: string, signal?: AbortSignal): Promise<string> {
    // 使用 thread_id 将同一 A2A context 的消息存入 MemorySaver。
    const result = await this.graph.invoke(
      { messages: [new HumanMessage(prompt)] },
      {
        configurable: { thread_id: contextId },
        ...(signal ? { signal } : {}),
      },
    );
    const text = result.messages.at(-1)?.text.trim();
    if (!text) throw new Error("The configured model returned an empty text response");
    return text;
  }
}

/**
 * 构建 Server Agent 的单节点对话 LangGraph。
 *
 * @param model - 接收系统消息与会话历史的聊天模型。
 * @param systemPrompt - 每轮调用前注入的系统提示词。
 * @returns 配置了 MemorySaver 的可执行对话图。
 */
function buildConversationGraph(model: BaseChatModel, systemPrompt: string) {
  /**
   * 使用系统提示词和当前会话消息调用模型。
   *
   * @param state - 当前对话图消息状态。
   * @param runnableConfig - LangGraph 运行配置及取消信号。
   * @returns 追加到消息状态中的模型响应。
   */
  const callModel = async (
    state: typeof MessagesAnnotation.State,
    runnableConfig?: LangGraphRunnableConfig,
  ) => {
    const response = await model.invoke(
      [new SystemMessage(systemPrompt), ...state.messages],
      runnableConfig,
    );
    return { messages: [response] };
  };

  // Server Agent 不使用工具，模型节点执行结束后直接结束本轮图调用。
  return new StateGraph(MessagesAnnotation)
    .addNode("model", callModel)
    .addEdge(START, "model")
    .addEdge("model", END)
    .compile({ checkpointer: new MemorySaver() });
}
