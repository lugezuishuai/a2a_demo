import { FakeListChatModel } from "@langchain/core/utils/testing";
import { expect, it } from "vitest";

import { ServerAgent } from "../src/server-agent.js";

it("runs a LangChain model inside LangGraph", async () => {
  const agent = new ServerAgent(new FakeListChatModel({ responses: ["hello from LangGraph"] }), "Be useful.");
  await expect(agent.respond("hello", "context-1")).resolves.toBe("hello from LangGraph");
});

it("streams a LangChain model response inside LangGraph", async () => {
  const agent = new ServerAgent(new FakeListChatModel({ responses: ["hello stream"] }), "Be useful.");
  const chunks: string[] = [];

  for await (const chunk of agent.stream("hello", "context-2")) {
    chunks.push(chunk);
  }

  expect(chunks.join("")).toBe("hello stream");
});
