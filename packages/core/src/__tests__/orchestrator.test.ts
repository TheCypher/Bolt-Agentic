import { describe, expect, it, vi } from "vitest";
import { createOrchestrator } from "@bolt-ai/core";

describe("orchestrator", () => {
  it("executes a heuristic plan", async () => {
    const router = {
      route: vi.fn(async () => "ok"),
    } as any;

    const orchestrator = createOrchestrator(router);
    const result = await orchestrator.run({ agentId: "support", input: "hello" });

    expect(router.route).toHaveBeenCalledTimes(1);
    expect(result.outputs.step1).toBe("ok");
  });
});
