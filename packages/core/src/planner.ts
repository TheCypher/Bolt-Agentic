// packages/core/src/planner.ts

import type { AppRouter } from "./router";
import type {
  Guard,
  Plan,
  PlanStep,
  RunnerContext,
  RunnerEvent,
  RunOptions,
} from "./types";

/* ----------------------------------------------
 * Utilities
 * ---------------------------------------------- */

// Stable stringify for cache signatures (sorts object keys)
const stableStringify = (v: any): string =>
  JSON.stringify(v, (_k, value: any) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.keys(value)
      .sort()
      .reduce((acc, k) => {
        (acc as any)[k] = (value as any)[k];
        return acc;
      }, {} as any);
  });

// Read nested "a.b[0].c" or "a.b.0.c" from a root object
const readPath = (root: any, path: string) => {
  const parts = String(path)
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);

  let cur = root;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p as any];
  }
  return cur;
};

// Compute a cache key for a step + input (when cacheKey === 'auto')
const autoCacheKey = (s: Extract<PlanStep, { kind: "model" } | { kind: "tool" }>, input: any) => {
  const sig =
    s.kind === "model"
      ? { k: "model", id: s.id, agent: s.agent, input }
      : { k: "tool", id: s.id, toolId: s.toolId, args: s.args ?? input };
  return `step:${s.id}:${stableStringify(sig)}`;
};

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

/* ----------------------------------------------
 * Runner
 * ---------------------------------------------- */

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
  const defaultTTL = Math.max(0, opts.defaultStepTTLSeconds ?? 300);

  // Evaluate inputs to a step
  const readInputs = (s: PlanStep) => {
    if (!("inputFrom" in s) || !s.inputFrom?.length) {
      // First model/tool step uses task input by default
      return ctx.input;
    }
    const arr = s.inputFrom.map((id) => out.get(id));
    return arr.length === 1 ? arr[0] : arr;
  };

  // Validate with guard.schema if provided
  const validate = (guard: Guard | undefined, value: any): boolean => {
    if (!guard?.schema) return true;
    const schema: any = guard.schema;
    if (schema?.safeParse) return Boolean(schema.safeParse(value)?.success);
    return true;
  };

  // Read "stepId" or "stepId.path.to.field" from outputs
  const refValue = (ref: string) => {
    const [head, ...rest] = String(ref).split(".");
    let v = out.get(head);
    if (!rest.length) return v;
    return readPath(v, rest.join("."));
  };

  // Deep resolve ${...} or { var: "..." } placeholders; supports "item.*" in map
  const deepResolve = (val: any, fromSteps: (ref: string) => any, item?: any): any => {
    if (typeof val === "string") {
      const m = val.match(/^\$\{([^}]+)\}$/);
      if (m) {
        const ref = m[1].trim();
        if (ref.startsWith("item") && item !== undefined) return readPath({ item }, ref);
        let v = fromSteps(ref);
        if (v === undefined) {
          // common LLM synonyms: result/results and url/link
          const alt = ref.replace(/\bresult\b/g, "results").replace(/\blink\b/g, "url");
          v = fromSteps(alt);
          if (v === undefined) {
            const alt2 = ref.replace(/\bresults\b/g, "result").replace(/\burl\b/g, "link");
            v = fromSteps(alt2);
          }
        }
        return v;
      }
      return val;
    }
    if (val && typeof val === "object") {
      if ("var" in val && typeof (val as any).var === "string") {
        const ref = String((val as any).var);
        if (ref.startsWith("item") && item !== undefined) return readPath({ item }, ref);
        return fromSteps(ref);
      }
      if (Array.isArray(val)) return val.map((v) => deepResolve(v, fromSteps, item));
      const out: any = {};
      for (const [k, v] of Object.entries(val)) out[k] = deepResolve(v, fromSteps, item);
      return out;
    }
    return val;
  };

  // Simple semaphore for concurrency control
  const pool = (limit: number) => {
    let active = 0;
    const q: (() => void)[] = [];
    const run = async <T>(fn: () => Promise<T>) => {
      if (active >= limit) await new Promise<void>((r) => q.push(r));
      active++;
      try {
        return await fn();
      } finally {
        active--;
        q.shift()?.();
      }
    };
    return { run };
  };
  const sem = pool(maxConc);

  // Step runner with retry/backoff, guard, and optional cache
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

        // Cache read (model/tool only)
        const cacheKey =
          s.cacheKey === "auto" ? autoCacheKey(s, input) : typeof s.cacheKey === "string" ? s.cacheKey : null;
        if (cacheKey && opts.cache) {
          const hit = await opts.cache.get(cacheKey);
          if (hit != null) {
            onEvent({ type: "step:done", stepId: s.id, output: hit } as RunnerEvent);
            return hit;
          }
        }

        // Execute the step
        const doExec = async () => {
          if (s.kind === "model") {
            return (router as any).route?.({
              id: `${ctx.taskId}:${s.id}:${attempt}`,
              agentId: s.agent,
              input,
              memoryScope: ctx.memoryScope,
            });
          } else {
            const tool = ctx.tools?.[s.toolId];
            if (!tool) throw new Error(`Tool not found: ${s.toolId}`);
            const rawArgs = s.args ?? input;
            const args = deepResolve(rawArgs, refValue); // resolve ${...} and { var: ... }
            return tool(args, { ...ctx });
          }
        };

        // Optional per-step timeout hint (best-effort: we don't cancel the underlying call)
        const result = s.timeoutMs && s.timeoutMs > 0
          ? await Promise.race([
              doExec(),
              new Promise((_res, rej) => setTimeout(() => rej(new Error("Step timeout")), s.timeoutMs)),
            ])
          : await doExec();

        if (!validate(s.guard, result)) throw new Error("Schema validation failed");

        // Cache write
        if (cacheKey && opts.cache) {
          await opts.cache.set(cacheKey, result, defaultTTL);
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

  // Condition evaluator for branch steps
  const evalCondition = (cond: any): boolean => {
    if (cond == null) return false;
    if (typeof cond === "string") return Boolean(refValue(cond));
    if (typeof cond === "object") {
      if ("truthy" in cond) return Boolean(refValue(cond.truthy));
      const bin = (pair: { left: any; right: any }, op: "eq" | "gt" | "lt") => {
        const lhs = resolveExpr(pair.left);
        const rhs = resolveExpr(pair.right);
        if (op === "eq") return lhs === rhs;
        if (op === "gt") return Number(lhs) > Number(rhs);
        if (op === "lt") return Number(lhs) < Number(rhs);
        return false;
      };
      if ("eq" in cond) return bin(cond.eq, "eq");
      if ("gt" in cond) return bin(cond.gt, "gt");
      if ("lt" in cond) return bin(cond.lt, "lt");
    }
    return false;
  };

  const resolveExpr = (expr: any): any => {
    if (expr && typeof expr === "object") {
      if ("var" in expr && typeof expr.var === "string") return refValue(expr.var);
      if ("value" in expr) return (expr as any).value;
    }
    return expr;
  };

  // Start
  onEvent({ type: "plan", plan } as RunnerEvent);

  for (const s of plan.steps) {
    // Parallel: run listed children concurrently
    if (s.kind === "parallel") {
      const proms = s.children.map((cid) => {
        const child = stepById.get(cid);
        if (!child || child.kind === "parallel") throw new Error(`Invalid child in parallel: ${cid}`);
        if (child.kind === "branch" || child.kind === "map") {
          throw new Error(`Unsupported child kind in parallel: ${child.kind}`);
        }
        return sem.run(async () => {
          const r = await execWithRetry(child as ModelOrTool);
          out.set(child.id, r);
        });
      });
      await Promise.all(proms);
      continue;
    }

    // Branch: pick first matching branch, else 'else'
    if (s.kind === "branch") {
      const picked = s.branches.find((b) => evalCondition(b.when));
      const seq = picked ? picked.then : s.else ?? [];
      for (const id of seq) {
        const st = stepById.get(id);
        if (!st || st.kind === "parallel" || st.kind === "branch") {
          throw new Error(`Invalid step in branch.then/else: ${id}`);
        }
        const r = await execWithRetry(st as ModelOrTool);
        out.set(st.id, r);
      }
      continue;
    }

    // Map: iterate an array from itemsFrom and run a child step per item
    if (s.kind === "map") {
      const items = out.get(s.itemsFrom);
      if (!Array.isArray(items)) {
        throw new Error(`map.itemsFrom '${s.itemsFrom}' did not yield an array`);
      }
      const child = s.child;
      const conc = Math.max(1, s.maxConcurrency ?? maxConc);
      const local = pool(conc);

      const results: any[] = [];
      await Promise.all(
        items.map((item, idx) =>
          local.run(async () => {
            const childId = `${s.id}:${idx}`;
            const childInput = s.fromItemAsInput ? item : readInputs(child as any);
            const rawArgs = (child as any).args ?? childInput;
            const args = deepResolve(rawArgs, refValue, item);

            let r: any;
            if (child.kind === "model") {
              r = await (router as any).route?.({
                id: `${ctx.taskId}:${childId}`,
                agentId: child.agent,
                input: childInput,
                memoryScope: ctx.memoryScope,
              });
            } else {
              const t = ctx.tools?.[child.toolId];
              if (!t) throw new Error(`Tool not found: ${child.toolId}`);
              r = await t(args, { ...ctx });
            }
            results[idx] = r;
          })
        )
      );

      out.set(s.id, results);
      continue;
    }

    // Model/tool
    const r = await execWithRetry(s as ModelOrTool);
    out.set(s.id, r);
  }

  const outputs: Record<string, any> = {};
  for (const id of plan.outputs) outputs[id] = out.get(id);

  onEvent({ type: "done", outputs } as RunnerEvent);
  return { outputs };
}
