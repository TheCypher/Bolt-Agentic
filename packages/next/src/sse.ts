import type { AppRouter } from '@bolt-ai/core';

export function sse(routerPromise: Promise<AppRouter> | AppRouter) {
  return async (req: Request) => {
    const router = await routerPromise;
    const { searchParams } = new URL(req.url);
    const agentId = searchParams.get('agentId') || 'support';
    const input = searchParams.get('q') || '';

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
            await router.routeStream({
              agentId,
              input,
              onToken: (delta) => {
                text += delta;
                send('token', { delta });   // stream incremental tokens
              }
            });
            send('message', { text });      // final full text
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
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      }
    });
  };
}
