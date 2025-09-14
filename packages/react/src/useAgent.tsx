import { useCallback, useRef, useState } from 'react';

type Msg = { id: string; role: 'user'|'assistant'; text: string };
type Opts = { streaming?: boolean; streamEndpoint?: string; memoryScope?: string };

export function useAgent(agentId: string, opts?: Opts) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [status, setStatus] = useState<'idle'|'streaming'>('idle');
  const esRef = useRef<EventSource | null>(null);
  const assistRef = useRef<string>(''); // accumulate current assistant text

  const send = useCallback(async (input: { text: string }) => {
    setMessages(m => [...m, { id: crypto.randomUUID(), role: 'user', text: input.text }]);

    if (opts?.streaming && opts.streamEndpoint) {
      setStatus('streaming');
      assistRef.current = '';
      const url = new URL(opts.streamEndpoint, window.location.origin);
      url.searchParams.set('agentId', agentId);
      url.searchParams.set('q', input.text);

      esRef.current?.close();
      const es = new EventSource(url.toString());
      esRef.current = es;

      let assistantId: string | null = null;

      es.addEventListener('token', (ev: any) => {
        try {
          const { delta } = JSON.parse(ev.data);
          if (!assistantId) {
            assistantId = crypto.randomUUID();
            setMessages(m => [...m, { id: assistantId!, role: 'assistant', text: '' }]);
          }
          assistRef.current += delta;
          setMessages(m => m.map(msg =>
            msg.id === assistantId ? { ...msg, text: assistRef.current } : msg
          ));
        } catch {}
      });

      es.addEventListener('message', (ev: any) => {
        try {
          const { text } = JSON.parse(ev.data);
          if (!assistantId) {
            assistantId = crypto.randomUUID();
            setMessages(m => [...m, { id: assistantId!, role: 'assistant', text }]);
          } else {
            setMessages(m => m.map(msg =>
              msg.id === assistantId ? { ...msg, text } : msg
            ));
          }
        } catch {}
      });

      const cleanup = () => { es.close(); setStatus('idle'); };
      es.addEventListener('done', cleanup);
      es.addEventListener('error', cleanup);
      return;
    }

    // non-streaming fallback
    const res = await fetch('/api/ai', {
      method: 'POST',
      body: JSON.stringify({ agentId, input: input.text })
    });
    const data = await res.json();
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    setMessages(m => [...m, { id: crypto.randomUUID(), role: 'assistant', text }]);
  }, [agentId, opts?.streaming, opts?.streamEndpoint]);

  const cancel = useCallback(() => {
    esRef.current?.close();
    setStatus('idle');
  }, []);

  return { messages, status, send, cancel };
}
