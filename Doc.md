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

# Memory

Bolt stores lightweight conversation and KV state behind a `MemoryStore` interface.

- **InMemoryStore** — zero-config, **per-process** (ephemeral). Great for local dev, demos, tests.
- **RedisMemoryStore** — **shared + persistent** across instances. Recommended for production.

> In the Next.js adapter, memory is **InMemory by default**, and can auto-switch to Redis when `REDIS_URL` is present (and the Redis adapter is installed). You can always override explicitly.

---

## TL;DR — Which one am I using?

- You call `createAppRouter` from **`@bolt-ai/next`** (the Next adapter) and **do not** pass `memory`:
  - **No `REDIS_URL`** → uses **InMemoryStore**.
  - **With `REDIS_URL`** **and** `@bolt-ai/memory-redis` installed → uses **RedisMemoryStore** (autodetect).
- If you **explicitly pass** a `memory` instance, that always wins.

---

## Next.js (recommended)

> Keep the one-liner and let the adapter choose. Make sure your `agents/` folder is bundled once via `import '@/agents'`.

### InMemory (default)

```ts
// app/api/ai/route.ts
import '@/agents';
import { createAppRouter, handle } from '@bolt-ai/next';

export const runtime = 'nodejs';

const router = createAppRouter({
  preset: 'fast',
  agentsDir: 'agents', // one-liner; memory defaults to InMemory
});

export const POST = handle(router);
````

### Redis (auto-detect)

Install the adapter tarball/package and set env:

```
pnpm add @bolt-ai/memory-redis
# or install your local tarball:
# pnpm add ../bolt-tars/bolt-ai-memory-redis-0.0.0.tgz
```

`.env.local`

```
REDIS_URL=redis://localhost:6379
```

Leave your route code **unchanged** (no `memory:` option needed). The Next adapter will pick Redis when `REDIS_URL` is present **and** `@bolt-ai/memory-redis` is resolvable.

### Redis (explicit — always works)

If your current `@bolt-ai/next` build doesn’t have autodetect, force it:

```ts
import '@/agents';
import { handle } from '@bolt-ai/next';
import { createAppRouter } from '@bolt-ai/core';
import { createGroqProvider } from '@bolt-ai/providers-groq';
import { createRedisMemoryStore } from '@bolt-ai/memory-redis';

export const runtime = 'nodejs';

const router = createAppRouter({
  preset: 'fast',
  providers: [createGroqProvider()],
  memory: createRedisMemoryStore(), // reads REDIS_URL
});
// NOTE: when using the core router directly, register agents explicitly
// or keep using the Next adapter's createAppRouter + agentsDir.

export const POST = handle(router);
```

---

## Node / Core (non-Next) usage

When you use the **core** router directly (`@bolt-ai/core`), you control memory explicitly:

```ts
import { createAppRouter, InMemoryStore } from '@bolt-ai/core';

const router = createAppRouter({
  preset: 'fast',
  memory: new InMemoryStore(),
});
```

Redis:

```ts
import { createAppRouter } from '@bolt-ai/core';
import { createRedisMemoryStore } from '@bolt-ai/memory-redis';

const router = createAppRouter({
  preset: 'fast',
  memory: createRedisMemoryStore({ /* optional: namespace, ttlSeconds, maxHistory */ }),
});
```

---

## Adapter options & behavior

### InMemoryStore

* **Zero config**, fast.
* Data is **not shared** across server processes/workers.
* Cleared on process restart.

### RedisMemoryStore

* Persistent, shared across instances.
* Options (constructor):

  * `namespace?: string` — key prefix (`"bolt"` default)
  * `ttlSeconds?: number` — expire keys/lists after N seconds (0 = no expiry)
  * `maxHistory?: number` — trim stored messages per conversation (default `200`)
* Environment:

  * `REDIS_URL=redis://localhost:6379`

---

## What gets stored?

Bolt appends **user** and **assistant** turns to memory automatically (via the router) so that agents can call:

```ts
const history = await memory.history('support', 6);
```

> The scope/id you pass to `history(scope, limit)` is typically the **agent id** (e.g., `"support"`), but you can use any logical scope if you build multi-threaded UX.

---

## Quick sanity checks

### See InMemory working

1. **Ensure** `REDIS_URL` is **unset** (or explicitly pass `new InMemoryStore()`).
2. Send a few chat messages.
3. Add a tiny probe:

```ts
// app/api/ai/_memcheck/route.ts
import { createAppRouter } from '@bolt-ai/next';
export const runtime = 'nodejs';

export async function GET() {
  const r: any = await createAppRouter({ preset: 'fast', agentsDir: 'agents' });
  const mem = r?.opts?.memory ?? r?.memory;
  const hist = await mem?.history?.('support', 50);
  return new Response(JSON.stringify({ count: hist?.length ?? 0, last: hist?.at?.(-1) ?? null }), {
    headers: { 'content-type': 'application/json' },
  });
}
```

Open `/api/ai/_memcheck` → `count > 0` while the dev server stays up.
Restarting the server **resets** InMemory (by design).

### See Redis persisting

1. Install `@bolt-ai/memory-redis` and set `REDIS_URL`.
2. Keep your Next route **without** a `memory:` option (autodetect), or pass `createRedisMemoryStore()` explicitly.
3. Send a few messages, then open `/api/ai/_memcheck` → `count > 0`.
4. Restart the server → `count` still **> 0** (data persisted in Redis).

---

## Gotchas

* **Next vs Core**: Only the **Next adapter** autoloads agents from `agentsDir` and may auto-switch memory. The **core** router does neither; you must pass `memory` explicitly and register agents yourself.
* **Edge runtime**: Use `export const runtime = 'nodejs'` for routes using Redis or streaming.
* **Bundling**: Ensure your agents are bundled at least once (e.g., `import '@/agents'`) so Next compiles them; otherwise autoload won’t find them.

```

## Quick sanity check (to see InMemory working)

1) **Remove** `REDIS_URL` (or force `InMemoryStore()` as above).
2) Hit your chat a few times.
3) Add a quick probe route:
   ```ts
   // app/api/ai/_memcheck/route.ts
   import { createAppRouter } from '@bolt-ai/next';
   export const runtime = 'nodejs';
   export async function GET() {
     const r: any = await createAppRouter({ preset: 'fast', agentsDir: 'agents' });
     const mem = r?.opts?.memory ?? r?.memory;
     const hist = await mem.history?.('support', 50);
     return new Response(JSON.stringify({ count: hist?.length ?? 0, last: hist?.at?.(-1) ?? null }), {
       headers: { 'content-type': 'application/json' }
     });
   }
````

4. Open `/api/ai/_memcheck` → you should see `count > 0` while the server stays up. Restarting the server clears InMemory (by design).

---

## What’s implemented (v0.1-pre)

* **@bolt-ai/core**

  * `createAppRouter()` with `route()` and `routeStream(onToken)`
  * Unified provider call args (`stream`, `onToken`)
  * InMemory memory store; lightweight event bus; typed errors
  * RedisMemoryStore; Persistent and shared across instances.(production-ready)

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
