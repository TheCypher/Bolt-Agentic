import type { Tool, ToolRegistry } from './types';

export class Registry implements ToolRegistry {
  private map = new Map<string, Tool>();
  register(t: Tool) { this.map.set(t.id, t) }
  get(id: string) { return this.map.get(id) }
  list() { return Array.from(this.map.values()) }
}