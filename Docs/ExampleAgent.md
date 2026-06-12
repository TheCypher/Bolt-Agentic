# End-to-End Example Agent (Bolt)

This example shows a **complete, production‑style agent** built with Bolt that coordinates sub‑agents, tools, and structured reasoning. It also demonstrates how `BOLT.md` scopes instructions across directories and how sub‑agents can override them with their own `BOLT.md`.

For a **fully working example with real files**, see `examples/complex-agent/`.

---

**Scenario**

Build a **Research + Decision** agent that:

- Receives a complex question from a user.
- Delegates research to sub‑agents.
- Validates sources and extracts structured data.
- Produces a final recommendation with citations and risk notes.

---

**Repository layout**

```
repo/
  BOLT.md
  agents/
    BOLT.md
    main/
      BOLT.md
      main.md
    research/
      BOLT.md
      research.md
    validator/
      BOLT.md
      validator.md
  tools/
    index.ts
```

---

**BOLT.md Scoping**

Bolt loads the **nearest** `BOLT.md` by default. To inherit parent instructions, add frontmatter `extends: true`.

**Global BOLT.md** (repo root)

```md
---
extends: true
---
You are Bolt. Follow security rules and do not expose secrets.
Prefer concise outputs and cite sources when possible.
```

**Agent defaults** (`agents/BOLT.md`)

```md
---
extends: true
---
All agents must:
- Use bullet points for intermediate notes.
- Return structured sections: Summary, Evidence, Risks, Next Steps.
```

**Main agent override** (`agents/main/BOLT.md`)

```md
---
extends: true
---
Focus on decision‑quality outputs.
Always include a short recommendation at the end.
```

**Research sub‑agent override** (`agents/research/BOLT.md`)

```md
---
extends: true
---
Prioritize reputable sources and include URLs in notes.
Do not provide final conclusions; only evidence.
```

**Validator sub‑agent override** (`agents/validator/BOLT.md`)

```md
---
extends: true
---
Check claims for internal consistency and flag uncertainty.
Return JSON with fields: valid, issues, confidence.
```

---

**Agent Flow (ASCII)**

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
| research    | | plan DSL    | | tools + run | | scorers     |
| sources     | | all tools   | | http/web    | | checks      |
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

---

**Main agent (Markdown)**

```md
---
id: main
description: Decision-quality research agent
boltDocs: true
reasoning:
  mode: deliberate
  steps: 2
tools:
  - web.search
  - http.fetch
  - vector.search
---

## System
You are the main agent. Coordinate sub‑agents and synthesize final answers.

## User
Question: {{input}}
```

---

**Research sub‑agent (Markdown)**

```md
---
id: research
description: Source gathering and evidence extraction
boltDocs: true
reasoning:
  mode: deliberate
  steps: 2
tools:
  - web.search
  - http.fetch
---

## System
Collect evidence only. No final conclusions.

## User
Find 3 credible sources about: {{input}}
Return: title, url, key points.
```

---

**Validator sub‑agent (Markdown)**

```md
---
id: validator
description: Consistency checks
boltDocs: true
outputKind: json
outputSchema:
  type: object
  properties:
    valid: { type: boolean }
    issues: { type: array, items: { type: string } }
    confidence: { type: number }
  required: [valid, issues, confidence]
---

## System
Validate claims for consistency. Flag any uncertainty.

## User
Check the following evidence and claims: {{input}}
```

---

**Tools registration**

```ts
// tools/index.ts
import { registerTools } from '@bolt-ai/core';
import { httpFetchTool, webSearchTool, createVectorTool } from '@bolt-ai/tools';

const vectorTool = createVectorTool({
  async query({ query, topK = 5 }) {
    return myVectorClient.search({ query, topK });
  }
});

registerTools(httpFetchTool, webSearchTool, vectorTool);
```

---

**Orchestration (plan + run)**

```ts
import { createAppRouter } from '@bolt-ai/next';
import { createOrchestrator } from '@bolt-ai/core';
import { toolsFromRegistry } from '@bolt-ai/core';
import { defaultToolRegistry } from '@bolt-ai/core';

const router = await createAppRouter({ agentsDir: 'agents', preset: 'auto' });
const orchestrator = createOrchestrator(router, { planner: 'heuristic' });

const tools = toolsFromRegistry(defaultToolRegistry());

const result = await orchestrator.run(
  { agentId: 'main', input: 'Should we adopt WebGPU for our rendering pipeline?' },
  { tools }
);

console.log(result.outputs);
```

---

**Optional: strict routing per request**

```ts
await router.route({
  id: 'req-1',
  agentId: 'main',
  input: {
    __bolt: { preset: 'strict' },
    question: 'Analyze safety and regulatory risk.'
  }
});
```

---

**What this demonstrates**

- `BOLT.md` scopes instructions per directory with optional inheritance.
- The main agent coordinates specialized sub‑agents and tools.
- Reasoning is explicit (`reasoning.mode: deliberate`), enabling staged thinking.
- The runner enforces determinism, retries, and guards when a plan is used.
- Providers can be routed with `preset: 'auto'` and per‑request overrides.
