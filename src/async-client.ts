import { StreamResponse, TaskState } from "@a2a-js/sdk";
import express, { type Express, type Request, type Response } from "express";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { once } from "node:events";

import {
  type A2AResult,
  type ClientEvent,
  createJsonRpcClientFactory,
  createSendMessageRequest,
  createUserMessage,
  normalizeStreamResponse,
} from "./client.js";

const PUSH_CALLBACK_PATH = "/a2a/push";
const PUSH_TOKEN_HEADER = "X-A2A-Notification-Token";

export interface A2AAsyncDemoClientOptions {
  callbackUrl?: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export interface A2AAsyncDemoClientRuntime {
  client: A2AAsyncDemoClient;
  callbackUrl: string;
  close(): Promise<void>;
}

interface PendingPushRequest {
  token: string;
  text: string;
  taskId: string;
  contextId: string;
  state: TaskState;
  timeout: NodeJS.Timeout;
  resolve(result: A2AResult): void;
  reject(error: Error): void;
}

/**
 * 启动异步 A2A Client 运行时，包括本地 push webhook 和基于回调事件聚合结果的 Client。
 *
 * @param serverUrl - A2A Server 根地址，用于发现 Agent Card。
 * @param host - 本地 push webhook 监听地址。
 * @param port - 本地 push webhook 监听端口。
 * @param options - 异步回调 URL、超时和可选 fetch 实现。
 * @returns 已启动的异步 Client 运行时。
 */
export async function startA2AAsyncDemoClient(
  serverUrl: string,
  host: string,
  port: number,
  options: A2AAsyncDemoClientOptions,
): Promise<A2AAsyncDemoClientRuntime> {
  const app = express();
  const server = await listen(app, host, port);
  const callbackUrl = options.callbackUrl ?? resolveLocalCallbackUrl(server, host);
  const client = new A2AAsyncDemoClient(serverUrl, { ...options, callbackUrl }, app);

  return {
    client,
    callbackUrl,
    close: () => closeServer(server),
  };
}

/**
 * 使用 A2A push notification 方式发送任务，并通过本地 webhook 等待最终结果。
 */
export class A2AAsyncDemoClient {
  private readonly factory;
  private readonly pendingByToken = new Map<string, PendingPushRequest>();

  constructor(
    private readonly serverUrl: string,
    private readonly options: A2AAsyncDemoClientOptions & {
      callbackUrl: string;
    },
    app: Express,
  ) {
    this.factory = createJsonRpcClientFactory(options.fetchImpl ?? fetch);
    app.post(
      PUSH_CALLBACK_PATH,
      express.json({ type: ["application/json", "application/a2a+json"] }),
      (request, response) => this.handlePush(request, response),
    );
  }

  /**
   * 发送异步 A2A 请求：Client 仅等待首个 Task 创建响应，最终结果由 push webhook 回填。
   *
   * @param prompt - 发送给 Server Agent 的文本请求。
   * @param contextId - 可选远端会话标识，用于延续多轮 A2A 对话。
   * @returns 由 push 事件聚合得到的最终任务结果。
   */
  async send(prompt: string, contextId?: string): Promise<A2AResult> {
    const client = await this.factory.createFromUrl(this.serverUrl);
    const token = randomUUID();
    const pendingResult = this.createPendingRequest(token);
    const request = createSendMessageRequest(createUserMessage(prompt, contextId));
    request.configuration = {
      acceptedOutputModes: ["text/plain", "task-status"],
      taskPushNotificationConfig: {
        tenant: "",
        id: "",
        taskId: "",
        url: this.options.callbackUrl,
        token,
        authentication: undefined,
      },
      historyLength: undefined,
      returnImmediately: true,
    };

    const firstResult = await client.sendMessage(request);
    if ("id" in firstResult) {
      this.updatePendingIdentity(token, firstResult.id, firstResult.contextId);
    } else {
      this.updatePendingIdentity(token, firstResult.taskId, firstResult.contextId);
    }

    return pendingResult;
  }

  /**
   * 接收 Server 推送的 StreamResponse，并按请求 token 聚合成最终 A2AResult。
   *
   * @param request - Server push notification 发送的 HTTP 请求。
   * @param response - webhook 响应对象。
   */
  private handlePush(request: Request, response: Response): void {
    const token = request.get(PUSH_TOKEN_HEADER) ?? "";
    const pending = this.pendingByToken.get(token);
    if (!pending) {
      response.status(404).json({ error: "unknown push token" });
      return;
    }

    const event = normalizeStreamResponse(StreamResponse.fromJSON(request.body));
    if (event) this.applyEvent(pending, event);
    response.status(202).json({ status: "accepted" });
  }

  /**
   * 为一次异步请求创建等待槽位，避免 push 事件早于 sendMessage 首响应到达时丢失。
   *
   * @param token - 当前请求专属 push token。
   * @returns 等待最终任务状态的 Promise。
   */
  private createPendingRequest(token: string): Promise<A2AResult> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingByToken.delete(token);
        reject(new Error(`Timed out waiting for A2A push result after ${this.options.timeoutMs}ms`));
      }, this.options.timeoutMs);
      this.pendingByToken.set(token, {
        token,
        text: "",
        taskId: "",
        contextId: "",
        state: TaskState.TASK_STATE_UNSPECIFIED,
        timeout,
        resolve,
        reject,
      });
    });
  }

  /**
   * 将 sendMessage 首响应中的任务标识补充到等待槽位，便于后续错误排查和最终结果返回。
   *
   * @param token - 当前请求专属 push token。
   * @param taskId - Server 创建或复用的 A2A 任务标识。
   * @param contextId - Server 创建或复用的 A2A 会话标识。
   */
  private updatePendingIdentity(token: string, taskId: string, contextId: string): void {
    const pending = this.pendingByToken.get(token);
    if (!pending) return;
    pending.taskId = taskId || pending.taskId;
    pending.contextId = contextId || pending.contextId;
  }

  /**
   * 将单个 push 事件合并到等待结果中，终态事件到达时完成 Promise。
   *
   * @param pending - 当前请求的等待状态。
   * @param event - 已归一化的 A2A push 事件。
   */
  private applyEvent(pending: PendingPushRequest, event: ClientEvent): void {
    if (event.kind === "artifactUpdate" && event.text) {
      pending.text = event.append ? `${pending.text}${event.text}` : event.text;
    } else if (event.text && ["message", "task"].includes(event.kind)) {
      pending.text = event.text;
    }
    pending.taskId = event.taskId ?? pending.taskId;
    pending.contextId = event.contextId ?? pending.contextId;
    pending.state = event.state ?? pending.state;

    if (!isTerminalState(pending.state)) return;
    clearTimeout(pending.timeout);
    this.pendingByToken.delete(pending.token);
    pending.resolve({
      text: pending.text,
      taskId: pending.taskId,
      contextId: pending.contextId,
      state: pending.state,
    });
  }
}

/**
 * 判断 A2A Task 是否已进入终态；异步 Client 只有终态到达后才结束等待。
 *
 * @param state - 当前任务状态。
 * @returns 是否为不可继续推进的终态。
 */
function isTerminalState(state: TaskState): boolean {
  return [
    TaskState.TASK_STATE_COMPLETED,
    TaskState.TASK_STATE_FAILED,
    TaskState.TASK_STATE_CANCELED,
    TaskState.TASK_STATE_REJECTED,
  ].includes(state);
}

/**
 * Promise 化 Express 监听流程，便于入口文件在 webhook 就绪后再发送 A2A 请求。
 *
 * @param app - 已注册 webhook 路由的 Express 应用。
 * @param host - 监听地址。
 * @param port - 监听端口。
 * @returns 已处于 listening 状态的 HTTP Server。
 */
async function listen(app: Express, host: string, port: number): Promise<Server> {
  const server = app.listen(port, host);
  await once(server, "listening");
  return server;
}

/**
 * 根据实际监听地址生成本地 push callback URL，主要用于端口为 0 的测试场景。
 *
 * @param server - 已启动的 HTTP Server。
 * @param fallbackHost - server.address 无法提供 host 时使用的监听地址。
 * @returns 可注册到 A2A taskPushNotificationConfig 的本地回调地址。
 */
function resolveLocalCallbackUrl(server: Server, fallbackHost: string): string {
  const address = server.address();
  if (!address || typeof address === "string") {
    return `http://${fallbackHost}${PUSH_CALLBACK_PATH}`;
  }
  return `http://${address.address}:${address.port}${PUSH_CALLBACK_PATH}`;
}

/**
 * Promise 化关闭 HTTP Server，避免交互式 Client 退出时残留端口。
 *
 * @param server - 本地 push webhook 使用的 HTTP Server。
 */
async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  server.close();
  await once(server, "close");
}
