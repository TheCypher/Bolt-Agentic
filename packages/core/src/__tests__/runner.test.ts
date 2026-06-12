import { describe, expect, it } from "vitest";
import { runPlan } from "@bolt-ai/core";
import type { Plan } from "@bolt-ai/core";

const makeRouter = (response: any, delayMs = 0) => ({
  route: async () => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    return response;
  },
});

describe("runPlan guard score checks", () => {
  it("fails when score check is below minimum", async () => {
    const plan: Plan = {
      id: "t1",
      steps: [
        {
          id: "s1",
          kind: "model",
          agent: "a",
          guard: { scoreCheck: { min: 0.8, scorer: "consistency" } },
        },
      ],
      outputs: ["s1"],
    };

    await expect(
      runPlan(makeRouter("ok") as any, plan, { taskId: "t1", agentId: "a", input: "hi" }, {
        scorers: { consistency: () => 0.5 },
      })
    ).rejects.toThrow(/score check/i);
  });
});

describe("runPlan budgets", () => {
  it("fails when latency budget is exceeded", async () => {
    const plan: Plan = {
      id: "t2",
      steps: [{ id: "s1", kind: "model", agent: "a" }],
      outputs: ["s1"],
    };

    await expect(
      runPlan(makeRouter("ok", 10) as any, plan, { taskId: "t2", agentId: "a", input: "hi" }, {
        budget: { maxLatencyMs: 5 },
      })
    ).rejects.toThrow(/latency/i);
  });

  it("fails when cost budget is exceeded", async () => {
    const plan: Plan = {
      id: "t3",
      steps: [{ id: "s1", kind: "model", agent: "a" }],
      outputs: ["s1"],
    };

    await expect(
      runPlan(makeRouter("ok") as any, plan, { taskId: "t3", agentId: "a", input: "hi" }, {
        budget: { maxCostUSD: 1 },
        costEstimator: () => 5,
      })
    ).rejects.toThrow(/cost/i);
  });
});
