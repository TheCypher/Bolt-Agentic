// Node-safe uuid helper (no DOM types)
let nodeRandomUUID: (() => string) | null = null;
try {
  // Node 16.14+ provides this
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  nodeRandomUUID = require('node:crypto').randomUUID as () => string;
} catch {
  nodeRandomUUID = null;
}

export function uuid(): string {
  if (nodeRandomUUID) return nodeRandomUUID();
  // Fallback (not cryptographically strong, fine for IDs in logs/tests)
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
