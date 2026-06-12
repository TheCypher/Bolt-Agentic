import { describe, expect, it, vi, afterEach } from "vitest";
import { createWebSearchTool } from "@bolt-ai/tools";

const mockSerp = {
  organic_results: [
    { title: "Allowed", link: "https://docs.example.com/a" },
    { title: "Blocked", link: "https://evil.com/b" },
  ],
};

describe("createWebSearchTool", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SERPAPI_KEY;
  });

  it("filters results by allowDomains", async () => {
    process.env.SERPAPI_KEY = "key";
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(mockSerp), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const tool = createWebSearchTool({ allowDomains: ["docs.example.com"] });
    const res = await tool.run({ query: "test" }, {} as any);

    expect(res.results.length).toBe(1);
    expect(res.results[0].link).toContain("docs.example.com");
  });
});
