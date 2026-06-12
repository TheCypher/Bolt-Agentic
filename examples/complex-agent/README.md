# Complex Agent Example (Bolt)

This example demonstrates a full, end‑to‑end agent that orchestrates tools and sub‑agents with scoped `BOLT.md` instructions.

**What it does**

- Searches for sources.
- Fetches documents.
- Summarizes evidence via a research sub‑agent.
- Validates claims via a validator sub‑agent.
- Synthesizes a final recommendation via the main agent.

---

## Folder layout

```
examples/complex-agent/
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
    index.mjs
  run.mjs
```

---

## Run

From repo root:

```bash
node examples/complex-agent/run.mjs
```

The example uses a **local mock provider** so it runs without API keys. To wire a real provider, swap the provider in `run.mjs`.

---

## How BOLT.md works here

- `examples/complex-agent/BOLT.md` defines **global rules**.
- `examples/complex-agent/agents/BOLT.md` defines **shared agent rules**.
- Each sub‑agent directory defines its own `BOLT.md` that **extends** the chain.

Bolt automatically loads the closest `BOLT.md` and uses `extends: true` to include parent instructions.
