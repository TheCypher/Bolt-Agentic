import { describe, expect, it, vi } from "vitest";
import { createMcpTool } from "@bolt-ai/tools";

describe("createMcpTool", () => {
  it("calls underlying MCP client", async () => {
    const callTool = vi.fn(async (_tool: string, _args: any) => ({ ok: true }));
    const tool = createMcpTool({ callTool });
    const res = await tool.run({ tool: "pdf.extract", args: { id: 1 } }, {} as any);
    expect(callTool).toHaveBeenCalledWith("pdf.extract", { id: 1 });
    expect(res).toEqual({ ok: true });
  });
});
