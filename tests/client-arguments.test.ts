import { describe, expect, it } from "vitest";

import { parseClientArguments, readClientArguments } from "../src/client-arguments.js";

describe("readClientArguments", () => {
  it("reads standard Node script arguments", () => {
    expect(readClientArguments(["node", "/repo/src/client-entry.ts", "hello"])).toEqual(["hello"]);
  });

  it("reads async client script arguments", () => {
    expect(readClientArguments(["node", "/repo/src/client-async-entry.ts", "hello"])).toEqual(["hello"]);
  });

  it("reads arguments when the TypeScript runner omits the entry path", () => {
    expect(readClientArguments(["node", "hello"])).toEqual(["hello"]);
  });
});

describe("parseClientArguments", () => {
  it("keeps the first prompt argument when --url is absent", () => {
    expect(parseClientArguments(["hello", "world"], "http://default.test")).toEqual({
      serverUrl: "http://default.test",
      initialPrompt: "hello world",
    });
  });

  it("extracts --url without including it in the prompt", () => {
    expect(parseClientArguments(["--url", "http://custom.test", "hello"], "http://default.test")).toEqual({
      serverUrl: "http://custom.test",
      initialPrompt: "hello",
    });
  });
});
