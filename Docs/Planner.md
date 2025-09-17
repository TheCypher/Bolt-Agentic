# Bolt Planner Guide

> **Make agent workflows reliable, testable, and composable.**
> The Planner turns a vague goal into a concrete sequence of steps that the **Runner** executes with retries, validation, parallelism, mapping, branching, and optional caching.

---

## Why the Planner?

Most real apps are not “one prompt.” They are **workflows**:

* Gather context → call tools/APIs → validate/clean → synthesize → notify/store.
* You want **reliability** (retries, guards), **speed** (parallel fan-out), **control** (deterministic steps), and **observability** (events to drive UIs).

The Planner gives you a small **Plan JSON** that captures this flow. The Runner then executes it deterministically and emits events you can stream to the client for progress/DAG UIs.

---

## What you can build

* **Single step** tasks (degenerates to one model call).
* **Multi-step** flows mixing **model** and **tool** steps.
* **Parallel** fan-out (`parallel`) for independent steps.
* **Map** an array (`map`) with per-map concurrency.
* **Branch** conditionally (`branch`) on structured conditions.
* **Guards** to validate outputs, **retries** with backoff, and **caching** per step.

---

## Core Concepts (DSL)

### Plan

```ts
export interface Plan {
  id: string;
  steps: PlanStep[];
  outputs: string[]; // which step outputs to return in the end
}
```

### Step types

```ts
type BaseStep = {
  id: string;
  guard?: Guard;                  // schema + retry policy
  cacheKey?: string | 'auto';     // enable caching for this step
  timeoutMs?: number;             // hint for your code/tools (runner doesn't hard-cancel)
  idempotencyKey?: string;        // pass through to tools if you support it
};

export type ModelStep = BaseStep & {
  kind: 'model';
  agent: string;
  inputFrom?: string[];           // upstream step IDs
};

export type ToolStep = BaseStep & {
  kind: 'tool';
  toolId: string;
  args?: any;
  inputFrom?: string[];
};

export type ParallelStep = BaseStep & {
  kind: 'parallel';
  children: string[];             // child step IDs to run concurrently (model/tool)
  maxConcurrency?: number;        // cap within this group
};

// Simple expressions/conditions for branches
export type Condition =
  | { truthy: string }            // treat outputs["..."] as boolean
  | { eq: { left: any; right: any } }
  | { gt: { left: any; right: any } }
  | { lt: { left: any; right: any } }
  | string;                       // shorthand: "someStep" → truthy

export type BranchStep = BaseStep & {
  kind: 'branch';
  branches: { when: Condition; then: string[] }[];
  else?: string[];
};

// Map over an array from a previous step
export type MapChild =
  | ({ kind: 'model'; agent: string; inputFrom?: string[] } & Omit<BaseStep, 'id'>)
  | ({ kind: 'tool'; toolId: string; args?: any; inputFrom?: string[] } & Omit<BaseStep, 'id'>);

export type MapStep = BaseStep & {
  kind: 'map';
  itemsFrom: string;              // step ID whose output is an array
  child: MapChild;                // the template step to run for each item
  maxConcurrency?: number;        // per-map concurrency
  fromItemAsInput?: boolean;      // pass array item as child's input
};

export type PlanStep = ModelStep | ToolStep | ParallelStep | BranchStep | MapStep;
```

### Guards & retries

```ts
export interface Guard {
  schema?: any;                   // zod or anything with safeParse()
  scoreCheck?: { min: number; scorer: 'consistency' | 'toxicity' | 'grounding' };
  retry?: { max: number; backoffMs?: number };  // backoff optional
}
```

### Runner options & cache

```ts
export interface StepCache {
  get(key: string): Promise<any | null>;
  set(key: string, value: any, ttlSeconds?: number): Promise<void>;
}

export interface RunOptions {
  maxConcurrency?: number;        // default 3
  onEvent?: (e: RunnerEvent) => void;
  cache?: StepCache | null;       // optional per-step cache
  defaultStepTTLSeconds?: number; // default 300
}
```

> The repo ships **`InMemoryStepCache`** (great for demos & tests).

---

## Three ways to get a Plan

1. **Templates** *(deterministic, testable)*
   You hand-author a function that returns a `Plan`. Best for **known, repeatable** business flows you want to unit test.

   **Real world:** Weekly ops report, invoice intake, bulk URL checker, onboarding workflows.

2. **Heuristic planner** *(built-in)*
   A tiny auto-planner for simple tasks, including “**compare A vs B**”. Great for **quick wins** and dev ergonomics.

   **Real world:** “Compare Next.js vs Remix”, “Summarize this doc”.

3. **LLM planner** *(optional)*
   Ask a dedicated **planner agent** to emit Plan JSON constrained to the DSL. Use when the user’s request is **open-ended**.

   **Real world:** “Research 3 recent sources on WebGPU and synthesize with citations.”

---

## Using the Planner in a Next.js App

### 1) Router

```ts
// src/lib/bolt-router.ts
import '@/agents';
import '@/templates';
import { createAppRouter } from '@bolt-ai/next';

export const routerPromise = createAppRouter({
  preset: 'fast',
  agentsDir: 'agents',
  templatesDir: 'templates',      // if your build supports auto-discovery
});
```

> If your current `@bolt-ai/next` doesn’t scan templates, publish to a global (see below) and the adapter will pick them up.

### 2) Agents

```ts
// src/agents/support.ts
import { defineAgent } from '@bolt-ai/agents';

export default defineAgent({
  id: 'support',
  description: 'Concise answers & summaries',
  capabilities: ['text'],
  async run({ input, call, memory }) {
    const history = await memory.history('support', 6);
    return call({
      kind: 'text',
      prompt: `You are concise.\nHistory: ${JSON.stringify(history)}\nQuestion: ${
        typeof input === 'string' ? input : JSON.stringify(input)
      }`
    });
  }
});

// src/agents/index.ts (barrel to force bundling)
import support from './support';
const g = globalThis as any;
g.__BOLT_AGENTS__ = { ...(g.__BOLT_AGENTS__ || {}), [support.id]: support };
export {};
```

### 3) Templates (deterministic plans)

#### Example: **Weekly Ops Report**

Fetch three KPIs in parallel, summarize, and post to Slack.

```ts
// src/templates/weekly-report.ts
import { defineTemplate } from '@bolt-ai/core';
import type { Plan, PlanStep, TemplateContext } from '@bolt-ai/core';

export default defineTemplate({
  id: 'weekly-report',
  description: 'Fetch KPIs in parallel and summarize for Slack/email.',
  plan: ({ agentId }: TemplateContext): Plan => {
    const steps: PlanStep[] = [
      { id: 'prep', kind: 'model', agent: agentId, cacheKey: 'auto' },

      { id: 'fan', kind: 'parallel', children: ['sales', 'signups', 'errors'], maxConcurrency: 3 },
      { id: 'sales',   kind: 'tool', toolId: 'kpi.fetch', args: { name: 'sales'   }, inputFrom: ['prep'], cacheKey: 'auto' },
      { id: 'signups', kind: 'tool', toolId: 'kpi.fetch', args: { name: 'signups' }, inputFrom: ['prep'], cacheKey: 'auto' },
      { id: 'errors',  kind: 'tool', toolId: 'kpi.fetch', args: { name: 'errors'  }, inputFrom: ['prep'], cacheKey: 'auto' },

      { id: 'summary', kind: 'model', agent: agentId, inputFrom: ['sales', 'signups', 'errors'], cacheKey: 'auto' },
      { id: 'post',    kind: 'tool', toolId: 'notify.slack', inputFrom: ['summary'] }
    ];
    return { id: crypto.randomUUID(), steps, outputs: ['summary'] };
  }
});
```

Publish the template (global):

```ts
// src/templates/index.ts
import weekly from './weekly-report';
const g = globalThis as any;
g.__BOLT_TEMPLATES__ = { ...(g.__BOLT_TEMPLATES__ || {}), [weekly.id]: weekly };
export {};
```

Preview/run APIs:

```ts
// src/app/api/ai/plan/preview/route.ts
import '@/templates';
import { routerPromise } from '@/lib/bolt-router';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { templateId = 'weekly-report', goal = 'Generate a weekly ops summary', agentId = 'support' } =
    await req.json().catch(() => ({}));
  const router: any = await routerPromise;
  const plan = await router.runTemplate?.(templateId, { goal, agentId, memoryScope: 'plan:weekly' });
  if (!plan) return new Response(JSON.stringify({ ok: false, error: `template not found: ${templateId}` }), { status: 404 });
  return new Response(JSON.stringify({ ok: true, plan }, null, 2), { headers: { 'content-type': 'application/json' } });
}
```

```ts
// src/app/api/ai/plan/run/route.ts
import '@/templates';
import { runPlan, InMemoryStepCache } from '@bolt-ai/core';
import { routerPromise } from '@/lib/bolt-router';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { templateId = 'weekly-report', goal = 'Generate a weekly ops summary', agentId = 'support' } =
    await req.json().catch(() => ({}));
  const router: any = await routerPromise;

  const plan = await router.runTemplate?.(templateId, { goal, agentId, memoryScope: 'plan:weekly' });
  if (!plan) return new Response(JSON.stringify({ ok: false, error: `template not found: ${templateId}` }), { status: 404 });

  // Mock tools (swap for real API calls)
  const tools = {
    'kpi.fetch': async ({ name }: { name: string }) => {
      if (name === 'sales')   return { name, value: 125000, change: '+4.2%' };
      if (name === 'signups') return { name, value: 930,    change: '+1.1%' };
      if (name === 'errors')  return { name, value: 17,     change: '-35%' };
      return { name, value: 0, change: '0%' };
    },
    'notify.slack': async (message: any) => ({ ok: true, posted: true, preview: message }),
  };

  const result = await runPlan(
    router,
    plan,
    { taskId: plan.id, agentId, input: goal, memoryScope: 'plan:weekly', tools: tools as any },
    { maxConcurrency: 3, cache: new InMemoryStepCache() }
  );

  return new Response(JSON.stringify({ ok: true, plan, result }, null, 2), {
    headers: { 'content-type': 'application/json' }
  });
}
```

**Why this matters:** reproducible weekly summaries that you can test (snapshot plan JSON, mock tools, assert output shape).

---

### 4) Heuristic planner (built-in)

**Use when:** the prompt is simple, or has the shape “compare X vs Y”.

Preview & run:

```ts
// src/app/api/ai/heuristic/preview/route.ts
import { createHeuristicPlan } from '@bolt-ai/core';
import { routerPromise } from '@/lib/bolt-router';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { goal = 'Compare Next.js vs Remix', agentId = 'support', memoryScope = 'plan:heur' } =
    await req.json().catch(() => ({}));
  const router: any = await routerPromise;
  const plan = await createHeuristicPlan(router, { taskId: crypto.randomUUID(), agentId, input: goal, memoryScope });
  return new Response(JSON.stringify({ ok: true, plan }, null, 2), { headers: { 'content-type': 'application/json' } });
}
```

```ts
// src/app/api/ai/heuristic/run/route.ts
import { createHeuristicPlan, runPlan } from '@bolt-ai/core';
import { routerPromise } from '@/lib/bolt-router';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { goal = 'Compare Next.js vs Remix', agentId = 'support', memoryScope = 'plan:heur' } =
    await req.json().catch(() => ({}));
  const router: any = await routerPromise;
  const plan = await createHeuristicPlan(router, { taskId: crypto.randomUUID(), agentId, input: goal, memoryScope });

  const result = await runPlan(router, plan, { taskId: plan.id, agentId, input: goal, memoryScope, tools: {} }, { maxConcurrency: 3 });
  return new Response(JSON.stringify({ ok: true, plan, result }, null, 2), { headers: { 'content-type': 'application/json' } });
}
```

**Why this matters:** no authoring friction; you still get a structured plan + Runner benefits.

---

### 5) LLM planner (optional)

**Use when:** users ask for open-ended, variable workflows and you want the model to propose the steps (still constrained to the DSL).

A dedicated **planner agent**:

```ts
// src/agents/planner.ts
import { defineAgent } from '@bolt-ai/agents';

const DSL_DESC = `
Return ONLY a JSON object with shape:
{ "id": string, "steps": PlanStep[], "outputs": string[] }
Steps may be: model/tool/parallel/map/branch. Use short step IDs. No prose.
`;

export default defineAgent({
  id: 'planner',
  description: 'Emits Bolt Plan JSON for a given goal; strictly JSON only.',
  capabilities: ['text'],
  async run({ input, call }) {
    const goal =
      typeof input === 'string'
        ? input
        : (input && typeof input === 'object' && 'text' in (input as any))
        ? String((input as any).text)
        : JSON.stringify(input);

    const prompt = [`Goal: ${goal}`, `You are a planner that returns a Bolt Plan.`, DSL_DESC].join('\n\n');
    return call({ kind: 'text', prompt });
  }
});
```

Publish it:

```ts
// src/agents/index.ts
import support from './support';
import planner from './planner';
const g = globalThis as any;
g.__BOLT_AGENTS__ = { ...(g.__BOLT_AGENTS__ || {}), [support.id]: support, [planner.id]: planner };
export {};
```

APIs:

```ts
// src/app/api/ai/llm/preview/route.ts
import '@/agents';
import { createLLMPlan } from '@bolt-ai/core';
import { routerPromise } from '@/lib/bolt-router';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { goal = 'Research 3 sources on WebGPU (2024+) and synthesize with citations', agentId = 'planner', memoryScope = 'plan:llm' } =
    await req.json().catch(() => ({}));
  const router: any = await routerPromise;
  const plan = await createLLMPlan(router, { goal, agentId, memoryScope, maxSteps: 10 });
  return new Response(JSON.stringify({ ok: true, plan }, null, 2), { headers: { 'content-type': 'application/json' } });
}
```

```ts
// src/app/api/ai/llm/run/route.ts
import '@/agents';
import { createLLMPlan, runPlan, InMemoryStepCache } from '@bolt-ai/core';
import { routerPromise } from '@/lib/bolt-router';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { goal = 'Research 3 sources on WebGPU (2024+) and synthesize with citations', agentId = 'planner', memoryScope = 'plan:llm' } =
    await req.json().catch(() => ({}));
  const router: any = await routerPromise;

  const plan = await createLLMPlan(router, { goal, agentId, memoryScope, maxSteps: 10 });

  // Provide real tools for the plan to call (mocked here)
  const tools = {
    'web.search': async (q: { query: string }) => [{ title: 'A', url: 'https://a' }, { title: 'B', url: 'https://b' }],
    'http.fetch': async ({ url }: { url: string }) => ({ status: 200, text: `fake body for ${url}` }),
  };

  const events: any[] = [];
  const result = await runPlan(
    router,
    plan,
    { taskId: plan.id, agentId, input: goal, memoryScope, tools: tools as any },
    { maxConcurrency: 4, cache: new InMemoryStepCache(), onEvent: e => events.push(e) }
  );

  return new Response(JSON.stringify({ ok: true, plan, events, result }, null, 2), {
    headers: { 'content-type': 'application/json' }
  });
}
```

**Why this matters:** let the model draft sophisticated flows while you keep the **execution engine** deterministic & observable.

---

## Streaming progress (SSE)

You can stream Runner events to the client:

```ts
// src/app/api/ai/plan/stream/route.ts
import '@/templates';
import { routerPromise } from '@/lib/bolt-router';
import { runPlan, InMemoryStepCache } from '@bolt-ai/core';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { templateId = 'weekly-report', goal = 'Generate a weekly ops summary', agentId = 'support', memoryScope = 'plan:weekly' } =
    await req.json().catch(() => ({}));
  const router: any = await routerPromise;

  const plan = await router.runTemplate?.(templateId, { goal, agentId, memoryScope });
  if (!plan) return new Response('no template', { status: 404 });

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: any) => {
        controller.enqueue(enc.encode(`event: ${event}\n`));
        controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      (async () => {
        try {
          await runPlan(
            router,
            plan,
            { taskId: plan.id, agentId, input: goal, memoryScope, tools: {} },
            {
              maxConcurrency: 4,
              cache: new InMemoryStepCache(),
              onEvent: e => send(e.type, e),
            }
          );
        } catch (err: any) {
          send('error', { error: String(err?.message ?? err) });
        } finally {
          controller.close();
        }
      })();
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    }
  });
}
```

---

## Building a tiny DAG UI

Render step nodes and edges from the `Plan` to help devs/users see what will run. (Use your existing `DAG` component or keep it simple: nodes from `steps`, edges from `inputFrom` / `children` / `branches` / `itemsFrom`.)

---

## Testing & reliability

* **Snapshot** your `Plan` JSON in tests.
* **Mock tools** for deterministic runs.
* **Validate** model outputs with **zod** via `guard.schema` + `retry`.
* **Cache** pure/expensive steps with `cacheKey: 'auto'` and `RunOptions.cache`.
* **Map/Parallel**: cap concurrency to protect backends.

---

## Common pitfalls & fixes

* **“No template 'X'”**
  Make sure you import `@/templates` in routes *and* publish templates to `globalThis.__BOLT_TEMPLATES__` (or use `templatesDir` if your adapter supports it). Restart dev server to clear Turbopack caches.

* **Types out of sync**
  If you updated the DSL in `@bolt-ai/core`, rebuild/pack and reinstall that tarball in your Next app so `node_modules/@bolt-ai/core/dist/index.d.ts` matches your code.

* **SSE shows nothing**
  Ensure `onEvent` is wired and you’re enqueuing SSE lines as `event:` + `data:` pairs.

* **Timeouts**
  `timeoutMs` is a hint; enforce inside tools or extend the runner with `AbortController` if you need hard cancelation.

---

## Why this approach wins

* **Deterministic core**: your critical workflows are stable and testable (templates).
* **Flexible edges**: quick wins via heuristic planner; exploratory power with the LLM planner.
* **Operational excellence**: retries, validation, fan-out, map, branch, and caching—without giving up control.
* **Great DX & UX**: artifact plans you can diff; real-time events you can stream; easy DAG UIs.

---

## Quick checklist

* [ ] Define agents in `agents/` and publish via `agents/index.ts`.
* [ ] Define templates in `templates/` and publish via `templates/index.ts` (or use `templatesDir`).
* [ ] Add preview/run/stream endpoints for Templates, Heuristic, and LLM planners.
* [ ] (Optional) Add a DAG view and progress UI driven by Runner events.
* [ ] Write tests that snapshot plans and mock tools.
* [ ] Cache expensive/pure steps; guard structured outputs; cap concurrency.

Go orchestrate real multi-step AI workflows with confidence 🚀
