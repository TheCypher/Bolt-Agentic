import { BoltError } from './errors';
import type { Agent, ModelProvider, MemoryStore } from './types';
import { EventBus } from './events';
import { InMemoryStore } from './memory';

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
    events?.emit({ type: 'route.decide', payload: { agentId } });
    events?.emit({ type: 'provider.choose', payload: { provider: provider?.id } });

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
    return agent.run({ input, call, memory, tools: (null as any) });
  }
}

export function createAppRouter(opts: RouterOptions) { return new AppRouter(opts) }