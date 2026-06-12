# @bolt-ai/core

Core runtime primitives for Bolt Agentic 1.0.

This package provides the provider-agnostic execution layer: runtime facade, router, memory interface, tool registry, planner, runner, events, budgets, redaction hooks, scoped `BOLT.md` discovery, and shared TypeScript types.

## Install

```bash
pnpm add @bolt-ai/core
```

## Runtime Example

```ts
import { createRuntime, InMemoryStore, type ModelProvider, type Tool } from '@bolt-ai/core';

const provider: ModelProvider = {
  id: 'mock:local',
  supports: ['text', 'json'],
  async call({ prompt }) {
    return { output: `Answer: ${prompt}` };
  },
};

const lookupTool: Tool<{ topic: string }, string> = {
  id: 'local.kb.lookup',
  schema: {
    type: 'object',
    properties: { topic: { type: 'string' } },
    required: ['topic'],
  },
  async run(args) {
    return `Facts about ${args.topic}`;
  },
};

const runtime = createRuntime({
  providers: [provider],
  memory: new InMemoryStore(),
  tools: [lookupTool],
  agents: [
    {
      id: 'support',
      capabilities: ['text'],
      tools: ['local.kb.lookup'],
      async run({ input, call, tools }) {
        const lookup = tools.get('local.kb.lookup');
        const facts = await lookup?.run({ topic: 'shipping' }, {});
        return call({
          kind: 'text',
          prompt: `Question: ${JSON.stringify(input)}\nFacts: ${facts}`,
        });
      },
    },
  ],
});

const result = await runtime.run('support', { question: 'Where is my order?' });
```

## Runtime Flow

```
+--------+      run/route      +----------------------+
| USER   | ------------------> | BOLT RUNTIME         |
+--------+                     | agents, tools        |
                               | memory, router       |
                               +----------+-----------+
                                          |
                                          v
                               +----------------------+
                               | ROUTER               |
                               | provider select      |
                               | budget/redaction     |
                               +----------+-----------+
                                          |
                                          v
                               +----------------------+
                               | AGENT                |
                               | scoped memory        |
                               | allowed tools only   |
                               +----------+-----------+
                                          |
                                          v
                               +----------------------+
                               | RUN RESULT           |
                               | ok/output/error      |
                               +----------------------+
```

## Main Exports

- `createRuntime()` and `createBoltRuntime()`
- `Router` and `createAppRouter()`
- `InMemoryStore`
- `Registry`
- `runPlan()` and planner/runner types
- `createOrchestrator()`
- `discoverBoltDocs()`
- shared types such as `Agent`, `Tool`, `ModelProvider`, `RunResult`, `Plan`, and `MemoryStore`

## Structured Results

```ts
const result = await runtime.run('support', input, {
  throwOnError: false,
  onToken(delta) {
    process.stdout.write(delta);
  },
});

if (!result.ok) {
  console.error(result.error?.message);
}
```

## Diagnostics

```ts
const info = await runtime.explain({
  agentId: 'support',
  input: { question: 'Hi' },
});

console.log(info.provider);
console.log(info.tools);
```

## Tool Governance

Register every tool with the runtime, then declare the subset each agent may use.

```ts
const runtime = createRuntime({
  providers: [provider],
  tools: [lookupTool, httpTool],
  agents: [
    {
      id: 'support',
      capabilities: ['text'],
      tools: ['local.kb.lookup'],
      async run(ctx) {
        return ctx.call({ kind: 'text', prompt: String(ctx.input) });
      },
    },
  ],
});
```

If a provider requests a tool outside the active agent allow-list, the router rejects the call.

## BOLT.md

`BOLT.md` files provide scoped instruction discovery.

```
repo/BOLT.md -> agents/BOLT.md -> agents/support/BOLT.md
```

The nearest file wins by default. Add frontmatter `extends: true` to inherit parent instructions.

## More Docs

- Root `README.md` for the full 1.0 guide
- `Docs/Planner.md` for deterministic workflow execution
- `Docs/Tools.md` for built-in tool adapters
- `examples/markdown-runtime/README.md` for a runnable Markdown runtime example
