````markdown
# Bolt

**Provider-agnostic TypeScript agents, routing, planning, tools, and state — with a one-liner Next.js integration.**

> Status: **v0.1-pre**. Core chat + streaming + Groq provider are working. Planner, fallback routing, more providers, and RAG/tools are in progress.

---

## Why Bolt?

- **Agents first** – author tiny, composable agents with `defineAgent`.
- **Provider-agnostic** – swap Groq/OpenAI/etc. behind a unified call surface.
- **Streaming** – true token streaming to the browser via SSE + React hook.
- **One-liner Next.js** – `createAppRouter({ preset: 'fast', agentsDir: 'agents' })`.
- **Pragmatic core** – router, memory, tools, with planner/runner on the way.

---

## Requirements

- **Node** ≥ 18.17
- **pnpm** ≥ 9
- A Groq API key (for the included provider)

---

## Quick Start (Next.js App Router)

> Until packages are published, install from local **tarballs**.

### 0) Install packages

In the **Bolt** repo:

```bash
pnpm -r build
DEST="$PWD/../bolt-tars"
mkdir -p "$DEST"
pnpm -F @bolt-ai/core pack --pack-destination "$DEST"
pnpm -F @bolt-ai/agents pack --pack-destination "$DEST"
pnpm -F @bolt-ai/next pack --pack-destination "$DEST"
pnpm -F @bolt-ai/react pack --pack-destination "$DEST"
pnpm -F @bolt-ai/providers-groq pack --pack-destination "$DEST"
````

In your **Next.js** app:

```bash
pnpm add ../bolt-tars/bolt-ai-core-*.tgz \
         ../bolt-tars/bolt-ai-agents-*.tgz \
         ../bolt-tars/bolt-ai-next-*.tgz \
         ../bolt-tars/bolt-ai-react-*.tgz \
         ../bolt-tars/bolt-ai-providers-groq-*.tgz
```

Create `.env.local`:

```bash
GROQ_API_KEY=your_key
GROQ_MODEL=llama-3.3-70b-versatile
```

### 1) Add an agent

`/agents/support.ts`

```ts
import { defineAgent } from '@bolt-ai/agents';

export default defineAgent({
  id: 'support',
  description: 'Answers FAQs, stays concise.',
  capabilities: ['text'],
  async run({ input, call, memory }) {
    const history = await memory.history('support', 6);
    return call({
      kind: 'text',
      prompt: `You are a concise support agent.
History: ${JSON.stringify(history)}
Question: ${typeof input === 'string' ? input : JSON.stringify(input)}`
    });
  }
});
```

### 2) Ensure agents are bundled (tiny registry)

> Next only bundles files that are imported somewhere. Publish agents to `globalThis` and import the registry once.

`/agents/index.ts`

```ts
import support from './support';
(globalThis as any).__BOLT_AGENTS__ = { support };
export { support };
```

### 3) API routes (one-liner)

**Non-streaming** – `/app/api/ai/route.ts`

```ts
import '@/agents'; // ensure agents are bundled
import { createAppRouter, handle } from '@bolt-ai/next';

export const runtime = 'nodejs';
const router = createAppRouter({ preset: 'fast', agentsDir: 'agents' });

export const POST = handle(router);
```

**Streaming (SSE)** – `/app/api/ai/stream/route.ts`

```ts
import '@/agents'; // ensure agents are bundled
import { sse, createAppRouter } from '@bolt-ai/next';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const router = createAppRouter({ preset: 'fast', agentsDir: 'agents' });

export const GET = sse(router);
```

### 4) Client page

`/app/chat/page.tsx`

```tsx
'use client';
import { useAgent } from '@bolt-ai/react';
import { useState } from 'react';

export default function ChatPage() {
  const { messages, status, send, cancel } = useAgent('support', {
    streaming: true,
    streamEndpoint: '/api/ai/stream'
  });
  const [value, setValue] = useState('');

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-4">
      <h1 className="text-xl font-semibold">Support Chat</h1>
      <div className="border rounded p-3 h-[50vh] overflow-auto bg-white space-y-2">
        {messages.map(m => (
          <div key={m.id}><b>{m.role === 'user' ? 'You' : 'AI'}:</b> {m.text}</div>
        ))}
        {status === 'streaming' && <div className="opacity-60">…</div>}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const q = value.trim();
          if (!q) return;
          setValue('');
          void send({ text: q }); // let it stream
        }}
        className="flex gap-2"
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          name="q"
          className="flex-1 border rounded px-3 py-2"
          placeholder="Ask anything…"
        />
        <button className="border rounded px-4 py-2" disabled={!value}>Send</button>
        {status === 'streaming' && (
          <button type="button" onClick={cancel} className="border rounded px-3">Stop</button>
        )}
      </form>
    </main>
  );
}
```

### File tree (reference)

```
your-next-app/
├─ .env.local
├─ app/
│  ├─ chat/page.tsx
│  └─ api/ai/
│     ├─ route.ts
│     └─ stream/route.ts
└─ agents/
   ├─ support.ts
   └─ index.ts
```

---

## What’s implemented (v0.1-pre)

* **@bolt-ai/core**

  * `createAppRouter()` with `route()` and `routeStream(onToken)`
  * Unified provider call args (`stream`, `onToken`)
  * InMemory memory store; lightweight event bus; typed errors

* **@bolt-ai/agents**

  * `defineAgent()` helper for authoring agents

* **@bolt-ai/providers-groq**

  * Text & JSON chat, **true token streaming** (Chat Completions)

* **@bolt-ai/next**

  * `createAppRouter({ agentsDir })` one-liner
  * Agent auto-registration for Next:

    * Reads `globalThis.__BOLT_AGENTS__` (reliable)
    * Falls back to compiled `.next/server/app/<agentsDir>/**/*.js`
  * `handle(router)` (POST JSON) and `sse(router)` (token stream)

* **@bolt-ai/react**

  * `useAgent()` hook with EventSource streaming + cancel

* **@bolt-ai/tools**

  * `http.fetch` via `undici.fetch`

---

## Development (Bolt monorepo)

```bash
pnpm i
pnpm -r build
```

Pack tarballs for local testing:

```bash
DEST="$PWD/../bolt-tars"
mkdir -p "$DEST"
pnpm -F @bolt-ai/core pack --pack-destination "$DEST"
pnpm -F @bolt-ai/agents pack --pack-destination "$DEST"
pnpm -F @bolt-ai/next pack --pack-destination "$DEST"
pnpm -F @bolt-ai/react pack --pack-destination "$DEST"
pnpm -F @bolt-ai/providers-groq pack --pack-destination "$DEST"
```

**Workspace tips**

* Any package that **imports `@bolt-ai/core`**:

  * Put `@bolt-ai/core` in **peerDependencies**
  * Keep `@bolt-ai/core: workspace:*` in **devDependencies** only
* Per-package `tsconfig.json` with `"moduleResolution": "Bundler"`
* Avoid `packages/**` globs; use:

  ```yaml
  packages:
    - 'packages/*'
    - 'packages/*/*'
    - '!packages/**/src/**'
    - 'examples/*'
  ```

---

## Troubleshooting

* **No agent 'support'**

  * Ensure `/agents/index.ts` exists and your API routes include `import '@/agents'`
  * Confirm the agent default-exports an object with `id: 'support'`

* **Nothing streams**

  * On the SSE route export: `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `revalidate = 0`
  * Check DevTools → Network → **/api/ai/stream** → EventStream for `token` events

* **404 for @bolt-ai/core during install**

  * Install **all** tarballs together; packages list `@bolt-ai/core` as a **peer**

* **Type errors for `{ agents }` option**

  * Update to the latest `@bolt-ai/next` tarball or keep using `agentsDir` + `globalThis` publish

* **`spawn ENOENT` when building a package**

  * Install `tsup` in that package’s **devDependencies**

---

## Roadmap (near-term)

* **Providers**: OpenAI adapter + provider order/fallback
* **Planner**: MVP sequential/parallel steps, Zod guards, SSE step events
* **Memory**: Redis adapter polish, TTLs, history compaction
* **Tools**: `web.search` (SerpAPI), `vector.query` interface
* **Reliability**: retries/backoff/timeouts, circuit breaker, redaction
* **Observability**: `router.explain()`, trace SSE, debug endpoints
* **Docs**: recipes (JSON mode, RAG), CLI planner example

---

## License

MIT

```
::contentReference[oaicite:0]{index=0}
```
