// packages/memory/redis/index.ts
import { createClient, type RedisClientType } from "redis";
import type { MemoryStore, Message } from "@bolt-ai/core";

export type RedisMemoryOptions = {
  namespace?: string;
  ttlSeconds?: number;
  maxHistory?: number;
  client?: RedisClientType;
  url?: string;
  /** Keep the connection alive by pinging Redis; set 0 to disable. Default: 20000 ms */
  pingIntervalMs?: number;
  /** Control logging verbosity for connection events. Default: 'warn' */
  logLevel?: "silent" | "warn" | "debug";
};

export class RedisMemoryStore implements MemoryStore {
  private client!: RedisClientType;
  private url: string;
  private ns: string;
  private ttl: number;
  private max: number;
  private connecting?: Promise<void>;

  private pingMs: number;
  private logLevel: "silent" | "warn" | "debug";
  private pingTimer?: NodeJS.Timeout;

  constructor(url: string, opts: Omit<RedisMemoryOptions, "url"> = {}) {
    this.url = url;
    this.ns = opts.namespace ?? "bolt";
    this.ttl = Math.max(0, opts.ttlSeconds ?? 0);
    this.max = Math.max(1, opts.maxHistory ?? 200);
    this.pingMs = Math.max(0, opts.pingIntervalMs ?? 20000);
    this.logLevel = opts.logLevel ?? "warn";
    if (opts.client) this.client = opts.client;
  }

  private log(kind: "error" | "info" | "debug", ...args: any[]) {
    if (this.logLevel === "silent") return;
    if (kind === "error") {
      // eslint-disable-next-line no-console
      console.warn(...args);
    } else if (this.logLevel === "debug") {
      // eslint-disable-next-line no-console
      console.debug(...args);
    }
  }

  private async ensure(): Promise<void> {
    if (this.client?.isOpen) return;
    if (this.connecting) return this.connecting;

    const url = this.url;
    this.connecting = (async () => {
      this.client =
        this.client ??
        createClient({
          url,
          socket: {
            // Upstash and other managed providers often require TLS with rediss://
            tls: url.startsWith("rediss://"),
            keepAlive: 5_000,
            reconnectStrategy: (retries) =>
              Math.min(1000 * 2 ** retries, 15_000),
          },
        });

      this.client.on("error", (err) =>
        this.log("error", "[RedisMemory] error:", err?.message ?? err)
      );
      this.client.on("end", () => this.log("debug", "[RedisMemory] end"));
      this.client.on("reconnecting", () =>
        this.log("debug", "[RedisMemory] reconnecting…")
      );
      this.client.on("ready", () => this.log("debug", "[RedisMemory] ready"));

      await this.client.connect();

      // Heartbeat to keep idle connections alive (especially for Upstash)
      if (this.pingMs > 0) {
        try {
          if (this.pingTimer) clearInterval(this.pingTimer);
        } catch {}
        this.pingTimer = setInterval(async () => {
          try {
            await this.client.ping();
          } catch {
            // swallow; reconnect will kick in via reconnectStrategy
          }
        }, this.pingMs);
        // Do not keep the process alive just for the timer
        (this.pingTimer as any)?.unref?.();
      }
    })();

    try {
      await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  private kKv(key: string) {
    return `${this.ns}:kv:${key}`;
  }
  private kConv(id: string) {
    return `${this.ns}:conv:${id}`;
  }

  // ---- KV ----
  async get<T = unknown>(key: string): Promise<T | null> {
    await this.ensure();
    const v = await this.client.get(this.kKv(key));
    if (v == null) return null;
    try {
      return JSON.parse(v) as T;
    } catch {
      return v as unknown as T;
    }
  }

  async set<T = unknown>(
    key: string,
    value: T,
    ttlSeconds?: number
  ): Promise<void> {
    await this.ensure();
    const v = JSON.stringify(value);
    const ex = ttlSeconds ?? this.ttl;
    if (ex > 0) await this.client.set(this.kKv(key), v, { EX: ex });
    else await this.client.set(this.kKv(key), v);
  }

  async patch<T extends object = any>(
    key: string,
    delta: Partial<T>
  ): Promise<void> {
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
      try {
        out.push(JSON.parse(s) as Message);
      } catch {
        /* ignore malformed entry */
      }
    }
    return out;
  }

  /** Optional: clean up (e.g., on process shutdown) */
  async close(): Promise<void> {
    try {
      if (this.pingTimer) clearInterval(this.pingTimer);
    } catch {}
    try {
      if (this.client?.isOpen) await this.client.quit();
    } catch {}
  }
}

function sanitizeRedisUrl(raw: string): string {
  const trimmed = raw.trim();
  // Strip accidental CLI prefixes like: "redis-cli --tls -u <url>" or "redis-cli -u <url>"
  const withoutCli = trimmed
    .replace(/^redis-cli\s+--tls\s+-u\s+/i, "")
    .replace(/^redis-cli\s+-u\s+/i, "");
  return withoutCli;
}

export function createRedisMemoryStore(opts: RedisMemoryOptions = {}) {
  let url = opts.url ?? process.env.REDIS_URL ?? "";
  url = sanitizeRedisUrl(url);
  if (!/^rediss?:\/\//i.test(url)) {
    throw new Error(
      `REDIS_URL must start with redis:// or rediss:// (got: ${url.slice(
        0,
        32
      )}…)`
    );
  }
  const { url: _omit, ...rest } = opts;
  return new RedisMemoryStore(url, rest);
}