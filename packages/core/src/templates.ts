// packages/core/src/templates.ts
import type { Plan } from "./types";  // <-- changed from "./planner"

export type TemplateContext = {
  goal: any;
  agentId: string;
  memoryScope?: string;
  params?: Record<string, any>;
};

export type Template = {
  id: string;
  description?: string;
  plan: (ctx: TemplateContext) => Plan | Promise<Plan>;
};

export function defineTemplate<T extends Template>(t: T): T {
  return t;
}
