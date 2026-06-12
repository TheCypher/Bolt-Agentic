# Bolt Documentation

Current documentation for Bolt Agentic 1.0.

## Start Here

- `../README.md` - complete 1.0 overview, install guide, runtime examples, Markdown agents, CLI, Next.js, providers, governance, and development checks
- `../examples/markdown-runtime/README.md` - runnable Markdown runtime example with a mock provider, skill, and local tool
- `../examples/complex-agent/README.md` - runnable multi-agent example with scoped `BOLT.md` instructions

## Guides

- `Planner.md` - deterministic plans, runner steps, retries, guards, branching, maps, budgets, and cache keys
- `Tools.md` - tool registration, agent allow-lists, HTTP allow-lists, web search domain filters, MCP, and vector tools

## Documentation Flow

```
README.md
   |
   +--> examples/markdown-runtime/README.md
   |
   +--> Docs/Planner.md
   |
   +--> Docs/Tools.md
   |
   +--> examples/complex-agent/README.md
```

Deprecated pre-1.0 roadmap, rebuild handoff, duplicate full guide, and duplicate example guide documents were removed. The source of truth is now the 1.0 runtime-first API described in the root README and the guides listed above.
