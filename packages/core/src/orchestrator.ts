// packages/core/src/orchestrator.ts

import type { AppRouter } from "./router";
import type { Plan, RunOptions, RunnerContext, ToolFn } from "./types";
import { createHeuristicPlan } from "./planner";
import { createLLMPlan } from "./planners/llm";
import { runPlan } from "./runner";
import { uuid } from "../util/uuid";

export type PlannerMode = "heuristic" | "llm" | ((router: AppRouter, ctx: OrchestratorContext) => Promise<Plan>);

export interface OrchestratorOptions {
  planner?: PlannerMode;
  plannerAgentId?: string;
  maxSteps?: number;
  run?: RunOptions;
}

export interface OrchestratorContext {
  taskId: string;
  agentId: string;
  input: any;
  memoryScope?: string;
  tools?: Record<string, ToolFn>;
}

export class Orchestrator {
  private router: AppRouter;
  private options: OrchestratorOptions;

  constructor(router: AppRouter, options: OrchestratorOptions = {}) {
    this.router = router;
    this.options = options;
  }

  async plan(ctx: Omit<OrchestratorContext, "taskId"> & { taskId?: string }): Promise<Plan> {
    const taskId = ctx.taskId ?? uuid();
    const planner = this.options.planner ?? "heuristic";

    if (typeof planner === "function") {
      return planner(this.router, { ...ctx, taskId });
    }

    if (planner === "llm") {
      return createLLMPlan(this.router, {
        goal: ctx.input,
        agentId: this.options.plannerAgentId ?? "planner",
        memoryScope: ctx.memoryScope,
        maxSteps: this.options.maxSteps ?? 12,
      });
    }

    return createHeuristicPlan(this.router, {
      taskId,
      agentId: ctx.agentId,
      input: ctx.input,
      memoryScope: ctx.memoryScope,
    });
  }

  async run(ctx: Omit<OrchestratorContext, "taskId"> & { taskId?: string }, runOpts: RunOptions = {}) {
    const plan = await this.plan(ctx);
    const runnerCtx: RunnerContext = {
      taskId: plan.id ?? ctx.taskId ?? uuid(),
      agentId: ctx.agentId,
      input: ctx.input,
      memoryScope: ctx.memoryScope,
      tools: ctx.tools,
    };
    return runPlan(this.router, plan, runnerCtx, { ...this.options.run, ...runOpts });
  }
}

export function createOrchestrator(router: AppRouter, options: OrchestratorOptions = {}) {
  return new Orchestrator(router, options);
}
