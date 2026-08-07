import { FakeListChatModel } from "@langchain/core/utils/testing";
import { TaskState } from "@a2a-js/sdk";
import type { Server } from "node:http";
import { once } from "node:events";
import { afterEach, expect, it } from "vitest";

import { A2ADemoClient } from "../src/client.js";
import { startA2AAsyncDemoClient, type A2AAsyncDemoClientRuntime } from "../src/async-client.js";
import type { AppConfig } from "../src/config.js";
import { ServerAgent } from "../src/server-agent.js";
import { LangGraphAgentExecutor } from "../src/langgraph-executor.js";
import { createA2AServer } from "../src/server.js";

let server: Server | undefined;
let asyncRuntime: A2AAsyncDemoClientRuntime | undefined;

afterEach(async () => {
  if (asyncRuntime) {
    await asyncRuntime.close();
    asyncRuntime = undefined;
  }
  if (!server) return;
  server.close();
  await once(server, "close");
  server = undefined;
});

it("completes a real A2A discovery and streaming round trip", async () => {
  const config: AppConfig = {
    modelProvider: "openai",
    model: "fake",
    temperature: 0,
    timeoutMs: 1_000,
    maxRetries: 0,
    systemPrompt: "test",
    clientSystemPrompt: "route test",
    serverHost: "127.0.0.1",
    serverPort: 0,
    publicUrl: "http://127.0.0.1:0",
    serverUrl: "http://127.0.0.1:0",
    pushHost: "127.0.0.1",
    pushPort: 0,
    pushPublicUrl: "http://127.0.0.1:0",
    pushTimeoutMs: 1_000,
    logLevel: "error",
  };
  const graphAgent = new ServerAgent(new FakeListChatModel({ responses: ["pong from A2A"] }), "Be useful.");
  const runtime = createA2AServer(config, new LangGraphAgentExecutor(graphAgent));
  server = runtime.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server has no TCP port");
  const serverUrl = `http://127.0.0.1:${address.port}`;
  runtime.agentCard.supportedInterfaces[0]!.url = `${serverUrl}/`;

  const result = await new A2ADemoClient(serverUrl).send("ping");

  expect(result.text).toBe("pong from A2A");
  expect(result.taskId).not.toBe("");
  expect(result.contextId).not.toBe("");
  expect(result.state).toBe(TaskState.TASK_STATE_COMPLETED);
});

it("completes a real A2A push notification round trip", async () => {
  const config: AppConfig = {
    modelProvider: "openai",
    model: "fake",
    temperature: 0,
    timeoutMs: 1_000,
    maxRetries: 0,
    systemPrompt: "test",
    clientSystemPrompt: "route test",
    serverHost: "127.0.0.1",
    serverPort: 0,
    publicUrl: "http://127.0.0.1:0",
    serverUrl: "http://127.0.0.1:0",
    pushHost: "127.0.0.1",
    pushPort: 0,
    pushPublicUrl: "http://127.0.0.1:0",
    pushTimeoutMs: 1_000,
    logLevel: "error",
  };
  const graphAgent = new ServerAgent(new FakeListChatModel({ responses: ["pong from push"] }), "Be useful.");
  const runtime = createA2AServer(config, new LangGraphAgentExecutor(graphAgent));
  server = runtime.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server has no TCP port");
  const serverUrl = `http://127.0.0.1:${address.port}`;
  runtime.agentCard.supportedInterfaces[0]!.url = `${serverUrl}/`;
  asyncRuntime = await startA2AAsyncDemoClient(serverUrl, "127.0.0.1", 0, {
    timeoutMs: 1_000,
  });

  const result = await asyncRuntime.client.send("ping");

  expect(result.text).toBe("pong from push");
  expect(result.taskId).not.toBe("");
  expect(result.contextId).not.toBe("");
  expect(result.state).toBe(TaskState.TASK_STATE_COMPLETED);
});
