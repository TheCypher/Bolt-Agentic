# @bolt-ai/core

> **Headless primitives for building agentic systems in TypeScript.**
>
> Router • Agents • Planner/Runner • Tools • Memory • Observability • Governance

**Status:** v0.1.0 (beta). APIs may evolve as we harden production usage.

---

**What this package provides**

1. **Router** — capability‑aware routing with ordered preference and policy‑aware presets (`fast | cheap | strict | auto`).
2. **Planner + Runner** — deterministic plans with retries, guards, branching, and caching.
3. **Orchestrator** — a plan→run wrapper with pluggable planning modes.
4. **Memory interfaces** — default in‑memory store + Redis adapter compatibility.
5. **Tool registry + types** — standardized tool interfaces and registry helpers.
6. **Observability** — event bus + trace events.
7. **Governance** — scoped `BOLT.md` instructions, score/budget guards, allow‑listed HTTP, redaction.

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

```bash
pnpm add @bolt-ai/core
```

---

**Usage**

```ts
import { createAppRouter } from '@bolt-ai/core';
import { InMemoryStore } from '@bolt-ai/core';
import { createGroqProvider } from '@bolt-ai/providers-groq';

const router = createAppRouter({
  providers: [createGroqProvider()],
  memory: new InMemoryStore(),
  preset: 'auto',
});

const result = await router.route({
  id: 'req-1',
  agentId: 'support',
  input: { text: 'hello' },
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

**Roadmap**

1. **v0.1.x (current)** — Router, Agents, Planner/Runner, Tools (web.search/http/mcp/vector), Memory (InMemory/Redis), Observability, Groq provider adapter, Next.js + React adapters.
2. **v0.2** — Health pings, improved JSON validators, OpenAI/Anthropic/Google adapters, Azure/Mistral adapters, vector store adapters (Pinecone/pgvector/Redis), richer evaluators.
3. **v0.3** — Multimodal/image tools, coding agent with diff patches, role‑based memory, CLI polish, recipe gallery.
4. **v1.0** — Docs site, governance & audit hooks, cost/latency dashboard, hardened APIs.

---

**License**

MIT © Contributors to Bolt
