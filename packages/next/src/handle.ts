import type { NextRequest } from 'next/server';
import type { AppRouter } from '@bolt-ai/core';

export function handle(routerPromise: Promise<AppRouter> | AppRouter) {
  return async (req: NextRequest) => {
    const router = await routerPromise;
    const { agentId, input } = await req.json();
    const out = await router.route({ agentId, input });
    return new Response(JSON.stringify(out), {
      headers: { 'Content-Type': 'application/json' }
    });
  };
}
