import { describe, expect, it } from "vitest";
import { buildGroqMessages, fromOpenAIToolCalls, toOpenAITools } from "../index";

describe("Groq provider tool mapping", () => {
  it("maps Bolt tool definitions to OpenAI-compatible function tools", () => {
    expect(toOpenAITools([
      {
        id: "local.kb.lookup",
        description: "Lookup local knowledge",
        schema: {
          type: "object",
          required: ["topic"],
          properties: { topic: { type: "string" } },
        },
      },
    ])).toEqual([
      {
        type: "function",
        function: {
          name: "local.kb.lookup",
          description: "Lookup local knowledge",
          parameters: {
            type: "object",
            required: ["topic"],
            properties: { topic: { type: "string" } },
          },
        },
      },
    ]);
  });

  it("maps OpenAI-compatible tool calls to Bolt tool calls", () => {
    expect(fromOpenAIToolCalls([
      {
        id: "call_1",
        function: {
          name: "local.kb.lookup",
          arguments: "{\"topic\":\"shipping\"}",
        },
      },
    ])).toEqual([
      {
        id: "call_1",
        toolId: "local.kb.lookup",
        args: { topic: "shipping" },
      },
    ]);
  });

  it("adds tool results as follow-up user context", () => {
    expect(buildGroqMessages("Answer", [
      { id: "call_1", toolId: "local.kb.lookup", output: { summary: "Found" } },
    ])).toEqual([
      { role: "user", content: "Answer" },
      {
        role: "user",
        content: "Tool results:\n[{\"id\":\"call_1\",\"toolId\":\"local.kb.lookup\",\"output\":{\"summary\":\"Found\"}}]",
      },
    ]);
  });
});
