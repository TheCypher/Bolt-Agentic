import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createMarkdownRuntime } from "@bolt-ai/agents";
import { InMemoryStore, type ModelProvider } from "@bolt-ai/core";

function provider(output = "ok") {
  return {
    id: "test",
    supports: ["text", "json"],
    call: vi.fn(async () => ({ output })),
  } as unknown as ModelProvider;
}

async function makeTempDir(prefix: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeFile(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

describe("createMarkdownRuntime", () => {
  it("loads and registers a Markdown agent from a file", async () => {
    const root = await makeTempDir("bolt-agent-");
    const agentPath = path.join(root, "support.md");
    await writeFile(
      agentPath,
      `---
id: support
---
## User
Question: {{input}}
`,
    );

    const model = provider("loaded");
    const runtime = createMarkdownRuntime({
      providers: [model],
      memory: new InMemoryStore(),
    });

    const agent = await runtime.loadAgent(agentPath);
    const result = await runtime.run("support", "refunds");

    expect(agent.id).toBe("support");
    expect(runtime.listAgents()).toContain("support");
    expect(result).toMatchObject({ ok: true, output: "loaded" });
    expect(model.call).toHaveBeenCalledWith(expect.objectContaining({ prompt: "Question: refunds" }));
  });

  it("uses runtime skillsDir when loading Markdown agents", async () => {
    const root = await makeTempDir("bolt-agent-skills-");
    const skillsDir = path.join(root, "skills");
    await writeFile(path.join(skillsDir, "concise.md"), "Use short sentences.");
    await writeFile(
      path.join(root, "analyst.md"),
      `---
id: analyst
skills: [concise]
---
## User
Task: {{input}}
`,
    );

    const prompts: string[] = [];
    const runtime = createMarkdownRuntime({
      providers: [
        {
          id: "test",
          supports: ["text"],
          call: vi.fn(async (args) => {
            prompts.push(args.prompt ?? "");
            return { output: "done" };
          }),
        } as unknown as ModelProvider,
      ],
      memory: new InMemoryStore(),
      skillsDir,
    });

    await runtime.loadAgent(path.join(root, "analyst.md"));
    await runtime.run("analyst", "release notes");

    expect(prompts[0]).toContain("Skills:");
    expect(prompts[0]).toContain("Use short sentences.");
  });

  it("loads Markdown agents from a directory and skips instruction files", async () => {
    const root = await makeTempDir("bolt-agents-dir-");
    await writeFile(path.join(root, "BOLT.md"), "Directory instructions.");
    await writeFile(path.join(root, "support.md"), "---\nid: support\n---\nSupport");
    await writeFile(path.join(root, "nested", "research.agent.md"), "---\nid: research\n---\nResearch");

    const runtime = createMarkdownRuntime({
      providers: [provider()],
      memory: new InMemoryStore(),
      agentsDir: root,
    });

    const agents = await runtime.loadAgents();

    expect(agents.map((agent) => agent.id)).toEqual(["research", "support"]);
    expect(runtime.listAgents().sort()).toEqual(["research", "support"]);
  });

  it("ready loads agentsDir once before runtime execution", async () => {
    const root = await makeTempDir("bolt-ready-agents-");
    await writeFile(
      path.join(root, "support.md"),
      `---
id: support
---
## User
Ready: {{input}}
`,
    );

    const model = provider("ready");
    const runtime = createMarkdownRuntime({
      providers: [model],
      memory: new InMemoryStore(),
      agentsDir: root,
    });

    await runtime.ready();
    await runtime.ready();
    const result = await runtime.run("support", "refunds");

    expect(runtime.listAgents()).toEqual(["support"]);
    expect(result).toMatchObject({ ok: true, output: "ready" });
    expect(model.call).toHaveBeenCalledWith(expect.objectContaining({ prompt: "Ready: refunds" }));
  });

  it("ready returns the same loaded agents on repeated calls", async () => {
    const root = await makeTempDir("bolt-ready-idempotent-");
    await writeFile(path.join(root, "support.md"), "---\nid: support\n---\nSupport");

    const runtime = createMarkdownRuntime({
      providers: [provider()],
      memory: new InMemoryStore(),
      agentsDir: root,
    });

    const first = await runtime.ready();
    const second = await runtime.ready();

    expect(first.map((agent) => agent.id)).toEqual(["support"]);
    expect(second).toBe(first);
    expect(runtime.listAgents()).toEqual(["support"]);
  });

  it("ready requires agentsDir", async () => {
    const runtime = createMarkdownRuntime({
      providers: [provider()],
      memory: new InMemoryStore(),
    });

    await expect(runtime.ready()).rejects.toThrow("ready requires MarkdownRuntimeOptions.agentsDir");
  });
});
