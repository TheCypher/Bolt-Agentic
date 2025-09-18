// packages/core/src/events.ts
export type TraceEvent =
  | { type: 'route:start'; id: string; agentId: string; inputKind: string; memoryScope?: string }
  | { type: 'route:agent.resolve'; id: string; agentId: string; ok: boolean; reason?: string }
  | { type: 'route:provider.select'; id: string; providerId: string }
  | { type: 'provider:call:start'; id: string; providerId: string; args: { kind: string } }
  | { type: 'provider:call:token'; id: string; delta: string }
  | { type: 'provider:call:end'; id: string; providerId: string; ms: number; tokens?: number; outputPreview?: string }
  | { type: 'memory:history'; id: string; scope: string; limit?: number; count: number }
  | { type: 'memory:append'; id: string; scope: string; role: string }
  | { type: 'error'; id: string; message: string; stack?: string }
  // … add runner/planner events you want to surface

export class EventBus {
  private listeners = new Set<(e: TraceEvent) => void>();
  emit(e: TraceEvent) {
    for (const fn of this.listeners) fn(e);
  }
  subscribe(fn: (e: TraceEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
