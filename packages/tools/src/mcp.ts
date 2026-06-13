import {
  agentToCapability,
  toolToCapability,
  type Agent,
  type AgentCtx,
  type CallableCapability,
  type CapabilityCallContext,
  type MemoryStore,
  type Tool,
  type ToolContext,
  type ToolRegistry,
} from "@bolt-ai/core";

export type McpToolArgs = {
  tool: string;
  args?: any;
  params?: any;
};

export type McpToolOptions = {
  callTool: (tool: string, args: any) => Promise<any>;
};

export type McpToolDefinition = {
  name: string;
  description?: string;
  inputSchema?: any;
};

export type McpListToolsResult = {
  tools: McpToolDefinition[];
};

export type McpCallToolRequest = {
  name: string;
  arguments?: any;
  args?: any;
};

export type McpContent =
  | { type: "json"; json: any }
  | { type: "text"; text: string };

export type McpCallToolResult = {
  content: McpContent[];
  isError?: boolean;
};

export type McpClientLike = {
  listTools: () => Promise<McpListToolsResult | McpToolDefinition[]>;
  callTool: ((request: McpCallToolRequest) => Promise<any>) | ((name: string, args: any) => Promise<any>);
};

export type McpImportOptions = {
  allow?: string[];
};

export type McpServerOptions = {
  tools?: Tool[] | ToolRegistry;
  agents?: Agent[] | Record<string, Agent>;
  allow?: string[];
  memory?: MemoryStore;
  call?: AgentCtx["call"];
};

export type McpServer = {
  listTools(): Promise<McpListToolsResult>;
  callTool(request: McpCallToolRequest): Promise<McpCallToolResult>;
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

function normalizeMcpToolDefinition(raw: any): McpToolDefinition {
  const name = raw?.name ?? raw?.id;
  if (!name) {
    throw new Error("MCP tool definition is missing a name");
  }
  return {
    name,
    description: raw.description,
    inputSchema: raw.inputSchema ?? raw.schema ?? { type: "object" },
  };
}

function isAllowed(id: string, allow?: string[]): boolean {
  return !allow || allow.includes(id);
}

export async function listMcpTools(client: Pick<McpClientLike, "listTools">): Promise<McpToolDefinition[]> {
  if (!client?.listTools) {
    throw new Error("listMcpTools requires a listTools implementation");
  }
  const result = await client.listTools();
  const tools = Array.isArray(result) ? result : result.tools;
  return (tools ?? []).map(normalizeMcpToolDefinition);
}

async function callClientTool(client: McpClientLike, name: string, args: any): Promise<any> {
  if (!client?.callTool) {
    throw new Error("MCP client is missing a callTool implementation");
  }
  if (client.callTool.length >= 2) {
    return (client.callTool as (name: string, args: any) => Promise<any>).call(client, name, args);
  }
  return (client.callTool as (request: McpCallToolRequest) => Promise<any>).call(client, {
    name,
    arguments: args ?? {},
  });
}

export async function importMcpTools(client: McpClientLike, options: McpImportOptions = {}): Promise<Tool[]> {
  const definitions = (await listMcpTools(client)).filter((tool) => isAllowed(tool.name, options.allow));
  return definitions.map((definition) => ({
    id: definition.name,
    description: definition.description,
    schema: definition.inputSchema ?? { type: "object" },
    async run(args: any) {
      return callClientTool(client, definition.name, args ?? {});
    },
  }));
}

function toolsFromInput(tools?: Tool[] | ToolRegistry): Tool[] {
  if (!tools) return [];
  return Array.isArray(tools) ? tools : tools.list();
}

function agentsFromInput(agents?: Agent[] | Record<string, Agent>): Agent[] {
  if (!agents) return [];
  return Array.isArray(agents) ? agents : Object.values(agents);
}

function createArrayRegistry(tools: Tool[]): ToolRegistry {
  const map = new Map(tools.map((tool) => [tool.id, tool]));
  return {
    get(id: string) {
      return map.get(id);
    },
    list() {
      return Array.from(map.values());
    },
    register(tool: Tool) {
      map.set(tool.id, tool);
    },
  };
}

function createScopedRegistry(options: {
  agent: Agent;
  registry: ToolRegistry;
  memory?: MemoryStore;
}): ToolRegistry {
  const allowed = new Set(options.agent.tools ?? []);
  const wrap = (tool: Tool): Tool => ({
    ...tool,
    run: (args: any, ctx: ToolContext = {}) =>
      tool.run(args, {
        ...ctx,
        allow: options.agent.tools,
        memory: ctx.memory ?? options.memory,
      }),
  });
  return {
    get(id: string) {
      if (!allowed.has(id)) return undefined;
      const tool = options.registry.get(id);
      return tool ? wrap(tool) : undefined;
    },
    list() {
      return options.registry.list().filter((tool) => allowed.has(tool.id)).map(wrap);
    },
    register(tool: Tool) {
      options.registry.register(tool);
    },
  };
}

function toMcpToolDefinition(capability: CallableCapability): McpToolDefinition {
  return {
    name: capability.id,
    description: capability.description,
    inputSchema: capability.schema ?? { type: "object" },
  };
}

function isMcpCallToolResult(value: any): value is McpCallToolResult {
  return Boolean(value && typeof value === "object" && Array.isArray(value.content));
}

function toMcpCallToolResult(value: any): McpCallToolResult {
  if (isMcpCallToolResult(value)) return value;
  return {
    content: [{ type: "json", json: value }],
  };
}

function createCapabilities(options: McpServerOptions): CallableCapability[] {
  const tools = toolsFromInput(options.tools);
  const registry = createArrayRegistry(tools);
  return [
    ...tools.map(toolToCapability),
    ...agentsFromInput(options.agents).map((agent) =>
      agentToCapability(agent, {
        memory: options.memory,
        call: options.call,
        tools: createScopedRegistry({ agent, registry, memory: options.memory }),
      })
    ),
  ];
}

function createCapabilityMap(capabilities: CallableCapability[], allow?: string[]): Map<string, CallableCapability> {
  const map = new Map<string, CallableCapability>();
  for (const capability of capabilities) {
    if (!isAllowed(capability.id, allow)) continue;
    if (map.has(capability.id)) {
      throw new Error(`Duplicate MCP capability id: ${capability.id}`);
    }
    map.set(capability.id, capability);
  }
  return map;
}

export function createMcpServer(options: McpServerOptions = {}): McpServer {
  const capabilities = createCapabilities(options);

  return {
    async listTools() {
      return {
        tools: Array.from(createCapabilityMap(capabilities, options.allow).values()).map(toMcpToolDefinition),
      };
    },
    async callTool(request: McpCallToolRequest) {
      const name = request?.name;
      const capability = createCapabilityMap(capabilities, options.allow).get(name);
      if (!capability) {
        throw new Error(`MCP tool not allowed or not found: ${name}`);
      }
      const args = request.arguments ?? request.args ?? {};
      const context: CapabilityCallContext = {
        allow: [capability.id],
        memory: options.memory,
      };
      return toMcpCallToolResult(await capability.run(args, context));
    },
  };
}
