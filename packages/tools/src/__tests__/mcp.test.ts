import { describe, expect, it, vi } from "vitest";
import {
  createMcpServer,
  createMcpTool,
  importMcpTools,
  listMcpTools,
} from "@bolt-ai/tools";
import type { Agent, Tool } from "@bolt-ai/core";

describe("createMcpTool", () => {
  it("calls underlying MCP client", async () => {
    const callTool = vi.fn(async (_tool: string, _args: any) => ({ ok: true }));
    const tool = createMcpTool({ callTool });
    const res = await tool.run({ tool: "pdf.extract", args: { id: 1 } }, {} as any);
    expect(callTool).toHaveBeenCalledWith("pdf.extract", { id: 1 });
    expect(res).toEqual({ ok: true });
  });
});

describe("MCP client imports", () => {
  it("lists and imports multiple MCP tools as Bolt tools", async () => {
    const client = {
      listTools: vi.fn(async () => ({
        tools: [
          {
            name: "files.read",
            description: "Read a file",
            inputSchema: {
              type: "object",
              required: ["path"],
              properties: { path: { type: "string" } },
            },
          },
          {
            name: "pdf.extract",
            description: "Extract PDF text",
            inputSchema: { type: "object" },
          },
        ],
      })),
      callTool: vi.fn(async (request: any) => ({
        content: [{ type: "json", json: { called: request.name, args: request.arguments } }],
      })),
    };

    await expect(listMcpTools(client)).resolves.toEqual([
      {
        name: "files.read",
        description: "Read a file",
        inputSchema: {
          type: "object",
          required: ["path"],
          properties: { path: { type: "string" } },
        },
      },
      {
        name: "pdf.extract",
        description: "Extract PDF text",
        inputSchema: { type: "object" },
      },
    ]);

    const tools = await importMcpTools(client);

    expect(tools.map((tool) => tool.id)).toEqual(["files.read", "pdf.extract"]);
    expect(tools[0]).toMatchObject({
      id: "files.read",
      description: "Read a file",
      schema: {
        type: "object",
        required: ["path"],
        properties: { path: { type: "string" } },
      },
    });

    await expect(tools[0].run({ path: "/tmp/a.txt" }, {} as any)).resolves.toEqual({
      content: [{ type: "json", json: { called: "files.read", args: { path: "/tmp/a.txt" } } }],
    });
    expect(client.callTool).toHaveBeenCalledWith({
      name: "files.read",
      arguments: { path: "/tmp/a.txt" },
    });
  });

  it("filters imported MCP tools with an allow-list", async () => {
    const client = {
      listTools: vi.fn(async () => ({
        tools: [{ name: "allowed.search" }, { name: "blocked.delete" }],
      })),
      callTool: vi.fn(async () => ({ content: [] })),
    };

    const tools = await importMcpTools(client, { allow: ["allowed.search"] });

    expect(tools.map((tool) => tool.id)).toEqual(["allowed.search"]);
  });
});

describe("MCP server exports", () => {
  it("exposes a Bolt tool as an MCP-compatible tool", async () => {
    const run = vi.fn(async (args: { value: string }) => ({ echoed: args.value.toUpperCase() }));
    const tool: Tool = {
      id: "local.echo",
      description: "Echo local input",
      schema: {
        type: "object",
        required: ["value"],
        properties: { value: { type: "string" } },
      },
      run,
    };

    const server = createMcpServer({ tools: [tool] });

    await expect(server.listTools()).resolves.toEqual({
      tools: [
        {
          name: "local.echo",
          description: "Echo local input",
          inputSchema: {
            type: "object",
            required: ["value"],
            properties: { value: { type: "string" } },
          },
        },
      ],
    });
    await expect(server.callTool({ name: "local.echo", arguments: { value: "hi" } })).resolves.toEqual({
      content: [{ type: "text", text: "{\"echoed\":\"HI\"}" }],
      structuredContent: { echoed: "HI" },
    });
    expect(run).toHaveBeenCalledWith(
      { value: "hi" },
      expect.objectContaining({ allow: ["local.echo"] })
    );
  });

  it("exposes a Bolt agent as an MCP-compatible callable capability", async () => {
    const agent: Agent = {
      id: "agent.summarize",
      description: "Summarize text",
      capabilities: ["text"],
      async run(ctx) {
        return {
          summary: `summary:${(ctx.input as any).text}`,
          hasTools: Boolean(ctx.tools),
        };
      },
    };

    const server = createMcpServer({ agents: [agent] });

    await expect(server.listTools()).resolves.toEqual({
      tools: [
        {
          name: "agent.summarize",
          description: "Summarize text",
          inputSchema: { type: "object" },
        },
      ],
    });
    await expect(server.callTool({ name: "agent.summarize", arguments: { text: "hello" } })).resolves.toEqual({
      content: [{ type: "text", text: "{\"summary\":\"summary:hello\",\"hasTools\":true}" }],
      structuredContent: { summary: "summary:hello", hasTools: true },
    });
  });

  it("can expose agents through a runtime-backed runner", async () => {
    const runAgent = vi.fn(async (agentId: string, input: unknown) => ({
      agentId,
      input,
      routed: true,
    }));
    const agent: Agent = {
      id: "agent.routed",
      capabilities: ["text"],
      async run() {
        throw new Error("direct agent execution should not run");
      },
    };
    const server = createMcpServer({ agents: [agent], runAgent });

    await expect(server.callTool({
      name: "agent.routed",
      arguments: { question: "hello" },
    })).resolves.toEqual({
      content: [{
        type: "text",
        text: "{\"agentId\":\"agent.routed\",\"input\":{\"question\":\"hello\"},\"routed\":true}",
      }],
      structuredContent: {
        agentId: "agent.routed",
        input: { question: "hello" },
        routed: true,
      },
    });
    expect(runAgent).toHaveBeenCalledWith("agent.routed", { question: "hello" });
  });

  it("enforces MCP server allow-lists for exposed tools and agents", async () => {
    const allowed: Tool = { id: "allowed.echo", async run() { return "ok"; } };
    const blocked: Tool = { id: "blocked.delete", async run() { return "blocked"; } };
    const server = createMcpServer({
      tools: [allowed, blocked],
      allow: ["allowed.echo"],
    });

    await expect(server.listTools()).resolves.toEqual({
      tools: [{ name: "allowed.echo", inputSchema: { type: "object" } }],
    });
    await expect(server.callTool({ name: "blocked.delete", arguments: {} })).rejects.toThrow(
      /not allowed or not found/i
    );
  });
});
