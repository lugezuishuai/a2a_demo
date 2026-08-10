import { TaskState } from "@a2a-js/sdk";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { describe, expect, it, vi } from "vitest";

import {
  ClientAgent,
  createClientAgentGraph,
  enableLangSmithTracing,
  type ServerAgentClient,
} from "../src/client-agent.js";

const completedResult = {
  text: "response from Server Agent",
  taskId: "task-1",
  contextId: "server-context-1",
  state: TaskState.TASK_STATE_COMPLETED,
};

describe("ClientAgent", () => {
  it("delegates a substantive request to the Server Agent through A2A", async () => {
    const model = fakeModel()
      .respondWithTools([
        {
          name: "delegate_to_server_agent",
          args: { request: "Analyze the A2A architecture" },
          id: "call-1",
        },
      ])
      .respond(new AIMessage("response from Server Agent"));
    const send = vi.fn<ServerAgentClient["send"]>().mockResolvedValue(completedResult);
    const agent = new ClientAgent(model, { send }, "Route by user intent.");

    const result = await agent.respond("Please analyze this architecture", "client-context-1");

    expect(send).toHaveBeenCalledWith("Analyze the A2A architecture", undefined);
    expect(result).toEqual({
      text: "response from Server Agent",
      delegated: true,
    });
  });

  it("answers locally when semantic routing does not request the A2A tool", async () => {
    const model = fakeModel().respond(new AIMessage("Hello! How can I help?"));
    const send = vi.fn<ServerAgentClient["send"]>();
    const agent = new ClientAgent(model, { send }, "Route by user intent.");

    const result = await agent.respond("hello", "client-context-2");

    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({
      text: "Hello! How can I help?",
      delegated: false,
    });
  });

  it("streams a local Client Agent answer", async () => {
    const model = fakeModel().respond(new AIMessage("streamed local answer"));
    const send = vi.fn<ServerAgentClient["send"]>();
    const agent = new ClientAgent(model, { send }, "Route by user intent.");
    const chunks: string[] = [];

    for await (const chunk of agent.stream("hello", "client-context-stream")) {
      chunks.push(chunk);
    }

    expect(chunks.join("")).toBe("streamed local answer");
    expect(send).not.toHaveBeenCalled();
  });

  it("reuses the remote A2A context for the same Client Agent conversation", async () => {
    const model = fakeModel()
      .respondWithTools([
        {
          name: "delegate_to_server_agent",
          args: { request: "first" },
          id: "call-1",
        },
      ])
      .respond(new AIMessage("first answer"))
      .respondWithTools([
        {
          name: "delegate_to_server_agent",
          args: { request: "follow-up" },
          id: "call-2",
        },
      ])
      .respond(new AIMessage("second answer"));
    const send = vi
      .fn<ServerAgentClient["send"]>()
      .mockResolvedValueOnce(completedResult)
      .mockResolvedValueOnce({ ...completedResult, taskId: "task-2" });
    const agent = new ClientAgent(model, { send }, "Route by user intent.");

    await agent.respond("first", "client-context-3");
    await agent.respond("follow-up", "client-context-3");

    expect(send).toHaveBeenNthCalledWith(2, "follow-up", "server-context-1");
  });

  it("pauses for human approval after delegation and resumes when approved", async () => {
    const model = fakeModel()
      .respondWithTools([
        {
          name: "delegate_to_server_agent",
          args: { request: "Draft a report summary" },
          id: "call-1",
        },
      ])
      .respondWithTools([
        {
          name: "submit_for_approval",
          args: { content: "response from Server Agent" },
          id: "call-2",
        },
      ])
      .respond(new AIMessage("Approved summary."));
    const send = vi.fn<ServerAgentClient["send"]>().mockResolvedValue(completedResult);
    const agent = new ClientAgent(model, { send }, "Route by user intent.");

    const pending = await agent.respond("Summarize the report", "client-context-approval");

    expect(pending.delegated).toBe(true);
    expect(pending.pendingApproval).toEqual({
      threadId: "client-context-approval",
      content: "response from Server Agent",
    });

    const final = await agent.resume("client-context-approval", { approved: true });

    expect(send).toHaveBeenCalledTimes(1);
    expect(final).toEqual({
      text: "Approved summary.",
      delegated: true,
    });
    expect(final.pendingApproval).toBeUndefined();
  });

  it("continues with the rejection feedback when human denies approval", async () => {
    const model = fakeModel()
      .respondWithTools([
        {
          name: "delegate_to_server_agent",
          args: { request: "Draft a report summary" },
          id: "call-1",
        },
      ])
      .respondWithTools([
        {
          name: "submit_for_approval",
          args: { content: "response from Server Agent" },
          id: "call-2",
        },
      ])
      .respond(new AIMessage("I will revise the summary based on the feedback."));
    const send = vi.fn<ServerAgentClient["send"]>().mockResolvedValue(completedResult);
    const agent = new ClientAgent(model, { send }, "Route by user intent.");

    const pending = await agent.respond("Summarize the report", "client-context-reject");
    expect(pending.pendingApproval?.content).toBe("response from Server Agent");

    const final = await agent.resume("client-context-reject", {
      approved: false,
      feedback: "Too short, add details",
    });

    expect(final).toEqual({
      text: "I will revise the summary based on the feedback.",
      delegated: true,
    });
  });

  it("builds a Studio-compatible graph without a local checkpointer", async () => {
    const model = fakeModel().respond(new AIMessage("studio local answer"));
    const send = vi.fn<ServerAgentClient["send"]>();
    const graph = createClientAgentGraph(model, { send }, "Route by user intent.", {
      useLocalMemorySaver: false,
    });

    const result = await graph.invoke({ messages: [new HumanMessage("hello from Studio")] });

    expect(result.messages.at(-1)?.text).toBe("studio local answer");
    expect(send).not.toHaveBeenCalled();
  });

  it("enables LangSmith tracing from the configured API key", () => {
    const previousTracing = process.env.LANGSMITH_TRACING;
    const previousApiKey = process.env.LANGSMITH_API_KEY;
    const previousProject = process.env.LANGSMITH_PROJECT;
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      const enabled = enableLangSmithTracing({
        apiKey: "test-langsmith-key",
        projectName: "a2a_demo_client",
      });

      expect(enabled).toBe(true);
      expect(process.env.LANGSMITH_TRACING).toBe("true");
      expect(process.env.LANGSMITH_API_KEY).toBe("test-langsmith-key");
      expect(process.env.LANGSMITH_PROJECT).toBe("a2a_demo_client");
    } finally {
      restoreEnvValue("LANGSMITH_TRACING", previousTracing);
      restoreEnvValue("LANGSMITH_API_KEY", previousApiKey);
      restoreEnvValue("LANGSMITH_PROJECT", previousProject);
      log.mockRestore();
    }
  });
});

/**
 * 恢复被测试临时改写的环境变量，避免 LangSmith 配置泄漏到后续用例。
 *
 * @param name - 需要恢复的环境变量名。
 * @param value - 测试前的原始值；undefined 表示原本不存在。
 */
function restoreEnvValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
