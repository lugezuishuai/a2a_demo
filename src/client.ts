import { ClientFactory, ClientFactoryOptions, JsonRpcTransportFactory } from '@a2a-js/sdk/client';
import { Role, TaskState, type Message, type SendMessageRequest, type StreamResponse } from '@a2a-js/sdk';
import { randomUUID } from 'node:crypto';

import { extractMessageText, extractPartsText, textPart } from './a2a-helpers.js';

export interface ClientEvent {
  kind: 'message' | 'task' | 'statusUpdate' | 'artifactUpdate';
  text: string;
  taskId?: string;
  contextId?: string;
  state?: TaskState;
}

export interface A2AResult {
  text: string;
  taskId: string;
  contextId: string;
  state: TaskState;
}

/**
 * 封装 Agent Card 发现、JSON-RPC 传输和流式事件归一化的底层 A2A Client。
 */
export class A2ADemoClient {
  private readonly factory: ClientFactory;

  /**
   * 创建指定 Server 地址的 A2A Client。
   *
   * @param serverUrl - A2A Server 根地址，用于发现 Agent Card。
   * @param fetchImpl - 可注入的 fetch 实现，便于测试或自定义网络行为。
   */
  constructor(
    private readonly serverUrl: string,
    fetchImpl: typeof fetch = fetch,
  ) {
    // 固定使用官方 JSON-RPC transport，确保与 Server Agent 的 A2A 接口一致。
    this.factory = new ClientFactory(
      ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
        transports: [new JsonRpcTransportFactory({ fetchImpl })],
        preferredTransports: ['JSONRPC'],
      }),
    );
  }

  /**
   * 向 Server Agent 发送请求并逐条产出归一化后的 A2A 流式事件。
   *
   * @param prompt - 发送给 Server Agent 的文本请求。
   * @param contextId - 可选远端会话标识，用于延续多轮 A2A 对话。
   * @yields Agent Card 发现后收到的消息、任务、状态和产物更新事件。
   */
  async *stream(prompt: string, contextId?: string): AsyncGenerator<ClientEvent> {
    const client = await this.factory.createFromUrl(this.serverUrl);
    // 构造符合官方 SDK 要求的 A2A User Message。
    const message: Message = {
      messageId: randomUUID(),
      role: Role.ROLE_USER,
      parts: [textPart(prompt)],
      taskId: '',
      contextId: contextId ?? '',
      extensions: [],
      metadata: {},
      referenceTaskIds: [],
    };
    const request: SendMessageRequest = {
      tenant: '',
      message,
      configuration: undefined,
      metadata: {},
    };

    // 将 SDK 原始 SSE/JSON-RPC 响应转换为调用方稳定消费的事件结构。
    for await (const response of client.sendMessageStream(request)) {
      const event = normalizeStreamResponse(response);
      if (event) yield event;
    }
  }

  /**
   * 完整消费 A2A 事件流，并汇总 Server Agent 的最终任务结果。
   *
   * @param prompt - 发送给 Server Agent 的文本请求。
   * @param contextId - 可选远端会话标识，用于延续多轮 A2A 对话。
   * @returns 包含最终文本、任务标识、会话标识和任务状态的结果。
   */
  async send(prompt: string, contextId?: string): Promise<A2AResult> {
    let text = '';
    let taskId = '';
    let resolvedContextId = contextId ?? '';
    let state = TaskState.TASK_STATE_UNSPECIFIED;

    // 仅把可见消息或产物作为最终文本，同时持续更新任务和会话标识。
    for await (const event of this.stream(prompt, contextId)) {
      if (event.text && ['message', 'task', 'artifactUpdate'].includes(event.kind)) {
        text = event.text;
      }
      taskId = event.taskId ?? taskId;
      resolvedContextId = event.contextId ?? resolvedContextId;
      state = event.state ?? state;
    }

    if (!taskId || !resolvedContextId) {
      throw new Error('A2A server returned no task or context identifier');
    }
    return { text, taskId, contextId: resolvedContextId, state };
  }
}

/**
 * 将官方 A2A SDK 的 StreamResponse 归一化为应用层 ClientEvent。
 *
 * @param response - 官方 SDK 返回的单个流式响应。
 * @returns 可消费的客户端事件；空 payload 时返回 undefined。
 */
function normalizeStreamResponse(response: StreamResponse): ClientEvent | undefined {
  const payload = response.payload;
  if (!payload) return undefined;

  // 不同 payload 分支对应 A2A 的消息、任务、状态与产物生命周期事件。
  switch (payload.$case) {
    // message 表示 Agent 在流中直接返回的一条消息，通常用于承载可展示给用户的文本回复。
    case 'message':
      return {
        kind: 'message',
        text: extractMessageText(payload.value),
        ...(payload.value.taskId ? { taskId: payload.value.taskId } : {}),
        ...(payload.value.contextId ? { contextId: payload.value.contextId } : {}),
      };
    // task 表示当前任务的完整快照，包含任务标识、会话标识、当前状态以及已生成的 artifacts。
    case 'task': {
      const artifactText = payload.value.artifacts
        .map((artifact) => extractPartsText(artifact.parts))
        .filter(Boolean)
        .join('\n');
      return {
        kind: 'task',
        text: artifactText,
        taskId: payload.value.id,
        contextId: payload.value.contextId,
        state: payload.value.status?.state ?? TaskState.TASK_STATE_UNSPECIFIED,
      };
    }
    // statusUpdate 表示任务状态的增量更新，例如 working、completed、failed 以及可选状态消息。
    case 'statusUpdate':
      return {
        kind: 'statusUpdate',
        text: payload.value.status?.message ? extractMessageText(payload.value.status.message) : '',
        taskId: payload.value.taskId,
        contextId: payload.value.contextId,
        state: payload.value.status?.state ?? TaskState.TASK_STATE_UNSPECIFIED,
      };
    // artifactUpdate 表示任务产物的增量更新，通常用于流式输出新生成的文本、文件或其他 artifact 内容。
    case 'artifactUpdate':
      return {
        kind: 'artifactUpdate',
        text: extractPartsText(payload.value.artifact?.parts ?? []),
        taskId: payload.value.taskId,
        contextId: payload.value.contextId,
      };
  }
}
