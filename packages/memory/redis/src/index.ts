import type { MemoryStore, Message } from '@bolt-ai/core';
import { createClient, RedisClientType } from 'redis';


export class RedisMemoryStore implements MemoryStore {
  private client: RedisClientType;
  constructor(url: string) { this.client = createClient({ url }); this.client.connect(); }
  async get<T=unknown>(key: string) { const v = await this.client.get(key); return v? JSON.parse(v) as T : null }
  async set<T=unknown>(key: string, value: T, ttlSeconds?: number) {
    if (ttlSeconds) await this.client.setEx(key, ttlSeconds, JSON.stringify(value));
    else await this.client.set(key, JSON.stringify(value));
  }
  async patch<T extends object>(key: string, delta: Partial<T>) {
    const cur = await this.get<T>(key) || {} as T; await this.set(key, { ...cur, ...delta });
  }
  async appendConversation(id: string, m: Message) {
    await this.client.rPush(`chat:${id}`, JSON.stringify(m));
  }
  async history(id: string, limit = 20) {
    const key = `chat:${id}`; const len = await this.client.lLen(key);
    const items = await this.client.lRange(key, Math.max(0, len - limit), len);
    return items.map(i => JSON.parse(i));
  }
}