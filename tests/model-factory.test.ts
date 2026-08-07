import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config.js";
import { createChatModel } from "../src/model-factory.js";

const baseConfig: AppConfig = {
  modelProvider: "openai",
  model: "test-model",
  apiKey: "test-key",
  temperature: 0,
  timeoutMs: 1_000,
  maxRetries: 0,
  systemPrompt: "test",
  clientSystemPrompt: "route test",
  serverHost: "127.0.0.1",
  serverPort: 10_000,
  publicUrl: "http://127.0.0.1:10000",
  serverUrl: "http://127.0.0.1:10000",
  pushHost: "127.0.0.1",
  pushPort: 10_001,
  pushPublicUrl: "http://127.0.0.1:10001",
  pushTimeoutMs: 120_000,
  logLevel: "error",
};

describe("createChatModel", () => {
  it("uses ChatOpenAI for OpenAI and DeepSeek", () => {
    expect(createChatModel(baseConfig)).toBeInstanceOf(ChatOpenAI);
    expect(
      createChatModel({
        ...baseConfig,
        modelProvider: "deepseek",
        model: "deepseek-chat",
      }),
    ).toBeInstanceOf(ChatOpenAI);
  });

  it("uses Responses API for deepseek-v4-flash and forwards MAX_TOKENS", () => {
    const model = createChatModel({
      ...baseConfig,
      modelProvider: "deepseek",
      model: "deepseek-v4-flash",
      maxTokens: 32_768,
    }) as ChatOpenAI;

    expect(model.useResponsesApi).toBe(true);
    expect(model.maxTokens).toBe(32_768);
  });

  it("keeps other DeepSeek models on Chat Completions", () => {
    const model = createChatModel({
      ...baseConfig,
      modelProvider: "deepseek",
      model: "deepseek-v4-pro",
    }) as ChatOpenAI;

    expect(model.useResponsesApi).toBe(false);
  });

  it("uses ChatAnthropic for Claude", () => {
    const model = createChatModel({
      ...baseConfig,
      modelProvider: "anthropic",
      maxTokens: 8_192,
    }) as ChatAnthropic;

    expect(model).toBeInstanceOf(ChatAnthropic);
    expect(model.maxTokens).toBe(8_192);
  });
});
