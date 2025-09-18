import type { NextRequest } from 'next/server';
import type { AppRouter } from '@bolt-ai/core';

import { randomUUID } from 'node:crypto'; // Node runtime
// or use globalThis.crypto.randomUUID()

export function handle(router: AppRouter) {
  return async function POST(req: Request) {
    const body = await req.json().catch(() => ({}));
    const agentId = body.agentId ?? new URL(req.url).searchParams.get('agentId') ?? 'support';
    const input   = body.input   ?? body.q ?? body.text ?? '';
    const memoryScope = body.memoryScope ?? new URL(req.url).searchParams.get('memoryScope') ?? undefined;

    const id = body.id
      ?? req.headers.get('x-bolt-id')
      ?? (typeof randomUUID === 'function' ? randomUUID() : (crypto as any).randomUUID());

    const result = await router.route({ id, agentId, input, memoryScope });
    return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
  };
}