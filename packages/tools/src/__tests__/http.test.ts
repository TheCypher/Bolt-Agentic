import { describe, expect, it, vi, afterEach } from "vitest";
import { createHttpTool } from "@bolt-ai/tools";

const response = (body: any, status = 200) => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
};

describe("createHttpTool", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("blocks urls not in allow list", async () => {
    const tool = createHttpTool({ allow: ["https://api.example.com/*"] });
    await expect(tool.run({ url: "https://evil.com" }, {} as any)).rejects.toThrow(/not allowed/i);
  });

  it("allows urls in allow list", async () => {
    const fetchSpy = vi.fn(async () => response({ ok: true }));
    vi.stubGlobal("fetch", fetchSpy);

    const tool = createHttpTool({ allow: ["https://api.example.com/*"] });
    const res = await tool.run({ url: "https://api.example.com/data" }, {} as any);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
