import { describe, expect, it, vi } from "vitest";
import { createVectorTool } from "@bolt-ai/tools";

describe("createVectorTool", () => {
  it("delegates to vector adapter", async () => {
    const query = vi.fn(async () => ({ matches: [{ id: "1", score: 0.9 }] }));
    const tool = createVectorTool({ query });

    const res = await tool.run({ query: "hello", topK: 1 }, {} as any);
    expect(query).toHaveBeenCalledWith({ query: "hello", topK: 1, filter: undefined, namespace: undefined });
    expect(res.matches[0].id).toBe("1");
  });
});
