export type Capability = 'text' | 'json' | 'vision' | 'image' | 'embedding';


export interface Message { id: string; role: 'user'|'assistant'|'system'|'tool'; text?: string; json?: any; trace?: any }


export interface ProviderCallArgs {
  kind: Capability extends 'json' ? 'json' : 'text' | 'json' | 'image' | 'embedding';
  prompt?: string;
  schema?: any; // zod or JSON schema
  input?: unknown; // when not prompt-driven
  stream?: boolean;
  metadata?: Record<string, any>;
}


export interface ProviderResult<T=any> { output: T; tokens?: number; trace?: any }


export interface ModelProvider {
  id: string;
  supports: Capability[];
  call(args: ProviderCallArgs): Promise<ProviderResult>;
}


export interface ToolContext { allow?: string[]; memory?: MemoryStore; signal?: AbortSignal }
export interface Tool<TArgs=any, TOut=any> {
  id: string;
  schema?: any; // zod schema for args
  run(args: TArgs, ctx: ToolContext): Promise<TOut>;
}


export interface ToolRegistry { get(id: string): Tool | undefined; list(): Tool[]; register(t: Tool): void }


export interface Guard {
  schema?: any;
  scoreCheck?: { min: number; scorer: 'consistency'|'toxicity'|'grounding' };
  retry?: { max: number; backoffMs: number };
}


export type PlanStep =
| { id: string; kind: 'model'; agent: string; inputFrom?: string[]; guard?: Guard }
| { id: string; kind: 'tool'; toolId: string; args?: any; inputFrom?: string[]; guard?: Guard }
| { id: string; kind: 'parallel'; children: string[] }
| { id: string; kind: 'branch'; branches: { when: string; then: string[] }[] };


export interface Plan { id: string; steps: PlanStep[]; outputs: string[] }


export interface MemoryStore {
  get<T=unknown>(key: string): Promise<T | null>;
  set<T=unknown>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  patch<T=object>(key: string, delta: Partial<T>): Promise<void>;
  appendConversation(id: string, m: Message): Promise<void>;
  history(id: string, limit?: number): Promise<Message[]>;
}


export interface AgentCtx {
  input: unknown;
  call: (req: { kind: 'text'|'json'; prompt: string; schema?: any }) => Promise<any>;
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

export interface ProviderCallArgs {
  kind: 'text' | 'json' | 'image' | 'embedding';
  prompt?: string;
  schema?: any;
  input?: unknown;
  stream?: boolean;
  /** Called with incremental text tokens (if provider supports streaming) */
  onToken?: (delta: string) => void;
  metadata?: Record<string, any>;
}
