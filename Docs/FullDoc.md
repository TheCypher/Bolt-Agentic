# Bolt — Full Library Guide

> Build reliable, testable AI apps.
> Bolt gives you **agents**, a **router**, a typed **planner + runner** DSL, **tools**, and **memory** — with Next.js-friendly adapters and observability.

---

## What’s in the box

### Packages

* **`@bolt-ai/core`**
  Types, Router, Planner+Runner DSL, EventBus, Tools registry, Memory interface.
* **`@bolt-ai/next`**
  Next.js adapter (`createAppRouter`), SSE helpers, agent/template auto-discovery.
* **`@bolt-ai/providers-groq`**
  Groq provider; more providers can be added similarly.
* **`@bolt-ai/memory-redis`** (optional)
  Redis-backed `MemoryStore` with auto-detection via `REDIS_URL`.

---

## Quick Start (Next.js app)

**Install** (from your private tarballs or registry):

```bash
pnpm add @bolt-ai/core @bolt-ai/next @bolt-ai/providers-groq
# optional:
pnpm add @bolt-ai/memory-redis redis
```

**Env** (e.g. `.env.local`):

```bash
GROQ_API_KEY=...
# optional to auto-pick Redis memory:
REDIS_URL=rediss://default:***@your-redis-host:6379
```

**Project structure (suggested)**

```
src/
  agents/
    support.ts
    planner.ts
    index.ts           # publishes agents globally
  templates/
    weekly-report.ts
    index.ts           # publishes templates globally
  tools/
    defaults.ts        # register custom tools
  lib/
    bolt-router.ts
  app/
    api/
      ai/
        stream/route.ts
        plan/
          preview/route.ts
          run/route.ts
        llm/
          preview/route.ts
          run/route.ts
        debug/
          trace/route.ts
    planner/
      page.tsx
```

---

## Core Concepts

### 1) Router

The **AppRouter** orchestrates agents, tools, memory, and providers.

```ts
// src/lib/bolt-router.ts
import { createAppRouter } from '@bolt-ai/next';
import '@/agents';     // side-effect: publish agents to globalThis
import '@/templates';  // side-effect: publish templates to globalThis
import '@/tools/defaults'; // side-effect: register tools

export const routerPromise = createAppRouter({
  preset: 'fast',            // policy preset (if your build supports it)
  agentsDir: 'agents',       // auto-discovery fallback
  templatesDir: 'templates', // auto-discovery fallback
  // memory: createRedisMemoryStore(), // OR let adapter auto-pick if REDIS_URL set
});
```

* **Providers**: If `GROQ_API_KEY` is set and `@bolt-ai/providers-groq` is installed, the Next adapter auto-registers a Groq provider.
* **Memory**: Defaults to `InMemoryStore`. If `REDIS_URL` exists and `@bolt-ai/memory-redis` is installed, the adapter will try to use Redis.

**Explain & events (observability):**

```ts
const router = await routerPromise;
const { providers, tools } = router.explain({ agentId: 'support', input: 'Hi' });
router.events.subscribe((e) => console.log('[trace]', e));
```

### 2) Agents

Agents wrap model calls + optional tools/memory logic.

```ts
// src/agents/support.ts
import { defineAgent } from '@bolt-ai/agents';

export default defineAgent({
  id: 'support',
  description: 'Concise, helpful assistant',
  capabilities: ['text'],
  async run({ input, call, memory }) {
    const hist = await memory.history('support', 4);
    return call({
      kind: 'text',
      prompt: `Helpful answers only.\nHistory: ${JSON.stringify(hist)}\nUser: ${String(input)}`
    });
  }
});
```

**LLM Planner agent (optional):**

```ts
// src/agents/planner.ts
import { defineAgent } from '@bolt-ai/agents';

const DSL_DESC = `
Return ONLY JSON: { "id": string, "steps": PlanStep[], "outputs": string[] }
Steps: 'model'|'tool'|'parallel'|'map'|'branch'. Use short ids. No prose.
`;

export default defineAgent({
  id: 'planner',
  description: 'Emits Bolt Plan JSON for a given goal; strictly JSON only.',
  capabilities: ['text'],
  async run({ input, call }) {
    const goal = typeof input === 'string' ? input : JSON.stringify(input);
    return call({ kind: 'text', prompt: `Goal: ${goal}\n\n${DSL_DESC}` });
  }
});
```

**Publish your agents:**

```ts
// src/agents/index.ts
import support from './support';
import planner from './planner';

const g = globalThis as any;
g.__BOLT_AGENTS__ = { ...(g.__BOLT_AGENTS__ || {}), [support.id]: support, [planner.id]: planner };
export {};
```

### 3) Tools

Tools are functions you can call from plans (and agents, if you want). Tools run **server-side**.

```ts
// src/tools/defaults.ts
import { httpFetchTool, defineTool } from '@bolt-ai/core';
import { routerPromise } from '@/lib/bolt-router';

const webSearch = defineTool({
  id: 'web.search',
  schema: { type: 'object', properties: { query: { type: 'string' }, topK: { type: 'number' } }, required: ['query'] },
  async run({ query, topK = 4 }) {
    // replace with real search API (SerpAPI, Tavily, etc.)
    return [
      { title: 'Result A', url: 'https://example.com/a' },
      { title: 'Result B', url: 'https://example.com/b' },
    ].slice(0, topK);
  }
});

(async () => {
  const router: any = await routerPromise;
  router.tools.register(httpFetchTool);
  router.tools.register(webSearch);
})();
```

* **Use many tools** in one plan.
* Build your own tools (DB writes, API calls, file ops), and expose them to the planner & runner.
* You can bridge **MCP servers** by wrapping them as Tools (call the MCP server in `run()`).

### 4) Planner + Runner DSL

Bolt describes workflows as a **Plan** — a small JSON graph the **runner** executes deterministically.

Supported step kinds:

* `model` — call an agent (LLM) with inputs from previous steps.
* `tool` — call a named tool with `args` or upstream inputs.
* `parallel` — run listed children concurrently.
* `map` — iterate over an array from another step, run a child step per item.
* `branch` — simple condition-based branching (`truthy`, `eq`, `gt`, `lt`).

**Types snapshot**

```ts
type BaseStep = {
  id: string;
  guard?: { schema?: any; retry?: { max: number; backoffMs?: number } };
  cacheKey?: string | 'auto';
  timeoutMs?: number;
  idempotencyKey?: string;
};

type ModelStep = BaseStep & { kind: 'model'; agent: string; inputFrom?: string[] };
type ToolStep  = BaseStep & { kind: 'tool'; toolId: string; args?: any; inputFrom?: string[] };

type ParallelStep = BaseStep & { kind: 'parallel'; children: string[]; maxConcurrency?: number };

type Expr =
  | { var: string } | { value: any }
  | string | number | boolean | null;
type Condition =
  | { truthy: string }
  | { eq: { left: Expr; right: Expr } }
  | { gt: { left: Expr; right: Expr } }
  | { lt: { left: Expr; right: Expr } }
  | string; // shorthand: "stepId" → truthy

type BranchStep = BaseStep & {
  kind: 'branch';
  branches: { when: Condition; then: string[] }[];
  else?: string[];
};

type MapChild =
  | ({ kind: 'model'; agent: string; inputFrom?: string[] } & Omit<BaseStep, 'id'>)
  | ({ kind: 'tool';  toolId: string; args?: any; inputFrom?: string[] } & Omit<BaseStep, 'id'>);

type MapStep = BaseStep & {
  kind: 'map';
  itemsFrom: string;
  child: MapChild;
  maxConcurrency?: number;
  fromItemAsInput?: boolean;
};

type PlanStep = ModelStep | ToolStep | ParallelStep | BranchStep | MapStep;

interface Plan { id: string; steps: PlanStep[]; outputs: string[] }
```

---

## Three ways to get a Plan

### A) Templates (deterministic, testable)

Author plans as code. Great for **known workflows**.

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
      { id: 'sales',   kind: 'tool', toolId: 'kpi.fetch',   args: { name: 'sales'   }, inputFrom: ['prep'], cacheKey: 'auto' },
      { id: 'signups', kind: 'tool', toolId: 'kpi.fetch',   args: { name: 'signups' }, inputFrom: ['prep'], cacheKey: 'auto' },
      { id: 'errors',  kind: 'tool', toolId: 'kpi.fetch',   args: { name: 'errors'  }, inputFrom: ['prep'], cacheKey: 'auto' },

      { id: 'summary', kind: 'model', agent: agentId, inputFrom: ['sales', 'signups', 'errors'], cacheKey: 'auto' },
      { id: 'post',    kind: 'tool',  toolId: 'notify.slack', inputFrom: ['summary'] }
    ];
    return { id: crypto.randomUUID(), steps, outputs: ['summary'] };
  }
});
```

**Publish templates:**

```ts
// src/templates/index.ts
import weekly from './weekly-report';
const g = globalThis as any;
g.__BOLT_TEMPLATES__ = { ...(g.__BOLT_TEMPLATES__ || {}), [weekly.id]: weekly };
export {};
```

**Preview & run routes:**

```ts
// /api/ai/plan/preview (POST { templateId, goal, agentId })
import '@/templates';
import { routerPromise } from '@/lib/bolt-router';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { templateId='weekly-report', goal='Generate a report', agentId='support', memoryScope='plan:weekly' } =
    await req.json().catch(() => ({}));
  const router: any = await routerPromise;
  const plan = await router.runTemplate(templateId, { goal, agentId, memoryScope });
  return new Response(JSON.stringify({ ok: true, plan }, null, 2), { headers: { 'content-type': 'application/json' } });
}
```

```ts
// /api/ai/plan/run (POST { templateId, ... })
import '@/templates';
import { runPlan, InMemoryStepCache } from '@bolt-ai/core';
import { routerPromise } from '@/lib/bolt-router';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { templateId='weekly-report', goal='Generate a report', agentId='support', memoryScope='plan:weekly' } =
    await req.json().catch(() => ({}));
  const router: any = await routerPromise;
  const plan = await router.runTemplate(templateId, { goal, agentId, memoryScope });

  // mock tools (replace with production implementations)
  const tools = {
    'kpi.fetch': async ({ name }: { name: string }) => ({ name, value: Math.floor(Math.random()*1000) }),
    'notify.slack': async (msg: any) => ({ ok: true, preview: msg }),
  };

  const result = await runPlan(router, plan, { taskId: plan.id, agentId, input: goal, memoryScope, tools: tools as any }, {
    maxConcurrency: 4,
    cache: new InMemoryStepCache(),
    onEvent: (e) => console.log('[runner]', e),
  });

  return new Response(JSON.stringify({ ok: true, plan, result }, null, 2), { headers: { 'content-type': 'application/json' } });
}
```

**Real-world uses**: weekly ops digest, content QA pipeline, invoice intake, bulk URL checks, sales pipeline enrichment.

---

### B) Heuristic planner (built-in)

Tiny auto-plan that handles simple tasks and “A vs B” compares.

```ts
// /api/ai/heuristic/run
import { createHeuristicPlan, runPlan } from '@bolt-ai/core';
import { routerPromise } from '@/lib/bolt-router';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { goal='Compare Next.js vs Remix', agentId='support', memoryScope='plan:heur' } =
    await req.json().catch(() => ({}));
  const router: any = await routerPromise;

  const plan = await createHeuristicPlan(router, { taskId: crypto.randomUUID(), agentId, input: goal, memoryScope });
  const result = await runPlan(router, plan, { taskId: plan.id, agentId, input: goal, memoryScope, tools: {} }, { maxConcurrency: 3 });

  return new Response(JSON.stringify({ ok: true, plan, result }, null, 2), { headers: { 'content-type': 'application/json' } });
}
```

**Real-world uses**: quick summaries, simple comparisons, one-shot answers.

---

### C) LLM Planner (open-ended)

Ask a planner agent to emit Plan JSON. Good for **exploratory** tasks.

```ts
// /api/ai/llm/run
import '@/agents';
import { createLLMPlan, runPlan, InMemoryStepCache } from '@bolt-ai/core';
import { routerPromise } from '@/lib/bolt-router';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { goal='Research 3 sources on WebGPU and synthesize', agentId='planner', memoryScope='plan:llm' } =
    await req.json().catch(() => ({}));
  const router: any = await routerPromise;

  const plan = await createLLMPlan(router, { goal, agentId, memoryScope, maxSteps: 10 });

  // Give the runner a toolbox; plans can mix tools & model steps
  const tools = {
    'web.search': async ({ query }: { query: string }) => [{ title: 'A', url: 'https://a' }, { title: 'B', url: 'https://b' }],
    'http.fetch': async ({ url }: { url: string }) => ({ status: 200, text: `fake for ${url}` }),
  };

  const events: any[] = [];
  const result = await runPlan(
    router,
    plan,
    { taskId: plan.id, agentId, input: goal, memoryScope, tools: tools as any },
    { maxConcurrency: 4, cache: new InMemoryStepCache(), onEvent: (e) => events.push(e) }
  );

  return new Response(JSON.stringify({ ok: true, plan, events, result }, null, 2), { headers: { 'content-type': 'application/json' } });
}
```

**Real-world uses**: research & synthesize, multi-source aggregation, ad-hoc structured workflows.

---

## Streaming chat (SSE)

```ts
// /api/ai/stream/route.ts
import '@/agents';
import { sse } from '@bolt-ai/next';
import { routerPromise } from '@/lib/bolt-router';

export const runtime = 'nodejs';
export const GET = sse(routerPromise);
```

Client will receive:

* `start` → `{ agentId }`
* `token` → `{ delta }` chunks (if provider streams)
* `message` → `{ text }` final
* `done`, `error`

---

## Observability & Debugging

### SSE Router Trace

```ts
// /api/ai/debug/trace/route.ts (POST)
import { routerPromise } from '@/lib/bolt-router';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { mode='plan:heur', goal='Compare Next.js vs Remix', templateId='weekly-report', agentId='support' } =
    await req.json().catch(() => ({}));
  const router: any = await routerPromise;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: any) => {
        controller.enqueue(enc.encode(`event: ${event}\n`));
        controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const unsub = router.events.subscribe((e: any) => send('trace', e));
      send('start', { mode });

      try {
        if (mode === 'route') {
          await router.route({ id: crypto.randomUUID(), agentId, input: goal });
        } else if (mode === 'plan:heur') {
          const { createHeuristicPlan, runPlan } = await import('@bolt-ai/core');
          const plan = await createHeuristicPlan(router, { taskId: crypto.randomUUID(), agentId, input: goal });
          await runPlan(router, plan, { taskId: plan.id, agentId, input: goal, tools: {} }, { onEvent: (e) => send('runner', e) });
        } else if (mode === 'plan:template') {
          const { runPlan } = await import('@bolt-ai/core');
          const plan = await router.runTemplate(templateId, { goal, agentId });
          await runPlan(router, plan, { taskId: plan.id, agentId, input: goal, tools: {} }, { onEvent: (e) => send('runner', e) });
        }
        send('done', {});
      } catch (err: any) {
        send('error', { message: String(err?.message ?? err) });
      } finally {
        unsub?.();
        controller.close();
      }
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

**Simple UI**

```tsx
// /debug/trace/page.tsx
'use client';
import * as React from 'react';

export default function TracePage() {
  const [goal, setGoal] = React.useState('Compare Next.js vs Remix');
  const [mode, setMode] = React.useState<'route'|'plan:heur'|'plan:template'>('plan:heur');
  const [log, setLog] = React.useState<any[]>([]);
  const [busy, setBusy] = React.useState(false);

  function push(e: any) { setLog(prev => [...prev, e]); }

  async function start() {
    setBusy(true); setLog([]);
    const res = await fetch('/api/ai/debug/trace', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode, goal, templateId: 'weekly-report' }),
    });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const lines = chunk.split('\n');
        const ev = lines.find(l => l.startsWith('event: '))?.slice(7).trim();
        const data = lines.find(l => l.startsWith('data: '))?.slice(6);
        if (ev && data) push({ event: ev, data: JSON.parse(data) });
      }
    }
    setBusy(false);
  }

  return (
    <main className="max-w-4xl mx-auto p-6 space-y-4">
      <h1 className="text-xl font-semibold">Trace Debug</h1>
      <div className="flex gap-2 items-center">
        <select className="border rounded px-2 py-2" value={mode} onChange={e => setMode(e.target.value as any)}>
          <option value="route">Route (single agent)</option>
          <option value="plan:heur">Plan: Heuristic</option>
          <option value="plan:template">Plan: Template</option>
        </select>
        <input className="border rounded px-3 py-2 flex-1" value={goal} onChange={e => setGoal(e.target.value)} />
        <button className="border rounded px-4 py-2" onClick={start} disabled={busy}>{busy ? 'Running…' : 'Start'}</button>
      </div>
      <pre className="bg-neutral-100 rounded p-3 h-[70vh] overflow-auto text-sm">
        {log.map((l, i) => <div key={i}>{JSON.stringify(l)}</div>)}
      </pre>
    </main>
  );
}
```

---

## Memory

Bolt persists lightweight state via a **MemoryStore**:

* **InMemoryStore** (default) — zero-config, per-process, ephemeral.
* **RedisMemoryStore** — shared & persistent.

**Use Redis (auto):** install `@bolt-ai/memory-redis`, set `REDIS_URL`.

**Force InMemory explicitly:**

```ts
import { createAppRouter, InMemoryStore } from '@bolt-ai/core';
const router = createAppRouter({ providers: [...], memory: new InMemoryStore() });
```

**Force Redis explicitly:**

```ts
import { createRedisMemoryStore } from '@bolt-ai/memory-redis';
const router = createAppRouter({ providers: [...], memory: createRedisMemoryStore() });
```

---

## Real-World Patterns

* **Ops Report** (template): parallel KPI fetch → synth → notify.
* **Docs Intake** (template): OCR (tool) → extract (model w/ zod guard) → branch: valid? save : ask-fix → summarize.
* **Content QA** (template): fetch → chunk → map (model scoring) → threshold filter → synth comments.
* **Research** (LLM planner): search + fetch → multi-source synthesis (citations) → export.
* **Compare** (heuristic): detect “A vs B” → fan-out → synth.

---

## Testing

* **Template plans** are deterministic JSON — snapshot them.
* **Runner**: pass **mock tools** and assert outputs.
* **Agents**: pre-record provider outputs (or stub provider).

Example (jest-ish):

```ts
import { runPlan } from '@bolt-ai/core';

test('weekly-report template runs', async () => {
  const plan = /* build or load JSON */;
  const tools = {
    'kpi.fetch': async ({ name }: any) => ({ name, value: 100 }),
    'notify.slack': async (msg: any) => ({ ok: true }),
  };
  const router = /* make a test router with a stub provider */;
  const res = await runPlan(router as any, plan, { taskId: plan.id, agentId: 'support', input: 'go', tools }, {});
  expect(res.outputs.summary).toBeDefined();
});
```

---

## Security & Production Notes

* **Tools** run server-side. Keep them safe: validate args, sanitize headers, enforce domain allow-lists.
* **Timeouts**: The default runner treats `timeoutMs` as a hint; enforce timeouts inside tools (AbortController) or extend the runner to hard-cancel.
* **Redaction**: If you log traces, redact secrets (add a redactor in `RouterOptions.redact`).
* **Memory**: Use Redis in prod to share state across instances.
* **Caching**: Use `cacheKey: 'auto'` + a `StepCache` for expensive/pure steps.

---

## Troubleshooting

* **Template not found**: Ensure you import `@/templates` somewhere in the API route (so Next bundles it), or use `templatesDir`.
* **Agent not found**: Ensure you import `@/agents` similarly.
* **Using Redis but see InMemory**: Check `REDIS_URL` and that `@bolt-ai/memory-redis` is installed in the **app** (not just the monorepo).
* **Tool not found**: Register tools on startup; confirm `router.tools.list()` includes them.
* **Streaming tokens**: Not all providers support it; Groq does for text models — ensure your provider implementation forwards `onToken`.

---

## Why Bolt?

* **Deterministic workflows** when you want them (templates).
* **Flexible** for open-ended asks (LLM planner).
* **Typed** plan DSL → easy to test, snapshot, and render (DAG).
* **Composable**: mix agents, tools, branches, maps, parallel fan-out.
* **Next-friendly**: plug-and-play API routes, SSE, auto-discovery.