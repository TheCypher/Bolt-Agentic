# Bolt Tools Guide

> **Tools provide controlled access to external systems.**
> Register tools with the runtime, then expose only the allowed subset on each agent. The same tools can also be used by deterministic runner plans.

**Tool Flow (ASCII)**

```
+--------+      prompt       +----------------------+
| USER   | --------------->  | MAIN AGENT           |
+--------+                   | - allowed tools only |
                             | - provider tool call |
                             +----------+-----------+
                                        |
                                      tool call
                                        |
                                        v
                              +-------------------+
                              | TOOL STEP         |
                              | http.fetch        |
                              | vector.search     |
                              +---------+---------+
                                        |
                                        v
                              +-------------------+
                              | TOOL RESULT       |
                              +-------------------+
```

**Flow Explanation**
Agents and providers can request allowed runtime tools. Planner/runner workflows can also execute tools as deterministic plan steps.

---

## What is a Tool?

A **Tool** is a small, async function with an ID and optional schema. The runtime exposes tools to agents through per-agent allow-lists; the runner can also call tools as steps in a `Plan`.

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

In practice, tools are exposed to the runner as a map:

```ts
type ToolFn = (args: any, ctx: RunnerContext) => Promise<any>;
type ToolsMap = Record<string, ToolFn>;
```

> The runner accepts a `tools` map in its context. Build the map from simple functions or from richer `Tool` objects registered centrally.

---

## When to Use Tools

- **Call external APIs** (HTTP GET/POST, Slack, Stripe, internal services).
- **Search** (SerpAPI, Tavily, internal search).
- **Read data** (databases, vector stores).
- **Kick off workflows** (queues, webhooks).
- **Bridge to MCP servers** (local tools exposed via Model Context Protocol).

Tools keep effects **outside** prompts, making flows testable, reusable, and governable.

---

## Ways to Provide Tools

Two common patterns are shown below. Runtime registration is the 1.0 default; per-request maps are useful for focused runner plans and tests.

### A) Runtime registration with agent allow-lists

Register tools once, then list the tool IDs an agent may use:

```ts
import { createRuntime, type Tool } from '@bolt-ai/core';

const httpTool: Tool<{ url: string }, { status: number; text: string }> = {
  id: 'http.fetch',
  schema: {
    type: 'object',
    properties: { url: { type: 'string' } },
    required: ['url'],
  },
  async run({ url }) {
    const res = await fetch(url);
    return { status: res.status, text: await res.text() };
  },
};

const runtime = createRuntime({
  providers: [provider],
  tools: [httpTool],
  agents: [
    {
      id: 'research',
      capabilities: ['text'],
      tools: ['http.fetch'],
      async run({ input, call }) {
        return call({ kind: 'text', prompt: String(input) });
      },
    },
  ],
});
```

If a provider requests a tool outside the active agent allow-list, Bolt rejects the call.

### B) Per-request runner map

Provide a map to `runPlan` when executing a deterministic plan:

```ts
const tools = {
  'http.fetch': async (req: { url: string; method?: string; headers?: any; body?: any }) => {
    const res = await fetch(req.url, { method: req.method ?? 'GET', headers: req.headers, body: req.body && JSON.stringify(req.body) });
    return { status: res.status, text: await res.text() };
  }
};

await runPlan(router, plan, { taskId, agentId, input, tools });
```

### C) App-level registry helpers

Some applications publish tools at app startup and pick them up in API routes.

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

## HTTP Tool Allow Lists

The built-in HTTP tool supports allow lists to constrain outbound calls.

```ts
import { createHttpTool } from '@bolt-ai/tools';

const httpTool = createHttpTool({
  allow: ['https://api.example.com/*', 'https://docs.example.com/*']
});
```

If a URL doesn’t match the allow list, the tool throws before making a request.

---

## Default Tools You’ll Want

Below are production‑ready tools ready to use.

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

To **restrict results to specific domains**, use the built‑in helper:

```ts
import { createWebSearchTool } from '@bolt-ai/tools';

const webSearchTool = createWebSearchTool({
  allowDomains: ['docs.example.com', 'api.example.com']
});
```

**Example plan usage** (LLM or template):

```ts
// plan step that searches and fetches the first result:
{ id: 's1', kind: 'tool', toolId: 'web.search', args: { query: 'what is webgpu (2024)?', num: 3 } },
{ id: 'doc', kind: 'tool', toolId: 'http.fetch', args: { url: '${s1.results.0.url}' } },
{ id: 'summ', kind: 'model', agent: 'support', inputFrom: ['doc'] }
```

> Notice `${s1.results.0.url}`: our runner resolves that placeholder safely.
> If “Invalid URL” errors occur, the previous tool did not return a valid URL or the tool was not registered.

### 3) `vector.search` – Vector store retrieval

Use the built‑in helper to wrap a vector adapter (Pinecone, pgvector, Redis, etc.).

```ts
import { createVectorTool } from '@bolt-ai/tools';

const vectorTool = createVectorTool({
  async query({ query, topK = 5, filter, namespace }) {
    return myVectorClient.search({ query, topK, filter, namespace });
  }
});
```

Register:

```ts
const g = globalThis as any;
g.__BOLT_TOOLS__ = { ...(g.__BOLT_TOOLS__ || {}), 'vector.search': vectorTool };
```

**Template usage**:

```ts
steps: [
  { id: 'retrieval', kind: 'tool', toolId: 'vector.search', args: { query: '${query}', topK: 5 } },
  { id: 'summary', kind: 'model', agent: 'support', inputFrom: ['retrieval'] },
],
outputs: ['summary']
```

### 4) `mcp.call` – Call tools on a local MCP server

> MCP (Model Context Protocol) exposes local/remote tools to LLM apps.
> Bolt ships a small wrapper; provide the MCP client implementation.

Minimal wrapper (adapt to your MCP SDK):

```ts
// src/tools/mcp.ts
import { z } from 'zod';
import { createMcpTool } from '@bolt-ai/tools';

// Suppose you have an MCP client that can call a named tool
const mcp = createMcpClient({ command: 'node', args: ['path/to/server.js'] });

const McpArgs = z.object({
  tool: z.string(),            // MCP tool name
  params: z.record(z.any()).optional()
});

export const mcpCall = createMcpTool({
  callTool: (tool, args) => mcp.callTool(tool, args)
});
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

Agents can call tools directly (outside of the planner) by using a `ToolRegistry`. For example:

```ts
// registry helper
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

> Prefer **planner steps** for tool usage to enable guards, retries, parallelism, and progress UIs.

---

## Safety, Auth, and Observability

* **Auth:** Tools should read credentials from environment variables (e.g., `SERPAPI_KEY`). Do not hardcode. For per‑user secrets, fetch them from the session and add them to tool args at the API layer.
* **Allow list:** Use `ToolContext.allow` or equivalent checks to prevent unapproved usage (e.g., limit domains for `http.fetch`).
* **Timeouts:** Implement per‑tool timeouts (as shown). You can also set per‑step `timeoutMs` in the plan.
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

To add a helper that always merges default + app tools:

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

A reusable pattern for any external system:

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

* Tools are **first-class** runtime capabilities in Bolt: define them once, register them with the runtime, and expose them through agent allow-lists.
* They can also be **parallelized**, **branched**, **retriable**, and **cached** by the Runner when used in deterministic plans.
* Teams can ship tools alongside Markdown agents and skills to expand capabilities safely and predictably.
