import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createAppRouter, InMemoryStore } from "@bolt-ai/core";
import type { Agent, ModelProvider } from "@bolt-ai/core";

function makeProvider(id: string, supports: string[]) {
  return {
    id,
    supports,
    call: vi.fn(async () => ({ output: id }))
  } as unknown as ModelProvider;
}

const agent: Agent = {
  id: "a",
  capabilities: ["text"],
  async run({ call }) {
    return call({ kind: "text", prompt: "hi" });
  },
};

describe("Router provider selection", () => {
  beforeEach(() => {
    vi.stubEnv("BOLT_PROVIDER_ORDER", "");
    vi.stubEnv("BOLT_PRESET", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("respects explicit providerOrder", async () => {
    const a = makeProvider("a", ["text"]);
    const b = makeProvider("b", ["text"]);
    const router = createAppRouter({
      providers: [a, b],
      memory: new InMemoryStore(),
      providerOrder: ["b", "a"],
    });
    router.registerAgents({ a: agent });

    await router.route({ id: "1", agentId: "a", input: "hi" });
    expect(b.call).toHaveBeenCalledTimes(1);
    expect(a.call).toHaveBeenCalledTimes(0);
  });

  it("skips providers that lack required capabilities", async () => {
    const textOnly = makeProvider("text", ["text"]);
    const jsonOnly = makeProvider("json", ["json"]);
    const router = createAppRouter({
      providers: [textOnly, jsonOnly],
      memory: new InMemoryStore(),
      providerOrder: ["text", "json"],
    });
    router.registerAgents({
      b: {
        id: "b",
        capabilities: ["json"],
        async run({ call }) {
          return call({ kind: "json", prompt: "{}" });
        },
      },
    });

    await router.route({ id: "2", agentId: "b", input: "hi" });
    expect(jsonOnly.call).toHaveBeenCalledTimes(1);
    expect(textOnly.call).toHaveBeenCalledTimes(0);
  });

  it("applies preset ordering when set", async () => {
    const groq = makeProvider("groq", ["text"]);
    const openai = makeProvider("openai", ["text"]);
    const router = createAppRouter({
      providers: [groq, openai],
      memory: new InMemoryStore(),
      preset: "strict",
    });
    router.registerAgents({ a: agent });

    await router.route({ id: "3", agentId: "a", input: "hi" });
    expect(openai.call).toHaveBeenCalledTimes(1);
    expect(groq.call).toHaveBeenCalledTimes(0);
  });

  it("auto preset selects strict for sensitive input", async () => {
    const groq = makeProvider("groq:model", ["text"]);
    const openai = makeProvider("openai:model", ["text"]);
    const router = createAppRouter({
      providers: [groq, openai],
      memory: new InMemoryStore(),
      preset: "auto" as any,
    });
    router.registerAgents({ a: agent });

    await router.route({ id: "4", agentId: "a", input: "medical diagnosis for symptoms" });
    expect(openai.call).toHaveBeenCalledTimes(1);
    expect(groq.call).toHaveBeenCalledTimes(0);
  });

  it("respects circuit breaker and skips unhealthy providers", async () => {
    const bad = {
      id: "bad",
      supports: ["text"],
      call: vi.fn(async () => {
        throw new Error("fail");
      }),
    } as unknown as ModelProvider;
    const good = makeProvider("good", ["text"]);

    const router = createAppRouter({
      providers: [bad, good],
      memory: new InMemoryStore(),
      providerOrder: ["bad", "good"],
      circuitBreaker: { failureThreshold: 1, cooldownMs: 1000 },
    } as any);
    router.registerAgents({ a: agent });

    await expect(router.route({ id: "5", agentId: "a", input: "hi" })).rejects.toThrow();
    await router.route({ id: "6", agentId: "a", input: "hi" });
    expect(good.call).toHaveBeenCalledTimes(1);
  });

  it("enforces route budgets", async () => {
    const slow = {
      id: "slow",
      supports: ["text"],
      call: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 10));
        return { output: "ok", tokens: 10 };
      }),
    } as unknown as ModelProvider;
    const router = createAppRouter({
      providers: [slow],
      memory: new InMemoryStore(),
      budget: { maxLatencyMs: 5, maxCostUSD: 1 },
      costEstimator: () => 2,
    } as any);
    router.registerAgents({ a: agent });

    await expect(router.route({ id: "7", agentId: "a", input: "hi" })).rejects.toThrow(/budget/i);
  });

  it("redacts secrets in provider prompt", async () => {
    let seenPrompt = "";
    const provider = {
      id: "redact",
      supports: ["text"],
      call: vi.fn(async (args) => {
        seenPrompt = args.prompt ?? "";
        return { output: "ok" };
      }),
    } as unknown as ModelProvider;
    const router = createAppRouter({
      providers: [provider],
      memory: new InMemoryStore(),
      redaction: { enabled: true },
    } as any);
    router.registerAgents({ a: agent });

    await router.route({ id: "8", agentId: "a", input: "my key is sk-1234567890abcdef" });
    expect(seenPrompt).not.toContain("sk-1234567890abcdef");
  });
});
