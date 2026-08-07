import { loadConfig } from "./config.js";

// Doctor 只诊断配置，因此允许 API Key 尚未填写。
const config = loadConfig(process.env, { requireApiKey: false });

// 输出经过脱敏的关键配置，避免在诊断日志中泄露 API Key。
console.log(`provider: ${config.modelProvider}`);
console.log(`model: ${config.model}`);
console.log(`api key configured: ${Boolean(config.apiKey)}`);
console.log(`model base URL: ${config.baseUrl ?? "(provider default)"}`);
console.log(`max output tokens: ${config.maxTokens ?? "(provider default)"}`);
console.log(`server bind: ${config.serverHost}:${config.serverPort}`);
console.log(`advertised A2A URL: ${config.publicUrl}`);
console.log(`client target: ${config.serverUrl}`);
