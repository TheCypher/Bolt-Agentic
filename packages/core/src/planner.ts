// packages/core/src/planner.ts

import type { AppRouter } from "./router";
import type { Plan, PlanStep, RunnerContext } from "./types";

/* ----------------------------------------------
 * Heuristic Planner (very small)
 * ---------------------------------------------- */

/** Tiny heuristic planner: single model step, or parallel fan-out then synthesize for "compare A vs B". */
export async function createHeuristicPlan(
  _router: AppRouter,
  ctx: Pick<RunnerContext, "taskId" | "agentId" | "input" | "memoryScope">
): Promise<Plan> {
  const goalText = typeof ctx.input === "string" ? ctx.input : JSON.stringify(ctx.input);

  // naive compare detector
  const compareMatch = goalText.match(/compare\s+(.+)\s+vs?\.\s*(.+)/i);
  if (compareMatch) {
    const steps: PlanStep[] = [
      { id: "s1", kind: "model", agent: ctx.agentId, guard: { retry: { max: 1 } } },
      { id: "fan", kind: "parallel", children: ["a", "b"] },
      { id: "a", kind: "model", agent: ctx.agentId, inputFrom: ["s1"], guard: { retry: { max: 1 } } },
      { id: "b", kind: "model", agent: ctx.agentId, inputFrom: ["s1"], guard: { retry: { max: 1 } } },
      { id: "synth", kind: "model", agent: ctx.agentId, inputFrom: ["a", "b"], guard: { retry: { max: 1 } } },
    ];
    return { id: ctx.taskId, steps, outputs: ["synth"] };
  }

  // default single-step
  return {
    id: ctx.taskId,
    steps: [{ id: "step1", kind: "model", agent: ctx.agentId, guard: { retry: { max: 1 } } }],
    outputs: ["step1"],
  };
}

export { runPlan } from "./runner";
