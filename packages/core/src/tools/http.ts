// packages/core/src/tools/http.ts
import type { Tool } from '../types';

export const httpFetchTool: Tool = {
  id: 'http.fetch',
  async run(args: { url: string; method?: string; headers?: Record<string,string>; body?: any; timeoutMs?: number }) {
    const { url, method = 'GET', headers = {}, body, timeoutMs = 15_000 } = args || {};
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      throw new Error('http.fetch: invalid url');
    }
    // strip potentially dangerous headers
    const h: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      if (/^authorization$/i.test(k)) continue; // never forward auth blindly
      h[k] = v;
    }

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort('timeout'), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: h,
        body: body && (typeof body === 'string' ? body : JSON.stringify(body)),
        signal: ctrl.signal
      });
      const text = await res.text();
      return { status: res.status, ok: res.ok, headers: Object.fromEntries(res.headers.entries()), text };
    } finally {
      clearTimeout(t);
    }
  }
};
