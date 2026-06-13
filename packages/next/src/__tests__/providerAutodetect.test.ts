import { describe, expect, it } from "vitest";
import { detectProviders } from "../router";

describe("Next provider autodetection", () => {
  it("loads native OpenAI, Gemini, and Groq providers from configured keys", async () => {
    const loaded: string[] = [];
    const providers = await detectProviders(
      {
        OPENAI_API_KEY: "openai-key",
        GEMINI_API_KEY: "gemini-key",
        GROQ_API_KEY: "groq-key",
      },
      async (specifier) => {
        loaded.push(specifier);
        if (specifier === "@bolt-ai/providers-openai") {
          return { createOpenAIProvider: ({ apiKey }: any) => provider(`openai:${apiKey}`) };
        }
        if (specifier === "@bolt-ai/providers-gemini") {
          return { createGeminiProvider: ({ apiKey }: any) => provider(`gemini:${apiKey}`) };
        }
        return { createGroqProvider: ({ apiKey }: any) => provider(`groq:${apiKey}`) };
      }
    );

    expect(loaded).toEqual([
      "@bolt-ai/providers-openai",
      "@bolt-ai/providers-gemini",
      "@bolt-ai/providers-groq",
    ]);
    expect(providers.map((item) => item.id)).toEqual([
      "openai:openai-key",
      "gemini:gemini-key",
      "groq:groq-key",
    ]);
  });

  it("ignores an unavailable optional provider package", async () => {
    const providers = await detectProviders(
      { OPENAI_API_KEY: "openai-key", GROQ_API_KEY: "groq-key" },
      async (specifier) => {
        if (specifier === "@bolt-ai/providers-openai") throw new Error("not installed");
        return { createGroqProvider: ({ apiKey }: any) => provider(`groq:${apiKey}`) };
      }
    );

    expect(providers.map((item) => item.id)).toEqual(["groq:groq-key"]);
  });
});

function provider(id: string) {
  return {
    id,
    supports: ["text"] as const,
    async call() {
      return { output: "ok" };
    },
  };
}
