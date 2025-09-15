// packages/next/src/router.ts
import path from "node:path";
import { pathToFileURL } from "node:url";
import fg from "fast-glob";

import {
  createAppRouter as createCoreRouter,
  EventBus,
  InMemoryStore,
} from "@bolt-ai/core";
import type {
  AppRouter,
  ModelProvider,
  Agent,
  MemoryStore,
} from "@bolt-ai/core";

export type NextCreateOptions = {
  /** Policy preset for the core router */
  preset?: "fast" | "cheap" | "strict";
  /** Provide providers explicitly (skips auto-detect) */
  providers?: ModelProvider[];
  /** Optional in-app agents directory (relative to process.cwd(), e.g. 'agents') */
  agentsDir?: string;
  /** Explicit agents map (alternative to agentsDir) */
  agents?: Record<string, Agent>;
  /** Provide a MemoryStore implementation (defaults to InMemoryStore) */
  memory?: MemoryStore;
  /** Enable/disable provider auto-detection by env (default: true) */
  providerAutoDetect?: boolean;
};

/**
 * Create a Bolt AppRouter prepped for Next.js.
 * - Registers explicit `agents` if provided.
 * - Picks up agents published on `globalThis.__BOLT_AGENTS__` by the app.
 * - Best-effort auto-load from compiled Next output `.next/server/app/<agentsDir>/**.js`,
 *   falling back to `<agentsDir>/**.js` if present.
 * - Auto-detects Groq provider if GROQ_API_KEY is set and @bolt-ai/providers-groq is installed.
 */
export async function createAppRouter(
  opts: NextCreateOptions = {}
): Promise<AppRouter> {
  const events = new EventBus();

  // Providers
  const providers: ModelProvider[] = [];
  if (opts.providers?.length) {
    providers.push(...opts.providers);
  } else if (opts.providerAutoDetect !== false) {
    // Auto-detect Groq when env key present AND package installed.
    if (process.env.GROQ_API_KEY) {
      try {
        // Use a computed specifier so DTS doesn't require the module at build time.
        const spec = "@bolt-ai/providers-groq";
        const mod: any = await import(spec).catch(() => null);
        if (mod?.createGroqProvider) {
          providers.push(mod.createGroqProvider());
        }
      } catch {
        /* ignore */
      }
    }
    // (Future: add other provider autodetects here)
  }

  let memory = opts.memory ?? new InMemoryStore();

  // Auto-detect Redis memory
  if (!opts.memory && process.env.REDIS_URL) {
    try {
      const spec = "@bolt-ai/memory-redis"; // computed to avoid DTS resolution
      const mod: any = await import(spec).catch(() => null);
      if (mod?.createRedisMemoryStore) {
        memory = mod.createRedisMemoryStore({}); // uses REDIS_URL env
      }
    } catch {
      // ignore if package isn't installed
    }
  }

  // Core router
  const router = createCoreRouter({
    preset: opts.preset ?? "fast",
    providers,
    events,
    memory: opts.memory ?? new InMemoryStore(),
  });

  // Agents: explicit map wins
  if (opts.agents && Object.keys(opts.agents).length) {
    (router as any).registerAgents?.(opts.agents);
    return router;
  }

  // Pick up agents published by the app on globalThis (guaranteed to be bundled by Next)
  const g = globalThis as any;
  const published = g.__BOLT_AGENTS__ || g.__BOLT_AGENTS || {};
  if (published && Object.keys(published).length) {
    (router as any).registerAgents?.(published);
    return router;
  }

  // Best-effort discovery from compiled Next output (and fallback to plain JS)
  if (opts.agentsDir) {
    const discovered = await discoverAgents(opts.agentsDir);
    if (Object.keys(discovered).length) {
      (router as any).registerAgents?.(discovered);
    }
  }

  return router;
}

async function discoverAgents(
  agentsDir: string
): Promise<Record<string, Agent>> {
  const root = process.cwd();
  let files: string[] = [];

  // 1) Prefer compiled JS under .next/server/app/<agentsDir>/**
  try {
    const compiledDir = path.join(root, ".next", "server", "app", agentsDir);
    files = await fg(["**/*.{js,mjs,cjs}"], { cwd: compiledDir, absolute: true });
  } catch {
    /* ignore */
  }

  // 2) Fallback: plain JS under <agentsDir> (don’t try TS at runtime)
  if (!files.length) {
    try {
      const srcDir = path.join(root, agentsDir);
      files = await fg(["**/*.{js,mjs,cjs}"], { cwd: srcDir, absolute: true });
    } catch {
      /* ignore */
    }
  }

  const agents: Record<string, Agent> = {};
  for (const file of files) {
    try {
      const mod = await import(pathToFileURL(file).href);
      // Try common export shapes and any named exports
      const candidates: any[] = [
        mod?.default,
        mod?.agent,
        mod?.support,
        ...Object.values(mod ?? {}),
      ];
      for (const c of candidates) {
        if (c && typeof c === "object" && "id" in c && (c as any).id) {
          agents[(c as Agent).id] = c as Agent;
        }
      }
    } catch {
      /* skip files that fail to import */
    }
  }
  return agents;
}

