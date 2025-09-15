import { createClient, type RedisClientType } from "redis";
import type { MemoryStore, Message } from "@bolt-ai/core";

export type RedisMemoryOptions = {
  namespace?: string;     // default "bolt"
  ttlSeconds?: number;    // default 0 (no expiry)
  maxHistory?: number;    // default 200
  client?: RedisClientType;
  url?: string;           // if omitted, uses REDIS_URL
};

export class RedisMemoryStore implements MemoryStore {
  private client!: RedisClientType;
  private url: string;
  private ns: string;
  private ttl: number;
  private max: number;
  private connecting?: Promise<void>;

  constructor(url: string, opts: Omit<RedisMemoryOptions, "url"> = {}) {
    this.url = url;
    this.ns = opts.namespace ?? "bolt";
    this.ttl = Math.max(0, opts.ttlSeconds ?? 0);
    this.max = Math.max(1, opts.maxHistory ?? 200);
    if (opts.client) this.client = opts.client;
  }

  private async ensure(): Promise<void> {
    if (this.client?.isOpen) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      this.client = this.client ?? createClient({ url: this.url });
      this.client.on("error", (err) => {
        console.warn("[RedisMemory] client error:", err?.message ?? err);
      });
      await this.client.connect();
    })();
    try { await this.connecting; } finally { this.connecting = undefined; }
  }

  private kKv(key: string)     { return `${this.ns}:kv:${key}`; }
  private kConv(id: string)    { return `${this.ns}:conv:${id}`; }

  // ---- KV ----
  async get<T = unknown>(key: string): Promise<T | null> {
    await this.ensure();
    const v = await this.client.get(this.kKv(key));
    if (v == null) return null;
    try { return JSON.parse(v) as T; } catch { return v as unknown as T; }
  }

  async set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.ensure();
    const v = JSON.stringify(value);
    const ex = ttlSeconds ?? this.ttl;
    if (ex > 0) await this.client.set(this.kKv(key), v, { EX: ex });
    else await this.client.set(this.kKv(key), v);
  }

  async patch<T extends object = any>(key: string, delta: Partial<T>): Promise<void> {
    const cur = (await this.get<T>(key)) || ({} as T);
    const next = { ...(cur as any), ...(delta as any) };
    await this.set<T>(key, next);
  }

  // ---- Conversation history ----
  async appendConversation(id: string, m: Message): Promise<void> {
    await this.ensure();
    const key = this.kConv(id);
    await this.client.rPush(key, JSON.stringify(m));
    await this.client.lTrim(key, -this.max, -1);
    if (this.ttl > 0) await this.client.expire(key, this.ttl);
  }

  async history(id: string, limit = 20): Promise<Message[]> {
    await this.ensure();
    const key = this.kConv(id);
    const n = Math.max(1, Math.min(limit, this.max));
    const items = await this.client.lRange(key, -n, -1);
    const out: Message[] = [];
    for (const s of items) {
      try { out.push(JSON.parse(s) as Message); } catch {}
    }
    return out;
  }
}

export function createRedisMemoryStore(opts: RedisMemoryOptions = {}) {
  const url = opts.url ?? process.env.REDIS_URL ?? "";
  if (!url) throw new Error("REDIS_URL is required to use RedisMemoryStore");
  const { url: _omit, ...rest } = opts;
  return new RedisMemoryStore(url, rest);
}
