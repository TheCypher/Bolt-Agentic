import { describe, expect, it } from "vitest";
import { runPlan } from "@bolt-ai/core";
import type { Plan } from "@bolt-ai/core";

const makeRouter = (response: any, delayMs = 0) => ({
  route: async () => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    return response;
  },
});

const makeCountingRouter = () => {
  const calls: string[] = [];

  return {
    calls,
    router: {
      route: async ({ agentId }: { agentId: string }) => {
        calls.push(agentId);
        return `${agentId}-result`;
      },
    },
  };
};

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

describe("runPlan nested step ownership", () => {
  it("does not execute parallel children again when they also appear later in plan.steps", async () => {
    const { calls, router } = makeCountingRouter();
    const plan: Plan = {
      id: "parallel-children",
      steps: [
        { id: "fanout", kind: "parallel", children: ["left", "right"] },
        { id: "left", kind: "model", agent: "left-agent" },
        { id: "right", kind: "model", agent: "right-agent" },
      ],
      outputs: ["left", "right"],
    };

    const result = await runPlan(router as any, plan, { taskId: "t4", agentId: "a", input: "hi" });

    expect(calls.sort()).toEqual(["left-agent", "right-agent"]);
    expect(result.outputs).toEqual({
      left: "left-agent-result",
      right: "right-agent-result",
    });
  });

  it("does not execute selected branch children again when they also appear later in plan.steps", async () => {
    const { calls, router } = makeCountingRouter();
    const plan: Plan = {
      id: "branch-children",
      steps: [
        { id: "decide", kind: "tool", toolId: "decide" },
        {
          id: "branch",
          kind: "branch",
          branches: [{ when: { truthy: "decide.runModel" }, then: ["chosen"] }],
          else: ["fallback"],
        },
        { id: "chosen", kind: "model", agent: "chosen-agent" },
        { id: "fallback", kind: "model", agent: "fallback-agent" },
      ],
      outputs: ["chosen", "fallback"],
    };

    const result = await runPlan(
      router as any,
      plan,
      {
        taskId: "t5",
        agentId: "a",
        input: "hi",
        tools: {
          decide: async () => ({ runModel: true }),
        },
      }
    );

    expect(calls).toEqual(["chosen-agent"]);
    expect(result.outputs).toEqual({
      chosen: "chosen-agent-result",
      fallback: undefined,
    });
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
