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

  it("executes allowed provider-native tool calls and sends results into the next provider call", async () => {
    const toolRun = vi.fn(async (args: { value: string }) => ({ echoed: args.value.toUpperCase() }));
    const model = {
      id: "native-tools",
      supports: ["text"],
      call: vi
        .fn()
        .mockResolvedValueOnce({
          toolCalls: [{ id: "call-1", toolId: "allowed.echo", args: { value: "hi" } }],
        })
        .mockResolvedValueOnce({ output: "final output" }),
    } as unknown as ModelProvider;
    const runtime = createRuntime({
      providers: [model],
      memory: new InMemoryStore(),
      agents: [{ ...echoAgent("native-agent"), tools: ["allowed.echo"] }],
      tools: [{ id: "allowed.echo", run: toolRun }],
    });

    const result = await runtime.run("native-agent", "hi");

    expect(result).toMatchObject({ ok: true, output: "final output" });
    expect(toolRun).toHaveBeenCalledWith(
      { value: "hi" },
      expect.objectContaining({ memory: expect.any(Object), allow: ["allowed.echo"] })
    );
    expect(model.call).toHaveBeenCalledTimes(2);
    expect(model.call).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        toolResults: [
          {
            id: "call-1",
            toolId: "allowed.echo",
            output: { echoed: "HI" },
          },
        ],
      })
    );
  });

  it("passes allowed tool definitions into provider calls", async () => {
    let seenTools: unknown;
    const model = {
      id: "tool-defs",
      supports: ["text"],
      call: vi.fn(async (args) => {
        seenTools = args.tools;
        return { output: "ok" };
      }),
    } as unknown as ModelProvider;
    const runtime = createRuntime({
      providers: [model],
      memory: new InMemoryStore(),
      agents: [{ ...echoAgent("tool-def-agent"), tools: ["allowed.echo"] }],
      tools: [
        {
          id: "allowed.echo",
          description: "Echo an allowed value",
          schema: {
            type: "object",
            required: ["value"],
            properties: { value: { type: "string" } },
          },
          async run() { return "ok"; },
        },
        {
          id: "blocked.echo",
          schema: { type: "object" },
          async run() { return "blocked"; },
        },
      ],
    });

    await runtime.run("tool-def-agent", "hi");

    expect(seenTools).toEqual([
      {
        id: "allowed.echo",
        description: "Echo an allowed value",
        schema: {
          type: "object",
          required: ["value"],
          properties: { value: { type: "string" } },
        },
      },
    ]);
  });

  it("forwards provider tokens through runtime run options", async () => {
    const deltas: string[] = [];
    const model = {
      id: "streaming",
      supports: ["text"],
      call: vi.fn(async (args) => {
        args.onToken?.("hel");
        args.onToken?.("lo");
        return { output: "hello" };
      }),
    } as unknown as ModelProvider;
    const runtime = createRuntime({
      providers: [model],
      memory: new InMemoryStore(),
      agents: [echoAgent("streamer")],
    });

    const result = await runtime.run("streamer", "hi", {
      onToken: (delta) => deltas.push(delta),
    });

    expect(deltas).toEqual(["hel", "lo"]);
    expect(result).toMatchObject({
      ok: true,
      output: "hello",
      streamedText: "hello",
    });
  });

  it("rejects provider-native tool calls outside the agent allowlist", async () => {
    const blockedRun = vi.fn(async () => "blocked");
    const model = {
      id: "native-tools",
      supports: ["text"],
      call: vi.fn(async () => ({
        toolCalls: [{ id: "call-1", toolId: "blocked.echo", args: { value: "hi" } }],
      })),
    } as unknown as ModelProvider;
    const runtime = createRuntime({
      providers: [model],
      memory: new InMemoryStore(),
      agents: [{ ...echoAgent("native-agent"), tools: ["allowed.echo"] }],
      tools: [{ id: "blocked.echo", run: blockedRun }],
    });

    const result = await runtime.run("native-agent", "hi", { throwOnError: false });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/Tool not allowed or not found: blocked\.echo/);
    expect(blockedRun).not.toHaveBeenCalled();
  });

  it("stops provider-native tool call loops at the max iteration guard", async () => {
    const toolRun = vi.fn(async () => ({ again: true }));
    const model = {
      id: "native-tools",
      supports: ["text"],
      call: vi.fn(async () => ({
        toolCalls: [{ id: "call-loop", toolId: "allowed.echo", args: { value: "hi" } }],
      })),
    } as unknown as ModelProvider;
    const runtime = createRuntime({
      providers: [model],
      memory: new InMemoryStore(),
      agents: [{ ...echoAgent("native-agent"), tools: ["allowed.echo"] }],
      tools: [{ id: "allowed.echo", run: toolRun }],
      maxToolCallIterations: 1,
    });

    const result = await runtime.run("native-agent", "hi", { throwOnError: false });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/tool call iteration limit/i);
    expect(model.call).toHaveBeenCalledTimes(2);
    expect(toolRun).toHaveBeenCalledTimes(1);
  });
});
