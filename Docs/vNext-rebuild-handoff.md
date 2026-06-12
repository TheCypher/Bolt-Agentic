# Bolt-Agentic vNext Rebuild Handoff

## 1. Purpose of This Document

This document is the technical handoff for rebuilding **Bolt-Agentic** from the ground up.

The current repository should be treated as a historical reference, not as the architectural foundation for the next version.

The goal is to rebuild Bolt as a **minimal, headless TypeScript library for running Markdown-defined AI agents**.

This handoff is intended for an AI coding agent such as **Codex**, **Claude Code**, or another capable software engineering agent. The coding agent should read this document, inspect the existing repository, research modern agent runtime patterns where needed, propose an implementation plan, and then begin rebuilding the library in phases.

The user/maintainer will act as the product and architecture approver. The coding agent should not blindly overbuild. It should work in small steps, propose architectural decisions before major changes, and keep the library minimal.

---

## 2. High-Level Vision

Bolt-Agentic vNext is not a traditional AI framework.

It is a **runtime library**.

The core idea:

> Agents should be Markdown files. Tools should be code. The runtime should connect them.

The user should be able to define an agent by writing a `.md` file that describes what the agent does, how it behaves, what skills it uses, which tools it can access, and what kind of output it should produce.

The developer should not need to create a TypeScript class for every agent.

The developer should not need to wire together complex framework objects just to run a useful agent.

The library should feel closer to **Flask** than **Django**:

- Minimal
- Composable
- Headless
- Easy to embed
- Easy to understand
- Powerful when needed
- Not bloated
- Not opinionated about UI
- Not full of unnecessary abstractions

The desired feeling is closer to tools like **Claude Code** and **Codex CLI**, but generalized beyond software development.

Bolt should feel like a small but powerful agent runtime that can be embedded into different products, CLIs, automation tools, personal assistants, backend services, and internal tools.

---

## 3. Core Product Statement

Bolt is a minimal TypeScript runtime for Markdown-defined AI agents.

It loads agents from Markdown files, resolves their skills, gives them controlled access to tools, manages memory/context, routes tasks, supports sub-agent delegation, and executes agent workflows through one shared runtime.

Short version:

> Bolt is a headless runtime for Markdown agents.

Slightly longer version:

> Bolt-Agentic is a lightweight TypeScript library for building AI-powered systems where agents and skills are described in Markdown, tools are registered as executable capabilities, and one runtime handles execution, routing, memory, tool use, delegation, and parallel sub-agent workflows.

---

## 4. What We Are Rebuilding Away From

The current project is considered old and misaligned with the new direction.

The existing code may contain useful ideas or pieces, but the new architecture should not be constrained by it.

Avoid preserving old code simply because it exists.

The current repo likely suffers from some or all of these issues:

- Agents are too code-centric.
- The abstractions are too framework-like.
- The structure does not match the desired Markdown-agent model.
- The runtime is not cleanly separated from agent definitions.
- Extensibility is not simple enough.
- The developer experience is not close enough to Claude Code/Codex-style workflows.
- It is not minimal enough.
- It does not feel like a modern headless agent runtime.
- It is probably easier to rebuild than to refactor.

The coding agent should inspect the current repo and identify anything worth saving, but the default assumption should be:

> Rebuild from scratch unless a piece is clearly reusable.

---

## 5. Design Philosophy

### 5.1 Minimal Core, Powerful Runtime

Bolt should have a small core.

The core should do only what is necessary:

- Load agents
- Load skills
- Register tools
- Build execution context
- Call models
- Handle tool calls
- Manage memory
- Route tasks
- Delegate to sub-agents
- Return structured results

Everything else should be optional or layered.

Do not build a giant framework.

Do not build a UI.

Do not build a full workflow engine unless the runtime truly needs it.

Do not create abstractions before there is a concrete need.

### 5.2 Markdown Is the Agent Interface

Agents should be defined as `.md` files.

The Markdown file is the primary agent definition.

This gives us:

- Portability
- Human readability
- Easy editing
- Version control friendliness
- Simple composition
- Compatibility with AI coding tools
- Clear separation between behavior and implementation

The runtime should treat Markdown agents as first-class runtime units.

### 5.3 Tools Are Code

Agents are Markdown.

Tools are code.

This distinction matters.

A tool performs real actions, so it must be implemented as executable TypeScript/JavaScript.

Examples:

- Send email
- Search email
- Read calendar
- Create calendar event
- Search web
- Read files
- Write files
- Run shell command
- Query database
- Call external API
- Store memory
- Retrieve memory

Agents should reference tools by name, but they should not implement tools.

The runtime should enforce which tools each agent can access.

### 5.4 Skills Are Reusable Markdown Capabilities

Skills are reusable instruction modules.

They may include:

- Workflows
- Procedures
- Domain knowledge
- Best practices
- Examples
- Tool usage guidance
- Output rules

A skill should be reusable across many agents.

Example skills:

- `debugging`
- `code-review`
- `email-writing`
- `calendar-scheduling`
- `research`
- `product-strategy`
- `senior-engineering`
- `system-design`
- `summarization`
- `legal-review`
- `customer-support`

Agents can reference skills in their Markdown frontmatter or body.

The runtime resolves those skills and injects them into the execution context.

### 5.5 One Runtime

There should be one main runtime.

The runtime is responsible for executing agents.

Avoid each agent having its own custom execution machinery.

The runtime should be the engine.

Agents should be declarative.

Tools should be registered capabilities.

Skills should be reusable instruction modules.

Memory should be a runtime service.

Routing should be a runtime service.

Sub-agent execution should be a runtime service.

### 5.6 Headless by Default

Bolt should not assume a UI.

It should work inside:

- CLI apps
- Next.js apps
- Node backend services
- Personal assistant products
- Automation workflows
- Internal tools
- Developer tools
- SaaS apps
- Job agents
- Research agents
- Email/calendar agents

The library should expose clean APIs that a host app can use.

The host app owns the UI.

Bolt owns the runtime.

---

## 6. Non-Goals

The first rebuild should explicitly avoid the following:

- Do not build a full application framework.
- Do not build a UI framework.
- Do not build a LangChain clone.
- Do not build a graph orchestration system unless needed later.
- Do not build a giant plugin marketplace.
- Do not hardcode agent behavior in TypeScript classes.
- Do not require users to subclass an Agent class.
- Do not make agents into code.
- Do not overbuild memory.
- Do not overbuild routing.
- Do not create unnecessary abstractions around every concept.
- Do not support every model provider on day one.
- Do not build enterprise permission systems on day one.
- Do not add complexity just because Claude Code or Codex has it.

The first version should prove the core runtime loop.

---

## 7. Inspiration From Claude Code and Codex

This project should study modern AI coding agents, especially Claude Code and Codex CLI, but should not blindly copy them.

Important patterns to learn from:

### 7.1 Markdown Configuration

Claude Code and Codex-style systems rely heavily on plain text configuration and instruction files.

This is the correct direction.

Bolt should use Markdown as the user-facing agent/skill definition format.

### 7.2 Subagents

Modern agent systems use subagents to isolate context, specialize behavior, and run work in parallel.

Bolt should support sub-agents as a first-class concept.

A sub-agent should:

- Run in its own isolated execution context
- Receive a focused task
- Use a specific agent definition
- Use limited tools
- Return a summarized result
- Avoid polluting the parent context

### 7.3 Tool Permissions

Modern coding agents use permission models around tool use.

Bolt should have a simple permission model from the beginning.

Agents should only be allowed to use tools they explicitly list or inherit through runtime configuration.

The runtime should be able to reject tool calls if the agent does not have permission.

### 7.4 Hooks / Lifecycle Events

Claude Code-style systems support lifecycle hooks.

Bolt should eventually support lifecycle hooks, but this should not be overbuilt in the first version.

Potential hook events:

- Runtime start
- Agent start
- Before model call
- After model call
- Before tool call
- After tool call
- Tool call failed
- Agent completed
- Sub-agent started
- Sub-agent completed
- Memory read
- Memory write

Hooks are useful for logging, tracing, policy enforcement, evals, safety, and automation.

For MVP, implement a very small internal event system or leave clear architecture for it.

### 7.5 Sandbox / Approval Concepts

Codex-style systems distinguish between safe operations and actions that need approval.

Bolt should support this as a future direction.

For MVP, implement tool access control.

Later, add:

- Tool risk levels
- Approval callbacks
- Human-in-the-loop gates
- Read/write/destructive tool categories
- Sandboxed execution for tools that touch filesystem or shell

---

## 8. Core Architecture

The new Bolt should be organized around these primitives:

1. Runtime
2. Agent
3. Skill
4. Tool
5. Model Adapter
6. Memory
7. Router
8. Execution Context
9. Sub-Agent Task
10. Result
11. Hook/Event System

---

## 9. Runtime

The runtime is the main public interface.

Example desired API:

```ts
import { BoltRuntime } from "@bolt-agentic/core";

const runtime = new BoltRuntime({
  agentsDir: "./agents",
  skillsDir: "./skills",
  model,
  tools,
  memory,
});

const result = await runtime.run("senior-engineer", {
  task: "Review this code and suggest improvements.",
  context: {
    files: [...],
  },
});
```

The runtime should support:

```ts
runtime.run(agentName, input)
runtime.route(input)
runtime.runParallel(tasks)
runtime.registerTool(tool)
runtime.registerSkill(skill)
runtime.loadAgent(name)
runtime.loadSkill(name)
```

The initial public API should be small.

### Runtime Responsibilities

The runtime should:

1. Load the requested agent Markdown file.
2. Parse frontmatter and body.
3. Resolve referenced skills.
4. Validate tool permissions.
5. Build the system prompt / execution prompt.
6. Pull relevant memory if configured.
7. Call the model.
8. Handle tool calls.
9. Continue the model-tool loop until completion.
10. Return a structured result.
11. Emit lifecycle events where needed.
12. Support sub-agent delegation.

---

## 10. Agent Definition Format

Agents should be Markdown files.

Recommended structure:

```md
---
name: senior-engineer
description: Use for senior-level software engineering, debugging, architecture, and code review tasks.
model: default
tools:
  - file.read
  - file.write
  - shell.run
  - git.diff
skills:
  - debugging
  - code-review
  - system-design
can_delegate: true
---

# Senior Engineer Agent

You are a senior software engineer.

## Responsibilities

- Understand the task before acting.
- Inspect relevant files before making recommendations.
- Prefer simple, maintainable solutions.
- Avoid overengineering.
- Explain tradeoffs clearly.

## Operating Rules

- Do not make broad rewrites unless necessary.
- Do not introduce new dependencies without justification.
- Prefer small, testable changes.
- When unsure, inspect before guessing.
- If a task is large, create a plan and delegate sub-tasks when useful.

## Output Format

Return:
1. Summary
2. Findings
3. Proposed changes
4. Implementation notes
5. Risks
```

### Required Frontmatter Fields

Minimum:

```yaml
name: string
description: string
```

Recommended optional fields:

```yaml
model: string
tools: string[]
skills: string[]
can_delegate: boolean
max_iterations: number
temperature: number
output_schema: string
```

### Agent Naming

Agent names should be stable IDs.

Use kebab-case:

- `senior-engineer`
- `email-assistant`
- `researcher`
- `planner`
- `debugger`
- `synthesizer`

### Agent Loading Rules

The runtime should support:

```txt
/agents
  senior-engineer.md
  email-assistant.md
  researcher.md
```

Possibly later:

```txt
.bolt/agents
src/agents
```

The runtime should allow the host app to configure agent directories.

---

## 11. Skill Definition Format

Skills should also be Markdown.

Recommended structure:

```md
---
name: debugging
description: A reusable debugging workflow for investigating software defects.
---

# Debugging Skill

## When to Use

Use this skill when diagnosing failing behavior, errors, regressions, or unclear technical bugs.

## Workflow

1. Reproduce the issue if possible.
2. Gather error messages and logs.
3. Identify the failing boundary.
4. Form hypotheses.
5. Test the smallest likely hypothesis first.
6. Propose the smallest safe fix.
7. Verify the fix with tests or reasoning.

## Rules

- Do not guess without evidence.
- Prefer root cause over symptom patching.
- State confidence level when uncertain.
```

Recommended directory:

```txt
/skills
  debugging.md
  code-review.md
  email-writing.md
```

Alternative future format:

```txt
/skills/debugging/SKILL.md
```

For MVP, keep it simple:

```txt
/skills/debugging.md
```

The runtime should resolve skills by name.

Agents may declare:

```yaml
skills:
  - debugging
  - code-review
```

The runtime loads those files and injects their content into the agent context.

---

## 12. Tool System

Tools are executable code.

Example tool definition:

```ts
import { z } from "zod";

const readFileTool = {
  name: "file.read",
  description: "Read a file from the current workspace.",
  inputSchema: z.object({
    path: z.string(),
  }),
  risk: "read",
  execute: async ({ path }, context) => {
    return await context.fs.readFile(path, "utf8");
  },
};
```

### Tool Interface

Recommended interface:

```ts
export type ToolRisk = "read" | "write" | "external" | "destructive";

export interface Tool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: unknown;
  risk?: ToolRisk;
  execute(input: TInput, context: ToolContext): Promise<TOutput>;
}
```

### Tool Context

```ts
export interface ToolContext {
  runtime: BoltRuntime;
  agent: LoadedAgent;
  runId: string;
  taskId?: string;
  memory?: MemoryStore;
  metadata?: Record<string, unknown>;
}
```

### Tool Permissions

Agents should only use tools they are allowed to use.

Example:

```yaml
tools:
  - email.search
  - email.send
```

If the model tries to call `shell.run`, but the agent does not have access, the runtime should reject it.

The runtime should support:

- explicit agent tool allowlist
- runtime-level global tool registry
- optional default tools
- optional denylist later

### MVP Tools

For MVP, include a few simple demo tools:

- `echo`
- `memory.write`
- `memory.search`
- maybe `file.read` if safe and scoped

Do not start with dangerous tools.

---

## 13. Model Adapter

The runtime should not be permanently locked to one model provider.

However, do not overbuild provider support on day one.

Create a simple model adapter interface:

```ts
export interface ModelAdapter {
  name: string;
  generate(input: ModelInput): Promise<ModelOutput>;
}
```

The model adapter should support:

- messages
- system prompt
- tool schemas
- tool calls
- streaming later
- metadata

Potential first provider:

- OpenAI
- Anthropic
- mock model for tests

The most important thing is to abstract just enough that the runtime is not hardcoded to a single SDK.

Do not build a complicated provider router in the MVP.

---

## 14. Execution Loop

The runtime execution loop is the heart of the library.

Basic loop:

1. Receive task.
2. Load agent.
3. Load skills.
4. Build messages.
5. Load relevant memory.
6. Call model.
7. If model returns tool calls:
   - validate tool permissions
   - validate tool input schema
   - execute tools
   - append tool results
   - call model again
8. Stop when model returns final answer or max iterations reached.
9. Return structured result.

Pseudo-code:

```ts
async function run(agentName: string, input: RunInput): Promise<RunResult> {
  const agent = await loadAgent(agentName);
  const skills = await loadSkills(agent.skills);
  const context = await buildContext(agent, skills, input);

  const messages = createInitialMessages(context);

  for (let i = 0; i < maxIterations; i++) {
    const output = await model.generate({
      messages,
      tools: getAllowedTools(agent),
    });

    if (output.toolCalls?.length) {
      for (const call of output.toolCalls) {
        const tool = registry.get(call.name);
        assertToolAllowed(agent, tool);
        const result = await tool.execute(call.input, toolContext);
        messages.push(toolResultMessage(call, result));
      }

      continue;
    }

    return {
      status: "completed",
      output: output.content,
      messages,
      usage: output.usage,
    };
  }

  return {
    status: "max_iterations_reached",
    messages,
  };
}
```

This loop should be simple and explicit.

Do not hide the core loop behind too many abstractions.

---

## 15. Memory

Memory should be a runtime interface.

Do not overbuild memory in the first version.

Recommended interface:

```ts
export interface MemoryStore {
  search(query: string, options?: MemorySearchOptions): Promise<MemoryRecord[]>;
  write(record: MemoryWriteInput): Promise<MemoryRecord>;
}
```

Possible record:

```ts
export interface MemoryRecord {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}
```

MVP memory implementation:

- In-memory store
- Optional file-based store

Later memory implementations:

- Redis
- Postgres
- SQLite
- Vector database
- User-provided adapter

Memory should be optional.

Runtime should work without memory.

Agents should not know the memory backend.

---

## 16. Router

Routing lets the runtime select the right agent for a task.

Example:

```ts
const result = await runtime.route({
  task: "Write a follow-up email to a recruiter.",
});
```

The runtime may choose:

```txt
email-assistant
```

Router should use agent metadata:

```yaml
name: email-assistant
description: Use for writing, editing, and responding to emails.
```

MVP router can be simple:

- Load all agent descriptions.
- Ask model which agent should handle the task.
- Return selected agent.
- Run selected agent.

Do not overbuild routing with embeddings or classifiers at first.

Potential API:

```ts
const routed = await runtime.route({
  task,
  candidates?: ["email-assistant", "researcher"],
});
```

Result:

```ts
{
  agent: "email-assistant",
  reason: "The task is an email-writing request.",
  result: RunResult
}
```

---

## 17. Sub-Agents

Sub-agents are critical.

The runtime should be designed for them early, even if MVP implementation is simple.

A sub-agent is an agent run started by another agent or by the runtime planner.

Sub-agents should:

- Run in isolated context.
- Receive a focused task.
- Use their own agent definition.
- Use limited tools.
- Return summarized output.
- Not pollute the parent context with all intermediate details.

Example use case:

A task says:

> Research competitors, inspect current codebase, propose architecture, and write implementation plan.

Main agent delegates:

- `researcher`: competitor/runtime design research
- `codebase-inspector`: inspect current repo
- `architect`: propose new architecture
- `synthesizer`: combine results

### Sub-Agent API

Potential API:

```ts
await runtime.runSubAgent({
  parentRunId,
  agent: "researcher",
  task: "Research modern Markdown-based agent runtimes.",
  context,
});
```

### Parallel Sub-Agent API

```ts
const results = await runtime.runParallel([
  {
    agent: "researcher",
    task: "Research modern agent runtimes.",
  },
  {
    agent: "codebase-inspector",
    task: "Inspect current Bolt repo and identify reusable parts.",
  },
  {
    agent: "architect",
    task: "Propose a clean architecture for vNext.",
  },
]);
```

### MVP Sub-Agent Support

For MVP, sub-agents can be exposed as runtime API calls.

Later, the model can call a built-in tool:

```txt
agent.run
agent.runParallel
```

This would allow agents to delegate dynamically.

Be careful with this. Delegation can create runaway loops.

Need guardrails:

- max depth
- max parallel tasks
- max total tool calls
- max budget
- allowed delegate agents

Recommended initial guardrails:

```ts
maxSubAgentDepth: 2
maxParallelSubAgents: 5
maxIterations: 10
```

---

## 18. Built-In Internal Tools

Eventually, Bolt may expose internal runtime tools to agents.

Examples:

- `agent.run`
- `agent.runParallel`
- `memory.search`
- `memory.write`
- `router.selectAgent`

These should be treated like tools and permissioned.

Example agent frontmatter:

```yaml
tools:
  - agent.run
  - agent.runParallel
  - memory.search
  - memory.write
```

Do not let every agent delegate by default.

Delegation must be explicit.

---

## 19. Hooks and Lifecycle Events

Hooks should be considered part of the long-term architecture.

For MVP, a simple event emitter is enough.

Possible events:

```ts
runtime:onStart
runtime:onStop
agent:onStart
agent:onComplete
agent:onError
model:beforeCall
model:afterCall
tool:beforeCall
tool:afterCall
tool:onError
subagent:onStart
subagent:onComplete
memory:beforeSearch
memory:afterSearch
memory:beforeWrite
memory:afterWrite
```

Potential API:

```ts
runtime.on("tool:beforeCall", async (event) => {
  console.log("Tool call:", event.toolName);
});
```

Later hooks can support:

- policy enforcement
- logging
- tracing
- evals
- approvals
- human-in-the-loop
- metrics
- security checks

MVP should not overbuild hooks.

Just make the architecture event-friendly.

---

## 20. Result Object

The runtime should return structured results.

Example:

```ts
export interface RunResult {
  runId: string;
  agent: string;
  status: "completed" | "failed" | "max_iterations_reached" | "cancelled";
  output?: string;
  messages?: RuntimeMessage[];
  toolCalls?: ToolCallRecord[];
  subRuns?: RunResultSummary[];
  usage?: UsageSummary;
  error?: ErrorSummary;
  metadata?: Record<string, unknown>;
}
```

This makes Bolt usable in real products.

The host app can inspect:

- What happened
- Which tools were called
- Which agent ran
- Whether sub-agents were used
- Whether the run failed
- How many tokens were used

---

## 21. Recommended Repository Structure

Proposed structure:

```txt
bolt-agentic/
  package.json
  tsconfig.json
  README.md
  AGENTS.md

  docs/
    vision.md
    architecture.md
    agent-format.md
    skill-format.md
    tool-system.md
    runtime.md
    memory.md
    subagents.md
    routing.md
    examples.md

  examples/
    basic/
      agents/
        assistant.md
      skills/
        summarization.md
      src/
        index.ts

    engineering-assistant/
      agents/
        senior-engineer.md
        debugger.md
        code-reviewer.md
      skills/
        debugging.md
        code-review.md
        system-design.md
      src/
        index.ts

  packages/
    core/
      src/
        index.ts
        runtime/
          BoltRuntime.ts
          run.ts
          context.ts
          events.ts
        agents/
          loadAgent.ts
          parseAgent.ts
          types.ts
        skills/
          loadSkill.ts
          parseSkill.ts
          types.ts
        tools/
          registry.ts
          types.ts
          validation.ts
        model/
          types.ts
          openai.ts
          mock.ts
        memory/
          types.ts
          inMemory.ts
        routing/
          route.ts
          types.ts
        subagents/
          runSubAgent.ts
          runParallel.ts
          types.ts
        results/
          types.ts
        utils/
          frontmatter.ts
          ids.ts
          errors.ts
      package.json
      tsconfig.json

    cli/
      src/
        index.ts
      package.json
      tsconfig.json
```

### Notes

The CLI package is optional.

Core comes first.

Do not build CLI before the runtime works.

---

## 22. Public API Target

The public API should eventually look like this:

```ts
import { BoltRuntime, defineTool, openaiModel } from "@bolt-agentic/core";
import { z } from "zod";

const runtime = new BoltRuntime({
  agentsDir: "./agents",
  skillsDir: "./skills",
  model: openaiModel({
    model: "gpt-5.5",
    apiKey: process.env.OPENAI_API_KEY,
  }),
});

runtime.registerTool(
  defineTool({
    name: "echo",
    description: "Echo input back to the agent.",
    inputSchema: z.object({
      text: z.string(),
    }),
    execute: async ({ text }) => {
      return { text };
    },
  })
);

const result = await runtime.run("assistant", {
  task: "Say hello using the echo tool.",
});

console.log(result.output);
```

This is the kind of simplicity we want.

---

## 23. Example Agent

```md
---
name: assistant
description: A general-purpose assistant for simple tasks.
tools:
  - echo
skills:
  - clear-communication
---

# Assistant

You are a helpful assistant.

## Rules

- Be clear.
- Be concise.
- Use tools only when useful.
- If you use a tool, explain the result naturally.

## Output

Return a direct answer.
```

---

## 24. Example Skill

```md
---
name: clear-communication
description: Helps agents produce clear, direct, useful responses.
---

# Clear Communication Skill

## Rules

- Prefer simple language.
- Avoid unnecessary jargon.
- Structure answers logically.
- Say when something is uncertain.
- Do not pretend to know what you do not know.
```

---

## 25. Example Runtime Run

```ts
const result = await runtime.run("assistant", {
  task: "Explain what Bolt-Agentic is in one sentence.",
});
```

Expected result:

```ts
{
  runId: "run_...",
  agent: "assistant",
  status: "completed",
  output: "Bolt-Agentic is a lightweight runtime for executing Markdown-defined AI agents with tools, skills, memory, and delegation."
}
```

---

## 26. Implementation Phases

### Phase 0: Research and Repo Inspection

The coding agent should first:

1. Inspect the existing repository.
2. Identify current architecture.
3. Identify reusable parts.
4. Identify what should be deleted/replaced.
5. Research current Claude Code/Codex patterns where useful.
6. Produce a short architecture proposal before writing major code.

Deliverables:

- `docs/current-state.md`
- `docs/rebuild-plan.md`
- Proposed new package structure
- List of reusable code, if any
- List of deleted/replaced concepts

Important:

Do not begin a large rewrite without first documenting the plan.

### Phase 1: Core Types and Parsing

Build:

- Agent type definitions
- Skill type definitions
- Tool type definitions
- Runtime result types
- Frontmatter parser
- Agent loader
- Skill loader

Deliverables:

- Load agent from `.md`
- Parse frontmatter
- Parse body
- Resolve skills by name
- Unit tests for parsing

No model calls yet.

### Phase 2: Tool Registry

Build:

- Tool interface
- Tool registry
- Tool permission validation
- Tool schema validation
- `defineTool` helper
- Example `echo` tool

Deliverables:

- Register tool
- Retrieve tool
- Validate allowed tool
- Reject disallowed tool
- Tests

### Phase 3: Model Adapter

Build:

- Model adapter interface
- Mock model adapter for tests
- One real provider adapter
- Message format
- Tool call format

Deliverables:

- Runtime can call mock model
- Runtime can call real model
- Runtime can pass available tools to model
- Runtime can receive final answer

### Phase 4: Runtime Execution Loop

Build:

- `BoltRuntime`
- `runtime.run()`
- Context builder
- Agent + skill prompt compiler
- Model call
- Basic tool-call loop
- Max iteration protection
- Structured result object

Deliverables:

- Basic agent can run
- Agent can use a tool
- Tool result gets passed back to model
- Final output returned
- Tests

### Phase 5: Memory Interface

Build:

- `MemoryStore` interface
- In-memory memory store
- Memory search/write tools
- Optional memory injection into context

Deliverables:

- Agent can write memory
- Agent can search memory
- Runtime can inject relevant memory
- Tests

### Phase 6: Routing

Build:

- Simple agent router
- Route based on agent descriptions
- `runtime.route()`

Deliverables:

- Given a task, runtime can select agent
- Router returns reason
- Runtime can execute selected agent
- Tests

### Phase 7: Sub-Agent Execution

Build:

- `runtime.runSubAgent()`
- `runtime.runParallel()`
- Isolated context
- Parent/child run IDs
- Guardrails for depth and max parallelism

Deliverables:

- Parent can trigger sub-agent run through API
- Multiple agents can run in parallel
- Results can be synthesized manually
- Tests

### Phase 8: Internal Agent Tools

Build optional internal tools:

- `agent.run`
- `agent.runParallel`

Only agents with explicit permission should use these.

Deliverables:

- Agent can delegate through tool call
- Runtime enforces delegation permissions
- Runtime prevents infinite recursion
- Tests

### Phase 9: Docs and Examples

Build:

- README
- Quickstart
- Agent format docs
- Skill format docs
- Tool system docs
- Runtime docs
- Memory docs
- Subagent docs
- Routing docs
- Examples

Deliverables:

- Basic example
- Engineering assistant example
- Email assistant example if useful
- Clear docs for library usage

### Phase 10: CLI Optional

Only after core is working.

Potential CLI:

```bash
bolt run assistant "Summarize this text"
bolt agents list
bolt skills list
bolt init
```

Do not build CLI before core runtime is stable.

---

## 27. Acceptance Criteria for MVP

MVP is complete when:

1. A developer can install/import the core library.
2. A developer can define an agent as a Markdown file.
3. A developer can define a skill as a Markdown file.
4. A developer can register a TypeScript tool.
5. The runtime can load an agent.
6. The runtime can resolve skills.
7. The runtime can call a model.
8. The runtime can expose allowed tools to the model.
9. The runtime can execute tool calls.
10. The runtime rejects disallowed tools.
11. The runtime returns a structured result.
12. There is at least one working example.
13. There are tests for parsing, tool registry, and execution loop.
14. Docs explain the architecture clearly.

MVP does not require:

- Full CLI
- Full plugin system
- Full approval system
- Full sandbox
- Vector memory
- Multi-provider routing
- UI
- Marketplace
- Complex graph workflows

---

## 28. Quality Bar

The implementation should be:

- Clean
- Small
- Typed
- Tested
- Easy to read
- Easy to delete/refactor
- Minimal
- Explicit
- Not clever
- Not magic-heavy

Prefer boring TypeScript.

Prefer small modules.

Prefer direct control flow.

Avoid deep inheritance.

Avoid excessive generics.

Avoid unnecessary decorators.

Avoid complex dependency injection.

Avoid framework cosplay.

---

## 29. Technical Preferences

Recommended:

- TypeScript
- ESM
- Node 20+
- `zod` for tool input schemas
- `gray-matter` or equivalent for Markdown frontmatter
- `vitest` for tests
- `tsx` for examples/dev scripts
- Simple package structure first
- Monorepo only if useful

Do not introduce heavy dependencies unless justified.

Every dependency should have a reason.

---

## 30. Coding Agent Instructions

When using Codex/Claude Code to build this, follow these rules:

### 30.1 Work in Phases

Do not attempt the entire rewrite in one massive change.

Start with docs and structure.

Then build core types.

Then parsing.

Then tools.

Then runtime.

Then model adapter.

Then examples.

### 30.2 Ask for Approval at Major Architecture Boundaries

Before implementing major architecture decisions, produce a short proposal.

Ask for approval before:

- Finalizing folder structure
- Choosing package architecture
- Choosing model adapter shape
- Choosing tool-call format
- Choosing memory API
- Choosing sub-agent API
- Adding any major dependency

### 30.3 Prefer Working Slices

Each phase should produce a working slice.

Example:

- First, parse an agent.
- Then parse an agent + skills.
- Then run with mock model.
- Then run with a real model.
- Then run with one tool.
- Then add memory.
- Then add subagents.

### 30.4 Keep the Maintainer in Control

The coding agent should not make broad product decisions without documenting them.

The maintainer wants to manage the process by approving:

- This is okay
- This is not okay
- This abstraction is too much
- This needs to be simpler
- This can be expanded

### 30.5 Be Aggressively Minimal

When in doubt, choose the simpler architecture.

Do not build for imaginary future use cases.

Build the smallest thing that proves the runtime.

---

## 31. Important Architectural Constraint

The most important constraint:

> Agents are Markdown. Agents are not code.

This must remain true.

There may be TypeScript types representing a loaded agent, but users should not need to create agent classes.

Correct:

```txt
agents/email-assistant.md
```

Incorrect:

```ts
class EmailAssistant extends Agent {}
```

Correct:

```yaml
tools:
  - email.send
  - email.search
```

Incorrect:

```ts
class EmailAssistant {
  async run() {
    await sendEmail()
  }
}
```

The runtime executes the agent.

The agent describes behavior.

---

## 32. Conceptual Model

The library should feel like this:

```txt
Markdown Agent
    +
Markdown Skills
    +
Registered Tools
    +
Memory
    +
Runtime
    =
Executable Agent
```

Or:

```txt
agent.md + skills.md + tools.ts + memory adapter + model adapter = run result
```

This is the whole library.

Everything else is secondary.

---

## 33. Suggested First Docs to Create

Create these early:

### `docs/vision.md`

Explain what Bolt is and is not.

### `docs/architecture.md`

Explain runtime, agents, skills, tools, memory, routing, subagents.

### `docs/agent-format.md`

Define Markdown agent format.

### `docs/skill-format.md`

Define Markdown skill format.

### `docs/tool-system.md`

Explain how tools are registered and permissioned.

### `docs/runtime.md`

Explain `BoltRuntime`.

### `docs/subagents.md`

Explain delegation and parallel execution.

### `docs/rebuild-plan.md`

Explain implementation phases.

---

## 34. Suggested `AGENTS.md`

The repository should include an `AGENTS.md` file for Codex/Claude Code.

Recommended content:

```md
# Agent Instructions for Bolt-Agentic

This repo is being rebuilt as a minimal TypeScript runtime library for Markdown-defined AI agents.

## Primary Rule

Agents are Markdown files. Do not implement agents as TypeScript classes.

## Architecture Principles

- Keep the core small.
- Prefer explicit TypeScript over clever abstractions.
- Tools are code.
- Skills are Markdown.
- Agents are Markdown.
- Runtime handles execution.
- Host app owns UI.
- Avoid framework bloat.

## Before Major Changes

Write a short plan before changing architecture.

## Testing

Add or update tests for parser, tool registry, runtime loop, and permissions.

## Non-Goals

Do not build a UI.
Do not build a full workflow framework.
Do not add heavy dependencies without justification.
Do not create class-based agents.
```

---

## 35. Risks

### 35.1 Overengineering

Biggest risk.

The project can easily become a bloated framework.

Mitigation:

- Keep MVP small.
- Add features only after core runtime works.
- Avoid copying every feature from Claude Code/Codex.

### 35.2 Agent Markdown Format Becomes Too Complex

If frontmatter becomes huge, the format becomes another programming language.

Mitigation:

- Keep frontmatter minimal.
- Put behavior in Markdown body.
- Use code only for tools.

### 35.3 Tool Permissions Are Too Weak

Agents with unrestricted tool access can be dangerous.

Mitigation:

- Tool allowlists per agent.
- Runtime validation.
- Tool risk levels.
- Later approval system.

### 35.4 Sub-Agent Loops Can Run Away

Delegation can recurse forever or explode in cost.

Mitigation:

- Max depth.
- Max iterations.
- Max parallel agents.
- Max total tool calls.
- Explicit delegation permission.

### 35.5 Memory Can Become Bloated

Memory systems can become their own product.

Mitigation:

- Start with simple adapter.
- Keep memory optional.
- Use clean interface.

---

## 36. The First Real Build Target

The first working demo should look like this:

```txt
examples/basic/
  agents/
    assistant.md
  skills/
    clear-communication.md
  src/
    index.ts
```

`assistant.md`:

```md
---
name: assistant
description: A basic assistant that can answer simple questions.
tools:
  - echo
skills:
  - clear-communication
---

# Assistant

You are a helpful assistant.

Use the clear communication skill.

Use tools only when useful.
```

`index.ts`:

```ts
import { BoltRuntime, defineTool, mockModel } from "@bolt-agentic/core";
import { z } from "zod";

const runtime = new BoltRuntime({
  agentsDir: "./agents",
  skillsDir: "./skills",
  model: mockModel(),
});

runtime.registerTool(
  defineTool({
    name: "echo",
    description: "Echoes text.",
    inputSchema: z.object({
      text: z.string(),
    }),
    execute: async ({ text }) => ({ text }),
  })
);

const result = await runtime.run("assistant", {
  task: "Use echo to say hello.",
});

console.log(result);
```

This proves the architecture.

After that, replace mock model with real model adapter.

---

## 37. Final North Star

The new Bolt should be a small, sharp, composable library that lets developers build real agentic systems without adopting a giant framework.

The north star:

> A developer writes Markdown agents, registers tools, optionally adds skills and memory, and lets one runtime execute the work.

The library should be powerful enough to support Claude Code/Codex-style workflows, but minimal enough to understand in one sitting.

That is the rebuild.
