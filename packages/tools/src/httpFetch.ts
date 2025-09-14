import type { Tool } from '@bolt-ai/core';
import { fetch } from 'undici';

type HttpArgs = {
  url: string;
  method?: string; // e.g. 'GET' | 'POST' ...
  headers?: Record<string, string>;
  body?: string;
};

type HttpOut = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

export const httpFetch: Tool<HttpArgs, HttpOut> = {
  id: 'http.fetch',
  async run({ url, method = 'GET', headers, body }) {
    const res = await fetch(url, { method, headers, body });
    const text = await res.text();
    // Headers is iterable with fetch(); convert to a plain object
    const headersObj = Object.fromEntries(res.headers.entries());
    return { status: res.status, headers: headersObj, body: text };
  }
};
