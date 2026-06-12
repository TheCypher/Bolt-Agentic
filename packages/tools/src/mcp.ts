import type { Tool } from "@bolt-ai/core";

export type McpToolArgs = {
  tool: string;
  args?: any;
  params?: any;
};

export type McpToolOptions = {
  callTool: (tool: string, args: any) => Promise<any>;
};

export function createMcpTool(options: McpToolOptions): Tool<McpToolArgs, any> {
  if (!options?.callTool) {
    throw new Error("createMcpTool requires a callTool implementation");
  }
  return {
    id: "mcp.call",
    async run(args) {
      const params = args.args ?? args.params ?? {};
      return options.callTool(args.tool, params);
    },
  };
}
