# Changelog

## 1.0.0 - 2026-06-12

### Added
- Stable `BoltRuntime` facade with `createRuntime`, `run`, `route`, `runParallel`, structured `RunResult`, token streaming callbacks, and `runtime.explain()`.
- Markdown runtime via `createMarkdownRuntime()` with `ready()`, `loadAgent()`, `loadAgents()`, Markdown skill resolution, and Markdown loader diagnostics.
- CLI package with `bolt run` for local Markdown-agent execution using Groq or deterministic mock output.
- Provider-native tool-call loop with per-agent allow-list enforcement, tool result feedback, and iteration limits.
- OpenAI-compatible tool mapping in the Groq provider adapter.
- Runnable Markdown runtime example with an agent, skill, local tool, mock provider, and test.

### Changed
- Promoted Bolt Agentic from beta to the 1.0 runtime-first API.
- Replaced beta roadmap README content with a detailed 1.0 guide covering install, runtime use, Markdown agents, tools, streaming, diagnostics, CLI, Next.js, providers, `BOLT.md`, planner/runner usage, and examples.
- Updated package versions and peer dependency ranges to `1.0.0`.
- Refreshed `@bolt-ai/core` package README for the current runtime surface.

### Removed
- Removed deprecated pre-1.0 quick/full docs, duplicate example guide, and the vNext rebuild handoff document now that the rebuild has shipped.

## 0.1.0 - 2026-02-04

### Added
- BOLT.md scoped instruction discovery with inheritance (`extends: true`) and agent injection.
- Orchestrator helper for plan → run workflows.
- Router policy‑aware presets (`auto`), circuit breaker, per‑route budgets, redaction, and provider order prefix matching.
- Runner score checks and budget enforcement with pluggable scorers and cost estimator.
- Tool adapters: `createHttpTool` allow‑lists, `createWebSearchTool` domain filters, `createMcpTool`, `createVectorTool`.
- Documentation upgrades with boxed ASCII flow diagrams and clarified governance guidance.

### Changed
- Provider guidance: Groq adapter is production‑ready; other providers are marked as planned.
- Roadmap and feature summaries aligned with current capabilities.
