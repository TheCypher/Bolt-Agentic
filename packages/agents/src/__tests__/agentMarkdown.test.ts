import { describe, expect, it, vi } from "vitest";
import { createAgent, parseAgentMarkdown } from "@bolt-ai/agents";
import type { AgentCtx, MemoryStore } from "@bolt-ai/core";

const createMemory = () => {
  const messages: any[] = [];
  const memory: MemoryStore = {
    get: async () => null,
    set: async () => {},
    patch: async () => {},
    history: async () => [],
    appendConversation: async (_scope, m) => {
      messages.push(m);
    },
  };
  return { memory, messages };
};

describe("parseAgentMarkdown", () => {
  it("parses frontmatter and sections", () => {
    const md = `---
id: support
description: Support agent
capabilities: [text, json]
tools:
  - web.search
  - http.fetch
memory:
  scope: support
  history: 4
reasoning:
  mode: deliberate
  steps: 2
---

## System
You are helpful.

## User
Question: {{input}}
`;

    const def = parseAgentMarkdown(md);
    expect(def.id).toBe("support");
    expect(def.description).toBe("Support agent");
    expect(def.capabilities).toEqual(["text", "json"]);
    expect(def.tools).toEqual(["web.search", "http.fetch"]);
    expect(def.memory?.history).toBe(4);
    expect(def.reasoning?.mode).toBe("deliberate");
    expect(def.prompt?.system).toContain("You are helpful");
    expect(def.prompt?.user).toContain("Question: {{input}}");
  });

  it("infers id from file path", () => {
    const md = `---\nname: Pricing\n---\nAgent body`;
    const def = parseAgentMarkdown(md, { filePath: "/agents/pricing.agent.md" });
    expect(def.id).toBe("pricing");
  });

  it("filters unsupported capabilities", () => {
    const md = `---\nid: demo\ncapabilities: [text, magic]\n---\nAgent body`;
    const def = parseAgentMarkdown(md);
    expect(def.capabilities).toEqual(["text"]);
  });
});

describe("createAgent", () => {
  it("runs deliberate reasoning with multiple calls", async () => {
    const { memory, messages } = createMemory();
    const calls: string[] = [];
    const ctx: AgentCtx = {
      input: "How do refunds work?",
      memory,
      tools: { get: () => undefined, list: () => [], register: () => {} },
      call: vi.fn(async ({ prompt }) => {
        calls.push(prompt);
        return calls.length === 1 ? "plan" : "final answer";
      }),
    };

    const agent = createAgent({
      id: "support",
      reasoning: { mode: "deliberate" },
      prompt: {
        system: "Be concise.",
        user: "Question: {{input}}",
      },
    });

    const out = await agent.run(ctx);
    expect(out).toBe("final answer");
    expect(calls.length).toBe(2);
    expect(calls[0]).toContain("concise plan");
    expect(messages.length).toBe(2);
  });

  it("parses json output when requested", async () => {
    const { memory } = createMemory();
    const ctx: AgentCtx = {
      input: { ok: true },
      memory,
      tools: { get: () => undefined, list: () => [], register: () => {} },
      call: vi.fn(async () => '{"answer":42}'),
    };

    const agent = createAgent({
      id: "json-agent",
      outputKind: "json",
      prompt: { user: "Return {{input}}" },
    });

    const out = await agent.run(ctx);
    expect(out).toEqual({ answer: 42 });
  });
});
