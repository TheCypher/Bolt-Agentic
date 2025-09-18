// packages/next/src/sse.ts
import type { AppRouter } from '@bolt-ai/core';

export function sse(routerOrPromise: Promise<AppRouter> | AppRouter) {
  return async (req: Request) => {
    const router: AppRouter = await Promise.resolve(routerOrPromise);
    const { searchParams } = new URL(req.url);

    const agentId = searchParams.get('agentId') || 'support';
    const input = searchParams.get('q') || '';
    const memoryScope = searchParams.get('scope') || undefined;

    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        const send = (event: string, data: any) => {
          controller.enqueue(enc.encode(`event: ${event}\n`));
          controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        (async () => {
          try {
            send('start', { agentId });

            let text = '';
            const result = await (router as any).route?.({
              id: crypto.randomUUID?.() ?? `${Date.now()}:${Math.random()}`,
              agentId,
              input,
              memoryScope,
              // IMPORTANT: stream tokens via onToken
              onToken: (delta: string) => {
                text += delta;
                send('token', { delta });
              }
            });

            // If the provider/agent returns a final string (or object), emit it
            if (typeof result === 'string') {
              if (result !== text) {
                // if agent returned full text separately, prefer it
                text = result;
              }
              send('message', { text });
            } else if (result != null) {
              send('message', { result, text });
            } else {
              send('message', { text });
            }

            send('done', {});
          } catch (e: any) {
            send('error', { message: e?.message || String(e) });
          } finally {
            controller.close();
          }
        })();
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      }
    });
  };
}
