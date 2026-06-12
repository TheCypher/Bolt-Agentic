# Changelog

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
