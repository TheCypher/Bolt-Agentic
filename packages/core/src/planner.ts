// packages/core/src/planner.ts

import type {
  AppRouter
} from "./router";
import type {
  Guard,
  Plan,
  PlanStep,
  RunnerContext,
  RunnerEvent,
  RunOptions,
  // DSL helpers
  BranchStep,
  ParallelStep,
  MapStep,
  ModelStep,
  ToolStep,
  Condition,
  Expr,
} from "./types";

/** Tiny heuristic planner: single model step, or simple 2-way fanout if goal hints at comparison. */
export async function createHeuristicPlan(
  _router: AppRouter,
  ctx: Pick<RunnerContext, "taskId" | "agentId" | "input" | "memoryScope">
): Promise<Plan> {
  const goalText = typeof ctx.input === "string" ? ctx.input : JSON.stringify(ctx.input);

  // naive "compare A vs B" detector → parallel fan-out then synthesize
  const compareMatch = goalText.match(/compare\s+(.+)\s+vs?\.\s*(.+)/i);
  if (compareMatch) {
    const steps: PlanStep[] = [
      { id: "prep", kind: "model", agent: ctx.agentId, guard: { retry: { max: 1 } } },
      { id: "fan", kind: "parallel", children: ["A", "B"] },
      { id: "A", kind: "model", agent: ctx.agentId, inputFrom: ["prep"], guard: { retry: { max: 1 } } },
      { id: "B", kind: "model", agent: ctx.agentId, inputFrom: ["prep"], guard: { retry: { max: 1 } } },
      { id: "synth", kind: "model", agent: ctx.agentId, inputFrom: ["A", "B"], guard: { retry: { max: 1 } } },
    ];
    return { id: ctx.taskId, steps, outputs: ["synth"] };
  }

  // default: just do the thing
  return {
    id: ctx.taskId,
    steps: [{ id: "step1", kind: "model", agent: ctx.agentId, guard: { retry: { max: 1 } } }],
    outputs: ["step1"],
  };
}

/* ----------------------------- Runner utilities ---------------------------- */

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

/** Read "stepId" or "stepId.path.to.field" from outputs Map */
function getByPath(outputs: Map<string, any>, ref: string) {
  const [head, ...rest] = String(ref).split(".");
  let v = outputs.get(head);
  for (const k of rest) {
    if (v == null) return undefined;
    v = v[k as any];
  }
  return v;
}

/** Evaluate an Expr against existing outputs */
function evalExpr(outputs: Map<string, any>, e: Expr): any {
  if (e == null || typeof e !== "object") return e;
  if ("var" in e) return getByPath(outputs, (e as any).var);
  if ("value" in e) return (e as any).value;
  return e;
}

/** Evaluate a Condition against outputs */
function evalCondition(outputs: Map<string, any>, c: Condition): boolean {
  if (typeof c === "string") return Boolean(getByPath(outputs, c));
  if (c && typeof c === "object" && "truthy" in c) {
    return Boolean(getByPath(outputs, (c as any).truthy));
  }
  if (c && typeof c === "object" && "eq" in c) {
    const { left, right } = (c as any).eq;
    return evalExpr(outputs, left) === evalExpr(outputs, right);
  }
  if (c && typeof c === "object" && "gt" in c) {
    const { left, right } = (c as any).gt;
    return evalExpr(outputs, left) > evalExpr(outputs, right);
  }
  if (c && typeof c === "object" && "lt" in c) {
    const { left, right } = (c as any).lt;
    return evalExpr(outputs, left) < evalExpr(outputs, right);
  }
  return false;
}

/** Guard validation: zod-like safeParse support if provided */
function validate(guard: Guard | undefined, value: any): boolean {
  if (!guard?.schema) return true;
  const schema: any = guard.schema;
  if (schema?.safeParse) return Boolean(schema.safeParse(value)?.success);
  return true;
}

/** Simple concurrency pool */
function makePool(limit: number) {
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
}

/* --------------------------------- Runner --------------------------------- */

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
  const sem = makePool(maxConc);

  // Budget: wall-clock
  const planStart = Date.now();
  const getElapsed = () => Date.now() - planStart;
  const checkBudget = () => {
    const maxMs = opts.budget?.maxLatencyMs ?? Infinity;
    if (getElapsed() > maxMs) {
      throw new Error(`Budget exceeded: total latency ${getElapsed()}ms > ${maxMs}ms`);
    }
  };

  const readInputs = (s: ModelStep | ToolStep) => {
    if (!s.inputFrom?.length) return ctx.input;
    const arr = s.inputFrom.map((id) => out.get(id));
    return arr.length === 1 ? arr[0] : arr;
  };

  async function execModelStep(s: ModelStep, attempt: number, controller: AbortController) {
    // If your router supports an AbortSignal, thread it here (commented by default):
    // return await (router as any).route?.({ id: `${ctx.taskId}:${s.id}:${attempt}`, agentId: s.agent, input, memoryScope: ctx.memoryScope, signal: controller.signal });
    const input = readInputs(s);
    return await (router as any).route?.({
      id: `${ctx.taskId}:${s.id}:${attempt}`,
      agentId: s.agent,
      input,
      memoryScope: ctx.memoryScope,
    });
  }

  async function execToolStep(s: ToolStep, attempt: number, controller: AbortController) {
    const tool = ctx.tools?.[s.toolId];
    if (!tool) throw new Error(`Tool not found: ${s.toolId}`);
    const input = readInputs(s);
    return await tool(s.args ?? input, { ...ctx, signal: controller.signal });
  }

  function deriveCacheKey(stepId: string, input: any, explicitKey?: string | "auto") {
    if (!opts.cache) return null;
    if (explicitKey && explicitKey !== "auto") return `step:${stepId}:${explicitKey}`;
    if (explicitKey === "auto" || explicitKey == null) return `step:${stepId}:${stableStringify(input)}`;
    return null;
  }

  async function execWithRetry(s: ModelStep | ToolStep): Promise<any> {
    const max = s.guard?.retry?.max ?? 0;
    const backoff = s.guard?.retry?.backoffMs ?? 400;
    const timeoutMs = s.timeoutMs ?? opts.stepTimeoutMs ?? 0;
    let attempt = 0;

    while (true) {
      onEvent({ type: "step:start", stepId: s.id } as RunnerEvent);

      // budget check before starting attempt
      checkBudget();

      const controller = new AbortController();
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      try {
        const input = readInputs(s);

        // ---- CACHE: read
        const cacheKey = deriveCacheKey(s.id, input, s.cacheKey as any);
        if (cacheKey && opts.cache) {
          const hit = await opts.cache.get(cacheKey);
          if (hit != null) {
            onEvent({ type: "step:done", stepId: s.id, output: hit } as RunnerEvent);
            return hit;
          }
        }

        // Execute with optional soft timeout
        const doStep = async () => {
          if (s.kind === "model") return await execModelStep(s, attempt, controller);
          return await execToolStep(s as ToolStep, attempt, controller);
        };
        const stepPromise = doStep();

        const raced = timeoutMs > 0
          ? Promise.race([
              stepPromise,
              new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                  try { controller.abort(); } catch {}
                  reject(new Error(`Step timeout after ${timeoutMs}ms`));
                }, timeoutMs);
              }),
            ])
          : stepPromise;

        // budget check while waiting
        checkBudget();
        const result = await raced;

        if (!validate(s.guard, result)) throw new Error("Schema validation failed");

        // ---- CACHE: write
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
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    }
  }

  /** Execute a MapStep by fanning out a child over an array */
  async function execMapStep(ms: MapStep): Promise<any[]> {
    const items = out.get(ms.itemsFrom);
    const list = Array.isArray(items) ? items : [];

    const results: any[] = [];
    const child = ms.child;
    const perMapPool = makePool(Math.max(1, ms.maxConcurrency ?? maxConc));

    await Promise.all(
      list.map((item, idx) =>
        perMapPool.run(async () => {
          // budget check per child
          checkBudget();

          // Build a synthetic step id for cache/trace
          const childId = `${ms.id}:${idx}`;

          // Determine input for child
          const childInput =
            ms.fromItemAsInput === true
              ? item
              : // If not from item, mimic normal readInputs on child's inputFrom
                (("inputFrom" in child && child.inputFrom?.length)
                  ? (child.inputFrom as string[]).map((id) => out.get(id)).reduce((a, b) => (a === undefined ? b : a), undefined)
                  : item);

          // Retry, timeout, cache support (mirror execWithRetry but adapted to inline child)
          const max = (child as any).guard?.retry?.max ?? 0;
          const backoff = (child as any).guard?.retry?.backoffMs ?? 400;
          const timeoutMs = (child as any).timeoutMs ?? opts.stepTimeoutMs ?? 0;
          let attempt = 0;

          while (true) {
            onEvent({ type: "step:start", stepId: childId } as RunnerEvent);
            checkBudget();

            const controller = new AbortController();
            let timeoutId: ReturnType<typeof setTimeout> | null = null;

            try {
              // ---- CACHE read
              const cacheKey = deriveCacheKey(childId, childInput, (child as any).cacheKey);
              if (cacheKey && opts.cache) {
                const hit = await opts.cache.get(cacheKey);
                if (hit != null) {
                  onEvent({ type: "step:done", stepId: childId, output: hit } as RunnerEvent);
                  results[idx] = hit;
                  return;
                }
              }

              const doChild = async () => {
                if (child.kind === "model") {
                  return await (router as any).route?.({
                    id: `${ctx.taskId}:${childId}:${attempt}`,
                    agentId: (child as any).agent,
                    input: childInput,
                    memoryScope: ctx.memoryScope,
                  });
                } else {
                  const tool = ctx.tools?.[(child as any).toolId];
                  if (!tool) throw new Error(`Tool not found: ${(child as any).toolId}`);
                  return await tool((child as any).args ?? childInput, { ...ctx, signal: controller.signal });
                }
              };

              const childPromise = doChild();
              const raced = timeoutMs > 0
                ? Promise.race([
                    childPromise,
                    new Promise((_, reject) => {
                      timeoutId = setTimeout(() => {
                        try { controller.abort(); } catch {}
                        reject(new Error(`Step timeout after ${timeoutMs}ms`));
                      }, timeoutMs);
                    }),
                  ])
                : childPromise;

              checkBudget();
              const res = await raced;

              if (!validate((child as any).guard, res)) throw new Error("Schema validation failed");

              // ---- CACHE write
              if (opts.cache && cacheKey) {
                await opts.cache.set(cacheKey, res, opts.defaultStepTTLSeconds ?? 300);
              }

              onEvent({ type: "step:done", stepId: childId, output: res } as RunnerEvent);
              results[idx] = res;
              return;
            } catch (err) {
              if (attempt >= max) throw err;
              attempt++;
              onEvent({ type: "step:retry", stepId: childId, attempt } as RunnerEvent);
              await new Promise((res) => setTimeout(res, backoff * attempt));
            } finally {
              if (timeoutId) clearTimeout(timeoutId);
            }
          }
        })
      )
    );

    return results;
  }

  /* ------------------------------- Execution ------------------------------- */

  onEvent({ type: "plan", plan } as RunnerEvent);

  for (const s of plan.steps) {
    checkBudget();

    switch (s.kind) {
      case "parallel": {
        const ps = s as ParallelStep;
        const proms = ps.children.map((cid) => {
          const child = stepById.get(cid);
          if (!child || child.kind === "parallel") throw new Error(`Invalid child in parallel: ${cid}`);
          if (child.kind === "branch") throw new Error(`Branch not allowed directly under parallel: ${cid}`);
          return sem.run(async () => {
            checkBudget();
            const r =
              child.kind === "model" || child.kind === "tool"
                ? await execWithRetry(child as ModelStep | ToolStep)
                : // allow nested map inside parallel
                  child.kind === "map"
                ? await execMapStep(child as MapStep)
                : (() => {
                    throw new Error(`Unsupported parallel child kind: ${(child as any).kind}`);
                  })();
            out.set(child.id, r);
          });
        });
        await Promise.all(proms);
        break;
      }

      case "branch": {
        const bs = s as BranchStep;
        const picked = bs.branches.find((b) => evalCondition(out, b.when));
        const runIds = picked?.then?.length ? picked.then : bs.else ?? [];
        for (const id of runIds) {
          const st = stepById.get(id);
          if (!st || st.kind === "parallel" || st.kind === "branch") {
            throw new Error(`Invalid step in branch.then: ${id}`);
          }
          const r =
            st.kind === "model" || st.kind === "tool"
              ? await execWithRetry(st as ModelStep | ToolStep)
              : st.kind === "map"
              ? await execMapStep(st as MapStep)
              : (() => {
                  throw new Error(`Unsupported step kind in branch: ${(st as any).kind}`);
                })();
          out.set(st.id, r);
        }
        break;
      }

      case "map": {
        const ms = s as MapStep;
        const res = await execMapStep(ms);
        out.set(ms.id, res);
        break;
      }

      case "model":
      case "tool": {
        const r = await execWithRetry(s as ModelStep | ToolStep);
        out.set(s.id, r);
        break;
      }

      default:
        throw new Error(`Unknown step kind: ${(s as any).kind}`);
    }
  }

  const outputs: Record<string, any> = {};
  for (const id of plan.outputs) outputs[id] = out.get(id);
  onEvent({ type: "done", outputs } as RunnerEvent);
  return { outputs };
}
