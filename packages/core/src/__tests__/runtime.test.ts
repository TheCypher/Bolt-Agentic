import { describe, expect, it, vi } from "vitest";
import { createRuntime, InMemoryStore } from "@bolt-ai/core";
import type { Agent, ModelProvider, Tool } from "@bolt-ai/core";

function provider(output = "ok") {
  return {
    id: "test",
    supports: ["text", "json"],
    call: vi.fn(async () => ({ output })),
  } as unknown as ModelProvider;
}

function echoAgent(id = "echo"): Agent {
  return {
    id,
    capabilities: ["text"],
    async run({ input, call }) {
      return call({ kind: "text", prompt: String(input) });
    },
  };
}

describe("BoltRuntime", () => {
  it("runs registered agents and returns a structured result", async () => {
    const model = provider("hello");
    const runtime = createRuntime({
      providers: [model],
      memory: new InMemoryStore(),
      agents: [echoAgent()],
    });

    const result = await runtime.run("echo", "hi");

    expect(result.ok).toBe(true);
    expect(result.agentId).toBe("echo");
    expect(result.output).toBe("hello");
    expect(result.error).toBeUndefined();
    expect(model.call).toHaveBeenCalledWith(expect.objectContaining({ prompt: "hi" }));
  });

  it("supports route-style requests", async () => {
    const runtime = createRuntime({
      providers: [provider("routed")],
      memory: new InMemoryStore(),
      agents: { echo: echoAgent() },
    });

    await expect(runtime.route({ agentId: "echo", input: "hi", id: "route-1" })).resolves.toMatchObject({
      ok: true,
      id: "route-1",
      output: "routed",
    });
  });

  it("runs multiple agent calls in parallel", async () => {
    const runtime = createRuntime({
      providers: [provider("done")],
      memory: new InMemoryStore(),
      agents: [echoAgent("a"), echoAgent("b")],
    });

    const results = await runtime.runParallel([
      { agentId: "a", input: "one" },
      { agentId: "b", input: "two" },
    ]);

    expect(results).toHaveLength(2);
    expect(results.map((result) => result.agentId)).toEqual(["a", "b"]);
    expect(results.every((result) => result.ok)).toBe(true);
  });

  it("captures runtime failures in the result when throwOnError is false", async () => {
    const runtime = createRuntime({
      providers: [provider()],
      memory: new InMemoryStore(),
    });

    const result = await runtime.run("missing", "hi", { throwOnError: false });

    expect(result.ok).toBe(false);
    expect(result.agentId).toBe("missing");
    expect(result.error?.code).toBe("AGENT_NOT_FOUND");
  });

  it("passes allowed registered tools into agent execution with runtime context", async () => {
    const memory = new InMemoryStore();
    const toolRun = vi.fn(async (_args, ctx) => {
      await ctx.memory?.set("tool:seen", { ok: true });
      return { memory: Boolean(ctx.memory), aborted: Boolean(ctx.signal?.aborted) };
    });
    const tool: Tool<{ value: string }, { memory: boolean; aborted: boolean }> = {
      id: "allowed.echo",
      run: toolRun,
    };
    const agent: Agent = {
      id: "tool-agent",
      capabilities: ["text"],
      tools: ["allowed.echo"],
      async run(ctx) {
        const selected = ctx.tools.get("allowed.echo");
        if (!selected) throw new Error("expected allowed tool");
        return selected.run({ value: String(ctx.input) }, { signal: AbortSignal.abort() });
      },
    };
    const runtime = createRuntime({
      providers: [provider()],
      memory,
      agents: [agent],
      tools: [tool],
    });

    const result = await runtime.run("tool-agent", "hi");

    expect(result).toMatchObject({
      ok: true,
      output: { memory: true, aborted: true },
    });
    expect(toolRun).toHaveBeenCalledWith(
      { value: "hi" },
      expect.objectContaining({
        memory: expect.objectContaining({
          get: expect.any(Function),
          set: expect.any(Function),
        }),
        signal: expect.any(AbortSignal),
      })
    );
    await expect(memory.get("tool:seen")).resolves.toEqual({ ok: true });
  });

  it("hides registered tools that are not in the agent allowlist", async () => {
    const agent: Agent = {
      id: "limited-agent",
      capabilities: ["text"],
      tools: ["allowed.echo"],
      async run(ctx) {
        return {
          allowed: Boolean(ctx.tools.get("allowed.echo")),
          blocked: ctx.tools.get("blocked.echo"),
          listed: ctx.tools.list().map((tool) => tool.id),
        };
      },
    };
    const runtime = createRuntime({
      providers: [provider()],
      memory: new InMemoryStore(),
      agents: [agent],
      tools: [
        { id: "allowed.echo", async run() { return "allowed"; } },
        { id: "blocked.echo", async run() { return "blocked"; } },
      ],
    });

    const result = await runtime.run("limited-agent", "hi");

    expect(result).toMatchObject({
      ok: true,
      output: {
        allowed: true,
        blocked: undefined,
        listed: ["allowed.echo"],
      },
    });
  });

  it("explains runtime routing, providers, memory, and registered tools", async () => {
    const runtime = createRuntime({
      providers: [provider()],
      memory: new InMemoryStore(),
      agents: [echoAgent()],
      tools: [{ id: "search", async run() { return "ok"; } }],
    });

    await expect(runtime.explain({ agentId: "echo", input: "hi" })).resolves.toMatchObject({
      ok: true,
      reason: "ready",
      agentId: "echo",
      agents: ["echo"],
      providers: ["test"],
      provider: "test",
      memory: "InMemoryStore",
      tools: ["search"],
    });
  });
});
