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
  preset?: "fast" | "cheap" | "strict";
  providers?: ModelProvider[];
  agentsDir?: string;
  agents?: Record<string, Agent>;
  memory?: MemoryStore;
  providerAutoDetect?: boolean;
};

export async function createAppRouter(
  opts: NextCreateOptions = {}
): Promise<AppRouter> {
  const events = new EventBus();

  // Providers
  const providers: ModelProvider[] = [];
  if (opts.providers?.length) {
    providers.push(...opts.providers);
  } else if (opts.providerAutoDetect !== false) {
    if (process.env.GROQ_API_KEY) {
      try {
        const spec = "@bolt-ai/providers-groq";
        const mod: any = await import(spec).catch(() => null);
        if (mod?.createGroqProvider) {
          providers.push(mod.createGroqProvider());
        }
      } catch { /* ignore */ }
    }
  }

  // Resolve memory (default InMemory; optionally switch to Redis)
  let memory = opts.memory ?? new InMemoryStore();

  if (!opts.memory && process.env.REDIS_URL) {
    try {
      const spec = "@bolt-ai/memory-redis";
      const mod: any = await import(spec).catch(() => null);
      if (mod?.createRedisMemoryStore) {
        memory = mod.createRedisMemoryStore({}); // uses REDIS_URL
      }
    } catch { /* ignore if not installed */ }
  }

  // Core router — IMPORTANT: pass the resolved `memory`
  const router = createCoreRouter({
    preset: opts.preset ?? "fast",
    providers,
    events,
    memory, // <-- use this, not a fresh InMemory
  });

  // Agents: explicit map wins
  if (opts.agents && Object.keys(opts.agents).length) {
    (router as any).registerAgents?.(opts.agents);
    return router;
  }

  // Global publish
  const g = globalThis as any;
  const published = g.__BOLT_AGENTS__ || g.__BOLT_AGENTS || {};
  if (published && Object.keys(published).length) {
    (router as any).registerAgents?.(published);
    return router;
  }

  // Discover compiled or plain JS agents
  if (opts.agentsDir) {
    const discovered = await discoverAgents(opts.agentsDir);
    if (Object.keys(discovered).length) {
      (router as any).registerAgents?.(discovered);
    }
  }

  return router;
}

async function discoverAgents(agentsDir: string): Promise<Record<string, Agent>> {
  const root = process.cwd();
  let files: string[] = [];

  try {
    const compiledDir = path.join(root, ".next", "server", "app", agentsDir);
    files = await fg(["**/*.{js,mjs,cjs}"], { cwd: compiledDir, absolute: true });
  } catch { /* ignore */ }

  if (!files.length) {
    try {
      const srcDir = path.join(root, agentsDir);
      files = await fg(["**/*.{js,mjs,cjs}"], { cwd: srcDir, absolute: true });
    } catch { /* ignore */ }
  }

  const agents: Record<string, Agent> = {};
  for (const file of files) {
    try {
      const mod = await import(pathToFileURL(file).href);
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
    } catch { /* skip bad files */ }
  }
  return agents;
}
