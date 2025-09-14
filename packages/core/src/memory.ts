import type { MemoryStore, Message } from './types';

export class InMemoryStore implements MemoryStore {
  private kv = new Map<string, any>();
  private chats = new Map<string, Message[]>();
  async get<T=unknown>(key: string) { return (this.kv.get(key) ?? null) as T | null }
  async set<T=unknown>(key: string, value: T) { this.kv.set(key, value) }
  async patch<T extends object>(key: string, delta: Partial<T>) {
    const cur = (this.kv.get(key) ?? {}) as T; this.kv.set(key, { ...cur, ...delta });
  }

  async appendConversation(id: string, m: Message) {
    const arr = this.chats.get(id) ?? []; arr.push(m); this.chats.set(id, arr);
  }

  async history(id: string, limit = 20) { const arr = this.chats.get(id) ?? []; return arr.slice(-limit) }
}