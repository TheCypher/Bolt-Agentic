// packages/core/src/util/backoff.ts
export function backoffWithJitter(params: {
  attempt: number;            // 1, 2, 3...
  baseMs?: number;            // default 400
  factor?: number;            // default 2
  maxMs?: number;             // default 20_000
  jitterRatio?: number;       // 0..1, default 0.25 (±25%)
}) {
  const { attempt, baseMs = 400, factor = 2, maxMs = 20_000, jitterRatio = 0.25 } = params;
  const pow = Math.pow(factor, Math.max(0, attempt - 1));
  const raw = Math.min(maxMs, baseMs * pow);
  const jitter = raw * jitterRatio;
  const min = Math.max(0, raw - jitter);
  const max = raw + jitter;
  return min + Math.random() * (max - min);
}
