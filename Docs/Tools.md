# Bolt Tools Guide

> **Tools connect your agents and planners to the real world.**
> They wrap side-effects (HTTP, DB, search, files, MCP servers) behind a typed interface the Runner can orchestrate with retries, branching, parallelism, and caching.

---

## What is a Tool?

A **Tool** is a small, async function with an ID and optional schema that the Runner can call as a step in a `Plan`.

```ts
// from @bolt-ai/core types
export interface ToolContext {
  allow?: string[];            // optional allowlist
  memory?: MemoryStore;        // optional memory access
  signal?: AbortSignal;        // optional cancellation
}

export interface Tool<TArgs = any, TOut = any> {
  id: string;                  // unique name like "http.fetch"
  schema?: any;                // optional zod schema for args (recommended)
  run(args: TArgs, ctx: ToolContext): Promise<TOut>;
}
```

In practice, you’ll usually expose tools to the Runner as a map:

```ts
type ToolFn = (args: any, ctx: RunnerContext) => Promise<any>;
type ToolsMap = Record<string, ToolFn>;
```

> The runner accepts a `tools` map in its context. You can build that map from simple functions or from richer `Tool` objects you register centrally.

---

## When to Use Tools

* **Call external APIs** (HTTP GET/POST, Slack, Stripe, your backend).
* **Search** (SerpAPI, Tavily, internal search).
* **Read data** (databases, vector stores).
* **Kick off workflows** (queues, webhooks).
* **Bridge to MCP servers** (local tools exposed via Model Context Protocol).

Tools keep effects **outside** of your agents and prompts—making flows testable, reusable, and safe.

---

## Ways to Provide Tools

You have two common patterns:

### A) Ad-hoc per request (quickest)

Provide a map to `runPlan`:

```ts
const tools = {
  'http.fetch': async (req: { url: string; method?: string; headers?: any; body?: any }) => {
    const res = await fetch(req.url, { method: req.method ?? 'GET', headers: req.headers, body: req.body && JSON.stringify(req.body) });
    return { status: res.status, text: await res.text() };
  }
};

await runPlan(router, plan, { taskId, agentId, input, tools });
```

### B) Register once (recommended for apps)

Publish tools at app startup and pick them up everywhere.

```ts
// src/tools/index.ts
import { z } from 'zod';

/** 1) Define concrete tool functions */
const httpFetch = async (args: { url: string; method?: string; headers?: any; body?: any }, _ctx: any) => {
  const res = await fetch(args.url, {
    method: args.method ?? 'GET',
    headers: args.headers,
    body: args.body && (typeof args.body === 'string' ? args.body : JSON.stringify(args.body))
  });
  return { status: res.status, text: await res.text() };
};

/** 2) Optionally attach schemas (zod) */
const HttpArgs = z.object({
  url: z.string().url(),
  method: z.string().optional(),
  headers: z.record(z.string()).optional(),
  body: z.any().optional(),
});

/** 3) Publish registry to a global bag so Next bundling includes it */
const g = globalThis as any;
g.__BOLT_TOOLS__ = {
  ...(g.__BOLT_TOOLS__ || {}),
  'http.fetch': Object.assign(httpFetch, { schema: HttpArgs }),
  // add more tools below…
};

export {}; // side-effect only
```

Use it by importing once in API routes:

```ts
// in API routes using runPlan
import '@/tools';  // ensures __BOLT_TOOLS__ is populated
…
const g = globalThis as any;
const registry = (g.__BOLT_TOOLS__ || {}) as Record<string, (args: any, ctx: any) => Promise<any>>;
await runPlan(router, plan, { taskId, agentId, input, tools: registry });
```

> You can also provide a helper `getTools()` that merges **default** tools with **app** tools.

---

## Default Tools You’ll Want

Below are production-ready, real-world tools you can drop in.

### 1) `http.fetch` – robust HTTP client (with timeout and AbortSignal)

```ts
// src/tools/http.ts
import { z } from 'zod';

export const HttpArgs = z.object({
  url: z.string(),
  method: z.enum(['GET','POST','PUT','PATCH','DELETE']).optional(),
  headers: z.record(z.string()).optional(),
  body: z.any().optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional()
});

export async function httpFetch(
  { url, method = 'GET', headers, body, timeoutMs = 15000 }: z.infer<typeof HttpArgs>,
  ctx: { signal?: AbortSignal }
) {
  // basic URL safety (the runner already resolves ${...} vars)
  try { new URL(url); } catch { throw new Error(`Invalid URL: ${url}`); }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort('timeout'), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body && (typeof body === 'string' ? body : JSON.stringify(body)),
      signal: ctx.signal ?? ctrl.signal
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, headers: Object.fromEntries(res.headers.entries()), text, json };
  } finally {
    clearTimeout(t);
  }
}
```

Register it:

```ts
// src/tools/index.ts
import { httpFetch, HttpArgs } from './http';
const g = globalThis as any;
g.__BOLT_TOOLS__ = { ...(g.__BOLT_TOOLS__ || {}), 'http.fetch': Object.assign(httpFetch, { schema: HttpArgs }) };
export {};
```

### 2) `web.search` – SerpAPI integration

```ts
// src/tools/search.ts
import { z } from 'zod';

const SerpArgs = z.object({
  query: z.string().min(2),
  num: z.number().int().min(1).max(10).optional()
});

export async function webSearch(
  { query, num = 5 }: z.infer<typeof SerpArgs>,
  _ctx: any
) {
  const key = process.env.SERPAPI_KEY;
  if (!key) throw new Error('Missing SERPAPI_KEY');
  const params = new URLSearchParams({ q: query, api_key: key, num: String(num), engine: 'google' });
  const r = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
  if (!r.ok) throw new Error(`SerpAPI error ${r.status}`);
  const j = await r.json();

  // normalize
  const results = (j.organic_results || []).slice(0, num).map((r: any) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet ?? r.snippet_highlighted_words?.join(' ') ?? ''
  }));
  return { results };
}
```

Register:

```ts
// src/tools/index.ts
import { webSearch } from './search';
import { z } from 'zod';
const SerpArgs = z.object({ query: z.string(), num: z.number().optional() });

const g = globalThis as any;
g.__BOLT_TOOLS__ = {
  ...(g.__BOLT_TOOLS__ || {}),
  'web.search': Object.assign(webSearch, { schema: SerpArgs })
};
export {};
```

**Example plan usage** (LLM or template):

```ts
// plan step that searches and fetches the first result:
{ id: 's1', kind: 'tool', toolId: 'web.search', args: { query: 'what is webgpu (2024)?', num: 3 } },
{ id: 'doc', kind: 'tool', toolId: 'http.fetch', args: { url: '${s1.results.0.url}' } },
{ id: 'summ', kind: 'model', agent: 'support', inputFrom: ['doc'] }
```

> Notice `${s1.results.0.url}`: our runner resolves that placeholder safely.
> If you see “Invalid URL” errors, your previous tool didn’t return a proper URL (or you didn’t register the tool).

### 3) `mcp.call` – Call tools on a local MCP server

> MCP (Model Context Protocol) exposes local/remote tools to LLM apps.
> Bolt can wrap MCP exposed tools as Bolt tools.

Minimal conceptual wrapper (pseudo-ish; you can adapt to your MCP SDK):

```ts
// src/tools/mcp.ts
import { z } from 'zod';
// Suppose you have an MCP client that can call a named tool
const mcp = createMcpClient({ command: 'node', args: ['path/to/server.js'] });

const McpArgs = z.object({
  tool: z.string(),            // MCP tool name
  params: z.record(z.any()).optional()
});

export async function mcpCall({ tool, params = {} }: z.infer<typeof McpArgs>) {
  // Ensure your MCP client is connected/reused across calls
  const out = await mcp.callTool(tool, params);
  return out; // normalize as you like
}
```

Register:

```ts
const g = globalThis as any;
g.__BOLT_TOOLS__ = { ...(g.__BOLT_TOOLS__ || {}), 'mcp.call': Object.assign(mcpCall, { schema: McpArgs }) };
```

**Template usage**:

```ts
// ask MCP server for a PDF→text conversion, then summarize
steps: [
  { id: 'pdf', kind: 'tool', toolId: 'mcp.call', args: { tool: 'pdf.extractText', params: { path: '/files/invoice.pdf' } } },
  { id: 'summary', kind: 'model', agent: 'support', inputFrom: ['pdf'] },
],
outputs: ['summary']
```

---

## Real-World Flows (using multiple tools & agents)

### 1) **Research & Synthesis** (web.search + http.fetch + model)

**Template:**

```ts
import { defineTemplate } from '@bolt-ai/core';
import type { Plan, PlanStep, TemplateContext } from '@bolt-ai/core';

export default defineTemplate({
  id: 'research',
  description: 'Search → fetch top hits → synthesize',
  plan: ({ agentId }: TemplateContext): Plan => {
    const steps: PlanStep[] = [
      { id: 'query', kind: 'model', agent: agentId, cacheKey: 'auto' },
      { id: 'search', kind: 'tool', toolId: 'web.search', args: { query: '${query}' } },
      { id: 'fan', kind: 'parallel', children: ['d0','d1','d2'], maxConcurrency: 3 },
      { id: 'd0', kind: 'tool', toolId: 'http.fetch', args: { url: '${search.results.0.url}' } },
      { id: 'd1', kind: 'tool', toolId: 'http.fetch', args: { url: '${search.results.1.url}' } },
      { id: 'd2', kind: 'tool', toolId: 'http.fetch', args: { url: '${search.results.2.url}' } },
      { id: 'synth', kind: 'model', agent: agentId, inputFrom: ['d0','d1','d2'], cacheKey: 'auto' },
    ];
    return { id: crypto.randomUUID(), steps, outputs: ['synth'] };
  }
});
```

**Run endpoint** (uses registered tools):

```ts
import '@/tools';
import { runPlan, InMemoryStepCache } from '@bolt-ai/core';
import { routerPromise } from '@/lib/bolt-router';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { templateId = 'research', goal = 'Summarize WebGPU post-2024', agentId = 'support' } = await req.json().catch(() => ({}));
  const router: any = await routerPromise;

  const plan = await router.runTemplate?.(templateId, { goal, agentId, memoryScope: 'plan:research' });
  if (!plan) return new Response(JSON.stringify({ ok: false, error: 'template not found' }), { status: 404 });

  const g = globalThis as any;
  const registry = (g.__BOLT_TOOLS__ || {}) as Record<string, (a: any, c: any) => Promise<any>>;

  const events: any[] = [];
  const result = await runPlan(
    router,
    plan,
    { taskId: plan.id, agentId, input: goal, memoryScope: 'plan:research', tools: registry },
    { maxConcurrency: 4, cache: new InMemoryStepCache(), onEvent: (e) => events.push(e) }
  );

  return new Response(JSON.stringify({ ok: true, plan, events, result }, null, 2), { headers: { 'content-type': 'application/json' } });
}
```

### 2) **Weekly Ops** (internal API fetch + Slack notify)

Tools: `kpi.fetch`, `notify.slack` + agent `support`. (See the Planner doc example you already have.)

### 3) **Invoice Intake** (MCP + validation + branch)

Tools: `mcp.call` → `db.save` → `notify.email`.
Guard with zod on the extraction step.

---

## Using Tools from Agents

Agents can call tools directly if you want (outside of Planner) by keeping a `ToolRegistry`. For example:

```ts
// tiny registry helper
class Registry {
  private map = new Map<string, (a: any, c: any) => Promise<any>>();
  register(id: string, fn: (a: any, c: any) => Promise<any>) { this.map.set(id, fn); }
  get(id: string) { return this.map.get(id); }
  list() { return [...this.map.keys()]; }
}

const registry = new Registry();
registry.register('http.fetch', httpFetch);
registry.register('web.search', webSearch);

// in an agent:
async run({ input, memory, call, tools }) {
  const search = registry.get('web.search')!;
  const res = await search({ query: String(input) }, { memory });
  return res;
}
```

> In most cases, prefer **Planner steps** for tool usage—so you can add guards, retries, parallelism, and show progress in UIs.

---

## Safety, Auth, and Observability

* **Auth:** Tools should read credentials from environment variables (e.g., `SERPAPI_KEY`). Never hardcode. For per-user secrets, look them up via your session and add them to the tool args at the API layer.
* **Allowlist:** Use `ToolContext.allow` or your own checks to prevent unapproved usage (e.g., limit domains for `http.fetch`).
* **Timeouts:** Implement per-tool timeouts (as shown). You can also set per-step `timeoutMs` in your plan.
* **Idempotency:** Tools that mutate state (payments, writes) should accept an idempotency key (we expose `idempotencyKey` on step types).
* **Logging:** Use `onEvent` from `RunOptions` to log `step:start`, `step:retry`, `step:done`, etc.
* **Caching:** Use `cacheKey: 'auto'` on expensive pure steps and pass a `StepCache` (e.g., `InMemoryStepCache`) to the Runner.

---

## Common Errors & Fixes

* **“Tool not found: …”**
  The plan references a tool ID you haven’t registered/passed to the runner.
  ✔ Ensure your API route imports `'@/tools'` (so the global registry is populated) and passes it to `runPlan`’s context.

* **“Invalid URL” in `http.fetch`**
  The interpolated arg `${...}` returned `undefined` or a non-URL.
  ✔ Check the upstream step output shape; log `events` in your run endpoint and inspect the preceding outputs.

* **SerpAPI fails**
  ✔ Set `SERPAPI_KEY`. Add a simple `/api/health` route to echo which env keys are present (without values).

---

## Quick Starter: Tools Registry Glue

If you want a tiny helper to always merge default + app tools:

```ts
// src/tools/registry.ts
import '@/tools'; // side-effect: populates globalThis.__BOLT_TOOLS__

export function getTools(): Record<string, (args: any, ctx: any) => Promise<any>> {
  const g = globalThis as any;
  return { ...(g.__BOLT_TOOLS__ || {}) };
}
```

Use it everywhere:

```ts
import { getTools } from '@/tools/registry';
…
const result = await runPlan(router, plan, { taskId, agentId, input, tools: getTools() }, { … });
```

---

## Make Your Own Tools

A quick pattern you can copy for any external system:

```ts
// src/tools/stripe.ts
import { z } from 'zod';

export const StripeChargeArgs = z.object({
  amount: z.number().int().min(1),
  currency: z.string().default('usd'),
  customerId: z.string(),
  idempotencyKey: z.string().optional(),
});

export async function stripeCharge(
  { amount, currency, customerId, idempotencyKey }: z.infer<typeof StripeChargeArgs>,
  _ctx: any
) {
  const key = process.env.STRIPE_SECRET_KEY!;
  const r = await fetch('https://api.stripe.com/v1/payment_intents', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ amount: String(amount), currency, customer: customerId }),
  });
  if (!r.ok) throw new Error(`Stripe error ${r.status}`);
  const j = await r.json();
  return { id: j.id, status: j.status, amount: j.amount };
}
```

Register it:

```ts
const g = globalThis as any;
g.__BOLT_TOOLS__ = { ...(g.__BOLT_TOOLS__ || {}), 'stripe.charge': Object.assign(stripeCharge, { schema: StripeChargeArgs }) };
```

Use it in a plan step:

```ts
{ id: 'charge', kind: 'tool', toolId: 'stripe.charge',
  args: { amount: 2999, currency: 'usd', customerId: '${lookup.customerId}', idempotencyKey: 'order-123' } }
```

---

## Wrap-Up

* Tools are **first-class** citizens in Bolt: define them once, use them from **templates**, **heuristics**, or **LLM-planned** flows.
* They can be **parallelized**, **branched**, **retriable**, and **cached** by the Runner.
* Encourage your team (or open-source community) to ship tools alongside agents and templates in each Next.js app. That’s how your AI system grows **capabilities** over time—safely and predictably.
