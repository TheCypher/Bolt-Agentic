import type { Tool } from "@bolt-ai/core";

type Args = {
  url: string;
  method?: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE';
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | null | undefined>;
  json?: any;           // body as JSON
  timeoutMs?: number;   // soft timeout (AbortController)
};

export type HttpToolOptions = {
  allow?: string[];
};

function withQuery(u: string, q?: Args["query"]) {
  if (!q) return u;
  const url = new URL(u);
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

function normalizeAllow(allow?: string[]) {
  if (!allow || !allow.length) return null;
  return allow.map((rule) => rule.trim()).filter(Boolean);
}

function matchPattern(url: string, pattern: string) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
  return regex.test(url);
}

function isAllowed(url: string, allow?: string[]) {
  if (!allow || !allow.length) return true;
  return allow.some((pattern) => matchPattern(url, pattern));
}

export function createHttpTool(options: HttpToolOptions = {}): Tool<Args, { status: number; headers: Record<string, string>; body: any }> {
  const allow = normalizeAllow(options.allow);
  return {
    id: "http.fetch",
    async run(args, ctx) {
      const method = args.method ?? (args.json ? "POST" : "GET");
      const url = withQuery(args.url, args.query);
      const ctxAllow = Array.isArray((ctx as any)?.allow) ? (ctx as any).allow as string[] : undefined;
      const effectiveAllow = allow && ctxAllow ? [...allow, ...ctxAllow] : (allow ?? ctxAllow);
      if (!isAllowed(url, effectiveAllow ?? undefined)) {
        throw new Error(`URL not allowed: ${url}`);
      }
      const ctr = new AbortController();
      const to = args.timeoutMs ? setTimeout(() => ctr.abort(), args.timeoutMs) : null;

      try {
        const r = await fetch(url, {
          method,
          headers: {
            ...(args.headers ?? {}),
            ...(args.json ? { "content-type": "application/json" } : {})
          } as any,
          body: args.json ? JSON.stringify(args.json) : undefined,
          signal: ctr.signal
        });
        const ct = r.headers.get("content-type") || "";
        const body = ct.includes("application/json")
          ? await r.json().catch(() => r.text())
          : await r.text();
        const headers: Record<string, string> = {};
        r.headers.forEach((v, k) => (headers[k] = v));
        return { status: r.status, headers, body };
      } finally {
        if (to) clearTimeout(to);
      }
    }
  };
}

export const httpFetchTool = createHttpTool();
