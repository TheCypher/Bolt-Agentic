// packages/core/src/cache.ts
import type { StepCache } from "./types";

export class InMemoryStepCache implements StepCache {
  private map = new Map<string, { v: any; exp: number | null }>();
  async get(key: string) {
    const e = this.map.get(key);
    if (!e) return null;
    if (e.exp && Date.now() > e.exp) { this.map.delete(key); return null; }
    return structuredClone(e.v);
  }
  async set(key: string, value: any, ttlSeconds = 300) {
    const exp = ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null;
    this.map.set(key, { v: structuredClone(value), exp });
  }
}
