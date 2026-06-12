import { BoltError } from "./errors";
import { Router, type AppRouter, type RouterOptions } from "./router";
import { InMemoryStore } from "./memory";
import { Registry } from "./tools";
import type { Agent, MemoryStore, ModelProvider, Tool, ToolRegistry } from "./types";

export interface RuntimeRunOptions {
  id?: string;
  memoryScope?: string;
  throwOnError?: boolean;
}

export interface RuntimeRunRequest extends RuntimeRunOptions {
  agentId: string;
  input: unknown;
}

export interface RuntimeError {
  code: string;
  message: string;
  cause?: unknown;
}

export interface RunResult<T = unknown> {
  ok: boolean;
  id: string;
  agentId: string;
  output?: T;
  error?: RuntimeError;
}

export interface RuntimeOptions extends Omit<RouterOptions, "memory" | "tools"> {
  memory?: MemoryStore;
  agents?: Agent[] | Record<string, Agent>;
  tools?: Tool[] | ToolRegistry;
}

export interface BoltRuntime {
  readonly router: AppRouter;
  readonly memory: MemoryStore;
  readonly tools: ToolRegistry;
  registerAgents(agents: Agent[] | Record<string, Agent>): void;
  registerTools(tools: Tool[] | ToolRegistry): void;
  listAgents(): string[];
  listProviders(): string[];
  listTools(): string[];
  run<T = unknown>(agentId: string, input: unknown, options?: RuntimeRunOptions): Promise<RunResult<T>>;
  route<T = unknown>(request: RuntimeRunRequest): Promise<RunResult<T>>;
  runParallel<T = unknown>(requests: RuntimeRunRequest[]): Promise<Array<RunResult<T>>>;
}

function makeRunId(agentId: string): string {
  return `run_${agentId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeAgents(agents: Agent[] | Record<string, Agent>): Record<string, Agent> {
  if (Array.isArray(agents)) {
    return Object.fromEntries(agents.map((agent) => [agent.id, agent]));
  }
  return agents;
}

function normalizeError(error: unknown): RuntimeError {
  if (error instanceof BoltError) {
    return { code: error.code, message: error.message, cause: error.cause };
  }
  if (error instanceof Error) {
    return { code: "RUNTIME_ERROR", message: error.message };
  }
  return { code: "RUNTIME_ERROR", message: String(error) };
}

export class DefaultBoltRuntime implements BoltRuntime {
  readonly router: AppRouter;
  readonly memory: MemoryStore;
  readonly tools: ToolRegistry;

  constructor(options: RuntimeOptions) {
    this.memory = options.memory ?? new InMemoryStore();
    this.tools = Array.isArray(options.tools) || !options.tools ? new Registry() : options.tools;

    if (Array.isArray(options.tools)) {
      this.registerTools(options.tools);
    }

    const routerOptions: RouterOptions = {
      ...options,
      memory: this.memory,
      tools: this.tools,
    };
    this.router = new Router(routerOptions);

    if (options.agents) {
      this.registerAgents(options.agents);
    }
  }

  registerAgents(agents: Agent[] | Record<string, Agent>): void {
    this.router.registerAgents(normalizeAgents(agents));
  }

  registerTools(tools: Tool[] | ToolRegistry): void {
    if (Array.isArray(tools)) {
      for (const tool of tools) this.tools.register(tool);
      return;
    }
    for (const tool of tools.list()) this.tools.register(tool);
  }

  listAgents(): string[] {
    return this.router.listAgents();
  }

  listProviders(): string[] {
    return this.router.listProviders();
  }

  listTools(): string[] {
    return this.tools.list().map((tool) => tool.id);
  }

  async run<T = unknown>(
    agentId: string,
    input: unknown,
    options: RuntimeRunOptions = {}
  ): Promise<RunResult<T>> {
    return this.route<T>({ ...options, agentId, input });
  }

  async route<T = unknown>(request: RuntimeRunRequest): Promise<RunResult<T>> {
    const id = request.id ?? makeRunId(request.agentId);
    try {
      const output = await this.router.route({
        id,
        agentId: request.agentId,
        input: request.input,
        memoryScope: request.memoryScope,
      });
      return { ok: true, id, agentId: request.agentId, output };
    } catch (error) {
      if (request.throwOnError !== false) throw error;
      return { ok: false, id, agentId: request.agentId, error: normalizeError(error) };
    }
  }

  async runParallel<T = unknown>(requests: RuntimeRunRequest[]): Promise<Array<RunResult<T>>> {
    return Promise.all(requests.map((request) => this.route<T>(request)));
  }
}

export function createRuntime(options: RuntimeOptions): BoltRuntime {
  return new DefaultBoltRuntime(options);
}

export function createBoltRuntime(options: RuntimeOptions): BoltRuntime {
  return createRuntime(options);
}
