import { TaskState } from "@a2a-js/sdk";
import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { describe, expect, it, vi } from "vitest";

import { ClientAgent, type ServerAgentClient } from "../src/client-agent.js";

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
    expect(result).toEqual({ text: "response from Server Agent", delegated: true });
  });

  it("answers locally when semantic routing does not request the A2A tool", async () => {
    const model = fakeModel().respond(new AIMessage("Hello! How can I help?"));
    const send = vi.fn<ServerAgentClient["send"]>();
    const agent = new ClientAgent(model, { send }, "Route by user intent.");

    const result = await agent.respond("hello", "client-context-2");

    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({ text: "Hello! How can I help?", delegated: false });
  });

  it("reuses the remote A2A context for the same Client Agent conversation", async () => {
    const model = fakeModel()
      .respondWithTools([
        { name: "delegate_to_server_agent", args: { request: "first" }, id: "call-1" },
      ])
      .respond(new AIMessage("first answer"))
      .respondWithTools([
        { name: "delegate_to_server_agent", args: { request: "follow-up" }, id: "call-2" },
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
});
