# @bolt-ai/core

> **Headless primitives for building agentic systems in TypeScript.**
>
> Router • Agents • Planner/Runner • Tools • Memory • Observability • Governance

**Status:** v0.1.0 (beta). APIs may evolve as we harden production usage.

---

**What this package provides**

1. **Runtime** — `createRuntime()` with `run`, `route`, `runParallel`, and structured `RunResult`.
2. **Router** — capability-aware routing with ordered preference and policy-aware presets (`fast | cheap | strict | auto`).
3. **Permissioned tools** — runtime registry with per-agent declared tool allow-lists.
4. **Planner + Runner** — deterministic plans with retries, guards, branching, and caching.
5. **Memory interfaces** — default in-memory store + Redis adapter compatibility.
6. **Observability** — event bus + trace events.
7. **Governance** — scoped `BOLT.md` instructions, score/budget guards, allow-listed HTTP, redaction.

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
                               | - provider select    |
                               | - budget/redaction   |
                               +----------+-----------+
                                          |
                                          v
                               +----------------------+
                               | AGENT                |
                               | - scoped memory      |
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
The runtime is the public execution surface. It registers agents and tools, delegates provider selection to the router, passes traced memory into agent execution, and exposes only the tools declared by the running agent.

---

**Install**

```bash
pnpm add @bolt-ai/core
```

---

**Usage**

```ts
import { createRuntime, InMemoryStore } from '@bolt-ai/core';
import { createGroqProvider } from '@bolt-ai/providers-groq';

const runtime = createRuntime({
  providers: [createGroqProvider()],
  memory: new InMemoryStore(),
  preset: 'auto',
  agents: [supportAgent],
  tools: [searchTool],
});

const result = await runtime.run('support', { text: 'hello' });
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

**Roadmap**

1. **v0.1.x (current)** — Router, Agents, Planner/Runner, Tools (web.search/http/mcp/vector), Memory (InMemory/Redis), Observability, Groq provider adapter, Next.js + React adapters.
2. **v0.2** — Health pings, improved JSON validators, OpenAI/Anthropic/Google adapters, Azure/Mistral adapters, vector store adapters (Pinecone/pgvector/Redis), richer evaluators.
3. **v0.3** — Multimodal/image tools, coding agent with diff patches, role‑based memory, CLI polish, recipe gallery.
4. **v1.0** — Docs site, governance & audit hooks, cost/latency dashboard, hardened APIs.

---

**License**

MIT © Contributors to Bolt
