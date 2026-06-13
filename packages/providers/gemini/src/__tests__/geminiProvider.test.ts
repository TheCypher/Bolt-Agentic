import { describe, expect, it, vi } from "vitest";
import {
  buildGeminiContents,
  createGeminiProvider,
  fromGeminiFunctionCalls,
  toGeminiFunctionName,
  toGeminiTools,
} from "../index";

function createClient(response: unknown) {
  const generateContent = vi.fn().mockResolvedValue(response);
  return {
    models: {
      generateContent,
    },
  };
}

async function* chunks(values: unknown[]) {
  for (const value of values) yield value;
}

describe("Gemini provider tool mapping", () => {
  it("maps Bolt tool definitions to Gemini function declarations", () => {
    expect(toGeminiTools([
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
        functionDeclarations: [
          {
            name: "local_kb_lookup",
            description: "Lookup local knowledge",
            parametersJsonSchema: {
              type: "object",
              required: ["topic"],
              properties: { topic: { type: "string" } },
            },
          },
        ],
      },
    ]);
  });

  it("maps Gemini function calls to original Bolt tool IDs", () => {
    expect(fromGeminiFunctionCalls([
      {
        id: "call_1",
        name: "local_kb_lookup",
        args: { topic: "shipping" },
      },
    ], [{ id: "local.kb.lookup" }])).toEqual([
      {
        id: "call_1",
        toolId: "local.kb.lookup",
        args: { topic: "shipping" },
      },
    ]);
  });

  it("builds native function response content for tool results", () => {
    expect(buildGeminiContents("Answer", [
      { id: "call_1", toolId: "local.kb.lookup", output: { summary: "Found" } },
    ])).toEqual([
      { role: "user", parts: [{ text: "Answer" }] },
      {
        role: "user",
        parts: [
          {
            functionResponse: {
              id: "call_1",
              name: "local_kb_lookup",
              response: { summary: "Found" },
            },
          },
        ],
      },
    ]);
  });

  it("creates stable Gemini function names", () => {
    expect(toGeminiFunctionName("9.local-kb.lookup")).toBe("tool_9_local_kb_lookup");
  });
});

describe("Gemini provider", () => {
  it("returns text from generateContent", async () => {
    const client = createClient({
      text: "Hello",
      usageMetadata: { totalTokenCount: 12 },
    });
    const provider = createGeminiProvider({ client, apiKey: "test", model: "gemini-test" });

    await expect(provider.call({ kind: "text", prompt: "Say hi" })).resolves.toEqual({
      output: "Hello",
      tokens: 12,
    });
    expect(client.models.generateContent).toHaveBeenCalledWith({
      model: "gemini-test",
      contents: [{ role: "user", parts: [{ text: "Say hi" }] }],
      config: { temperature: 0.2 },
    });
  });

  it("requests JSON MIME type and parses JSON output", async () => {
    const client = createClient({
      text: "{\"ok\":true}",
      usageMetadata: { totalTokenCount: 8 },
    });
    const provider = createGeminiProvider({ client, apiKey: "test", model: "gemini-test" });

    await expect(provider.call({ kind: "json", prompt: "Return JSON" })).resolves.toEqual({
      output: { ok: true },
      tokens: 8,
    });
    expect(client.models.generateContent).toHaveBeenCalledWith({
      model: "gemini-test",
      contents: [{ role: "user", parts: [{ text: "Return JSON" }] }],
      config: { temperature: 0.2, responseMimeType: "application/json" },
    });
  });

  it("passes function declarations and returns provider function calls", async () => {
    const client = createClient({
      functionCalls: [
        {
          id: "call_1",
          name: "local_kb_lookup",
          args: { topic: "shipping" },
        },
      ],
      usageMetadata: { totalTokenCount: 15 },
    });
    const provider = createGeminiProvider({ client, apiKey: "test", model: "gemini-test" });

    await expect(provider.call({
      kind: "text",
      prompt: "Use tool",
      tools: [{ id: "local.kb.lookup", schema: { type: "object" } }],
    })).resolves.toEqual({
      toolCalls: [{ id: "call_1", toolId: "local.kb.lookup", args: { topic: "shipping" } }],
      tokens: 15,
    });
    expect(client.models.generateContent).toHaveBeenCalledWith({
      model: "gemini-test",
      contents: [{ role: "user", parts: [{ text: "Use tool" }] }],
      config: {
        temperature: 0.2,
        tools: [
          {
            functionDeclarations: [
              {
                name: "local_kb_lookup",
                description: "local.kb.lookup",
                parametersJsonSchema: { type: "object" },
              },
            ],
          },
        ],
        toolConfig: {
          functionCallingConfig: {
            mode: "AUTO",
          },
        },
      },
    });
  });

  it("streams token deltas and returns streamed text", async () => {
    const stream = chunks([{ text: "Hel" }, { text: "lo" }]);
    const generateContentStream = vi.fn().mockResolvedValue(stream);
    const client = {
      models: {
        generateContent: vi.fn(),
        generateContentStream,
      },
    };
    const provider = createGeminiProvider({ client, apiKey: "test", model: "gemini-test" });
    const deltas: string[] = [];

    await expect(provider.call({
      kind: "text",
      prompt: "Say hi",
      onToken: (delta) => deltas.push(delta),
    })).resolves.toEqual({ output: "Hello" });
    expect(deltas).toEqual(["Hel", "lo"]);
    expect(generateContentStream).toHaveBeenCalledWith({
      model: "gemini-test",
      contents: [{ role: "user", parts: [{ text: "Say hi" }] }],
      config: { temperature: 0.2 },
    });
  });
});
