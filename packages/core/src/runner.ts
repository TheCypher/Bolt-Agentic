import type { Plan } from './types';
export async function runPlan(router: any, plan: Plan, ctx: any) {
  // naive executor: run first output step only
  const outStep = plan.outputs[0];
  return { ok: true, out: outStep };
}