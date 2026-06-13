import { describe, expect, it, vi } from "vitest";
import {
  buildOpenAIMessages,
  createOpenAIProvider,
  fromOpenAIToolCalls,
  toOpenAITools,
} from "../index";

function createClient(response: unknown) {
  const create = vi.fn().mockResolvedValue(response);
  return {
    chat: {
      completions: {
        create,
      },
    },
  };
}

async function* chunks(values: unknown[]) {
  for (const value of values) yield value;
}

describe("OpenAI provider tool mapping", () => {
  it("maps Bolt tool definitions to OpenAI function tools", () => {
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

  it("maps OpenAI tool calls to Bolt tool calls", () => {
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

  it("adds tool results using native assistant and tool messages", () => {
    expect(buildOpenAIMessages("Answer", [
      { id: "call_1", toolId: "local.kb.lookup", output: { summary: "Found" } },
    ])).toEqual([
      { role: "user", content: "Answer" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "local.kb.lookup", arguments: "{}" },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_1",
        content: "{\"summary\":\"Found\"}",
      },
    ]);
  });
});

describe("OpenAI provider", () => {
  it("returns text from chat completions", async () => {
    const client = createClient({
      choices: [{ message: { content: "Hello" } }],
      usage: { total_tokens: 12 },
    });
    const provider = createOpenAIProvider({ client, apiKey: "test", model: "gpt-test" });

    await expect(provider.call({ kind: "text", prompt: "Say hi" })).resolves.toEqual({
      output: "Hello",
      tokens: 12,
    });
    expect(client.chat.completions.create).toHaveBeenCalledWith({
      model: "gpt-test",
      temperature: 0.2,
      messages: [{ role: "user", content: "Say hi" }],
    });
  });

  it("requests JSON mode and parses JSON output", async () => {
    const client = createClient({
      choices: [{ message: { content: "{\"ok\":true}" } }],
      usage: { total_tokens: 8 },
    });
    const provider = createOpenAIProvider({ client, apiKey: "test", model: "gpt-test" });

    await expect(provider.call({ kind: "json", prompt: "Return JSON" })).resolves.toEqual({
      output: { ok: true },
      tokens: 8,
    });
    expect(client.chat.completions.create).toHaveBeenCalledWith({
      model: "gpt-test",
      temperature: 0.2,
      messages: [{ role: "user", content: "Return JSON" }],
      response_format: { type: "json_object" },
    });
  });

  it("passes tools and returns provider tool calls", async () => {
    const client = createClient({
      choices: [
        {
          message: {
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "local.kb.lookup",
                  arguments: "{\"topic\":\"shipping\"}",
                },
              },
            ],
          },
        },
      ],
      usage: { total_tokens: 15 },
    });
    const provider = createOpenAIProvider({ client, apiKey: "test", model: "gpt-test" });

    await expect(provider.call({
      kind: "text",
      prompt: "Use tool",
      tools: [{ id: "local.kb.lookup", schema: { type: "object" } }],
    })).resolves.toEqual({
      toolCalls: [{ id: "call_1", toolId: "local.kb.lookup", args: { topic: "shipping" } }],
      tokens: 15,
    });
    expect(client.chat.completions.create).toHaveBeenCalledWith({
      model: "gpt-test",
      temperature: 0.2,
      messages: [{ role: "user", content: "Use tool" }],
      tools: [
        {
          type: "function",
          function: {
            name: "local.kb.lookup",
            description: "local.kb.lookup",
            parameters: { type: "object" },
          },
        },
      ],
      tool_choice: "auto",
    });
  });

  it("streams token deltas and returns the streamed text", async () => {
    const stream = chunks([
      { choices: [{ delta: { content: "Hel" } }] },
      { choices: [{ delta: { content: "lo" } }] },
    ]);
    const create = vi.fn().mockResolvedValue(stream);
    const client = { chat: { completions: { create } } };
    const provider = createOpenAIProvider({ client, apiKey: "test", model: "gpt-test" });
    const deltas: string[] = [];

    await expect(provider.call({
      kind: "text",
      prompt: "Say hi",
      onToken: (delta) => deltas.push(delta),
    })).resolves.toEqual({ output: "Hello" });
    expect(deltas).toEqual(["Hel", "lo"]);
    expect(create).toHaveBeenCalledWith({
      model: "gpt-test",
      temperature: 0.2,
      stream: true,
      messages: [{ role: "user", content: "Say hi" }],
    });
  });
});
