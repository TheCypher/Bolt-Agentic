# Bolt Quick Guide

Concise overview of Bolt’s core concepts. For full details, see `Docs/FullDoc.md`.

---

## Overview

- **Agents as files**: define agents in TypeScript or Markdown.
- **Scoped instructions**: `BOLT.md` applies per directory; nearest file wins by default.
- **Orchestration**: planner + runner for deterministic workflows, or the `Orchestrator` convenience wrapper.

---

## BOLT.md Instruction Chain

```
repo/
  BOLT.md
  agents/
    BOLT.md
    support/
      BOLT.md
      support.md
```

Default behavior (nearest wins):

```
root BOLT.md  ->  agents/support/BOLT.md
```

With `extends: true` in each file:

```
root BOLT.md  ->  agents/BOLT.md  ->  agents/support/BOLT.md
```

---

## Core Runtime Flow

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

+--------+      +----------+      +---------+      +------+
| INPUT  | ---> | PLANNER  | ---> |  PLAN   | ---> | RUN  |
+--------+      +----------+      +---------+      +------+
                                \-> steps (model/tool/branch/map)

ORCHESTRATOR = PLANNER + RUNNER
```

**Flow Explanation**
The router selects a provider and runs the main agent with scoped instructions. The runner executes plans step‑by‑step; the orchestrator is a plan→run convenience wrapper.

---

## Docs Index

- `Docs/FullDoc.md` for complete library usage
- `Docs/Planner.md` for plan/runner/orchestrator patterns
- `Docs/Tools.md` for tool registration and governance
- `Docs/ExampleAgent.md` for an end‑to‑end complex agent example
