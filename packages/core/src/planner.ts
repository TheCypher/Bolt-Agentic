// packages/core/src/planner.ts
import type { AppRouter } from "./router";
import type {
  Guard,
  Plan,
  PlanStep,
  RunnerContext,
  RunnerEvent,
  RunOptions,
  Condition,
  Expr,
} from "./types";

/** Tiny heuristic planner: single model step, or simple 2-way fanout if goal hints at comparison. */
export async function createHeuristicPlan(
  _router: AppRouter,
  ctx: Pick<RunnerContext, "taskId" | "agentId" | "input" | "memoryScope">
): Promise<Plan> {
  const goalText = typeof ctx.input === "string" ? ctx.input : JSON.stringify(ctx.input);

  const compareMatch = goalText.match(/compare\s+(.+)\s+vs?\.\s*(.+)/i);
  if (compareMatch) {
    const steps: PlanStep[] = [
      { id: "s1", kind: "model", agent: ctx.agentId, guard: { retry: { max: 1 } } },
      { id: "pa", kind: "parallel", children: ["a", "b"] },
      { id: "a", kind: "model", agent: ctx.agentId, inputFrom: ["s1"], guard: { retry: { max: 1 } } },
      { id: "b", kind: "model", agent: ctx.agentId, inputFrom: ["s1"], guard: { retry: { max: 1 } } },
      { id: "synth", kind: "model", agent: ctx.agentId, inputFrom: ["a", "b"], guard: { retry: { max: 1 } } },
    ];
    return { id: ctx.taskId, steps, outputs: ["synth"] };
  }

  return {
    id: ctx.taskId,
    steps: [{ id: "step1", kind: "model", agent: ctx.agentId, guard: { retry: { max: 1 } } }],
    outputs: ["step1"],
  };
}

// deterministic key for cache signatures
const stableStringify = (v: any) =>
  JSON.stringify(v, (_k, value: any) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.keys(value)
      .sort()
      .reduce((acc, k) => {
        (acc as any)[k] = (value as any)[k];
        return acc;
      }, {} as any);
  });

export async function runPlan(
  router: AppRouter,
  plan: Plan,
  ctx: RunnerContext,
  opts: RunOptions = {}
): Promise<{ outputs: Record<string, any> }> {
  const out = new Map<string, any>();
  const stepById = new Map(plan.steps.map((s) => [s.id, s]));
  const onEvent = opts.onEvent ?? (() => {});
  const maxConc = Math.max(1, opts.maxConcurrency ?? 3);

  const readInputs = (s: { inputFrom?: string[] }) => {
    if (!s.inputFrom?.length) return ctx.input;
    const arr = s.inputFrom.map((id) => out.get(id));
    return arr.length === 1 ? arr[0] : arr;
  };

  const validate = (guard: Guard | undefined, value: any): boolean => {
    if (!guard?.schema) return true;
    const schema: any = guard.schema;
    if (schema?.safeParse) return Boolean(schema.safeParse(value)?.success);
    return true;
  };

  // Resolve "stepId" or "stepId.path.to.field"
  const getOutputRef = (ref: string) => {
    const [head, ...rest] = String(ref).split(".");
    let v = out.get(head);
    for (const k of rest) {
      if (v == null) return undefined;
      v = v[k as any];
    }
    return v;
  };

  const resolveExpr = (expr: Expr): any => {
    if (expr == null) return expr;
    if (typeof expr === "object") {
      if ("var" in expr) return getOutputRef((expr as any).var);
      if ("value" in expr) return (expr as any).value;
      return expr;
    }
    return expr;
  };

  const evalCondition = (cond: Condition): boolean => {
    if (typeof cond === "string") return Boolean(getOutputRef(cond));
    if ("truthy" in cond) return Boolean(getOutputRef(cond.truthy));
    if ("eq" in cond) return resolveExpr(cond.eq.left) === resolveExpr(cond.eq.right);
    if ("gt" in cond) return Number(resolveExpr(cond.gt.left)) > Number(resolveExpr(cond.gt.right));
    if ("lt" in cond) return Number(resolveExpr(cond.lt.left)) < Number(resolveExpr(cond.lt.right));
    return false;
  };

  type ModelOrTool = Extract<PlanStep, { kind: "model" } | { kind: "tool" }>;

  async function execWithRetry(s: ModelOrTool): Promise<any> {
    const max = s.guard?.retry?.max ?? 0;
    const backoff = s.guard?.retry?.backoffMs ?? 400;
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      onEvent({ type: "step:start", stepId: s.id } as RunnerEvent);
      try {
        const input = readInputs(s);

        // cache read
        const cacheKey = opts.cache ? `step:${s.id}:${stableStringify(input)}` : null;
        if (cacheKey && opts.cache) {
          const hit = await opts.cache.get(cacheKey);
          if (hit != null) {
            onEvent({ type: "step:done", stepId: s.id, output: hit } as RunnerEvent);
            return hit;
          }
        }

        let result: any;
        if (s.kind === "model") {
          result = await (router as any).route?.({
            id: `${ctx.taskId}:${s.id}:${attempt}`,
            agentId: s.agent,
            input,
            memoryScope: ctx.memoryScope,
          });
        } else {
          const tool = ctx.tools?.[s.toolId];
          if (!tool) throw new Error(`Tool not found: ${s.toolId}`);
          result = await tool(s.args ?? input, { ...ctx });
        }

        if (!validate(s.guard, result)) throw new Error("Schema validation failed");

        // cache write
        if (cacheKey && opts.cache) {
          await opts.cache.set(cacheKey, result, opts.defaultStepTTLSeconds ?? 300);
        }

        onEvent({ type: "step:done", stepId: s.id, output: result } as RunnerEvent);
        return result;
      } catch (err) {
        if (attempt >= max) throw err;
        attempt++;
        onEvent({ type: "step:retry", stepId: s.id, attempt } as RunnerEvent);
        await new Promise((res) => setTimeout(res, backoff * attempt));
      }
    }
  }

  // simple semaphore helper
  const pool = (limit: number) => {
    let active = 0;
    const queue: (() => void)[] = [];
    const run = async <T>(fn: () => Promise<T>) => {
      if (active >= limit) await new Promise<void>((r) => queue.push(r));
      active++;
      try {
        return await fn();
      } finally {
        active--;
        queue.shift()?.();
      }
    };
    return { run };
  };
  const sem = pool(maxConc);

  onEvent({ type: "plan", plan } as RunnerEvent);

  for (const s of plan.steps) {
    if (s.kind === "parallel") {
      const proms = s.children.map((cid) => {
        const child = stepById.get(cid);
        if (!child || child.kind === "parallel" || child.kind === "branch" || child.kind === "map") {
          throw new Error(`Invalid child in parallel: ${cid}`);
        }
        return sem.run(async () => {
          const r = await execWithRetry(child as ModelOrTool);
          out.set(child.id, r);
        });
      });
      await Promise.all(proms);
      continue;
    }

    if (s.kind === "branch") {
      const picked = s.branches.find((b) => evalCondition(b.when));
      const runIds = picked?.then ?? s.else ?? [];
      for (const id of runIds) {
        const st = stepById.get(id);
        if (!st || st.kind === "parallel" || st.kind === "branch") {
          throw new Error(`Invalid step in branch.then: ${id}`);
        }
        const r = await execWithRetry(st as ModelOrTool);
        out.set(st.id, r);
      }
      continue;
    }

    if (s.kind === "map") {
      const items = out.get(s.itemsFrom);
      if (!Array.isArray(items)) throw new Error(`Map itemsFrom '${s.itemsFrom}' did not yield an array`);
      const lim = s.maxConcurrency ?? maxConc;
      const mapSem = pool(lim);
      const results: any[] = [];
      const child = s.child;

      await Promise.all(
        items.map((item, idx) =>
          mapSem.run(async () => {
            const childInput = s.fromItemAsInput ? item : readInputs(child as any);
            const childStep: any =
              child.kind === "model"
                ? ({ ...child, id: `${s.id}:${idx}`, kind: "model" })
                : ({ ...child, id: `${s.id}:${idx}`, kind: "tool" });

            // when not passing item as input, still expose it for tools
            if (child.kind === "tool" && !s.fromItemAsInput) {
              childStep.args = childStep.args ?? {};
              childStep.args.item = item;
            }

            // preserve child's declared inputFrom if provided
            (childStep as any).inputFrom = s.fromItemAsInput ? undefined : (child as any).inputFrom;

            const r = await execWithRetry(childStep);
            results[idx] = r;
          })
        )
      );

      out.set(s.id, results);
      continue;
    }

    // model/tool
    const r = await execWithRetry(s as ModelOrTool);
    out.set(s.id, r);
  }

  const outputs: Record<string, any> = {};
  for (const id of plan.outputs) outputs[id] = out.get(id);
  onEvent({ type: "done", outputs } as RunnerEvent);
  return { outputs };
}
