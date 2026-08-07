import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";

import type { AppConfig } from "./config.js";

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_RESPONSES_MODELS = new Set(["deepseek-v4-flash"]);

/**
 * 根据应用配置创建与 Provider 对应的 LangChain Chat Model。
 *
 * @param config - 已校验的应用配置，包含模型、鉴权和推理参数。
 * @returns 可供 LangGraph Client Agent 或 Server Agent 调用的聊天模型。
 */
export function createChatModel(config: AppConfig): BaseChatModel {
  if (!config.apiKey) {
    throw new Error("Cannot create a chat model without an API key");
  }

  // 统一汇总所有 Provider 共享的模型生成参数。
  const common = {
    model: config.model,
    temperature: config.temperature,
    maxRetries: config.maxRetries,
    ...(config.maxTokens ? { maxTokens: config.maxTokens } : {}),
  };

  // Anthropic 使用独立的原生适配器与超时配置结构。
  if (config.modelProvider === "anthropic") {
    return new ChatAnthropic({
      ...common,
      apiKey: config.apiKey,
      ...(config.baseUrl ? { anthropicApiUrl: config.baseUrl } : {}),
      clientOptions: { timeout: config.timeoutMs },
    });
  }

  // DeepSeek 默认使用官方 OpenAI 兼容地址，其他 OpenAI Provider 使用可选自定义地址。
  const baseURL =
    config.modelProvider === "deepseek"
      ? (config.baseUrl ?? DEEPSEEK_BASE_URL)
      : config.baseUrl;

  // OpenAI 与 DeepSeek 均使用 ChatOpenAI；仅 V4 Flash 显式走 Responses API。
  return new ChatOpenAI({
    ...common,
    apiKey: config.apiKey,
    timeout: config.timeoutMs,
    ...(baseURL ? { configuration: { baseURL } } : {}),
    ...(config.modelProvider === "deepseek"
      ? { useResponsesApi: DEEPSEEK_RESPONSES_MODELS.has(config.model) }
      : {}),
  });
}
