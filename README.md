# Bolt Agentic

Headless TypeScript runtime for Markdown-defined AI agents.

**Status:** 1.0.0 stable release.

Bolt loads agents from Markdown or TypeScript, resolves reusable Markdown skills, gives each agent controlled access to tools, routes model calls to providers, manages memory, and returns structured runtime results. It is designed for CLIs, backend services, internal tools, product workflows, and Next.js applications that need agent behavior without adopting a UI framework.

## Why Bolt

- **Runtime first:** one `BoltRuntime` owns agents, tools, providers, memory, routing, diagnostics, and parallel runs.
- **Markdown agents:** define behavior, skills, tool allow-lists, schemas, memory, and prompts in `.md` files.
- **Tools are governed:** tools are registered in code and exposed only to agents that declare them.
- **Provider agnostic:** model providers implement one small interface; Groq ships today.
- **Production controls:** budgets, routing presets, circuit breaker, redaction, schema validation, events, and scoped `BOLT.md` instructions.
- **Embeddable:** use it from Node, Next.js, or the `bolt` CLI.

## Runtime Flow

```
+--------+      runtime.run()      +----------------------+
| USER   | ----------------------> | BOLT RUNTIME         |
+--------+                         | agents, tools        |
                                   | memory, diagnostics  |
                                   +----------+-----------+
                                              |
                                              v
                                   +----------------------+
                                   | ROUTER               |
                                   | provider selection   |
                                   | budgets, redaction   |
                                   +----------+-----------+
                                              |
                                              v
                                   +----------------------+
                                   | AGENT                |
                                   | BOLT.md + skills     |
                                   | allowed tools only   |
                                   +----------+-----------+
                                              |
                                              v
                                   +----------------------+
                                   | RUN RESULT           |
                                   | ok, output, error    |
                                   | streamedText         |
                                   +----------------------+
```

## Install

```bash
pnpm add @bolt-ai/core @bolt-ai/agents
```

Optional packages:

```bash
pnpm add @bolt-ai/cli
pnpm add @bolt-ai/tools
pnpm add @bolt-ai/providers-groq
pnpm add @bolt-ai/next @bolt-ai/react
pnpm add @bolt-ai/memory-redis
```

Requirements:

- Node.js `>=18.17`
- TypeScript projects should use ESM or a bundler that understands package `exports`

## Quick Start

This example uses a deterministic local provider so it works without API keys.

```ts
import { createRuntime, InMemoryStore, type ModelProvider } from '@bolt-ai/core';
import { defineAgent } from '@bolt-ai/agents';

const provider: ModelProvider = {
  id: 'mock:local',
  supports: ['text', 'json'],
  async call({ prompt }) {
    return { output: `Provider saw: ${prompt}` };
  },
};

const support = defineAgent({
  id: 'support',
  description: 'Answers support questions clearly.',
  capabilities: ['text'],
  prompt: {
    system: 'You are concise and practical.',
    user: 'Question: {{input}}',
  },
  memory: { write: false },
});

const runtime = createRuntime({
  providers: [provider],
  memory: new InMemoryStore(),
  agents: [support],
});

const result = await runtime.run('support', 'Where can I check my order?');

if (result.ok) {
  console.log(result.output);
}
```

`runtime.run()` returns a structured `RunResult`:

```ts
type RunResult<T = unknown> = {
  ok: boolean;
  id: string;
  agentId: string;
  output?: T;
  streamedText?: string;
  error?: { code: string; message: string; cause?: unknown };
};
```

Use `throwOnError: false` when you want errors returned instead of thrown:

```ts
const result = await runtime.run('support', input, { throwOnError: false });
```

## Markdown Runtime

Markdown agents are the primary Bolt 1.0 workflow.

```
my-app/
  agents/
    support.md
  skills/
    concise.md
  tools/
    localKnowledge.ts
```

`agents/support.md`:

```md
---
id: support
description: Customer support agent
skills:
  - concise
tools:
  - local.kb.lookup
memory:
  write: false
---

## System

Use only the facts provided by the runtime or allowed tools.

## User

Request JSON: {{input}}

Available tools: {{tools}}

Return one answer and one next action.
```

`skills/concise.md`:

```md
---
id: concise
description: Short answer style
---

Use at most two short sentences. Prefer direct next actions.
```

Runtime setup:

```ts
import { createMarkdownRuntime } from '@bolt-ai/agents';
import { InMemoryStore, type Tool } from '@bolt-ai/core';
import { createGroqProvider } from '@bolt-ai/providers-groq';

const localKnowledgeTool: Tool<{ topic: string }, { summary: string }> = {
  id: 'local.kb.lookup',
  schema: {
    type: 'object',
    properties: { topic: { type: 'string' } },
    required: ['topic'],
  },
  async run(args) {
    return { summary: `Internal facts for ${args.topic}` };
  },
};

const runtime = createMarkdownRuntime({
  agentsDir: 'agents',
  skillsDir: 'skills',
  providers: [createGroqProvider()],
  tools: [localKnowledgeTool],
  memory: new InMemoryStore(),
});

await runtime.ready();

const result = await runtime.run('support', {
  question: 'Where can I check my order?',
  facts: 'Order status lives in the customer portal.',
});
```

`ready()` loads every Markdown agent under `agentsDir`. You can also load individual files:

```ts
await runtime.loadAgent('agents/support.md');
await runtime.loadAgents('agents');
```

## Markdown Agent Fields

Supported frontmatter:

```yaml
id: support
name: Support Agent
description: Answers customer questions
capabilities: [text, json]
model: groq:llama-3.3-70b-versatile
skills: [concise, refunds]
tools: [local.kb.lookup, http.fetch]
outputKind: json
inputSchema:
  type: object
  required: [question]
  properties:
    question:
      type: string
outputSchema:
  type: object
  required: [answer]
  properties:
    answer:
      type: string
memory:
  scope: support
  history: 6
  write: true
reasoning:
  mode: deliberate
  steps: 2
boltDocs: true
```

Supported body sections:

```md
## System
System instructions.

## User
Prompt template using {{input}}, {{history}}, {{tools}}, and {{agent.id}}.

## Prefix
Text inserted before user content.

## Suffix
Text inserted after user content.
```

## Tool Governance

Tools are registered globally but exposed per agent.

```
registered tools:     local.kb.lookup, http.fetch, web.search
agent tools:          local.kb.lookup
provider can call:    local.kb.lookup only
blocked calls:        http.fetch, web.search
```

```ts
import { createRuntime, type Tool } from '@bolt-ai/core';

const lookupTool: Tool<{ topic: string }, string> = {
  id: 'local.kb.lookup',
  schema: {
    type: 'object',
    properties: { topic: { type: 'string' } },
    required: ['topic'],
  },
  async run(args, ctx) {
    const cached = await ctx.memory?.get<string>(`kb:${args.topic}`);
    return cached ?? `No facts for ${args.topic}`;
  },
};

const runtime = createRuntime({
  providers: [provider],
  agents: [agent],
  tools: [lookupTool],
});
```

Provider-native tool calls are supported. Providers can return `toolCalls`; Bolt executes allowed tools, sends tool results back to the provider, and stops at the configured iteration guard.

## Streaming

Providers that support token streaming can call `onToken`. Bolt forwards deltas through the runtime options and event bus.

```ts
let text = '';

const result = await runtime.run('support', 'Stream this answer', {
  onToken(delta) {
    text += delta;
  },
});

console.log(result.streamedText ?? text);
```

## Diagnostics

Use `runtime.explain()` to debug loading, provider selection, tool registration, memory, and environment state without making a model call.

```ts
const info = await runtime.explain({
  agentId: 'support',
  input: { question: 'Hi' },
});

console.log(info);
```

Markdown runtimes include loader state:

```ts
{
  ok: true,
  reason: 'ready',
  agentId: 'support',
  agents: ['support'],
  provider: 'groq:llama-3.3-70b-versatile',
  providers: ['groq:llama-3.3-70b-versatile'],
  tools: ['local.kb.lookup'],
  memory: 'InMemoryStore',
  markdown: {
    agentsDir: 'agents',
    skillsDir: 'skills',
    ready: true
  }
}
```

## CLI

Install:

```bash
pnpm add -D @bolt-ai/cli
```

Run with Groq:

```bash
export GROQ_API_KEY=...

bolt run support \
  --agents-dir agents \
  --skills-dir skills \
  --input '{"question":"Where is my order?"}' \
  --preset fast
```

Run without API keys using deterministic output:

```bash
bolt run support \
  --agents-dir examples/markdown-runtime/agents \
  --skills-dir examples/markdown-runtime/skills \
  --input '{"question":"Hi"}' \
  --mock-output 'Local test output'
```

## Next.js

```ts
// app/api/ai/route.ts
import { createAppRouter, handle } from '@bolt-ai/next';
import { createGroqProvider } from '@bolt-ai/providers-groq';
import { defineAgent } from '@bolt-ai/agents';

export const runtime = 'nodejs';

const support = defineAgent({
  id: 'support',
  prompt: {
    system: 'You are concise.',
    user: '{{input}}',
  },
});

const router = await createAppRouter({
  preset: 'fast',
  providers: [createGroqProvider()],
  agents: [support],
});

export const POST = handle(router);
```

## Provider Setup

Groq is included as the first provider adapter:

```ts
import { createGroqProvider } from '@bolt-ai/providers-groq';

const provider = createGroqProvider({
  apiKey: process.env.GROQ_API_KEY,
  model: 'llama-3.3-70b-versatile',
  temperature: 0.2,
});
```

Environment variables:

```bash
GROQ_API_KEY=...
GROQ_MODEL=llama-3.3-70b-versatile
BOLT_PROVIDER_ORDER=groq:llama-3.3-70b-versatile
BOLT_PRESET=fast
REDIS_URL=redis://localhost:6379
```

Custom providers implement `ModelProvider`:

```ts
import type { ModelProvider } from '@bolt-ai/core';

export const provider: ModelProvider = {
  id: 'custom:model',
  supports: ['text', 'json'],
  async call(args) {
    return { output: 'model output' };
  },
};
```

## Scoped Instructions with BOLT.md

`BOLT.md` files provide directory-scoped instructions. The nearest file wins by default. Add `extends: true` to inherit parent instructions.

```
repo/
  BOLT.md
  agents/
    BOLT.md
    support/
      BOLT.md
      support.md
```

Default behavior:

```
agents/support/BOLT.md
```

With inheritance:

```
repo/BOLT.md -> agents/BOLT.md -> agents/support/BOLT.md
```

Markdown agents load `BOLT.md` automatically from their file location. TypeScript declarative agents can opt in:

```ts
defineAgent({
  id: 'support',
  boltDocs: { cwd: new URL('.', import.meta.url).pathname },
  prompt: { user: '{{input}}' },
});
```

## Planner and Runner

For deterministic workflows, use the planner and runner in `@bolt-ai/core`.

```ts
import { runPlan, type Plan } from '@bolt-ai/core';

const plan: Plan = {
  id: 'support-flow',
  steps: [
    { id: 'lookup', kind: 'tool', toolId: 'local.kb.lookup', args: { topic: 'shipping' } },
    { id: 'answer', kind: 'model', agent: 'support', inputFrom: ['lookup'] },
  ],
  outputs: ['answer'],
};

const outputs = await runPlan(router, plan, {
  taskId: 'task-1',
  agentId: 'support',
  input: { question: 'Where is my order?' },
  tools: {
    'local.kb.lookup': async () => ({ summary: 'Use the customer portal.' }),
  },
});
```

Runner features include model steps, tool steps, parallel groups, branches, maps, retries, score checks, budgets, and cache keys.

## Examples

Run the Markdown runtime example:

```bash
pnpm install
pnpm build
node examples/markdown-runtime/run.mjs
```

Expected output:

```text
Loaded agents: support
Registered tools: local.kb.lookup

=== RESULT ===
Order status lives in the customer portal. Next action: open the tracking link from your shipping email.
```

Other docs:

- `Docs/README.md` - documentation index
- `Docs/Planner.md` - plan and runner details
- `Docs/Tools.md` - built-in tool adapters and governance
- `examples/complex-agent/README.md` - multi-agent Markdown example
- `examples/markdown-runtime/README.md` - runnable Markdown runtime walkthrough

## Packages

| Package | Purpose |
| --- | --- |
| `@bolt-ai/core` | Runtime, router, memory, tools registry, planner, runner, events, governance types |
| `@bolt-ai/agents` | `defineAgent`, Markdown parser, Markdown runtime, skill resolution |
| `@bolt-ai/cli` | `bolt run` for local Markdown agents |
| `@bolt-ai/tools` | HTTP, web search, MCP, and vector tool adapters |
| `@bolt-ai/providers-groq` | Groq provider adapter with OpenAI-compatible tool mapping |
| `@bolt-ai/next` | Next.js App Router helpers |
| `@bolt-ai/react` | React helpers |
| `@bolt-ai/memory-redis` | Redis-backed memory store |

## Security and Governance

- Agent-level tool allow-lists are enforced at runtime.
- HTTP tools can restrict outbound domains.
- Web search tools can restrict result domains.
- Router budgets limit cost and latency.
- Circuit breaker settings reduce repeated provider failures.
- Redaction can be enabled before provider calls.
- Input and output schemas validate agent boundaries.
- `BOLT.md` lets teams layer directory-specific operating rules.

## Development

```bash
pnpm install
pnpm test
pnpm build
```

Focused checks:

```bash
pnpm exec tsc --noEmit -p packages/core/tsconfig.json
pnpm exec tsc --noEmit -p packages/agents/tsconfig.json
pnpm exec tsc --noEmit -p packages/cli/tsconfig.json
pnpm exec tsc --noEmit -p packages/providers/groq/tsconfig.json
node --test examples/markdown-runtime/run.test.mjs
```

## Release

Bolt Agentic 1.0 is the first stable runtime-first release. It replaces the pre-1.0 roadmap docs with the shipped Markdown-agent runtime, CLI, provider tool loop, diagnostics, and governance surface.

## License

MIT
