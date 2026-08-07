import type { Message, Part } from "@a2a-js/sdk";
import { Role } from "@a2a-js/sdk";
import { randomUUID } from "node:crypto";

/**
 * 将普通文本封装为 A2A 协议使用的 text Part。
 *
 * @param text - 需要传输或返回的纯文本内容。
 * @returns 包含 text/plain 元数据的 A2A Part。
 */
export function textPart(text: string): Part {
  return {
    content: { $case: "text", value: text },
    metadata: undefined,
    filename: "",
    mediaType: "text/plain",
  };
}

/**
 * 根据任务与会话信息创建一个 A2A Agent Message。
 *
 * @param text - Agent 返回给调用方的文本内容。
 * @param taskId - 当前 A2A 任务标识。
 * @param contextId - 当前 A2A 会话上下文标识。
 * @returns 带有唯一 messageId 的 Agent 消息。
 */
export function agentMessage(text: string, taskId: string, contextId: string): Message {
  return {
    messageId: randomUUID(),
    role: Role.ROLE_AGENT,
    parts: [textPart(text)],
    taskId,
    contextId,
    extensions: [],
    metadata: {},
    referenceTaskIds: [],
  };
}

/**
 * 提取 A2A Message 中全部文本 Part，并按换行拼接。
 *
 * @param message - 待解析的 A2A 消息。
 * @returns 消息中的纯文本内容；非文本 Part 会被忽略。
 */
export function extractMessageText(message: Message): string {
  return message.parts
    .filter(part => part.content?.$case === "text")
    .map(part => (part.content?.$case === "text" ? part.content.value : ""))
    .join("\n");
}

/**
 * 提取一组 A2A Part 中的文本内容。
 *
 * @param parts - 待解析的 A2A 内容片段。
 * @returns 按原顺序拼接后的文本内容。
 */
export function extractPartsText(parts: Part[]): string {
  return parts
    .filter(part => part.content?.$case === "text")
    .map(part => (part.content?.$case === "text" ? part.content.value : ""))
    .join("\n");
}
