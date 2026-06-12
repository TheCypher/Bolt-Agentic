import type {
  ModelProvider,
  ProviderCallArgs,
  ProviderResult,
  ProviderToolCall,
  ProviderToolDefinition,
  ProviderToolResult,
} from "@bolt-ai/core";
import Groq from "groq-sdk";

export function createGroqProvider(opts?: {
  apiKey?: string;
  model?: string;
  temperature?: number;
}): ModelProvider {
  const apiKey = opts?.apiKey ?? process.env.GROQ_API_KEY ?? "";
  if (!apiKey) throw new Error("GROQ_API_KEY is required");
  const model = opts?.model ?? process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
  const temperature = opts?.temperature ?? 0.2;
  const client = new Groq({ apiKey });

  return {
    id: `groq:${model}`,
    supports: ["text", "json"],
    async call(args: ProviderCallArgs): Promise<ProviderResult> {
      const prompt =
        args.prompt ??
        (typeof args.input === "string" ? args.input : JSON.stringify(args.input ?? ""));

      const messages = buildGroqMessages(prompt, args.toolResults);
      const tools = toOpenAITools(args.tools);

      // Streaming path
      if (args.onToken && args.kind === "text") {
        const stream = await client.chat.completions.create({
          model,
          temperature,
          stream: true,
          messages
        });

        let full = "";
        for await (const chunk of stream as any) {
          const delta: string | undefined =
            chunk?.choices?.[0]?.delta?.content ??
            chunk?.choices?.[0]?.message?.content ??
            "";
          if (delta) {
            full += delta;
            args.onToken(delta);
          }
        }
        return { output: full };
      }

      // Non-stream / JSON path
      const resp = await client.chat.completions.create({
        model,
        temperature,
        messages,
        ...(tools?.length ? { tools, tool_choice: "auto" } : {}),
        ...(args.kind === "json" ? { response_format: { type: "json_object" } } : {})
      });

      const message = resp.choices?.[0]?.message as any;
      const toolCalls = fromOpenAIToolCalls(message?.tool_calls);
      if (toolCalls.length) {
        return { toolCalls, tokens: resp.usage?.total_tokens };
      }

      const content = message?.content ?? "";
      const output = args.kind === "json" ? safeParseJSON(content) : content;
      return { output, tokens: resp.usage?.total_tokens };
    }
  };
}

export function toOpenAITools(tools?: ProviderToolDefinition[]) {
  if (!tools?.length) return undefined;
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.id,
      description: tool.description ?? tool.id,
      parameters: tool.schema ?? { type: "object", properties: {} },
    },
  }));
}

export function fromOpenAIToolCalls(toolCalls: unknown): ProviderToolCall[] {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls
    .map((toolCall): ProviderToolCall | null => {
      const raw = toolCall as any;
      const fn = raw?.function ?? {};
      const toolId = String(fn.name ?? raw.toolId ?? "").trim();
      if (!toolId) return null;
      return {
        id: raw.id ? String(raw.id) : undefined,
        toolId,
        args: parseToolArguments(fn.arguments),
      };
    })
    .filter((toolCall): toolCall is ProviderToolCall => Boolean(toolCall));
}

export function buildGroqMessages(prompt: string, toolResults?: ProviderToolResult[]) {
  const messages: Array<{ role: "user"; content: string }> = [{ role: "user", content: prompt }];
  if (toolResults?.length) {
    messages.push({
      role: "user",
      content: `Tool results:\n${JSON.stringify(toolResults)}`,
    });
  }
  return messages;
}

function safeParseJSON(s: string) {
  try { return JSON.parse(s); } catch {
    const m = s.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    return { raw: s };
  }
}

function parseToolArguments(raw: unknown): unknown {
  if (typeof raw !== "string") return raw ?? {};
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}
