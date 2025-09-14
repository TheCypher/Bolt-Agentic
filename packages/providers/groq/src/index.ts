import type { ModelProvider, ProviderCallArgs, ProviderResult } from "@bolt-ai/core";
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

      // Streaming path
      if (args.onToken && args.kind === "text") {
        const stream = await client.chat.completions.create({
          model,
          temperature,
          stream: true,
          messages: [{ role: "user", content: prompt }]
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
        messages: [{ role: "user", content: prompt }],
        ...(args.kind === "json" ? { response_format: { type: "json_object" } } : {})
      });

      const content = resp.choices?.[0]?.message?.content ?? "";
      const output = args.kind === "json" ? safeParseJSON(content) : content;
      return { output, tokens: resp.usage?.total_tokens };
    }
  };
}

function safeParseJSON(s: string) {
  try { return JSON.parse(s); } catch {
    const m = s.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    return { raw: s };
  }
}
