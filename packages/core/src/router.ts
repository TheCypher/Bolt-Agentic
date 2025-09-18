// packages/core/src/router.ts

import { BoltError } from './errors';
import { EventBus, type TraceEvent } from './events';
import type { Template } from './templates';
import type {
  Agent,
  AgentCtx,
  MemoryStore,
  ModelProvider,
  ProviderCallArgs,
  ProviderResult,
  Plan,
} from './types';

/** Public surface other packages/apps rely on */
export interface AppRouter {
  /** Invoke an agent by id with an input payload. Emits trace events on `events`. */
  route(req: { id: string; agentId: string; input: unknown; memoryScope?: string }): Promise<any>;

  /** Introspect how a route would execute (no model calls). */
  explain(args: { agentId: string; input?: unknown; memoryScope?: string }): Promise<{
    ok: boolean;
    reason: string;
    agentId: string;
    agents: string[];
    provider: string;
    providers: string[];
    memory: string;
    env: { GROQ_API_KEY: boolean; REDIS_URL: boolean };
  }>;

  /** Register multiple agents (id -> Agent). */
  registerAgents(map: Record<string, Agent>): void;

  /** List registered agent IDs. */
  listAgents(): string[];

  /** List registered provider IDs. */
  listProviders(): string[];

  /** Event stream for observability. */
  readonly events: EventBus;

  /** Template helpers (deterministic planners). */
  registerTemplates?(map: Record<string, Template>): void;
  listTemplates?(): string[];
  runTemplate?(
    templateId: string,
    ctx: { goal: any; agentId: string; memoryScope?: string; params?: Record<string, any> }
  ): Promise<Plan | null>;
}

/** Internal: guards a dynamic global read (Next bundles agents/templates into globals) */
function readGlobalBag<T>(key: string): Record<string, T> {
  const g = globalThis as any;
  const bag = g?.[key];
  return bag && typeof bag === 'object' ? (bag as Record<string, T>) : {};
}

/** Core Router */
export class Router implements AppRouter {
  private agents = new Map<string, Agent>();
  private providers: ModelProvider[] = [];
  public events: EventBus;
  private memory: MemoryStore;

  // optional local template registry (apps can also publish via global)
  private templates = new Map<string, Template>();

  constructor(opts: { providers: ModelProvider[]; memory: MemoryStore; events?: EventBus }) {
    this.providers = opts.providers ?? [];
    this.memory = opts.memory;
    this.events = opts.events ?? new EventBus();
  }

  /** ---- Agent registry ---- */
  registerAgents(map: Record<string, Agent>) {
    for (const a of Object.values(map)) this.agents.set(a.id, a);
  }
  listAgents() {
    return [...this.agents.keys()];
  }

  /** ---- Provider info ---- */
  listProviders() {
    return this.providers.map((p) => p.id);
  }
  private pickProvider(): ModelProvider {
    const p = this.providers[0];
    if (!p) {
      throw new BoltError('NO_PROVIDER', 'No model provider configured on the router.');
    }
    return p;
  }
  private memoryImplName() {
    return this.memory?.constructor?.name ?? 'Unknown';
  }

  /** ---- Templates (local + global merge) ---- */
  registerTemplates(map: Record<string, Template>) {
    for (const t of Object.values(map)) this.templates.set(t.id, t);
  }
  listTemplates(): string[] {
    const local = [...this.templates.keys()];
    const glob = Object.keys(readGlobalBag<Template>('__BOLT_TEMPLATES__'));
    const set = new Set([...local, ...glob]);
    return [...set.values()];
  }
  async runTemplate(
    templateId: string,
    ctx: { goal: any; agentId: string; memoryScope?: string; params?: Record<string, any> }
  ): Promise<Plan | null> {
    const local = this.templates.get(templateId);
    const globalMap = readGlobalBag<Template>('__BOLT_TEMPLATES__');
    const t = local ?? globalMap[templateId];
    if (!t) return null;
    return await t.plan({ ...ctx });
  }

  /** ---- Diagnostics ---- */
  async explain(args: { agentId: string; input?: unknown; memoryScope?: string }) {
    const agent = this.agents.get(args.agentId);
    const providerId = this.providers[0]?.id ?? 'none';
    const ok = Boolean(agent);
    return {
      ok,
      reason: ok ? 'ready' : `agent '${args.agentId}' not found`,
      agentId: args.agentId,
      agents: this.listAgents(),
      provider: providerId,
      providers: this.listProviders(),
      memory: this.memoryImplName(),
      env: {
        GROQ_API_KEY: Boolean(process.env.GROQ_API_KEY),
        REDIS_URL: Boolean(process.env.REDIS_URL),
      },
    };
  }

  /** ---- Routing ---- */
  async route(req: { id: string; agentId: string; input: unknown; memoryScope?: string }): Promise<any> {
    const { id, agentId, input, memoryScope } = req;

    // start trace
    this.events.emit({ type: 'route:start', id, agentId, inputKind: typeof input, memoryScope });

    // resolve agent
    const agent = this.agents.get(agentId);
    if (!agent) {
      this.events.emit({ type: 'route:agent.resolve', id, agentId, ok: false, reason: 'not found' });
      throw new BoltError('AGENT_NOT_FOUND', `No agent '${agentId}'`);
    }
    this.events.emit({ type: 'route:agent.resolve', id, agentId, ok: true });

    // choose provider (naive)
    const provider = this.pickProvider();
    this.events.emit({ type: 'route:provider.select', id, providerId: provider.id });

    // provider wrapper to emit call/stream/end events
    const call = async (args: ProviderCallArgs): Promise<any> => {
      const t0 = Date.now();
      this.events.emit({ type: 'provider:call:start', id, providerId: provider.id, args: { kind: args.kind } });

      // wire token streaming into event bus (if provider supports it)
      const res: ProviderResult = await provider.call({
        ...args,
        onToken: (delta: string) => this.events.emit({ type: 'provider:call:token', id, delta }),
      } as any);

      this.events.emit({
        type: 'provider:call:end',
        id,
        providerId: provider.id,
        ms: Date.now() - t0,
        tokens: res.tokens,
        outputPreview: typeof res.output === 'string' ? String(res.output).slice(0, 120) : undefined,
      });

      return res.output;
    };

    // memory wrapper to trace history/append
    const memory: MemoryStore = {
      get: <T = unknown>(k: string) => this.memory.get<T>(k),
      set: <T = unknown>(k: string, v: T, ttl?: number) => this.memory.set<T>(k, v, ttl),
      patch: <T extends object>(k: string, d: Partial<T>) => this.memory.patch<T>(k, d),
      history: async (scope: string, limit?: number) => {
        const arr = await this.memory.history(scope, limit);
        this.events.emit({ type: 'memory:history', id, scope, limit, count: arr.length });
        return arr;
      },
      appendConversation: async (scope: string, m: any) => {
        await this.memory.appendConversation(scope, m);
        this.events.emit({ type: 'memory:append', id, scope, role: m.role });
      },
    };

    // minimal ToolRegistry stub (full registry lives elsewhere; runner can pass ad-hoc tools)
    const tools = {
      get: (_id: string) => undefined,
      list: () => [] as any[],
      register: (_t: any) => {},
    };

    // run agent with the wrapped call + traced memory
    const ctx: AgentCtx = { input, call, memory, tools } as any;
    try {
      const out = await agent.run(ctx);
      return out;
    } catch (err: any) {
      this.events.emit({
        type: 'error',
        id,
        message: String(err?.message ?? err),
        stack: err?.stack,
      } as TraceEvent);
      throw err;
    }
  }
}

/** Factory used by adapters (e.g., @bolt-ai/next) */
export function createAppRouter(opts: {
  providers: ModelProvider[];
  memory: MemoryStore;
  events?: EventBus;
}): AppRouter {
  return new Router(opts);
}
