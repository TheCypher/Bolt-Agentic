import type { Tool } from "@bolt-ai/core";

/**
 * Minimal SerpAPI Google search wrapper.
 * Requires SERPAPI_KEY in env or pass via args.apiKey.
 */
type Args = {
  query: string;
  apiKey?: string;         // optional override
  engine?: 'google';       // reserved for future
  num?: number;            // number of results (1-10 typical)
  gl?: string;             // country code
  hl?: string;             // language
  tbs?: string;            // time range, e.g. qdr:d (day), w, m, y
};

type SearchItem = { title: string; link: string; snippet?: string; source?: string };
type Out = { results: SearchItem[]; raw?: any };

export const webSearchTool: Tool<Args, Out> = {
  id: "web.search",
  async run(args) {
    const key = args.apiKey ?? process.env.SERPAPI_KEY;
    if (!key) throw new Error("SERPAPI_KEY not set (or provide apiKey in args)");
    const params = new URLSearchParams({
      engine: args.engine ?? "google",
      q: args.query,
      api_key: key,
      ...(args.num ? { num: String(args.num) } : {}),
      ...(args.gl ? { gl: args.gl } : {}),
      ...(args.hl ? { hl: args.hl } : {}),
      ...(args.tbs ? { tbs: args.tbs } : {})
    });
    const url = `https://serpapi.com/search.json?${params.toString()}`;
    const r = await fetch(url, { method: "GET" });
    const json: any = await r.json();

    const organic: any[] = Array.isArray(json?.organic_results) ? json.organic_results : [];
    const results: SearchItem[] = organic.map((it) => ({
      title: String(it.title ?? ""),
      link: String(it.link ?? it.url ?? ""),
      snippet: typeof it.snippet === "string" ? it.snippet : undefined,
      source: it.source ? String(it.source) : undefined
    })).filter(x => x.link);

    return { results, raw: json };
  }
};
