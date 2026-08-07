import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it.each([
    ["openai", "openai"],
    ["gpt", "openai"],
    ["deepseek", "deepseek"],
    ["anthropic", "anthropic"],
    ["claude", "anthropic"],
  ])("normalizes %s to %s", (configured, expected) => {
    const config = loadConfig(
      { MODEL_PROVIDER: configured, API_KEY: "test-key" },
      { requireApiKey: true },
    );
    expect(config.modelProvider).toBe(expected);
  });

  it("accepts a provider-specific key", () => {
    const config = loadConfig({ MODEL_PROVIDER: "claude", ANTHROPIC_API_KEY: "secret" });
    expect(config.apiKey).toBe("secret");
  });

  it("parses MAX_TOKENS as a positive integer", () => {
    const config = loadConfig({ API_KEY: "test-key", MAX_TOKENS: "32768" });
    expect(config.maxTokens).toBe(32_768);
  });

  it("rejects an invalid MAX_TOKENS value", () => {
    expect(() => loadConfig({ API_KEY: "test-key", MAX_TOKENS: "0" })).toThrow();
  });

  it("fails with an actionable message when no key is configured", () => {
    expect(() => loadConfig({ MODEL_PROVIDER: "deepseek" })).toThrow(/API_KEY/);
  });
});
