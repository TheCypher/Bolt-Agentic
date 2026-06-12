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
  ProviderToolCall,
  ProviderToolResult,
  Plan,
  Budget,
  Tool,
  ToolContext,
  ToolRegistry,
} from './types';

export type ProviderPreset = 'fast' | 'cheap' | 'strict' | 'auto';
type FixedPreset = Exclude<ProviderPreset, 'auto'>;

const PRESET_PROVIDER_ORDER: Record<FixedPreset, string[]> = {
  fast: ['groq', 'openai', 'anthropic', 'google', 'azure', 'mistral'],
  cheap: ['groq', 'openai', 'mistral', 'anthropic', 'google', 'azure'],
  strict: ['openai', 'anthropic', 'google', 'azure', 'mistral', 'groq'],
};

function parseProviderOrder(raw?: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter(Boolean);
}

function normalizePreset(value?: string | null): ProviderPreset | undefined {
  if (!value) return undefined;
  const v = value.toLowerCase().trim();
  if (v === 'fast' || v === 'cheap' || v === 'strict' || v === 'auto') return v;
  return undefined;
}

function matchProviderId(id: string, token: string) {
  if (!token) return false;
  if (id === token) return true;
  return id.startsWith(token);
}

function minDefined(a?: number, b?: number): number | undefined {
  if (a == null) return b;
  if (b == null) return a;
  return Math.min(a, b);
}

function mergeBudget(base?: Budget, override?: Budget): Budget | undefined {
  if (!base && !override) return undefined;
  return {
    maxLatencyMs: minDefined(base?.maxLatencyMs, override?.maxLatencyMs),
    maxCostUSD: minDefined(base?.maxCostUSD, override?.maxCostUSD),
  };
}

const DEFAULT_SENSITIVE_PATTERNS: RegExp[] = [
  /\bmedical\b/i,
  /\bdiagnos/i,
  /\bhealth\b/i,
  /\bpatient\b/i,
  /\bhipaa\b/i,
  /\bphi\b/i,
  /\blegal\b/i,
  /\battorney\b/i,
  /\blawsuit\b/i,
  /\btax\b/i,
  /\bfinance\b/i,
  /\bbank\b/i,
  /\bcredit card\b/i,
  /\bssn\b/i,
  /\bsocial security\b/i,
  /\bpassword\b/i,
  /\bapi key\b/i,
  /\bsecret\b/i,
  /\bconfidential\b/i,
  /\bpii\b/i,
  /\baccount number\b/i,
];

const DEFAULT_REDACTION_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9]{10,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /AIza[0-9A-Za-z-_]{20,}/g,
  /\b\d{3}-\d{2}-\d{4}\b/g,
];

function inputToText(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input == null) return '';
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

function autoPresetForInput(input: unknown): FixedPreset {
  const text = inputToText(input);
  for (const pattern of DEFAULT_SENSITIVE_PATTERNS) {
    if (pattern.test(text)) return 'strict';
  }
  return 'fast';
}

function resolvePreset(
  preset: ProviderPreset | undefined,
  input: unknown,
  agent: Agent | undefined,
  classify?: (input: unknown, agent?: Agent) => FixedPreset
): FixedPreset | undefined {
  if (!preset) return undefined;
  if (preset !== 'auto') return preset;
  if (classify) return classify(input, agent);
  return autoPresetForInput(input);
}

function policyToPreset(policy?: RouteHints['policy']): ProviderPreset | undefined {
  if (!policy) return undefined;
  if (policy === 'sensitive' || policy === 'strict') return 'strict';
  if (policy === 'cheap') return 'cheap';
  if (policy === 'fast') return 'fast';
  return undefined;
}

function extractRouteHints(input: unknown): { hints: RouteHints; input: unknown } {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const obj = input as Record<string, any>;
    if ('__bolt' in obj) {
      const { __bolt, ...rest } = obj;
      const hints = __bolt && typeof __bolt === 'object' ? (__bolt as RouteHints) : {};
      return { hints, input: rest };
    }
  }
  return { hints: {}, input };
}

function redactText(value: string, patterns: RegExp[], replacement: string): string {
  let out = value;
  for (const pattern of patterns) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function applyRedaction(args: ProviderCallArgs, options?: RedactionOptions): ProviderCallArgs {
  if (!options) return args;
  if (options.enabled === false) return args;
  const patterns = options.patterns?.length ? options.patterns : DEFAULT_REDACTION_PATTERNS;
  const replacement = options.replaceWith ?? '[REDACTED]';
  const out: ProviderCallArgs = { ...args };
  if (typeof out.prompt === 'string') {
    out.prompt = redactText(out.prompt, patterns, replacement);
  }
  if (typeof out.input === 'string') {
    out.input = redactText(out.input, patterns, replacement);
  }
  return out;
}

function resolveProviderOrder(options: {
  providerOrder?: string[];
  preset?: FixedPreset;
  providers: ModelProvider[];
}) {
  const order = options.providerOrder?.length
    ? options.providerOrder
    : options.preset
      ? PRESET_PROVIDER_ORDER[options.preset]
      : [];

  const ordered: ModelProvider[] = [];
  const used = new Set<string>();
  for (const token of order) {
    for (const p of options.providers) {
      if (used.has(p.id)) continue;
      if (matchProviderId(p.id, token)) {
        ordered.push(p);
        used.add(p.id);
      }
    }
  }
  for (const p of options.providers) {
    if (!used.has(p.id)) ordered.push(p);
  }
  return ordered;
}

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

export interface CircuitBreakerOptions {
  failureThreshold: number;
  cooldownMs: number;
}

export interface RedactionOptions {
  enabled?: boolean;
  patterns?: RegExp[];
  replaceWith?: string;
}

export interface RouteHints {
  preset?: ProviderPreset;
  providerOrder?: string[];
  policy?: 'sensitive' | 'strict' | 'fast' | 'cheap';
  budget?: Budget;
  redaction?: RedactionOptions;
}

export type RouteCostEstimator = (args: {
  provider: ModelProvider;
  args: ProviderCallArgs;
  result: ProviderResult;
}) => number;

export interface RouterOptions {
  providers: ModelProvider[];
  memory: MemoryStore;
  tools?: ToolRegistry;
  events?: EventBus;
  providerOrder?: string[];
  preset?: ProviderPreset;
  circuitBreaker?: CircuitBreakerOptions;
  budget?: Budget;
  costEstimator?: RouteCostEstimator;
  redaction?: RedactionOptions;
  maxToolCallIterations?: number;
  classify?: (input: unknown, agent?: Agent) => Exclude<ProviderPreset, 'auto'>;
}

function createScopedToolRegistry(options: {
  agent: Agent;
  registry?: ToolRegistry;
  memory: MemoryStore;
  signal?: AbortSignal;
}): ToolRegistry {
  const allowed = new Set(options.agent.tools ?? []);
  const isAllowed = (id: string) => allowed.has(id);
  const wrap = (tool: Tool): Tool => ({
    ...tool,
    run: async (args: any, ctx: ToolContext = {}) =>
      tool.run(args, {
        ...ctx,
        allow: options.agent.tools,
        memory: ctx.memory ?? options.memory,
        signal: ctx.signal ?? options.signal,
      }),
  });

  return {
    get(id: string) {
      if (!isAllowed(id)) return undefined;
      const tool = options.registry?.get(id);
      return tool ? wrap(tool) : undefined;
    },
    list() {
      return (options.registry?.list() ?? []).filter((tool) => isAllowed(tool.id)).map(wrap);
    },
    register(tool: Tool) {
      options.registry?.register(tool);
    },
  };
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
  private preset?: ProviderPreset;
  private providerOrder?: string[];
  private circuitBreaker?: CircuitBreakerOptions;
  private budget?: Budget;
  private costEstimator?: RouteCostEstimator;
  private redaction?: RedactionOptions;
  private classify?: (input: unknown, agent?: Agent) => FixedPreset;
  private tools?: ToolRegistry;
  private maxToolCallIterations: number;
  private breakerState = new Map<string, { failures: number; openUntil?: number }>();

  // optional local template registry (apps can also publish via global)
  private templates = new Map<string, Template>();

  constructor(opts: RouterOptions) {
    this.preset = opts.preset;
    this.providers = opts.providers ?? [];
    this.providerOrder = opts.providerOrder;
    this.circuitBreaker = opts.circuitBreaker;
    this.budget = opts.budget;
    this.costEstimator = opts.costEstimator;
    this.redaction = opts.redaction;
    this.classify = opts.classify;
    this.tools = opts.tools;
    this.maxToolCallIterations =
      typeof opts.maxToolCallIterations === 'number' && Number.isFinite(opts.maxToolCallIterations)
        ? Math.max(0, Math.floor(opts.maxToolCallIterations))
        : 4;
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
    return this.resolveProviders(undefined, undefined, {}).map((p) => p.id);
  }

  private resolveProviders(agent?: Agent, input?: unknown, hints: RouteHints = {}): ModelProvider[] {
    const envOrder = parseProviderOrder(process.env.BOLT_PROVIDER_ORDER);
    const envPreset = normalizePreset(process.env.BOLT_PRESET);
    const hintPreset = normalizePreset(hints.preset) ?? policyToPreset(hints.policy);
    const basePreset = hintPreset ?? this.preset ?? envPreset;
    const effectivePreset = resolvePreset(basePreset, input, agent, this.classify);
    const order =
      (hints.providerOrder && hints.providerOrder.length ? hints.providerOrder : undefined) ??
      (this.providerOrder && this.providerOrder.length ? this.providerOrder : undefined) ??
      (envOrder.length ? envOrder : undefined) ??
      (effectivePreset ? PRESET_PROVIDER_ORDER[effectivePreset] : undefined) ??
      [];
    return resolveProviderOrder({ providers: this.providers, providerOrder: order });
  }

  private isProviderHealthy(providerId: string): boolean {
    if (!this.circuitBreaker) return true;
    const state = this.breakerState.get(providerId);
    if (!state) return true;
    if (state.openUntil && Date.now() < state.openUntil) return false;
    if (state.openUntil && Date.now() >= state.openUntil) {
      this.breakerState.set(providerId, { failures: 0 });
    }
    return true;
  }

  private recordProviderFailure(providerId: string) {
    if (!this.circuitBreaker) return;
    const state = this.breakerState.get(providerId) ?? { failures: 0 };
    state.failures += 1;
    if (state.failures >= this.circuitBreaker.failureThreshold) {
      state.openUntil = Date.now() + this.circuitBreaker.cooldownMs;
    }
    this.breakerState.set(providerId, state);
  }

  private recordProviderSuccess(providerId: string) {
    if (!this.circuitBreaker) return;
    this.breakerState.set(providerId, { failures: 0 });
  }

  private pickProvider(agent: Agent | undefined, input?: unknown, hints: RouteHints = {}): ModelProvider {
    const required = agent?.capabilities?.length ? agent.capabilities : [];
    const ordered = this.resolveProviders(agent, input, hints);
    const candidates = required.length
      ? ordered.filter((p) => required.every((cap) => p.supports.includes(cap)))
      : ordered;
    const healthy = this.circuitBreaker ? candidates.filter((p) => this.isProviderHealthy(p.id)) : candidates;
    const p = healthy[0];
    if (!p) {
      const capText = required.length ? ` for capabilities: ${required.join(', ')}` : '';
      if (candidates.length) {
        throw new BoltError('NO_PROVIDER', `No healthy provider configured on the router${capText}.`);
      }
      throw new BoltError('NO_PROVIDER', `No model provider configured on the router${capText}.`);
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
    const providers = this.resolveProviders(agent, args.input, {});
    const providerId = providers[0]?.id ?? 'none';
    const ok = Boolean(agent);
    return {
      ok,
      reason: ok ? 'ready' : `agent '${args.agentId}' not found`,
      agentId: args.agentId,
      agents: this.listAgents(),
      provider: providerId,
      providers: providers.map((p) => p.id),
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
    const { hints, input: cleanedInput } = extractRouteHints(input);
    const budget = mergeBudget(this.budget, hints.budget);
    const redaction = hints.redaction ? { ...this.redaction, ...hints.redaction } : this.redaction;

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
    const provider = this.pickProvider(agent, cleanedInput, hints);
    this.events.emit({ type: 'route:provider.select', id, providerId: provider.id });

    const routeStartedAt = Date.now();
    let totalCost = 0;

    const invokeProvider = async (args: ProviderCallArgs): Promise<ProviderResult> => {
      const t0 = Date.now();
      this.events.emit({ type: 'provider:call:start', id, providerId: provider.id, args: { kind: args.kind } });

      const safeArgs = applyRedaction(args, redaction);
      let res: ProviderResult;
      try {
        // wire token streaming into event bus (if provider supports it)
        res = await provider.call({
          ...safeArgs,
          onToken: (delta: string) => this.events.emit({ type: 'provider:call:token', id, delta }),
        } as any);
      } catch (err) {
        this.recordProviderFailure(provider.id);
        throw err;
      }

      this.recordProviderSuccess(provider.id);

      this.events.emit({
        type: 'provider:call:end',
        id,
        providerId: provider.id,
        ms: Date.now() - t0,
        tokens: res.tokens,
        outputPreview: typeof res.output === 'string' ? String(res.output).slice(0, 120) : undefined,
      });

      if (this.costEstimator) {
        const cost = this.costEstimator({ provider, args: safeArgs, result: res });
        if (Number.isFinite(cost)) {
          totalCost += Number(cost);
        }
      } else if (provider.estimateCost) {
        const cost = provider.estimateCost({ tokens: res.tokens, input: safeArgs });
        if (Number.isFinite(cost)) {
          totalCost += Number(cost);
        }
      }
      if (budget?.maxCostUSD != null && totalCost > budget.maxCostUSD) {
        throw new Error('Route budget exceeded: cost');
      }

      if (budget?.maxLatencyMs != null && Date.now() - routeStartedAt > budget.maxLatencyMs) {
        throw new Error('Route budget exceeded: latency');
      }

      return res;
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

    const tools = createScopedToolRegistry({
      agent,
      registry: this.tools,
      memory,
    });

    const runProviderToolCalls = async (
      toolCalls: ProviderToolCall[],
      iteration: number
    ): Promise<ProviderToolResult[]> => {
      const results: ProviderToolResult[] = [];
      for (let index = 0; index < toolCalls.length; index += 1) {
        const toolCall = toolCalls[index];
        const tool = tools.get(toolCall.toolId);
        if (!tool) {
          throw new Error(`Tool not allowed or not found: ${toolCall.toolId}`);
        }
        const output = await tool.run(toolCall.args, {});
        results.push({
          id: toolCall.id ?? `${toolCall.toolId}:${iteration}:${index}`,
          toolId: toolCall.toolId,
          output,
        });
      }
      return results;
    };

    // provider wrapper to emit call/stream/end events and satisfy provider-native tool calls
    const call = async (args: ProviderCallArgs): Promise<any> => {
      let nextArgs: ProviderCallArgs = args;
      let toolIterations = 0;
      let toolResults: ProviderToolResult[] = [...(args.toolResults ?? [])];

      while (true) {
        const res = await invokeProvider(nextArgs);
        const toolCalls = res.toolCalls ?? [];
        if (!toolCalls.length) return res.output;

        if (toolIterations >= this.maxToolCallIterations) {
          throw new Error(`Provider tool call iteration limit exceeded: ${this.maxToolCallIterations}`);
        }

        const newResults = await runProviderToolCalls(toolCalls, toolIterations);
        toolResults = [...toolResults, ...newResults];
        nextArgs = {
          ...args,
          toolResults,
        };
        toolIterations += 1;
      }
    };

    // run agent with the wrapped call + traced memory
    const ctx: AgentCtx = { input: cleanedInput, call, memory, tools } as any;
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
export function createAppRouter(opts: RouterOptions): AppRouter {
  return new Router(opts);
}
