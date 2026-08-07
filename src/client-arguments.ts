import { basename } from "node:path";

export interface ClientArguments {
  serverUrl: string;
  initialPrompt: string;
}

/**
 * 兼容 Node 与 TypeScript 运行器的 argv 结构，提取传给 Client CLI 的参数。
 *
 * @param argv - 原始命令行参数，默认使用当前进程参数。
 * @returns 不含 Node 可执行文件和可能的入口文件路径的业务参数。
 */
export function readClientArguments(argv: readonly string[] = process.argv): string[] {
  const possibleEntryPath = argv[1];
  const argumentStart = possibleEntryPath && isClientEntryPath(possibleEntryPath) ? 2 : 1;
  return argv.slice(argumentStart);
}

/**
 * 解析 Client CLI 的目标 Server 地址与初始用户请求。
 *
 * @param args - 已清理入口路径后的命令行参数。
 * @param defaultServerUrl - 未传入 --url 时使用的默认 A2A Server 地址。
 * @returns Client 运行所需的 Server 地址和可选初始请求文本。
 */
export function parseClientArguments(
  args: readonly string[],
  defaultServerUrl: string,
): ClientArguments {
  // 将 --url 后的值作为目标地址，其余位置参数组合为用户请求。
  const urlIndex = args.indexOf("--url");
  const configuredServerUrl = urlIndex >= 0 ? args[urlIndex + 1] : defaultServerUrl;
  if (!configuredServerUrl) throw new Error("--url requires a value");

  const promptArgs =
    urlIndex >= 0
      ? args.filter((_value, index) => index !== urlIndex && index !== urlIndex + 1)
      : args;

  return {
    serverUrl: configuredServerUrl,
    initialPrompt: promptArgs.join(" ").trim(),
  };
}

/**
 * 判断 argv 中的值是否为 Client CLI 的入口文件路径。
 *
 * @param value - 待识别的 argv 值。
 * @returns 值是否指向 client-entry.* 文件。
 */
function isClientEntryPath(value: string): boolean {
  return basename(value).startsWith("client-entry.");
}
