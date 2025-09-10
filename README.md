# Bolt

> **Headless, TypeScript‑first primitives for building reliable, provider‑agnostic AI agents and workflows.**
>
> Router • Agents • Planner/Runner • Tools • Memory • Observability • Governance

---

## Who we are

We’re a small group of practitioners who kept rebuilding the same AI plumbing—routing, planning, tool calls, memory, retries, and observability—every time we shipped a new feature. **Bolt** exists to make those foundations **simple, composable, and production‑ready** for everyone, from seasoned engineers to developers just getting started.

**What we value**

* **Headless & composable:** Tiny primitives, no UI, works with any stack.
* **Reliability by default:** Retries, timeouts, fallbacks, circuit breaker, and transparent traces.
* **Provider‑agnostic:** OpenAI, Anthropic, Google, Groq, Mistral, Azure—choose what’s best per task.
* **Structured outputs:** First‑class JSON/SQL generation with schema validation and score checks.
* **Great DX:** Minimal boilerplate, TypeScript types, sensible defaults.

---

## What we’re trying to accomplish

**Mission:** Reduce “time to trustworthy AI features” from weeks to minutes by standardizing the **core agentic building blocks**—so you can focus on your product, not the scaffolding.

**North‑star DX metrics**

* **TTFWA (Time to First Working Agent)** ≤ **5 min** from `pnpm add` to an agent answering.
* **TTFWW (Time to First Working Workflow)** ≤ **20 min** for a multi‑step plan with a tool call and visible retries/fallbacks.
* **<60 LoC** for a 3‑step plan (classify → retrieve → synthesize).

---

## Features (MVP)

1. **Router** — task classification → agent selection → provider selection with **retries/fallbacks** and policy presets (`fast | cheap | strict`).
2. **Agents** — small, composable units with typed inputs/outputs (`text | json | vision | image | embedding`).
3. **Planner + Runner** — LLM/heuristic planner emits a **Plan (DAG)**; runner executes with concurrency, guards, and streaming events.
4. **Tools** — declarative registry with JSON schemas; built‑ins for `web.search`, `http.fetch` (allow‑list), `vector.query` interface; sandbox for custom tools.
5. **Memory** — in‑memory and Redis adapters (`get/set/patch/history`), role‑scoped conversation and working memory.
6. **Observability** — event bus, SSE helpers, `router.explain()`, trace logs.
7. **Security & Governance** — tool allow‑lists, secret redaction, per‑tenant budgets, circuit breaker.

> **Status:** v0.1 work‑in‑progress. APIs may shift slightly as we harden examples.

---

## Install

> **Note:** Package names are tentative and may change before 1.0. Use the monorepo locally until published.

```bash
pnpm add @bolt-ai/core @bolt-ai/react @bolt-ai/next @bolt-ai/agents
# Optional
# pnpm add @bolt-ai/tools @bolt-ai/memory-redis
```

**Provider SDKs (optional but recommended for performance):** `openai`, `@anthropic-ai/sdk`, `@google/generative-ai`, `@azure/openai`, `groq-sdk`, `@mistralai/mistralai`.

**Environment variables**

```bash
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GOOGLE_API_KEY=...
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=...
GROQ_API_KEY=...
MISTRAL_API_KEY=...

# Router preferences and presets
BOLT_PROVIDER_ORDER=groq:llama-3.1-70b-versatile,openai:gpt-4o-mini,anthropic:sonnet-3.5,google:gemini-1.5-pro
BOLT_PRESET=fast # fast | cheap | strict

# Memory (optional)
REDIS_URL=redis://localhost:6379
```

---

## Quick Start (Next.js App Router)

### 1) API Route — one‑liner router

```ts
// app/api/ai/route.ts
import { createAppRouter, handle } from '@bolt-ai/next';

export const runtime = 'nodejs';
const router = createAppRouter({ preset: 'fast', agentsDir: 'agents' });

export const POST = handle(router);
```

### 2) A tiny agent

```ts
// agents/support.ts
import { defineAgent } from '@bolt-ai/agents';

export default defineAgent({
  id: 'support',
  description: 'Answers FAQs, stays concise.',
  capabilities: ['text'],
  async run({ input, call, memory }) {
    const history = await memory.history('support', 6);
    return call({
      kind: 'text',
      prompt: `You are a concise support agent.\nHistory: ${JSON.stringify(history)}\nQuestion: ${typeof input === 'string' ? input : JSON.stringify(input)}`
    });
  }
});
```

### 3) Client hook (optional)

```tsx
// app/chat/page.tsx
'use client';
import { useAgent } from '@bolt-ai/react';

export default function ChatPage() {
  const { messages, status, send } = useAgent('support');
  return (
    <main className="mx-auto max-w-2xl p-6 space-y-4">
      <h1 className="text-xl font-semibold">Support Chat</h1>
      <div className="border rounded p-3 h-[50vh] overflow-auto bg-white space-y-2">
        {messages.map(m => (
          <div key={m.id}><b>{m.role === 'user' ? 'You' : 'AI'}:</b> {m.text}</div>
        ))}
        {status === 'streaming' && <div className="opacity-60">…</div>}
      </div>
      <form
        onSubmit={async e => {
          e.preventDefault();
          const q = String(new FormData(e.currentTarget).get('q') || '');
          if (q) await send({ text: q });
          (e.currentTarget as HTMLFormElement).reset();
        }}
        className="flex gap-2"
      >
        <input name="q" className="flex-1 border rounded px-3 py-2" placeholder="Ask anything…" />
        <button className="border rounded px-4 py-2">Send</button>
      </form>
    </main>
  );
}
```

---

## Planner + Runner (why it matters)

Single prompts answer text; **real apps perform actions**. Bolt’s planner turns a vague goal into a small plan (DAG) with guards (schema validation, score checks) that the runner executes with retries, fallbacks, and parallelism.

```ts
// plan types (simplified)
export type PlanStep =
  | { id: string; kind: 'model'; agent: string; inputFrom?: string[]; guard?: Guard }
  | { id: string; kind: 'tool'; toolId: string; args?: any; inputFrom?: string[]; guard?: Guard }
  | { id: string; kind: 'parallel'; children: string[] };
```

**When to use it**

* Tiny tasks → planner collapses to one step.
* Medium → classify → retrieve → synthesize.
* Large → parallel fan‑out across sources then synthesize with validation.

---

## Examples (repo `/examples`)

A. **Conversational Data Lake Analyst** — connectors → semantic layer → SQL/Vector RAG → narrated visuals with provenance.

B. **Document Intake → Structured JSON** — OCR/layout → key‑value extraction → schema validation → exception queue.

C. **Workflow Automation Agent** — plan from NL → tool registry calls → approval gate → rollback on failure.

Each example is wired to the same primitives (router, planner/runner, tools, memory, observability).

---

## Roadmap

* **v0.1 (MVP):** Router, Agents, Planner/Runner, Tools (web.search/http/vector), Memory (InMemory/Redis), Observability, 4 provider adapters (OpenAI, Anthropic, Google, Groq), Next.js + React adapters.
* **v0.2:** Health pings, improved JSON validators, Azure/Mistral adapters, vector adapters (Pinecone/pgvector/Redis), richer evaluators.
* **v0.3:** Multimodal/image tools, coding agent with diff patches, role‑based memory, CLI polish, recipe gallery.
* **v1.0:** Docs site, governance & audit hooks, cost/latency dashboard, hardened APIs.

---

## Contributing

We welcome issues, RFCs, and PRs. Start with **small, focused contributions** (examples, adapters, docs) while the core stabilizes.

**Monorepo layout**

```
/bolt
  /packages
    core/        # router, planner, runner, types, telemetry
    providers/   # adapters (openai, anthropic, google, groq, azure, mistral)
    tools/       # http.fetch, web.search, vector, evaluators
    memory/      # InMemory + Redis adapters
    react/       # optional useAgent hook + streaming helpers
    next/        # Next.js handlers (App Router)
    cli/         # scaffolder + local dev server helpers
  /examples
    data-lake-analyst/
    docs-to-json/
    workflow-agent/
```

**Setup**

```bash
git clone https://github.com/your-org/bolt
cd bolt
pnpm i
pnpm -r build
pnpm -r dev
```

Please read our **[Code of Conduct](./CODE_OF_CONDUCT.md)** and **[Contributing Guide](./CONTRIBUTING.md)** (coming soon).

---

## Security & Governance

* Tool allow‑lists & domain filters; secret/PII redaction before provider calls.
* Per‑tenant budgets (cost & TPS); circuit breaker with rolling health window.
* Lineage/citations hooks for provenance in examples.

---

## License

MIT © Contributors to Bolt
