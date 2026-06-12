# Bolt Agentic

> **Headless, TypeScript‑first primitives for building reliable AI agents and workflows.**
>
> Router • Agents • Planner/Runner • Tools • Memory • Observability • Governance

**Status:** v0.1.0 (beta). APIs may evolve as we harden production usage.

---

**Overview**

Bolt is a modular toolkit for building agentic systems without locking you into a UI or vendor. It provides one headless runtime for agents, routing, permissioned tools, memory, planning, and governance primitives designed to be composed into your application architecture.

**Highlights**

1. **Runtime** — `createRuntime()` with `run`, `route`, `runParallel`, and structured `RunResult`.
2. **Router** — capability‑aware routing with ordered preference and policy‑aware presets (`fast | cheap | strict | auto`).
3. **Markdown Agents + Skills** — Markdown definitions can resolve reusable skills from `skillsDir`.
4. **Tools** — runtime registry plus per-agent declared tool allow-lists.
5. **Planner + Runner** — deterministic plans with retries, guards, branching, and caching.
6. **Memory** — InMemory + Redis adapters (`get/set/patch/history`).
7. **Observability** — event bus + trace events.
8. **Governance** — scoped `BOLT.md` instructions, JSON Schema/Zod-like validation, budgets, allow-listed HTTP, redaction.

**Core Flow (ASCII)**

```
+--------+      run/route      +----------------------+
| USER   | ------------------> | BOLT RUNTIME         |
+--------+                     | - agents + memory    |
                               | - tools + results    |
                               +----------+-----------+
                                          |
                                          v
                               +----------------------+
                               | ROUTER               |
                               | - policy/preset      |
                               | - provider select    |
                               | - budget/redaction   |
                               +----------+-----------+
                                          |
                                          v
                               +----------------------+
                               | AGENT                |
                               | - BOLT.md chain      |
                               | - Markdown skills    |
                               | - allowed tools only |
                               +----------+-----------+
                                          |
                                          v
                               +----------------------+
                               | RUN RESULT           |
                               | ok/output/error      |
                               +----------------------+
```

**Flow Explanation**
The runtime owns the public execution surface. The router selects a provider and runs the agent with scoped `BOLT.md` instructions, resolved Markdown skills, traced memory, and only the tools declared by that agent.

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
import { createRuntime, InMemoryStore } from '@bolt-ai/core';
import { createAgentFromMarkdown } from '@bolt-ai/agents';

const support = createAgentFromMarkdown(markdown, { skillsDir: 'skills' });
const runtime = createRuntime({
  providers: [provider],
  memory: new InMemoryStore(),
  agents: [support],
  tools: [searchTool],
});

const result = await runtime.run('support', 'How do refunds work?');
```

**Next.js App Router**

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
