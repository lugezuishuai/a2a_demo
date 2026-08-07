import "dotenv/config";

import { z } from "zod";

// 将用户友好的 provider 别名归一化为模型工厂使用的标准名称。
const providerSchema = z
  .enum(["openai", "gpt", "deepseek", "anthropic", "claude"])
  .default("openai")
  .transform((provider) => {
    if (provider === "gpt") return "openai" as const;
    if (provider === "claude") return "anthropic" as const;
    return provider;
  });

// 空字符串在 .env 中表示未配置，因此在 URL 校验前转换为 undefined。
const optionalUrl = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : value),
  z.url().optional(),
);

const environmentSchema = z.object({
  MODEL_PROVIDER: providerSchema,
  MODEL: z.string().min(1).default("gpt-4o-mini"),
  API_KEY: z.string().min(1).optional(),
  BASE_URL: optionalUrl,
  MODEL_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  MAX_TOKENS: z.coerce.number().int().positive().optional(),
  MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  MODEL_MAX_RETRIES: z.coerce.number().int().nonnegative().default(2),
  SYSTEM_PROMPT: z
    .string()
    .min(1)
    .default("You are a helpful assistant exposed through the A2A protocol."),
  CLIENT_SYSTEM_PROMPT: z
    .string()
    .min(1)
    .default(
      "You are a client-side routing agent. Decide from the user's intent whether to delegate to the remote Server Agent. Delegate substantive informational or actionable requests. Handle only greetings and clarification requests locally. After delegation, return a concise answer grounded in the Server Agent result.",
    ),
  SERVER_HOST: z.string().min(1).default("127.0.0.1"),
  SERVER_PORT: z.coerce.number().int().min(0).max(65_535).default(10_000),
  A2A_PUBLIC_URL: optionalUrl,
  A2A_SERVER_URL: z.url().default("http://127.0.0.1:10000"),
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
  OPENAI_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  DEEPSEEK_API_KEY: z.string().min(1).optional(),
});

export type ModelProvider = "openai" | "deepseek" | "anthropic";

export interface AppConfig {
  modelProvider: ModelProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature: number;
  maxTokens?: number;
  timeoutMs: number;
  maxRetries: number;
  systemPrompt: string;
  clientSystemPrompt: string;
  serverHost: string;
  serverPort: number;
  publicUrl: string;
  serverUrl: string;
  logLevel: "error" | "warn" | "info" | "debug";
}

export interface LoadConfigOptions {
  requireApiKey?: boolean;
}

/**
 * 读取、校验并标准化应用运行配置。
 *
 * @param environment - 要解析的环境变量，默认使用当前进程环境变量。
 * @param options - 控制是否必须提供模型 API Key 的加载选项。
 * @returns 供 Client、Server 与模型工厂使用的标准化应用配置。
 */
export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
  options: LoadConfigOptions = {},
): AppConfig {
  // 先利用 Zod 处理默认值、类型转换与合法性校验。
  const parsed = environmentSchema.parse(environment);
  const apiKey = resolveApiKey(parsed);

  if (options.requireApiKey !== false && !apiKey) {
    throw new Error(
      "API_KEY is required (provider-specific OPENAI_API_KEY, DEEPSEEK_API_KEY, or ANTHROPIC_API_KEY is also accepted)",
    );
  }

  // 对外地址允许覆盖监听地址，适配反向代理或容器部署场景。
  const publicUrl = (
    parsed.A2A_PUBLIC_URL ?? `http://${parsed.SERVER_HOST}:${parsed.SERVER_PORT}`
  ).replace(/\/$/, "");

  return {
    modelProvider: parsed.MODEL_PROVIDER,
    model: parsed.MODEL,
    ...(apiKey ? { apiKey } : {}),
    ...(parsed.BASE_URL ? { baseUrl: parsed.BASE_URL } : {}),
    temperature: parsed.MODEL_TEMPERATURE,
    ...(parsed.MAX_TOKENS ? { maxTokens: parsed.MAX_TOKENS } : {}),
    timeoutMs: parsed.MODEL_TIMEOUT_MS,
    maxRetries: parsed.MODEL_MAX_RETRIES,
    systemPrompt: parsed.SYSTEM_PROMPT,
    clientSystemPrompt: parsed.CLIENT_SYSTEM_PROMPT,
    serverHost: parsed.SERVER_HOST,
    serverPort: parsed.SERVER_PORT,
    publicUrl,
    serverUrl: parsed.A2A_SERVER_URL.replace(/\/$/, ""),
    logLevel: parsed.LOG_LEVEL,
  };
}

/**
 * 按通用 Key 优先、Provider 专属 Key 兜底的规则选择模型 API Key。
 *
 * @param environment - 已通过 Zod 校验的原始环境变量。
 * @returns 当前模型 Provider 对应的 API Key；未配置时返回 undefined。
 */
function resolveApiKey(environment: z.infer<typeof environmentSchema>): string | undefined {
  if (environment.API_KEY) return environment.API_KEY;
  if (environment.MODEL_PROVIDER === "anthropic") return environment.ANTHROPIC_API_KEY;
  if (environment.MODEL_PROVIDER === "deepseek") return environment.DEEPSEEK_API_KEY;
  return environment.OPENAI_API_KEY;
}
