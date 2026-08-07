import {
  A2A_PROTOCOL_VERSION,
  AGENT_CARD_PATH,
  type AgentCard,
} from "@a2a-js/sdk";
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
  type AgentExecutor,
} from "@a2a-js/sdk/server";
import {
  UserBuilder,
  agentCardHandler,
  jsonRpcHandler,
} from "@a2a-js/sdk/server/express";
import express, { type Express } from "express";

import type { AppConfig } from "./config.js";

export interface A2AServerRuntime {
  app: Express;
  agentCard: AgentCard;
  requestHandler: DefaultRequestHandler;
}

/**
 * 根据应用配置生成 A2A AgentCard，向调用方声明当前 Agent 的元信息、能力和技能清单。
 *
 * @param config - 应用运行配置，其中 publicUrl 用于生成对外可访问的 AgentCard 与 JSON-RPC 地址。
 */
export function buildAgentCard(config: AppConfig): AgentCard {
  return {
    // Agent 展示名称，用于客户端或目录服务识别当前助手。
    name: "LangGraph A2A Assistant",
    // Agent 功能描述，说明该服务通过 A2A JSON-RPC 暴露 LangGraph 多模型助手能力。
    description:
      "A multi-provider LangGraph assistant exposed over A2A JSON-RPC.",
    // 支持的 A2A 通信接口列表，客户端会根据这些信息选择可用协议和访问地址。
    supportedInterfaces: [
      {
        // JSON-RPC 服务入口地址，使用 publicUrl 保证对外暴露地址与部署环境一致。
        url: `${config.publicUrl}/`,
        // 协议绑定类型，声明该接口使用 A2A JSON-RPC 交互。
        protocolBinding: "JSONRPC",
        // 租户标识；当前 Demo 不区分租户，因此保持为空字符串。
        tenant: "",
        // A2A 协议版本，复用 SDK 常量以避免与依赖版本不一致。
        protocolVersion: A2A_PROTOCOL_VERSION,
      },
    ],
    // Agent 提供方信息，用于客户端展示来源和关联服务主页。
    provider: {
      // 提供方组织名称，标识该 AgentCard 的发布主体。
      organization: "A2A Demo",
      // 提供方主页或服务根地址，与当前公开访问地址保持一致。
      url: config.publicUrl,
    },
    // AgentCard 版本号，用于客户端判断元数据变更。
    version: "0.1.0",
    // Agent 能力声明，告知客户端当前服务支持的 A2A 可选能力。
    capabilities: {
      // 是否支持流式响应；当前服务支持任务状态与消息的流式输出。
      streaming: true,
      // 是否支持推送通知；异步 Client 会通过 taskPushNotificationConfig 注册回调地址。
      pushNotifications: true,
      // 协议扩展能力列表；当前未启用额外扩展。
      extensions: [],
      // 是否提供扩展版 AgentCard；当前仅返回标准 AgentCard。
      extendedAgentCard: false,
    },
    // 安全方案定义；当前 Demo 使用无认证模式，因此不声明安全方案。
    securitySchemes: {},
    // 全局安全要求；当前 Demo 不要求客户端提供认证信息。
    securityRequirements: [],
    // 默认输入 MIME 类型，声明 Agent 默认接收纯文本输入。
    defaultInputModes: ["text/plain"],
    // 默认输出 MIME 类型，声明 Agent 可返回纯文本和任务状态。
    defaultOutputModes: ["text/plain", "task-status"],
    // Agent 暴露的技能列表，客户端可据此选择可调用的能力。
    skills: [
      {
        // 技能唯一标识，供客户端稳定引用该通用助手能力。
        id: "general_assistant",
        // 技能展示名称，用于 UI 或能力目录展示。
        name: "General assistant",
        // 技能说明，描述该技能基于已配置语言模型回答文本问题。
        description:
          "Answers text questions with the configured language model.",
        // 技能标签，用于能力检索、过滤和分类展示。
        tags: ["assistant", "langgraph", "llm"],
        // 示例请求，帮助客户端或使用者理解该技能的典型调用方式。
        examples: ["Explain the A2A protocol in three sentences."],
        // 技能支持的输入 MIME 类型，当前仅接收纯文本。
        inputModes: ["text/plain"],
        // 技能支持的输出 MIME 类型，当前仅返回纯文本内容。
        outputModes: ["text/plain"],
        // 技能级安全要求；当前技能继承无认证策略，因此为空。
        securityRequirements: [],
      },
    ],
    // 文档地址；当前 Demo 暂未提供额外文档链接。
    documentationUrl: "",
    // AgentCard 签名列表；当前 Demo 未启用签名校验。
    signatures: [],
  };
}

/**
 * 创建 Express 运行时，并注册 A2A Agent Card、JSON-RPC 与健康检查路由。
 *
 * @param config - 应用运行配置，用于生成 Agent Card 和服务地址。
 * @param executor - 负责执行 A2A 任务生命周期的 Agent 执行器。
 * @returns 可供入口文件监听的 Express app、Agent Card 和请求处理器。
 */
export function createA2AServer(
  config: AppConfig,
  executor: AgentExecutor,
): A2AServerRuntime {
  // Agent Card 与请求处理器共用同一份能力声明，保证发现结果和实际执行行为一致。
  const agentCard = buildAgentCard(config);
  const requestHandler = new DefaultRequestHandler(
    agentCard,
    new InMemoryTaskStore(),
    executor,
  );
  const app = express();

  // 健康检查供 VS Code compound 调试和部署探针等待服务就绪。
  app.get("/healthz", (_request, response) => response.json({ status: "ok" }));
  // 依次注册 Agent Card 发现路由和 A2A JSON-RPC 主入口。
  app.use(
    `/${AGENT_CARD_PATH}`,
    agentCardHandler({ agentCardProvider: requestHandler }),
  );
  app.use(
    jsonRpcHandler({
      requestHandler,
      userBuilder: UserBuilder.noAuthentication,
    }),
  );

  return { app, agentCard, requestHandler };
}
