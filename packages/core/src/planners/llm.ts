// packages/core/src/planners/llm.ts
import type { AppRouter } from "../router";
import type { Plan } from "../types";
import { uuid } from "../../util/uuid";

const DSL_DESC = `Bolt Plan DSL:
- See Agent 'planner' for the exact schema (model/tool/parallel/map/branch, guards, outputs).
- You MUST output a single JSON object only (no prose / fences).`;

function extractJson(raw: string): string | null {
  if (!raw) return null;
  // Prefer ```json ... ``` blocks
  const fence = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1].trim();
  // Fallback: first { ... } big block
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1);
  }
  return null;
}

function validatePlan(p: any): p is Plan {
  if (!p || typeof p !== 'object') return false;
  if (typeof p.id !== 'string') return false;
  if (!Array.isArray(p.steps) || !Array.isArray(p.outputs)) return false;
  for (const s of p.steps) {
    if (!s || typeof s !== 'object') return false;
    if (typeof s.id !== 'string') return false;
    if (!['model','tool','parallel','map','branch'].includes(s.kind)) return false;
    if (s.kind === 'model' && typeof s.agent !== 'string') return false;
    if (s.kind === 'tool' && typeof s.toolId !== 'string') return false;
    if (s.kind === 'parallel' && !Array.isArray(s.children)) return false;
    if (s.kind === 'map' && (typeof s.itemsFrom !== 'string' || typeof s.child !== 'object')) return false;
    if (s.kind === 'branch' && !Array.isArray(s.branches)) return false;
  }
  return true;
}

export async function createLLMPlan(
  router: AppRouter,
  {
    goal,
    agentId = "planner",               // <— default to the dedicated planner agent
    memoryScope = "plan:llm",
    maxSteps = 12
  }: { goal: any; agentId?: string; memoryScope?: string; maxSteps?: number }
): Promise<Plan> {
  const prompt = [
    `Goal: ${typeof goal === "string" ? goal : JSON.stringify(goal)}`,
    `Max steps: ${maxSteps}`,
    DSL_DESC
  ].join("\n\n");

  const res1 = await (router as any).route?.({
    id: uuid(),
    agentId,
    input: { kind: "plan_request", text: prompt },
    memoryScope
  });

  const raw1 = typeof res1 === 'string' ? res1 : JSON.stringify(res1 ?? '');
  const j1 = extractJson(raw1) ?? raw1;
  try {
    const plan1 = JSON.parse(j1);
    if (validatePlan(plan1)) {
      plan1.id = plan1.id || uuid();
      return plan1 as Plan;
    }
  } catch { /* fall through */ }

  // Attempt one repair pass
  const repairPrompt = [
    `You previously tried to output a Bolt Plan but it did not parse.`,
    `Here is your previous output (verbatim):\n${raw1}`,
    `Return ONLY a corrected JSON object that conforms to the DSL.`
  ].join('\n\n');

  const res2 = await (router as any).route?.({
    id: uuid(),
    agentId,
    input: { kind: "plan_request", text: repairPrompt },
    memoryScope
  });

  const raw2 = typeof res2 === 'string' ? res2 : JSON.stringify(res2 ?? '');
  const j2 = extractJson(raw2) ?? raw2;
  try {
    const plan2 = JSON.parse(j2);
    if (validatePlan(plan2)) {
      plan2.id = plan2.id || uuid();
      return plan2 as Plan;
    }
  } catch { /* fall through */ }

  throw new Error("Planner LLM did not return a valid plan");
}
