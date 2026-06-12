import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

async function makeTempDir(prefix: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeFile(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

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

  it("preserves declared skills and resolves Markdown skill files from skillsDir", async () => {
    const skillsDir = await makeTempDir("bolt-skills-");
    await writeFile(
      path.join(skillsDir, "research.md"),
      `---
name: Research
description: Source-grounded research behavior
---
Verify claims against primary sources.
`,
    );
    await writeFile(
      path.join(skillsDir, "concise", "SKILL.md"),
      `# Concise

Use short, direct sentences.
`,
    );

    const def = parseAgentMarkdown(
      `---
id: analyst
skills: [research, concise]
---
Summarize {{input}}
`,
      { skillsDir },
    );

    expect(def.skills).toEqual(["research", "concise"]);
    expect(def.resolvedSkills).toEqual([
      expect.objectContaining({
        id: "research",
        name: "Research",
        description: "Source-grounded research behavior",
        content: "Verify claims against primary sources.",
      }),
      expect.objectContaining({
        id: "concise",
        content: "# Concise\n\nUse short, direct sentences.",
      }),
    ]);
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

  it("preserves declared tools on created agents for runtime allowlists", () => {
    const agent = createAgent({
      id: "tool-agent",
      tools: ["web.search", "http.fetch"],
    });

    expect(agent.tools).toEqual(["web.search", "http.fetch"]);
  });

  it("injects resolved Markdown skills into the prompt", async () => {
    const skillsDir = await makeTempDir("bolt-skills-");
    await writeFile(path.join(skillsDir, "research.md"), "Verify claims against primary sources.");
    await writeFile(path.join(skillsDir, "concise.md"), "Use short, direct sentences.");

    const def = parseAgentMarkdown(
      `---
id: analyst
skills:
  - research
  - concise
---
## System
Analyze carefully.

## User
Task: {{input}}
`,
      { skillsDir },
    );

    const { memory } = createMemory();
    const calls: string[] = [];
    const ctx: AgentCtx = {
      input: "latest release notes",
      memory,
      tools: { get: () => undefined, list: () => [], register: () => {} },
      call: vi.fn(async ({ prompt }) => {
        calls.push(prompt);
        return "done";
      }),
    };

    const agent = createAgent(def);
    await agent.run(ctx);

    expect(calls[0]).toContain("Skills:");
    expect(calls[0]).toContain("## research");
    expect(calls[0]).toContain("Verify claims against primary sources.");
    expect(calls[0]).toContain("## concise");
    expect(calls[0]).toContain("Use short, direct sentences.");
    expect(calls[0]).toContain("Analyze carefully.");
  });

  it("validates output against a plain JSON Schema object", async () => {
    const { memory } = createMemory();
    const ctx: AgentCtx = {
      input: "summarize",
      memory,
      tools: { get: () => undefined, list: () => [], register: () => {} },
      call: vi.fn(async () => ({
        answer: "Use backups",
        confidence: 0.92,
        tags: ["ops", "recovery"],
        source: { title: "Runbook", pages: [1, 2] },
      })),
    };

    const agent = createAgent({
      id: "schema-agent",
      outputSchema: {
        type: "object",
        required: ["answer", "confidence", "tags", "source"],
        properties: {
          answer: { type: "string" },
          confidence: { type: "number" },
          tags: { type: "array", items: { type: "string" } },
          source: {
            type: "object",
            required: ["title", "pages"],
            properties: {
              title: { type: "string" },
              pages: { type: "array", items: { type: "number" } },
            },
          },
        },
      },
    });

    await expect(agent.run(ctx)).resolves.toEqual({
      answer: "Use backups",
      confidence: 0.92,
      tags: ["ops", "recovery"],
      source: { title: "Runbook", pages: [1, 2] },
    });
  });

  it("rejects output missing JSON Schema required properties", async () => {
    const { memory } = createMemory();
    const ctx: AgentCtx = {
      input: "summarize",
      memory,
      tools: { get: () => undefined, list: () => [], register: () => {} },
      call: vi.fn(async () => ({ answer: "Use backups" })),
    };

    const agent = createAgent({
      id: "schema-agent",
      outputSchema: {
        type: "object",
        required: ["answer", "confidence"],
        properties: {
          answer: { type: "string" },
          confidence: { type: "number" },
        },
      },
    });

    await expect(agent.run(ctx)).rejects.toThrow("Output schema validation failed");
  });

  it("rejects output with invalid nested JSON Schema array items", async () => {
    const { memory } = createMemory();
    const ctx: AgentCtx = {
      input: "summarize",
      memory,
      tools: { get: () => undefined, list: () => [], register: () => {} },
      call: vi.fn(async () => ({ tags: ["ops", 3] })),
    };

    const agent = createAgent({
      id: "schema-agent",
      outputSchema: {
        type: "object",
        required: ["tags"],
        properties: {
          tags: { type: "array", items: { type: "string" } },
        },
      },
    });

    await expect(agent.run(ctx)).rejects.toThrow("Output schema validation failed");
  });

  it("preserves Zod-like safeParse output schema behavior", async () => {
    const { memory } = createMemory();
    const ctx: AgentCtx = {
      input: "summarize",
      memory,
      tools: { get: () => undefined, list: () => [], register: () => {} },
      call: vi.fn(async () => ({ answer: 42 })),
    };
    const safeParse = vi.fn(() => ({ success: false }));

    const agent = createAgent({
      id: "safe-parse-agent",
      outputSchema: { safeParse },
    });

    await expect(agent.run(ctx)).rejects.toThrow("Output schema validation failed");
    expect(safeParse).toHaveBeenCalledWith({ answer: 42 });
  });

  it("preserves Zod-like parse output schema behavior", async () => {
    const { memory } = createMemory();
    const ctx: AgentCtx = {
      input: "summarize",
      memory,
      tools: { get: () => undefined, list: () => [], register: () => {} },
      call: vi.fn(async () => ({ answer: 42 })),
    };
    const parse = vi.fn(() => {
      throw new Error("invalid");
    });

    const agent = createAgent({
      id: "parse-agent",
      outputSchema: { parse },
    });

    await expect(agent.run(ctx)).rejects.toThrow("Output schema validation failed");
    expect(parse).toHaveBeenCalledWith({ answer: 42 });
  });
});
