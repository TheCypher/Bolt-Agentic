import type {
  ModelProvider,
  ProviderCallArgs,
  ProviderResult,
  ProviderToolCall,
  ProviderToolDefinition,
  ProviderToolResult,
} from "@bolt-ai/core";
import { GoogleGenAI } from "@google/genai";

declare const process: { env: Record<string, string | undefined> };

type GeminiClient = {
  models: {
    generateContent(args: Record<string, unknown>): Promise<unknown>;
    generateContentStream?(args: Record<string, unknown>): Promise<unknown>;
  };
};

export interface GeminiProviderOptions {
  apiKey?: string;
  model?: string;
  temperature?: number;
  client?: GeminiClient;
}

export function createGeminiProvider(model?: string): ModelProvider;
export function createGeminiProvider(opts?: GeminiProviderOptions): ModelProvider;
export function createGeminiProvider(opts: GeminiProviderOptions | string = {}): ModelProvider {
  const options = typeof opts === "string" ? { model: opts } : opts;
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "";
  if (!apiKey && !options.client) throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY is required");
  const model = options.model ?? process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const temperature = options.temperature ?? 0.2;
  const client: GeminiClient =
    options.client ?? (new GoogleGenAI({ apiKey }) as unknown as GeminiClient);

  return {
    id: `gemini:${model}`,
    supports: ["text", "json"],
    async call(args: ProviderCallArgs): Promise<ProviderResult> {
      const prompt =
        args.prompt ??
        (typeof args.input === "string" ? args.input : JSON.stringify(args.input ?? ""));
      const contents = buildGeminiContents(prompt, args.toolResults);
      const request = buildGeminiRequest({
        model,
        temperature,
        contents,
        tools: args.tools,
        kind: args.kind,
        schema: args.schema,
      });

      if (args.onToken && args.kind === "text" && client.models.generateContentStream) {
        const stream = await client.models.generateContentStream(request);
        return collectGeminiStream(stream, args.onToken, args.tools);
      }

      const resp = await client.models.generateContent(request);
      const raw = resp as any;
      const toolCalls = fromGeminiFunctionCalls(extractGeminiFunctionCalls(raw), args.tools);
      if (toolCalls.length) {
        return { toolCalls, tokens: raw.usageMetadata?.totalTokenCount };
      }

      const content = extractGeminiText(raw);
      const output = args.kind === "json" ? safeParseJSON(content) : content;
      return { output, tokens: raw.usageMetadata?.totalTokenCount };
    },
  };
}

export function toGeminiFunctionName(toolId: string): string {
  const normalized = toolId.replace(/[^A-Za-z0-9_]/g, "_");
  if (/^[A-Za-z_]/.test(normalized)) return normalized.slice(0, 64);
  return `tool_${normalized}`.slice(0, 64);
}

export function toGeminiTools(tools?: ProviderToolDefinition[]) {
  if (!tools?.length) return undefined;
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: toGeminiFunctionName(tool.id),
        description: tool.description ?? tool.id,
        parametersJsonSchema: tool.schema ?? { type: "object", properties: {} },
      })),
    },
  ];
}

export function fromGeminiFunctionCalls(
  functionCalls: unknown,
  tools?: ProviderToolDefinition[]
): ProviderToolCall[] {
  if (!Array.isArray(functionCalls)) return [];
  const providerNameToToolId = new Map(
    (tools ?? []).map((tool) => [toGeminiFunctionName(tool.id), tool.id])
  );

  return functionCalls
    .map((functionCall): ProviderToolCall | null => {
      const raw = functionCall as any;
      const name = String(raw?.name ?? "").trim();
      if (!name) return null;
      return {
        id: raw.id ? String(raw.id) : undefined,
        toolId: providerNameToToolId.get(name) ?? name,
        args: raw.args ?? {},
      };
    })
    .filter((toolCall): toolCall is ProviderToolCall => Boolean(toolCall));
}

export function buildGeminiContents(prompt: string, toolResults?: ProviderToolResult[]) {
  const contents: any[] = [{ role: "user", parts: [{ text: prompt }] }];
  if (!toolResults?.length) return contents;

  contents.push({
    role: "user",
    parts: toolResults.map((result) => ({
      functionResponse: {
        id: result.id,
        name: toGeminiFunctionName(result.toolId),
        response: normalizeGeminiFunctionResponse(result.output),
      },
    })),
  });

  return contents;
}

function buildGeminiRequest(args: {
  model: string;
  temperature: number;
  contents: unknown[];
  tools?: ProviderToolDefinition[];
  kind: ProviderCallArgs["kind"];
  schema?: unknown;
}) {
  const tools = toGeminiTools(args.tools);
  const config = {
    temperature: args.temperature,
    ...(args.kind === "json" ? { responseMimeType: "application/json" } : {}),
    ...(args.kind === "json" && args.schema ? { responseSchema: args.schema } : {}),
    ...(tools?.length ? { tools, toolConfig: { functionCallingConfig: { mode: "AUTO" } } } : {}),
  };

  return {
    model: args.model,
    contents: args.contents,
    config,
  };
}

async function collectGeminiStream(
  stream: unknown,
  onToken: (delta: string) => void,
  tools?: ProviderToolDefinition[]
): Promise<ProviderResult> {
  let full = "";
  const functionCalls: unknown[] = [];

  for await (const chunk of stream as AsyncIterable<any>) {
    const text = extractGeminiText(chunk);
    if (text) {
      full += text;
      onToken(text);
    }
    functionCalls.push(...extractGeminiFunctionCalls(chunk));
  }

  const toolCalls = fromGeminiFunctionCalls(functionCalls, tools);
  if (toolCalls.length) return { toolCalls };
  return { output: full };
}

function extractGeminiText(response: any): string {
  if (typeof response?.text === "string") return response.text;
  if (typeof response?.text === "function") return response.text();
  const parts = response?.candidates?.[0]?.content?.parts ?? response?.content?.parts ?? [];
  return parts
    .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
    .join("");
}

function extractGeminiFunctionCalls(response: any): unknown[] {
  if (Array.isArray(response?.functionCalls)) return response.functionCalls;
  const parts = response?.candidates?.[0]?.content?.parts ?? response?.content?.parts ?? [];
  return parts.map((part: any) => part?.functionCall).filter(Boolean);
}

function normalizeGeminiFunctionResponse(output: unknown) {
  if (output && typeof output === "object" && !Array.isArray(output)) return output;
  return { result: output };
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
