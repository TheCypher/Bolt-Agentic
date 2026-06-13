import type {
  ModelProvider,
  ProviderCallArgs,
  ProviderResult,
  ProviderToolCall,
  ProviderToolDefinition,
  ProviderToolResult,
} from "@bolt-ai/core";
import OpenAI from "openai";

declare const process: { env: Record<string, string | undefined> };

type OpenAIClient = {
  chat: {
    completions: {
      create(args: Record<string, unknown>): Promise<unknown>;
    };
  };
};

export interface OpenAIProviderOptions {
  apiKey?: string;
  model?: string;
  temperature?: number;
  client?: OpenAIClient;
}

export function createOpenAIProvider(model?: string): ModelProvider;
export function createOpenAIProvider(opts?: OpenAIProviderOptions): ModelProvider;
export function createOpenAIProvider(opts: OpenAIProviderOptions | string = {}): ModelProvider {
  const options = typeof opts === "string" ? { model: opts } : opts;
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
  if (!apiKey && !options.client) throw new Error("OPENAI_API_KEY is required");
  const model = options.model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const temperature = options.temperature ?? 0.2;
  const client: OpenAIClient = options.client ?? (new OpenAI({ apiKey }) as unknown as OpenAIClient);

  return {
    id: `openai:${model}`,
    supports: ["text", "json"],
    async call(args: ProviderCallArgs): Promise<ProviderResult> {
      const prompt =
        args.prompt ??
        (typeof args.input === "string" ? args.input : JSON.stringify(args.input ?? ""));
      const messages = buildOpenAIMessages(prompt, args.toolResults);
      const tools = toOpenAITools(args.tools);
      const request = buildOpenAIRequest({
        model,
        temperature,
        messages,
        tools,
        kind: args.kind,
      });

      if (args.onToken && args.kind === "text") {
        const stream = await client.chat.completions.create({ ...request, stream: true });
        return collectOpenAIStream(stream, args.onToken);
      }

      const resp = await client.chat.completions.create(request);
      const raw = resp as any;
      const message = raw.choices?.[0]?.message;
      const toolCalls = fromOpenAIToolCalls(message?.tool_calls);
      if (toolCalls.length) {
        return { toolCalls, tokens: raw.usage?.total_tokens };
      }

      const content = message?.content ?? "";
      const output = args.kind === "json" ? safeParseJSON(content) : content;
      return { output, tokens: raw.usage?.total_tokens };
    },
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

export function buildOpenAIMessages(prompt: string, toolResults?: ProviderToolResult[]) {
  const messages: any[] = [{ role: "user", content: prompt }];
  if (!toolResults?.length) return messages;

  messages.push({
    role: "assistant",
    content: null,
    tool_calls: toolResults.map((result) => ({
      id: result.id,
      type: "function",
      function: {
        name: result.toolId,
        arguments: "{}",
      },
    })),
  });

  for (const result of toolResults) {
    messages.push({
      role: "tool",
      tool_call_id: result.id,
      content: stringifyToolOutput(result.output),
    });
  }

  return messages;
}

function buildOpenAIRequest(args: {
  model: string;
  temperature: number;
  messages: unknown[];
  tools?: ReturnType<typeof toOpenAITools>;
  kind: ProviderCallArgs["kind"];
}) {
  return {
    model: args.model,
    temperature: args.temperature,
    messages: args.messages,
    ...(args.tools?.length ? { tools: args.tools, tool_choice: "auto" } : {}),
    ...(args.kind === "json" ? { response_format: { type: "json_object" } } : {}),
  };
}

async function collectOpenAIStream(
  stream: unknown,
  onToken: (delta: string) => void
): Promise<ProviderResult> {
  let full = "";
  const toolCallByIndex = new Map<number, any>();

  for await (const chunk of stream as AsyncIterable<any>) {
    const delta = chunk?.choices?.[0]?.delta ?? {};
    const content = typeof delta.content === "string" ? delta.content : "";
    if (content) {
      full += content;
      onToken(content);
    }

    for (const toolCall of delta.tool_calls ?? []) {
      const index = Number.isInteger(toolCall.index) ? toolCall.index : toolCallByIndex.size;
      const current = toolCallByIndex.get(index) ?? {
        id: undefined,
        type: "function",
        function: { name: "", arguments: "" },
      };
      if (toolCall.id) current.id = toolCall.id;
      if (toolCall.function?.name) current.function.name += toolCall.function.name;
      if (toolCall.function?.arguments) current.function.arguments += toolCall.function.arguments;
      toolCallByIndex.set(index, current);
    }
  }

  const toolCalls = fromOpenAIToolCalls([...toolCallByIndex.values()]);
  if (toolCalls.length) return { toolCalls };
  return { output: full };
}

function safeParseJSON(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    const m = s.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {}
    }
    return { raw: s };
  }
}

function stringifyToolOutput(output: unknown): string {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
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
