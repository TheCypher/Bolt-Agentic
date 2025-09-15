import { BoltError } from './errors';
import type { Agent, ModelProvider, MemoryStore } from './types';
import { EventBus } from './events';
import { InMemoryStore } from './memory';
import { randomUUID } from "node:crypto";

export interface RouterOptions {
  providers: ModelProvider[];
  providerOrder?: string[];
  preset?: 'fast'|'cheap'|'strict';
  events?: EventBus;
  memory?: MemoryStore;
}

export class AppRouter {
  private agents: Record<string, Agent> = {};
  constructor(private opts: RouterOptions) {}

  registerAgents(a: Record<string, Agent>) { Object.assign(this.agents, a) }

  async route({ agentId, input }: { agentId: string; input: unknown }) {
    return this._run({ agentId, input, onToken: undefined });
  }

  async routeStream({ agentId, input, onToken }: {
    agentId: string; input: unknown; onToken: (t: string) => void;
  }) {
    return this._run({ agentId, input, onToken });
  }

  private async _run({ agentId, input, onToken }:{
    agentId: string; input: unknown; onToken?: (t: string)=>void;
  }) {
    const agent = this.agents[agentId];
    if (!agent) throw new BoltError('AGENT_NOT_FOUND', `No agent '${agentId}'`);
  
    const { providers, events } = this.opts;
    const provider = providers?.[0];
  
    const call = async (req: { kind: 'text'|'json'; prompt: string; schema?: any }) => {
      if (!provider) throw new BoltError('NO_PROVIDER', 'No providers configured');
      const res = await provider.call({
        kind: req.kind,
        prompt: req.prompt,
        schema: req.schema,
        stream: Boolean(onToken),
        onToken
      });
      return res.output;
    };
  
    const memory = this.opts.memory ?? new InMemoryStore();
    const inputText = typeof input === "string" ? input : JSON.stringify(input ?? "");
  
    // Append user message
    try {
      await memory.appendConversation(agentId, {
        id: safeUUID(),
        role: "user",
        text: inputText,
        ts: Date.now()
      } as any);
    } catch {}
  
    const output = await agent.run({ input, call, memory, tools: (null as any) });
  
    // Append assistant message if it's text
    if (typeof output === "string") {
      try {
        await memory.appendConversation(agentId, {
          id: safeUUID(),
          role: "assistant",
          text: output,
          ts: Date.now()
        } as any);
      } catch {}
    }
  
    return output;
  }
}

function safeUUID() {
  try { return randomUUID(); } catch { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
}

export function createAppRouter(opts: RouterOptions) { return new AppRouter(opts) }