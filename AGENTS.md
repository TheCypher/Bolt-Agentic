# AGENTS.md

Purpose: source of truth for feature scope and technical location. Update this file whenever you ship or adjust a feature, and mirror roadmap changes in `README.md` when applicable.

## Feature Catalog
- What: Bolt Agentic 1.0 documentation and release metadata.
- Where: `README.md`, `Docs/README.md`, `packages/core/README.md`, `CHANGELOG.md`, package manifests.
- Why: Promotes the shipped Markdown-agent runtime from pre-1.0 docs to the stable 1.0 source of truth and removes deprecated pre-release guides.
- What: `BoltRuntime` facade with structured `RunResult`, `run`, `route`, and `runParallel`.
- Where: `packages/core/src/runtime.ts`, `packages/core/src/router.ts`, `packages/core/src/types.ts`, `packages/core/src/__tests__/runtime.test.ts`.
- Why: Provides one headless runtime entry point over provider routing, memory, agents, and tool registration.
- What: Runtime tool registry wiring with per-agent declared tool allow-lists.
- Where: `packages/core/src/runtime.ts`, `packages/core/src/router.ts`, `packages/core/src/types.ts`, `packages/core/src/__tests__/runtime.test.ts`.
- Why: Enforces tool governance while passing runtime memory and cancellation context into allowed tools.
- What: Provider-native tool-call loop with allowed tool execution, tool result feedback, and iteration guard.
- Where: `packages/core/src/types.ts`, `packages/core/src/router.ts`, `packages/core/src/__tests__/runtime.test.ts`.
- Why: Lets model providers request runtime tools directly while preserving per-agent tool governance.
- What: OpenAI-compatible provider tool mapping for Groq adapters.
- Where: `packages/core/src/types.ts`, `packages/core/src/router.ts`, `packages/providers/groq/src/index.ts`, `packages/providers/groq/src/__tests__/groqProvider.test.ts`.
- Why: Converts Bolt tool definitions, provider tool calls, and tool results into the common chat-completions tool shape.
- What: Native OpenAI and Gemini provider adapters with streaming, JSON, and tool calling.
- Where: `packages/providers/openai`, `packages/providers/gemini`, provider tests, `pnpm-lock.yaml`.
- Why: Completes the 1.0 native provider surface alongside Groq.
- What: Native provider discovery in CLI and Next.js integrations.
- Where: `packages/cli/src/index.ts`, `packages/cli/src/__tests__/cli.test.ts`, `packages/next/src/router.ts`, `packages/next/src/__tests__/providerAutodetect.test.ts`.
- Why: Makes OpenAI, Gemini, and Groq available through the primary application adapters without manual provider wiring.
- What: Markdown skill resolution from `skills` frontmatter and `skillsDir`.
- Where: `packages/agents/src/markdown.ts`, `packages/agents/src/agentDefinition.ts`, `packages/agents/src/index.ts`, `packages/agents/src/__tests__/agentMarkdown.test.ts`.
- Why: Makes reusable Markdown skills first-class prompt inputs for Markdown-defined agents.
- What: Markdown runtime loader via `createMarkdownRuntime().ready()`, `.loadAgent()`, and `.loadAgents()`.
- Where: `packages/agents/src/markdownRuntime.ts`, `packages/agents/src/index.ts`, `packages/agents/src/__tests__/markdownRuntime.test.ts`.
- Why: Lets apps run Markdown-defined agents without manually parsing and registering each agent, with idempotent startup loading from `agentsDir`.
- What: Runtime diagnostics via `runtime.explain()` with provider, memory, tool, and Markdown loader state.
- Where: `packages/core/src/runtime.ts`, `packages/agents/src/markdownRuntime.ts`, `packages/core/src/__tests__/runtime.test.ts`, `packages/agents/src/__tests__/markdownRuntime.test.ts`.
- Why: Helps users debug loaded agents, provider choice, registered tools, and Markdown runtime readiness without making model calls.
- What: Runtime token streaming via `run(..., { onToken })` and `RunResult.streamedText`.
- Where: `packages/core/src/runtime.ts`, `packages/core/src/router.ts`, `packages/core/src/__tests__/runtime.test.ts`.
- Why: Lets runtime callers and SSE adapters receive provider token deltas without bypassing the structured run result path.
- What: Runnable Markdown runtime example with agents, skills, local tool, and deterministic mock provider.
- Where: `examples/markdown-runtime/README.md`, `examples/markdown-runtime/run.mjs`, `examples/markdown-runtime/agents/support.md`, `examples/markdown-runtime/skills/concise.md`, `examples/markdown-runtime/tools/localKnowledge.mjs`, `examples/markdown-runtime/run.test.mjs`.
- Why: Demonstrates the runtime-first Markdown agent workflow without network calls or API keys.
- What: CLI runner for Markdown agents via `bolt run`.
- Where: `packages/cli/package.json`, `packages/cli/src/index.ts`, `packages/cli/src/__tests__/cli.test.ts`, `packages/cli/tsconfig.json`.
- Why: Lets users run Markdown agents from `agentsDir` locally with OpenAI, Gemini, Groq, or deterministic mock providers.
- What: Agent input/output validation for Zod-like schemas and minimal JSON Schema objects.
- Where: `packages/agents/src/agentDefinition.ts`, `packages/agents/src/__tests__/agentMarkdown.test.ts`.
- Why: Aligns documented JSON Schema usage with runtime validation behavior.
- What: BOLT.md scoped instruction chain with auto-override and optional inheritance (`extends: true`).
- Where: `packages/core/src/boltDocs.ts`, `packages/agents/src/agentDefinition.ts`, `packages/agents/src/markdown.ts`, `packages/core/src/__tests__/boltDocs.test.ts`, `packages/agents/src/__tests__/boltDocsAgent.test.ts`.
- Why: Enables Codex-style instruction layering so multiple agents can carry directory-specific guidance.
- What: Provider selection with capability matching and ordered presets (`fast | cheap | strict | auto`).
- Where: `packages/core/src/router.ts`, `packages/next/src/router.ts`, `packages/core/src/__tests__/router.test.ts`.
- Why: Aligns routing behavior with presets and explicit provider ordering for predictable execution.
- What: Policy-aware routing (`preset: auto`), router budgets, circuit breaker, and redaction.
- Where: `packages/core/src/router.ts`, `packages/next/src/router.ts`, `packages/core/src/__tests__/router.test.ts`.
- Why: Enforces safety, cost/latency limits, and resilience at the routing layer.
- What: Runner budgets + score checks (`scorers`, `costEstimator`).
- Where: `packages/core/src/types.ts`, `packages/core/src/runner.ts`, `packages/core/src/__tests__/runner.test.ts`.
- Why: Enforces reliability guardrails and cost/latency limits during orchestration.
- What: Runner nested step ownership for `parallel` and `branch` children.
- Where: `packages/core/src/runner.ts`, `packages/core/src/__tests__/runner.test.ts`.
- Why: Prevents child steps declared in a plan from executing again as top-level steps after a parent runs them.
- What: HTTP tool allow-list support via `createHttpTool`.
- Where: `packages/tools/src/http.ts`, `packages/tools/src/__tests__/http.test.ts`.
- Why: Adds governance controls over outbound HTTP access.
- What: Web search tool domain filtering via `createWebSearchTool`.
- Where: `packages/tools/src/webSearch.ts`, `packages/tools/src/__tests__/webSearch.test.ts`.
- Why: Restricts search results to trusted domains.
- What: MCP compatibility helpers for importing MCP tools and exposing Bolt tools/agents as callable MCP capabilities.
- Where: `packages/core/src/types.ts`, `packages/tools/src/mcp.ts`, `packages/tools/src/__tests__/mcp.test.ts`.
- Why: Bridges Bolt tools and agents with MCP client/server tool shapes while leaving stdio/HTTP transport ownership to the selected MCP SDK or host.
- What: Vector search tool adapter via `createVectorTool`.
- Where: `packages/tools/src/vector.ts`, `packages/tools/src/__tests__/vector.test.ts`.
- Why: Enables vector retrieval steps inside plans.

## Catalog Format (What / Where / Why)
- What: concise capability name and behavior.
- Where: primary files or directories.
- Why: user or system rationale for the capability.

## Working Rules
- TDD always: write a failing Vitest test before implementation and keep tests co-located with the code.
- Keep documentation current: update this file for any feature change.
- Refactor old docs to align with new changes.
- Use ASCII diagrams in docs to explain and visualize how things work.
- Use shadcn/ui as the UI component library for all interface work.
- Prefer functional React components + hooks; co-locate logic with UI; ensure accessibility.
- Anchor new workflows to live data first (Prisma/Supabase) before UI polish.
