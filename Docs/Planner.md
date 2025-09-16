# Bolt Planner Guide

> **Make agent workflows reliable, testable, and composable.**
> The Planner turns a vague goal into a concrete sequence of steps—run by the Runner with retries, parallelism, guards, and optional caching.

---

## What is the Planner?

The **Planner** is Bolt’s orchestration layer:

* **Inputs:** a goal (string/JSON), the agent to use, and optional memory scope.
* **Output:** a **Plan** (JSON) – a graph of typed steps the **Runner** executes deterministically.

Why it matters:

* Real apps need **actions** (retrieve → call tools → validate → synthesize), not just one prompt.
* Smaller, typed steps with **retries**, **validation**, and **parallelism** yield better reliability and latency.
* Plans are **artifacts**: snapshot in tests, diff in PRs, replay, drive UIs (DAGs, progress bars).

---

## What can it do?

* **Single-step** tasks (degenerates to one model call).
* **Multi-step** flows with **model** and **tool** calls.
* **Parallel fan-out** (`parallel`) for independent steps.
* **Map** over arrays (`map`) with per-map concurrency.
* **Conditional branches** (`branch`) using simple conditions.
* **Guards** (schema checks), **retries** (with backoff), and optional **caching** per-step.

---

## Core Concepts (DSL)

A Plan is a small JSON object:

```ts
export interface Plan {
  id: string;
  steps: PlanStep[];
  outputs: string[]; // which step outputs to return at the end
}
```

Step types:

```ts
type BaseStep = {
  id: string;
  guard?: Guard;                 // schema + retry
  cacheKey?: string | 'auto';    // enable caching for this step
  timeoutMs?: number;            // hint for your code/tools
  idempotencyKey?: string;
};

export type ModelStep = BaseStep & {
  kind: 'model';
  agent: string;
  inputFrom?: string[];          // upstream step IDs
};

export type ToolStep = BaseStep & {
  kind: 'tool';
  toolId: string;
  args?: any;
  inputFrom?: string[];
};

export type ParallelStep = BaseStep & {
  kind: 'parallel';
  children: string[];            // child step IDs to run concurrently
  maxConcurrency?: number;
};

export type Condition =
  | { truthy: string }           // treat outputs["..."] as boolean
  | { eq: { left: any; right: any } }
  | { gt: { left: any; right: any } }
  | { lt: { left: any; right: any } }
  | string;                      // shorthand: "stepId" means truthy

export type BranchStep = BaseStep & {
  kind: 'branch';
  branches: { when: Condition; then: string[] }[];
  else?: string[];
};

export type MapChild =
  | ({ kind: 'model'; agent: string; inputFrom?: string[] } & Omit<BaseStep, 'id'>)
  | ({ kind: 'tool'; toolId: string; args?: any; inputFrom?: string[] } & Omit<BaseStep, 'id'>);

export type MapStep = BaseStep & {
  kind: 'map';
  itemsFrom: string;             // step ID whose output is an array
  child: MapChild;               // template step for each item
  maxConcurrency?: number;
  fromItemAsInput?: boolean;     // pass array item as child input
};

export type PlanStep = ModelStep | ToolStep | ParallelStep | BranchStep | MapStep;

export interface Guard {
  schema?: any; // zod or anything with safeParse()
  scoreCheck?: { min: number; scorer: 'consistency' | 'toxicity' | 'grounding' };
  retry?: { max: number; backoffMs?: number }; // optional backoffMs
}
```

Runner options:

```ts
export interface RunOptions {
  maxConcurrency?: number;                         // default 3
  onEvent?: (e: RunnerEvent) => void;              // progress events
  cache?: StepCache | null;                        // optional cache layer
  defaultStepTTLSeconds?: number;                  // default 300
}

export interface StepCache {
  get(key: string): Promise<any | null>;
  set(key: string, value: any, ttlSeconds?: number): Promise<void>;
}
```

---

## When to use which planner?

Plain English, real-world examples:

### 1) **Templates** (deterministic, testable)

You hand-write a plan. Use this when the workflow is **known and repeatable** and you want tests.

* **Weekly Ops Report:** Fetch metrics from 3 APIs in parallel, summarize, post to Slack.
* **Bulk URL Checker:** Map a list of URLs → fetch status → summarize failures.
* **Invoice Intake:** OCR → extract fields → validate → save → notify.

### 2) **Heuristic** planner (built in)

Bolt does a tiny autoplan for simple jobs. Use this for **quick wins** or **“compare A vs B”** tasks.

* **Compare frameworks:** “Compare Next.js vs Remix” → plan = prep → two branches → synthesize.
* **Quick summary:** “Summarize this text” → a single model step.

### 3) **LLM** planner (optional)

Ask a dedicated **planner agent** to emit Plan JSON. Use this when the request is **open-ended** and users vary widely.

* **Research task:** “Find 3 sources on WebGPU (2024+) and synthesize with citations.”
* **Ad-hoc workflows:** “Extract KPIs from these docs, flag risks, and email the owner.”

> Tip: keep core business flows as **templates** (stable, testable), and use **LLM planner** for exploratory tasks.

---

## End-to-end code examples

> These examples assume:
>
> * Next.js App Router
> * `@bolt-ai/core`, `@bolt-ai/next`, `@bolt-ai/agents`
> * Groq provider configured in your app (or adapt to your providers)

### Shared: router & support agent

**`src/lib/bolt-router.ts`**

```ts
import { createAppRouter } from '@bolt-ai/next';

export const routerPromise = createAppRouter({
  preset: 'fast',
  agentsDir: 'agents',        // auto-discovers your agents
  templatesDir: 'templates',  // if your @bolt-ai/next build supports it
});
```

**`src/agents/support.ts`** (a tiny general-purpose model agent)

```ts
import { defineAgent } from '@bolt-ai/agents';

export default defineAgent({
  id: 'support',
  description: 'Answers FAQs and summarizes content concisely.',
  capabilities: ['text'],
  async run({ input, call, memory }) {
    const history = await memory.history('support', 6);
    return call({
      kind: 'text',
      prompt: `You are a concise assistant.
History: ${JSON.stringify(history)}
Question: ${typeof input === 'string' ? input : JSON.stringify(input)}`
    });
  }
});
```

**Agent barrel to ensure bundling: `src/agents/index.ts`**

```ts
import support from './support';
// add planner agent later for LLM planner (see below)

const g = globalThis as any;
g.__BOLT_AGENTS__ = { ...(g.__BOLT_AGENTS__ || {}), [support.id]: support };
export {};
```

---

### A) TEMPLATES — Real-world “Weekly Ops Report”

**What it does:**
Fetch three KPIs in parallel from your APIs, then synthesize a short summary for Slack/email.

**Template:** `src/templates/weekly-report.ts`

```ts
import { defineTemplate } from '@bolt-ai/core';
import type { Plan, PlanStep, TemplateContext } from '@bolt-ai/core';

export default defineTemplate({
  id: 'weekly-report',
  description: 'Fetch KPIs in parallel and summarize for Slack/email.',
  plan: ({ agentId }: TemplateContext): Plan => {
    const steps: PlanStep[] = [
      { id: 'prep', kind: 'model', agent: agentId, cacheKey: 'auto' },
      { id: 'parallelFetch', kind: 'parallel', children: ['sales', 'signups', 'errors'], maxConcurrency: 3 },

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

**Template barrel:** `src/templates/index.ts`

```ts
import weekly from './weekly-report';
const g = globalThis as any;
g.__BOLT_TEMPLATES__ = { ...(g.__BOLT_TEMPLATES__ || {}), [weekly.id]: weekly };
export {};
```

**Preview API:** `src/app/api/ai/plan/preview/route.ts`

```ts
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

**Run API:** `src/app/api/ai/plan/run/route.ts`

```ts
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

  // Mock tools (replace with real implementations)
  const tools = {
    'kpi.fetch': async ({ name }: { name: string }) => {
      // fetch from your service here
      if (name === 'sales') return { name, value: 125000, change: '+4.2%' };
      if (name === 'signups') return { name, value: 930, change: '+1.1%' };
      if (name === 'errors') return { name, value: 17, change: '-35%' };
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

**Minimal UI (optional):** `src/app/planner/weekly/page.tsx`

```tsx
'use client';
import { useState } from 'react';

export default function WeeklyPlanner() {
  const [json, setJson] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function preview() {
    const r = await fetch('/api/ai/plan/preview', { method: 'POST', body: JSON.stringify({ templateId: 'weekly-report' }) });
    setJson(await r.json());
  }
  async function run() {
    setBusy(true);
    try {
      const r = await fetch('/api/ai/plan/run', { method: 'POST', body: JSON.stringify({ templateId: 'weekly-report' }) });
      setJson(await r.json());
    } finally { setBusy(false); }
  }
  return (
    <main className="max-w-3xl mx-auto p-6 space-y-3">
      <h1 className="text-xl font-semibold">Weekly Report (Template)</h1>
      <div className="flex gap-2">
        <button className="border rounded px-3 py-2" onClick={preview}>Preview Plan</button>
        <button className="border rounded px-3 py-2" onClick={run} disabled={busy}>{busy ? 'Running…' : 'Run Plan'}</button>
      </div>
      <pre className="bg-neutral-100 rounded p-3 text-sm h-[60vh] overflow-auto">{JSON.stringify(json, null, 2)}</pre>
    </main>
  );
}
```

> Adapt this template to other real use-cases:
>
> * **Bulk URL Checker:** `list` (tool) → `map` with `http.fetch` → `model` summary.
> * **Invoice Intake:** `ocr` (tool) → `model extract` (guard with zod) → branch (valid? store : requestFix).

---

### B) HEURISTIC — Real-world “Compare frameworks”

**What it does:**
For simple prompts, Bolt can auto-create a tiny plan. E.g., if it detects “compare A vs B”, it will do a small fan-out then synthesize.

**Preview API:** `src/app/api/ai/heuristic/preview/route.ts`

```ts
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

**Run API:** `src/app/api/ai/heuristic/run/route.ts`

```ts
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

**UI (optional):** `src/app/planner/heuristic/page.tsx`

```tsx
'use client';
import { useState } from 'react';

export default function HeuristicPlanner() {
  const [goal, setGoal] = useState('Compare Next.js vs Remix');
  const [json, setJson] = useState<any>(null);

  async function preview() {
    const r = await fetch('/api/ai/heuristic/preview', { method: 'POST', body: JSON.stringify({ goal }) });
    setJson(await r.json());
  }
  async function run() {
    const r = await fetch('/api/ai/heuristic/run', { method: 'POST', body: JSON.stringify({ goal }) });
    setJson(await r.json());
  }
  return (
    <main className="max-w-3xl mx-auto p-6 space-y-3">
      <h1 className="text-xl font-semibold">Heuristic Planner</h1>
      <input className="border rounded px-3 py-2 w-full" value={goal} onChange={e => setGoal(e.target.value)} />
      <div className="flex gap-2">
        <button className="border rounded px-3 py-2" onClick={preview}>Preview</button>
        <button className="border rounded px-3 py-2" onClick={run}>Run</button>
      </div>
      <pre className="bg-neutral-100 rounded p-3 text-sm h-[60vh] overflow-auto">{JSON.stringify(json, null, 2)}</pre>
    </main>
  );
}
```

---

### C) LLM PLANNER — Real-world “Research & Synthesize”

**What it does:**
Ask a dedicated **planner agent** to emit a Plan JSON for an open-ended goal. Then run that plan.

**Planner agent:** `src/agents/planner.ts`

```ts
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

    const prompt = [
      `Goal: ${goal}`,
      `You are a planner that returns a Bolt Plan.`,
      DSL_DESC
    ].join('\n\n');

    // Ask the model for plain JSON text
    return call({ kind: 'text', prompt });
  }
});
```

**Add planner to the barrel:** `src/agents/index.ts`

```ts
import support from './support';
import planner from './planner';
const g = globalThis as any;
g.__BOLT_AGENTS__ = { ...(g.__BOLT_AGENTS__ || {}), [support.id]: support, [planner.id]: planner };
export {};
```

**Preview API:** `src/app/api/ai/llm/preview/route.ts`

```ts
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

**Run API:** `src/app/api/ai/llm/run/route.ts`

```ts
import '@/agents';
import { createLLMPlan, runPlan, InMemoryStepCache } from '@bolt-ai/core';
import { routerPromise } from '@/lib/bolt-router';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { goal = 'Research 3 sources on WebGPU (2024+) and synthesize with citations', agentId = 'planner', memoryScope = 'plan:llm' } =
    await req.json().catch(() => ({}));
  const router: any = await routerPromise;

  const plan = await createLLMPlan(router, { goal, agentId, memoryScope, maxSteps: 10 });

  // Supply any real tools you want the plan to call; mock for now
  const tools = {
    'web.search': async (q: { query: string }) => [{ title: 'A', url: 'https://a' }, { title: 'B', url: 'https://b' }],
    'http.fetch': async ({ url }: { url: string }) => ({ status: 200, text: `fake body for ${url}` }),
  };

  const events: any[] = [];
  const result = await runPlan(
    router,
    plan,
    { taskId: plan.id, agentId, input: goal, memoryScope, tools: tools as any },
    { maxConcurrency: 4, cache: new InMemoryStepCache(), onEvent: (e) => events.push(e) }
  );

  return new Response(JSON.stringify({ ok: true, plan, events, result }, null, 2), {
    headers: { 'content-type': 'application/json' }
  });
}
```

**UI (optional):** `src/app/planner/llm/page.tsx`

```tsx
'use client';
import { useState } from 'react';

export default function LLMPlanner() {
  const [goal, setGoal] = useState('Research 3 sources on WebGPU (2024+) and synthesize with citations');
  const [json, setJson] = useState<any>(null);

  async function preview() {
    const r = await fetch('/api/ai/llm/preview', { method: 'POST', body: JSON.stringify({ goal }) });
    setJson(await r.json());
  }
  async function run() {
    const r = await fetch('/api/ai/llm/run', { method: 'POST', body: JSON.stringify({ goal }) });
    setJson(await r.json());
  }
  return (
    <main className="max-w-3xl mx-auto p-6 space-y-3">
      <h1 className="text-xl font-semibold">LLM Planner</h1>
      <input className="border rounded px-3 py-2 w-full" value={goal} onChange={e => setGoal(e.target.value)} />
      <div className="flex gap-2">
        <button className="border rounded px-3 py-2" onClick={preview}>Preview</button>
        <button className="border rounded px-3 py-2" onClick={run}>Run</button>
      </div>
      <pre className="bg-neutral-100 rounded p-3 text-sm h-[60vh] overflow-auto">{JSON.stringify(json, null, 2)}</pre>
    </main>
  );
}
```

---

## Best Practices

* **Keep steps small** and idempotent where possible.
* **Guard early**: validate structured outputs with zod or schema checks.
* **Fan-out then synthesize** for research/aggregation tasks.
* **Cache** expensive or pure steps (`cacheKey: 'auto'` + `RunOptions.cache`).
* **Map** for per-item processing; cap concurrency.
* **Branch** on explicit conditions (prefer `{ truthy: 'step.field' }`).
* **Test plans** as JSON! Snapshot in your repo; replay in CI.

---

## Notes

* `timeoutMs` is a **hint**; enforce inside tools/agents or extend the runner with `AbortController` to hard-cancel.
* `map.itemsFrom` expects a **step id** whose output is an array.
* If you update the DSL/types, **bump & republish** `@bolt-ai/core`, then reinstall in your app.

---

## Quick Start Checklist

1. Define agents in `agents/` (and import via `agents/index.ts`).
2. Define templates in `templates/` (and import via `templates/index.ts`) or pass `templatesDir` to the Next adapter.
3. Add **preview** and **run** endpoints for each planner flavor (Template / Heuristic / LLM).
4. (Optional) Add a tiny UI page to exercise each planner.

Go orchestrate real multi-step AI workflows with confidence 🚀
