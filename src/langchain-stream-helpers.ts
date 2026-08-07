/**
 * 从 LangChain / LangGraph 流式 chunk 中提取可展示文本。
 *
 * LangGraph 的 messages stream 通常返回 `[messageChunk, metadata]`，而底层模型也可能直接返回
 * message chunk。这里集中处理这些结构差异，避免业务层重复判断。
 *
 * @param chunk - LangChain 或 LangGraph 返回的单个流式片段。
 * @returns 当前片段中的文本内容；非文本片段返回空字符串。
 */
export function extractLangChainStreamText(chunk: unknown): string {
  const message = Array.isArray(chunk) ? chunk[0] : chunk;
  if (!message || typeof message !== "object") return "";

  const text = (message as { text?: unknown }).text;
  if (typeof text === "string") return text;

  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;

  return "";
}
