import type { Tool } from "@bolt-ai/core";

export type VectorQueryArgs = {
  query: string;
  topK?: number;
  filter?: Record<string, any>;
  namespace?: string;
};

export type VectorQueryResult = {
  matches: Array<{
    id: string;
    score?: number;
    metadata?: Record<string, any>;
    values?: number[];
  }>;
};

export type VectorAdapter = {
  query: (args: VectorQueryArgs) => Promise<VectorQueryResult>;
};

export function createVectorTool(adapter: VectorAdapter): Tool<VectorQueryArgs, VectorQueryResult> {
  if (!adapter?.query) {
    throw new Error("createVectorTool requires a query implementation");
  }
  return {
    id: "vector.search",
    async run(args) {
      return adapter.query({
        query: args.query,
        topK: args.topK,
        filter: args.filter,
        namespace: args.namespace,
      });
    },
  };
}
