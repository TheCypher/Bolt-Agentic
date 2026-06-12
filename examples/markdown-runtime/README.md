# Markdown Runtime Example

This example shows the minimal path for loading Markdown agents and skills into `createMarkdownRuntime`, registering a local tool, waiting for `runtime.ready()`, and calling `runtime.run()`.

It uses a deterministic mock provider and a local knowledge tool, so it makes no network calls and does not require API keys.

## Flow

```
examples/markdown-runtime/
  agents/support.md
        |
        | skills: [concise]
        | tools:  [local.kb.lookup]
        v
  createMarkdownRuntime({ agentsDir, skillsDir, tools })
        |
        v
  await runtime.ready()
        |
        v
  local.kb.lookup({ topic: "shipping" })
        |
        v
  await runtime.run("support", { question, facts })
        |
        v
  deterministic mock provider output
```

## Run

From the repo root:

```bash
pnpm build && node examples/markdown-runtime/run.mjs
```

If dependencies are not installed yet, run `pnpm install` first.

Expected output includes:

```text
Loaded agents: support
Registered tools: local.kb.lookup

=== RESULT ===
Order status lives in the customer portal. Next action: open the tracking link from your shipping email.
```
