// packages/core/src/types.ts

export type Capability = 'text' | 'json' | 'vision' | 'image' | 'embedding';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  text?: string;
  json?: any;
  trace?: any;
}

export interface ProviderCallArgs {
  kind: 'text' | 'json' | 'image' | 'embedding';
  prompt?: string;
  schema?: any;        // zod or JSON schema
  input?: unknown;     // when not prompt-driven
  stream?: boolean;
  /** Called with incremental text tokens (if provider supports streaming) */
  onToken?: (delta: string) => void;
  metadata?: Record<string, any>;
}

export interface ProviderResult<T = any> {
  output: T;
  tokens?: number;     // optional token count for budgeting
  trace?: any;
}

export interface ModelProvider {
  id: string;
  supports: Capability[];
  call(args: ProviderCallArgs): Promise<ProviderResult>;
}

export interface ToolContext {
  allow?: string[];
  memory?: MemoryStore;
  signal?: AbortSignal;           // <-- propagate cancellation/timeouts to tools
}

export interface Tool<TArgs = any, TOut = any> {
  id: string;
  schema?: any; // zod schema for args
  run(args: TArgs, ctx: ToolContext): Promise<TOut>;
}

export interface ToolRegistry {
  get(id: string): Tool | undefined;
  list(): Tool[];
  register(t: Tool): void;
}

export interface Guard {
  schema?: any;
  scoreCheck?: { min: number; scorer: 'consistency' | 'toxicity' | 'grounding' };
  /** backoffMs optional so { retry: { max: 1 } } type-checks */
  retry?: { max: number; backoffMs?: number };
}

type BaseStep = {
  id: string;
  guard?: Guard;
  /** optional cache signature key; "auto" derives from (step,input) */
  cacheKey?: string | 'auto';
  /** per-step timeout in ms (soft; see notes) */
  timeoutMs?: number;
  /** optional idempotency key hint for tools */
  idempotencyKey?: string;
};

export type ModelStep = BaseStep & {
  kind: 'model';
  agent: string;
  inputFrom?: string[];
};

export type ToolStep = BaseStep & {
  kind: 'tool';
  toolId: string;
  args?: any;
  inputFrom?: string[];
};

export type ParallelStep = BaseStep & {
  kind: 'parallel';
  children: string[];   // child step ids (model/tool), executed concurrently
  maxConcurrency?: number;
};

export type Expr =
  | { var: string }       // reference into outputs, e.g. { var: "validate.valid" }
  | { value: any }        // literal
  | string | number | boolean | null;

export type Condition =
  | { truthy: string }    // treat outputs["a.b.c"] as boolean
  | { eq: { left: Expr; right: Expr } }
  | { gt: { left: Expr; right: Expr } }
  | { lt: { left: Expr; right: Expr } }
  | string;               // shorthand truthy for "some.step.path"

export type BranchStep = BaseStep & {
  kind: 'branch';
  branches: { when: Condition; then: string[] }[];
  else?: string[];
};

export type MapChild =
  | ({ kind: 'model'; agent: string; inputFrom?: string[] } & Omit<BaseStep, 'id'>)
  | ({ kind: 'tool'; toolId: string; args?: any; inputFrom?: string[] } & Omit<BaseStep, 'id'>);

export type MapStep = BaseStep & {
  kind: 'map';
  itemsFrom: string;        // step id whose output is an array
  child: MapChild;          // template step to run for each item
  maxConcurrency?: number;  // per-map concurrency
  fromItemAsInput?: boolean;// if true, pass the array item as the child's input
};

export type PlanStep = ModelStep | ToolStep | ParallelStep | BranchStep | MapStep;

export interface Plan { id: string; steps: PlanStep[]; outputs: string[] }

export interface MemoryStore {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  patch<T extends object = any>(key: string, delta: Partial<T>): Promise<void>;
  appendConversation(id: string, m: Message): Promise<void>;
  history(id: string, limit?: number): Promise<Message[]>;
}

export interface AgentCtx {
  input: unknown;
  call: (req: { kind: 'text' | 'json'; prompt: string; schema?: any }) => Promise<any>;
  memory: MemoryStore;
  tools: ToolRegistry;
}

export interface Agent {
  id: string;
  description?: string;
  capabilities: Capability[];
  outputSchema?: any;
  run(ctx: AgentCtx): Promise<any>;
}

/** Runner/Planner support types */
export type ToolFn = (args: any, ctx: RunnerContext) => Promise<any>;

export interface RunnerContext {
  taskId: string;
  agentId: string;
  input: any;
  memoryScope?: string;
  tools?: Record<string, ToolFn>;
  signal?: AbortSignal | null;
}

export interface RunnerEvent {
  type: 'plan' | 'step:start' | 'step:retry' | 'step:done' | 'done';
  plan?: Plan;
  stepId?: string;
  attempt?: number;
  output?: any;
  outputs?: Record<string, any>;
}

export interface StepCache {
  get(key: string): Promise<any | null>;
  set(key: string, value: any, ttlSeconds?: number): Promise<void>;
}

/** Optional budget limits for a run */
export interface Budget {
  maxLatencyMs?: number;
  maxCostUSD?: number;
}

/** Cost estimator: given a step and its result, return $ cost */
export type CostEstimator = (args: {
  step: PlanStep;
  result: any;
  tokens?: number;
}) => number;

export interface RunOptions {
  maxConcurrency?: number;
  onEvent?: (e: RunnerEvent) => void;
  cache?: StepCache | null;
  defaultStepTTLSeconds?: number;
  stepTimeoutMs?: number;
  budget?: Budget;
}
