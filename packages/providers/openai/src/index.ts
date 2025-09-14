import type { ModelProvider, ProviderCallArgs, ProviderResult } from '@bolt-ai/core';


export function createOpenAIProvider(model = 'gpt-4o-mini'): ModelProvider {
  return {
    id: `openai:${model}`,
    supports: ['text','json','embedding','image'],
    async call(args: ProviderCallArgs): Promise<ProviderResult> {
      // TODO: wire official SDK; for now, throw to prove the interface
      throw new Error('OpenAI adapter not implemented yet');
    }
  };
}