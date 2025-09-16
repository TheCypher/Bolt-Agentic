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
import type { Template } from "@bolt-ai/core";

export type NextCreateOptions = {
  /** Policy preset for the core router */
  preset?: "fast" | "cheap" | "strict";
  /** Provide providers explicitly (skips auto-detect) */
  providers?: ModelProvider[];
  /** In-app agents directory (relative to process.cwd(), e.g. 'agents') */
  agentsDir?: string;
  /** Explicit agents map (alternative to agentsDir) */
  agents?: Record<string, Agent>;
  /** Provide a MemoryStore implementation (defaults to InMemoryStore) */
  memory?: MemoryStore;
  /** Enable/disable provider auto-detection by env (default: true) */
  providerAutoDetect?: boolean;

  /** Explicit templates map (alternative to templatesDir) */
  templates?: Record<string, Template>;
  /** In-app templates directory (relative to process.cwd(), e.g. 'templates') */
  templatesDir?: string;
};

/**
 * Create a Bolt AppRouter prepped for Next.js:
 * - Provider autodetect (e.g. Groq) by env + installed package
 * - Memory autodetect: InMemory by default; switch to Redis if REDIS_URL + package present
 * - Agents: explicit > global publish > discovered from agentsDir (compiled or plain JS)
 * - Templates: explicit > global publish > discovered from templatesDir (compiled or plain JS)
 * - Exposes template helpers on the returned router: listTemplates/getTemplate/runTemplate
 */
export async function createAppRouter(
  opts: NextCreateOptions = {}
): Promise<AppRouter> {
  const events = new EventBus();

  // ----- Providers -----
  const providers: ModelProvider[] = [];
  if (opts.providers?.length) {
    providers.push(...opts.providers);
  } else if (opts.providerAutoDetect !== false) {
    // Auto-detect Groq when env key present AND package installed.
    if (process.env.GROQ_API_KEY) {
      try {
        // dynamic specifier so DTS doesn't hard-require the module
        const spec = "@bolt-ai/providers-groq";
        const mod: any = await import(spec).catch(() => null);
        if (mod?.createGroqProvider) {
          providers.push(mod.createGroqProvider());
        }
      } catch {
        /* ignore */
      }
    }
    // (Future: add more provider autodetects here)
  }

  // ----- Memory (default InMemory; optionally Redis) -----
  let memory = opts.memory ?? new InMemoryStore();

  if (!opts.memory && process.env.REDIS_URL) {
    try {
      const spec = "@bolt-ai/memory-redis";
      const mod: any = await import(spec).catch(() => null);
      if (mod?.createRedisMemoryStore) {
        memory = mod.createRedisMemoryStore({}); // uses REDIS_URL
      }
    } catch {
      // ignore if not installed
    }
  }

  // ----- Core router (pass resolved memory!) -----
  const router = createCoreRouter({
    preset: opts.preset ?? "fast",
    providers,
    events,
    memory,
  });

  // ====== Agents ======

  // 1) Explicit map wins
  if (opts.agents && Object.keys(opts.agents).length) {
    (router as any).registerAgents?.(opts.agents);
  } else {
    // 2) Global publish
    const g = globalThis as any;
    const published = g.__BOLT_AGENTS__ || g.__BOLT_AGENTS || {};
    if (published && Object.keys(published).length) {
      (router as any).registerAgents?.(published);
    } else if (opts.agentsDir) {
      // 3) Discover compiled or plain JS agents
      const discovered = await discoverAgents(opts.agentsDir);
      if (Object.keys(discovered).length) {
        (router as any).registerAgents?.(discovered);
      }
    }
  }

  // ====== Templates ======

  // Build a local registry (explicit > global > discovered)
  const templates: Record<string, Template> = {};

  // 1) Explicit templates
  if (opts.templates && Object.keys(opts.templates).length) {
    Object.assign(templates, opts.templates);
  }

  // 2) From global publish
  {
    const g = globalThis as any;
    const publishedTpl = g.__BOLT_TEMPLATES__ || g.__BOLT_TEMPLATES || {};
    if (publishedTpl && Object.keys(publishedTpl).length) {
      Object.assign(templates, publishedTpl);
    }
  }

  // 3) Discover from templatesDir
  if (opts.templatesDir) {
    const discoveredTpl = await discoverTemplates(opts.templatesDir);
    Object.assign(templates, discoveredTpl);
  }

  // Expose simple helpers on the router instance
  (router as any).listTemplates = () => Object.keys(templates);
  (router as any).getTemplate = (id: string) => templates[id] || null;
  (router as any).runTemplate = async (id: string, ctx: any) => {
    const t = templates[id];
    if (!t) {
      const err: any = new Error(`No template '${id}'`);
      err.code = "TEMPLATE_NOT_FOUND";
      throw err;
    }
    return await t.plan(ctx);
  };

  return router;
}

// ---------- Discovery helpers ----------

async function discoverAgents(agentsDir: string): Promise<Record<string, Agent>> {
  const root = process.cwd();
  let files: string[] = [];

  // 1) Prefer compiled JS under .next/server/app/<agentsDir>/**
  try {
    const compiledDir = path.join(root, ".next", "server", "app", agentsDir);
    files = await fg(["**/*.{js,mjs,cjs}"], { cwd: compiledDir, absolute: true });
  } catch {
    /* ignore */
  }

  // 2) Fallback: plain JS under <agentsDir>
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
      const candidates: any[] = [mod?.default, mod?.agent, mod?.support, ...Object.values(mod ?? {})];
      for (const c of candidates) {
        if (c && typeof c === "object" && "id" in c && (c as any).id) {
          agents[(c as Agent).id] = c as Agent;
        }
      }
    } catch {
      // skip bad files
    }
  }
  return agents;
}

async function discoverTemplates(templatesDir: string): Promise<Record<string, Template>> {
  const root = process.cwd();
  let files: string[] = [];

  // 1) Prefer compiled JS under .next/server/app/<templatesDir>/**
  try {
    const compiledDir = path.join(root, ".next", "server", "app", templatesDir);
    files = await fg(["**/*.{js,mjs,cjs}"], { cwd: compiledDir, absolute: true });
  } catch {
    /* ignore */
  }

  // 2) Fallback: plain JS under <templatesDir>
  if (!files.length) {
    try {
      const srcDir = path.join(root, templatesDir);
      files = await fg(["**/*.{js,mjs,cjs}"], { cwd: srcDir, absolute: true });
    } catch {
      /* ignore */
    }
  }

  const templates: Record<string, Template> = {};
  for (const file of files) {
    try {
      const mod = await import(pathToFileURL(file).href);
      const candidates: any[] = [mod?.default, mod?.template, ...Object.values(mod ?? {})];
      for (const c of candidates) {
        if (
          c &&
          typeof c === "object" &&
          "id" in c &&
          typeof (c as any).plan === "function"
        ) {
          templates[(c as Template).id] = c as Template;
        }
      }
    } catch {
      // skip bad files
    }
  }
  return templates;
}
