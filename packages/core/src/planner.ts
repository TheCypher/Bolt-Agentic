import type { Plan } from './types';
export function createHeuristicPlanner() {
  return {
    plan({ id = crypto.randomUUID(), input }: any): Plan {
      return { id, steps: [{ id: 's1', kind: 'model', agent: 'default' }], outputs: ['s1'] } as any;
    }
  };
}