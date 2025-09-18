import type { Tool, ToolRegistry } from "../types";
import type { RunnerContext } from "../types";
import type { ToolFn } from "../types";

/** Simple in-process registry (good for server apps and tests). */
export class SimpleToolRegistry implements ToolRegistry {
  private map = new Map<string, Tool>();

  get(id: string) { return this.map.get(id); }
  list() { return Array.from(this.map.values()); }
  register(t: Tool) {
    if (!t?.id) throw new Error("Tool must have an id");
    this.map.set(t.id, t);
  }
  registerMany(tools: Tool[]) {
    for (const t of tools) this.register(t);
  }
}

/** Singleton default registry */
const _default = new SimpleToolRegistry();

export function defaultToolRegistry() { return _default; }
export function registerTool(tool: Tool) { _default.register(tool); }
export function registerTools(...tools: Tool[]) { _default.registerMany(tools); }
export function getTool(id: string) { return _default.get(id); }
export function listTools() { return _default.list(); }

/** Adapt a registry to RunnerContext.tools map (Tool -> ToolFn). */
export function toolsFromRegistry(reg: ToolRegistry = _default): Record<string, ToolFn> {
  const out: Record<string, ToolFn> = {};
  for (const t of reg.list()) {
    out[t.id] = async (args: any, _ctx: RunnerContext) => {
      // Minimal ToolContext for now; extend as needed (memory, allow, signal).
      return t.run(args, {});
    };
  }
  return out;
}
