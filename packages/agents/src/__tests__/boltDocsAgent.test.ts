import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

import { createAgent } from "@bolt-ai/agents";
import type { AgentCtx, MemoryStore } from "@bolt-ai/core";

async function makeTempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return dir;
}

async function writeFile(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

function createMemory(): MemoryStore {
  return {
    get: async () => null,
    set: async () => {},
    patch: async () => {},
    history: async () => [],
    appendConversation: async () => {},
  };
}

describe("boltDocs injection", () => {
  it("prepends BOLT.md instructions to system prompt", async () => {
    const root = await makeTempDir("bolt-docs-");
    await writeFile(path.join(root, "BOLT.md"), "Project rules.");

    const calls: string[] = [];
    const ctx: AgentCtx = {
      input: "hello",
      memory: createMemory(),
      tools: { get: () => undefined, list: () => [], register: () => {} },
      call: vi.fn(async ({ prompt }) => {
        calls.push(prompt);
        return "ok";
      }),
    };

    const agent = createAgent({
      id: "support",
      prompt: { system: "Base system", user: "Say {{input}}" },
      boltDocs: { cwd: root, includeGlobal: false, projectRoot: root },
    } as any);

    await agent.run(ctx);
    expect(calls[0]).toContain("Project rules.");
    expect(calls[0]).toContain("Base system");
  });
});
