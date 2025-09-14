export type TraceEvent =
| { type: 'route.decide'; payload: any }
| { type: 'provider.choose'; payload: any }
| { type: 'step:start'|'step:retry'|'step:fallback'|'step:done'; payload: any }
| { type: 'error'; payload: any };

export type Listener = (e: TraceEvent) => void;

export class EventBus {
  private listeners = new Set<Listener>();
  on(l: Listener) { this.listeners.add(l); return () => this.listeners.delete(l); }
  emit(e: TraceEvent) { for (const l of this.listeners) l(e); }
}