# Bolt — Full Library Guide

> Build reliable, testable AI applications.
> Bolt provides **agents**, a **router**, a typed **planner + runner** DSL, an **orchestrator**, **tools**, and **memory** with Next.js adapters and observability.

---

## Included Packages

### Packages

- **`@bolt-ai/core`** — Types, router, planner/runner DSL, orchestrator, event bus, tool registry, memory interface.
- **`@bolt-ai/next`** — Next.js adapter (`createAppRouter`), SSE helpers, agent/template auto‑discovery.
- **`@bolt-ai/providers-groq`** — Groq provider adapter.
- **`@bolt-ai/memory-redis`** (optional) — Redis‑backed `MemoryStore` with auto‑detection via `REDIS_URL`.

---

## Quick Start (Next.js App Router)

**Install**:

```bash
pnpm add @bolt-ai/core @bolt-ai/next @bolt-ai/providers-groq
# optional:
pnpm add @bolt-ai/memory-redis redis
```

**Env** (e.g., `.env.local`):

```bash
GROQ_API_KEY=...
# optional to auto-pick Redis memory:
REDIS_URL=rediss://default:***@your-redis-host:6379
```

**Project structure (suggested)**

```

For an end‑to‑end complex agent example, see `Docs/ExampleAgent.md`.
src/
  BOLT.md
  agents/
    BOLT.md
    support.ts
    planner.ts
    support.md
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

## BOLT.md instructions (scoped overrides)

BOLT.md files provide **directory-scoped instructions**. The **nearest BOLT.md wins by default**.
Add frontmatter `extends: true` to inherit parent instructions.

```
repo/
  BOLT.md
  agents/
    BOLT.md
    support/
      BOLT.md
      support.md
```

Chain with `extends: true`:

```
root BOLT.md  ->  agents/BOLT.md  ->  agents/support/BOLT.md
```

Markdown agents load BOLT.md automatically by file location. For TS-defined agents, set
`boltDocs: true` or `boltDocs: { cwd: __dirname }`.

---

## Core Concepts

### 1) Router

The **AppRouter** orchestrates agents, tools, memory, and providers.

**Router Flow (ASCII)**

```
+--------+      prompt       +----------------------+
| USER   | --------------->  | ROUTER               |
+--------+                   | - policy/preset      |
                             | - provider select    |
                             | - BOLT.md rules      |
                             +----------+-----------+
                                        |
                                        v
+--------------------------------------------------------------+
|                         MAIN AGENT                           |
| - System prompt + tool descriptions + reminders              |
| - Orchestrates subagents via Task()                          |
+-----------+-----------+-----------+-----------+--------------+
            |           |           |           |
          Task()      Task()      Task()      Task()
            v           v           v           v
+-------------+ +-------------+ +-------------+ +-------------+
| EXPLORE     | | PLAN        | | EXECUTE     | | VALIDATE    |
| read-only   | | plan DSL    | | tools + run | | scorers     |
| tools: rg   | | all tools   | | http/web    | | checks      |
+-------------+ +-------------+ +-------------+ +-------------+
            \         |           |         /
             \________|___________|________/
                      |
              results (hidden)
                      v
+--------------------------------------------------------------+
|                         MAIN AGENT                           |
| summarizes + responds to user                                |
+--------------------------------------------------------------+
                      |
                      v
+--------+
| USER   |
+--------+
```

**Flow Explanation**
The router resolves the agent, selects a provider, and executes the agent with access to memory and tools.

```ts
// src/lib/bolt-router.ts
import { createAppRouter } from '@bolt-ai/next';
import '@/agents';     // side-effect: publish agents to globalThis
import '@/templates';  // side-effect: publish templates to globalThis
import '@/tools/defaults'; // side-effect: register tools

export const routerPromise = createAppRouter({
  preset: 'auto',            // policy preset (auto picks strict for sensitive input)
  agentsDir: 'agents',       // auto-discovery fallback
  templatesDir: 'templates', // auto-discovery fallback
  circuitBreaker: { failureThreshold: 2, cooldownMs: 30_000 },
  budget: { maxLatencyMs: 8_000, maxCostUSD: 0.25 },
  redaction: { enabled: true },
  // memory: createRedisMemoryStore(), // OR let adapter auto-pick if REDIS_URL set
});
```

* **Providers**: If `GROQ_API_KEY` is set and `@bolt-ai/providers-groq` is installed, the Next adapter auto-registers a Groq provider.
* **Memory**: Defaults to `InMemoryStore`. If `REDIS_URL` exists and `@bolt-ai/memory-redis` is installed, the adapter will try to use Redis.
* **Agents**: Next auto-discovers compiled JS and markdown agents under `agentsDir`.
* **Routing**: Provider selection respects agent capabilities and uses the first matching provider
  in the configured order (`providerOrder` or `BOLT_PROVIDER_ORDER`). Presets apply default ordering
  when no explicit order is provided. `preset: 'auto'` uses a lightweight classifier to pick strict
  ordering for sensitive input (medical/legal/finance).

Per-request overrides (optional):

```ts
await router.route({
  id: 'req-1',
  agentId: 'support',
  input: {
    __bolt: { preset: 'strict' },
    text: 'Review these symptoms...'
  }
});
```

> The `__bolt` block is treated as a routing hint and is not passed into the agent input.

**Explain & events (observability):**

```ts
const router = await routerPromise;
const { providers } = router.explain({ agentId: 'support', input: 'Hi' });
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

**Agent Flow (ASCII)**

```
+--------+      context       +--------------------------+      call      +-----------+
| INPUT  | --------------->   | MAIN AGENT               | ----------->  | PROVIDER  |
+--------+                    | - system + history       |               +-----+-----+
                              | - tools + BOLT.md rules  |                     |
                              +-----------+--------------+                     v
                                          |                             +-----------+
                                          v                             | OUTPUT    |
                                  +---------------+                     +-----------+
                                  | MEMORY        |
                                  | read / write  |
                                  +---------------+
```

**Flow Explanation**
Agents turn inputs and context into prompts, call the provider, and optionally read/write memory.

**Markdown agent (auto BOLT.md instructions):**

```markdown
---
id: support
description: Concise, helpful assistant
boltDocs: true
---

## System
Helpful answers only.

## User
User: {{input}}
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

> `__BOLT_AGENTS__` is a fallback for bundling in Next. The adapter prefers file discovery
> via `agentsDir` (compiled JS or markdown) when available.

### 3) Tools

# Bolt Tools Guide

> **Tools provide controlled access to external systems.**
> They wrap side effects (HTTP, DB, search, files, MCP servers) behind a typed interface the runner can orchestrate with retries, branching, parallelism, and caching.

**Tool Flow (ASCII)**

```
+--------+      prompt       +----------------------+
| USER   | --------------->  | MAIN AGENT           |
+--------+                   | - tool descriptions  |
                             | - chooses tool steps |
                             +----------+-----------+
                                        |
                                      Task()
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
Agents or planners select tools; the runner executes tool steps and returns structured results back into the plan.

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

In practice, tools are exposed to the runner as a map:

```ts
type ToolFn = (args: any, ctx: RunnerContext) => Promise<any>;
type ToolsMap = Record<string, ToolFn>;
```

> The runner accepts a `tools` map in its context. Build the map from simple functions or from richer `Tool` objects registered centrally.

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

Two common patterns are shown below.

### A) Per-request map (minimal setup)

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

### B) Central registration (recommended)

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

> You can provide a helper `getTools()` that merges **default** tools with **app** tools.

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
> If you see “Invalid URL” errors, your previous tool didn’t return a proper URL (or you didn’t register the tool).

### 3) `vector.search` – Vector store retrieval

Use the built‑in helper to wrap your vector adapter (Pinecone, pgvector, Redis, etc.).

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
> Bolt ships a small wrapper; you provide the MCP client implementation.

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

* **Auth:** Tools should read credentials from environment variables (e.g., `SERPAPI_KEY`). Never hardcode. For per-user secrets, look them up via your session and add them to the tool args at the API layer.
* **Allowlist:** Use `ToolContext.allow` or your own checks to prevent unapproved usage (e.g., limit domains for `http.fetch`).
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

* Tools are **first-class** citizens in Bolt: define them once, use them from **templates**, **heuristics**, or **LLM-planned** flows.
* They can be **parallelized**, **branched**, **retriable**, and **cached** by the Runner.
* Teams can ship tools alongside agents and templates in each Next.js app to expand capabilities safely and predictably.


### 4) Planner + Runner DSL

Bolt describes workflows as a **Plan** — a small JSON graph the **runner** executes deterministically.

**Plan Execution Flow (ASCII)**

```
+--------+          +----------+          +---------+          +---------+
| INPUT  | -------> | PLANNER  | -------> |  PLAN   | -------> | RUNNER  |
+--------+          +----------+          +---------+          +----+----+
                                                            |
                                              +-------------+-------------+
                                              |             |             |
                                            Task()        Task()        Task()
                                              v             v             v
                                       +-----------+  +-----------+  +-----------+
                                       | MODEL     |  | TOOL      |  | BRANCH    |
                                       +-----------+  +-----------+  +-----------+
                                              \           |           /
                                               \__________|__________/
                                                          |
                                                 +-----------------+
                                                 | FINAL OUTPUTS   |
                                                 +-----------------+

                             +------------------------------+
                             | GUARD / RETRY / CACHE        |
                             | applied per step by runner   |
                             +------------------------------+
```

**Flow Explanation**
Plans are just JSON; the runner executes each step and enforces guards, retries, and caching.

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

**Examples**: concise summaries, simple comparisons, one‑shot answers.

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
* **Redaction**: If you log traces, redact secrets (configure `RouterOptions.redaction`).
* **Budgets & circuit breaker**: Set `budget` and `circuitBreaker` on the router to cap latency/cost and skip unhealthy providers.
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

* **Deterministic workflows** where required (templates).
* **Flexible** for open-ended asks (LLM planner).
* **Typed** plan DSL → easy to test, snapshot, and render (DAG).
* **Composable**: mix agents, tools, branches, maps, parallel fan-out.
* **Next-friendly**: plug-and-play API routes, SSE, auto-discovery.
