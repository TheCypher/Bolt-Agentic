# Bolt Agentic

> **Headless, TypeScript‑first primitives for building reliable AI agents and workflows.**
>
> Router • Agents • Planner/Runner • Tools • Memory • Observability • Governance

**Status:** v0.1.0 (beta). APIs may evolve as we harden production usage.

---

**Overview**

Bolt is a modular toolkit for building agentic systems without locking you into a UI or vendor. It provides routing, planning, tool execution, memory, and governance primitives designed to be composed into your application architecture.

**Highlights**

1. **Router** — capability‑aware routing with ordered preference and policy‑aware presets (`fast | cheap | strict | auto`).
2. **Agents** — small, composable units with typed inputs/outputs (`text | json | vision | image | embedding`).
3. **Planner + Runner** — deterministic plans with retries, guards, branching, and caching.
4. **Orchestrator** — a plan→run wrapper with pluggable planning modes (`heuristic | llm`).
5. **Tools** — registry plus built‑ins (`web.search` with domain allow‑list, `http.fetch` allow‑list, `mcp.call`, `vector.search`).
6. **Memory** — InMemory + Redis adapters (`get/set/patch/history`).
7. **Observability** — event bus + trace events.
8. **Governance** — scoped `BOLT.md` instructions, score/budget guards, allow‑listed HTTP, redaction.

**Core Flow (ASCII)**

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
The router selects a provider and runs the main agent with scoped instructions. The main agent can delegate to specialized subagents (planner, executor, validator) and then summarize results back to the user.

---

**Install**

Packages ship under `@bolt-ai/*`. Use the monorepo locally for development.

```bash
# Core primitives
pnpm add @bolt-ai/core

# Common stacks
pnpm add @bolt-ai/core @bolt-ai/agents
pnpm add @bolt-ai/core @bolt-ai/agents @bolt-ai/next
pnpm add @bolt-ai/core @bolt-ai/agents @bolt-ai/react

# Optional extensions
pnpm add @bolt-ai/tools @bolt-ai/memory-redis @bolt-ai/providers-groq
```

**Provider SDKs**

Groq is supported today (`groq-sdk`). Other providers are planned.

**Environment variables**

```bash
GROQ_API_KEY=...

# Router preferences and presets
BOLT_PROVIDER_ORDER=groq:llama-3.1-70b-versatile,openai:gpt-4o-mini
BOLT_PRESET=fast # fast | cheap | strict | auto

# Memory (optional)
REDIS_URL=redis://localhost:6379
```

Provider selection respects agent capabilities and uses the first matching provider in the configured order. `preset: 'auto'` uses a lightweight heuristic (e.g., medical/legal/finance keywords) to choose a stricter ordering.

---

**Quick Start (Next.js App Router)**

```ts
// app/api/ai/route.ts
import { createAppRouter, handle } from '@bolt-ai/next';

export const runtime = 'nodejs';
const router = await createAppRouter({ preset: 'fast', agentsDir: 'agents' });

export const POST = handle(router);
```

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
      prompt: `You are concise.\nHistory: ${JSON.stringify(history)}\nQuestion: ${typeof input === 'string' ? input : JSON.stringify(input)}`,
    });
  },
});
```

---

**BOLT.md Instructions (Scoped Overrides)**

`BOLT.md` files provide directory‑scoped instructions. The nearest file wins by default. To inherit parent instructions, add frontmatter `extends: true`.

```
repo/
  BOLT.md                  (root rules)
  agents/
    BOLT.md                (agent defaults)
    support/
      BOLT.md              (overrides by default)
      support.md           (agent definition)
```

With inheritance enabled:

```
root BOLT.md  ->  agents/BOLT.md  ->  agents/support/BOLT.md
```

Markdown agents load `BOLT.md` automatically based on file location. For TS‑defined agents, set `boltDocs: true` or `boltDocs: { cwd: __dirname }` in the agent definition.

---

**Packages**

1. **`@bolt-ai/core`** — Router, planner/runner, event bus, memory, types.
2. **`@bolt-ai/agents`** — Agent definitions and markdown parsing.
3. **`@bolt-ai/tools`** — Built‑in tools and registry helpers.
4. **`@bolt-ai/next`** — Next.js router factory + handlers.
5. **`@bolt-ai/react`** — React hooks and helpers.
6. **`@bolt-ai/providers-groq`** — Groq provider adapter.
7. **`@bolt-ai/memory-redis`** — Redis memory adapter.

---

**Roadmap**

1. **v0.1.x (current)** — Router, Agents, Planner/Runner, Tools (web.search/http/mcp/vector), Memory (InMemory/Redis), Observability, Groq provider adapter, Next.js + React adapters.
2. **v0.2** — Health pings, improved JSON validators, OpenAI/Anthropic/Google adapters, Azure/Mistral adapters, vector store adapters (Pinecone/pgvector/Redis), richer evaluators.
3. **v0.3** — Multimodal/image tools, coding agent with diff patches, role‑based memory, CLI polish, recipe gallery.
4. **v1.0** — Docs site, governance & audit hooks, cost/latency dashboard, hardened APIs.

---

**Contributing**

We welcome issues, RFCs, and PRs. Start with small, focused contributions (examples, adapters, docs) while the core stabilizes.

**Monorepo layout**

```
/bolt
  /packages
    core/        # router, planner, runner, types, telemetry
    providers/   # adapters (openai, anthropic, google, groq, azure, mistral)
    tools/       # http.fetch, web.search, mcp.call, vector.search
    memory/      # InMemory + Redis adapters
    react/       # optional useAgent hook + streaming helpers
    next/        # Next.js handlers (App Router)
    cli/         # scaffolder + local dev server helpers
  /examples
    data-lake-analyst/
    docs-to-json/
    workflow-agent/
```

---

**Security & Governance**

1. Tool allow‑lists (e.g., `http.fetch`) and domain filters (`web.search`), plus secret/PII redaction.
2. Runner budgets and score checks, plus router‑level budgets and circuit breaker.
3. Lineage/citations hooks for provenance in examples (planned).

---

**License**

MIT © Contributors to Bolt
