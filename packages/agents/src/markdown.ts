import matter from "gray-matter";
import type { Capability } from "@bolt-ai/core";
import { createAgent, type AgentDefinition, type AgentPrompt, type ReasoningConfig } from "./agentDefinition";

export type MarkdownParseOptions = {
  defaultId?: string;
  filePath?: string;
};

function normalizeArray(value: unknown): string[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string") {
    const parts = value.split(/[,\n]/).map((p) => p.trim()).filter(Boolean);
    return parts.length ? parts : undefined;
  }
  return undefined;
}

const CAPABILITIES = new Set<Capability>(["text", "json", "vision", "image", "embedding"]);

function normalizeCapabilities(value: unknown): Capability[] | undefined {
  const arr = normalizeArray(value);
  if (!arr) return undefined;
  const caps = arr
    .map((v) => v.toLowerCase())
    .filter((v): v is Capability => CAPABILITIES.has(v as Capability));
  return caps.length ? caps : undefined;
}

function parseMaybeJson(value: unknown): any {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

function normalizeReasoning(value: any): ReasoningConfig | undefined {
  if (!value) return undefined;
  if (typeof value === "string") {
    return { mode: value as ReasoningConfig["mode"] };
  }
  if (typeof value === "object") {
    return {
      mode: value.mode,
      steps: value.steps,
    };
  }
  return undefined;
}

function splitSections(content: string): Record<string, string> {
  const sections: Record<string, string[]> = {};
  let current: string | null = null;
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^##\s+(.+)$/);
    if (match) {
      current = match[1].trim().toLowerCase();
      if (!sections[current]) sections[current] = [];
      continue;
    }
    const key = current ?? "__body";
    if (!sections[key]) sections[key] = [];
    sections[key].push(line);
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(sections)) {
    const text = value.join("\n").trim();
    if (text) out[key] = text;
  }
  return out;
}

function inferIdFromPath(filePath?: string, fallback?: string): string | undefined {
  if (!filePath) return fallback;
  const base = filePath.split(/[\\\\/]/).pop() ?? filePath;
  if (!base) return fallback;
  const cleaned = base
    .replace(/\.agent\.(md|mdx)$/i, "")
    .replace(/\.(md|mdx)$/i, "");
  return cleaned || fallback;
}

export function parseAgentMarkdown(markdown: string, options: MarkdownParseOptions = {}): AgentDefinition {
  const parsed = matter(markdown ?? "");
  const data = (parsed.data ?? {}) as Record<string, any>;
  const nestedAgent = typeof data.agent === "object" && data.agent ? data.agent : null;
  const meta = nestedAgent ? { ...data, ...nestedAgent } : data;

  const inferredId = inferIdFromPath(options.filePath, options.defaultId);
  const id = String(meta.id ?? inferredId ?? "").trim();
  if (!id) {
    throw new Error("Agent markdown is missing an 'id' in frontmatter");
  }

  const sections = splitSections(parsed.content ?? "");
  const scopeDir = options.filePath ? options.filePath.split(/[\\\\/]/).slice(0, -1).join("/") : undefined;

  const promptMeta = typeof meta.prompt === "object" && meta.prompt ? meta.prompt : {};
  const bodySystem = sections.system || sections.instructions || sections.__body;
  const prompt: AgentPrompt = {
    system: (promptMeta.system ?? meta.system ?? bodySystem)?.toString().trim() || undefined,
    user: (promptMeta.user ?? meta.user ?? (typeof meta.prompt === "string" ? meta.prompt : null) ?? sections.user ?? sections.prompt)?.toString().trim() || undefined,
    prefix: (promptMeta.prefix ?? meta.prefix ?? sections.prefix)?.toString().trim() || undefined,
    suffix: (promptMeta.suffix ?? meta.suffix ?? sections.suffix)?.toString().trim() || undefined,
  };

  const toolsFromSection = sections.tools ? sections.tools.split(/\r?\n/).map((line) => line.replace(/^[-*]\s+/, "").trim()).filter(Boolean) : undefined;

  const memoryMeta = meta.memory ?? {};

  const boltDocsMeta = meta.boltDocs ?? meta.bolt;
  const boltDocs =
    boltDocsMeta === false
      ? false
      : boltDocsMeta === true
        ? scopeDir
          ? { cwd: scopeDir }
          : true
        : typeof boltDocsMeta === "object" && boltDocsMeta
          ? { ...(boltDocsMeta as any), ...(scopeDir && !(boltDocsMeta as any).cwd ? { cwd: scopeDir } : {}) }
          : scopeDir
            ? { cwd: scopeDir }
            : undefined;

  const def: AgentDefinition = {
    id,
    name: meta.name ?? meta.title,
    description: meta.description ?? meta.summary,
    capabilities: normalizeCapabilities(meta.capabilities ?? meta.capability),
    model: meta.model ?? meta.provider,
    instructions: meta.instructions,
    inputSchema: parseMaybeJson(meta.inputSchema ?? meta.input?.schema),
    outputSchema: parseMaybeJson(meta.outputSchema ?? meta.output?.schema),
    outputKind: meta.outputKind ?? meta.output?.kind,
    tools: normalizeArray(meta.tools) ?? toolsFromSection,
    memory: {
      scope: memoryMeta.scope ?? meta.memoryScope,
      history: memoryMeta.history ?? memoryMeta.limit ?? meta.history,
      write: memoryMeta.write,
    },
    reasoning: normalizeReasoning(meta.reasoning ?? meta.thinking ?? meta.deepThinking),
    prompt: Object.values(prompt).some(Boolean) ? prompt : undefined,
    boltDocs,
    metadata: meta.metadata,
  };

  return def;
}

export function createAgentFromMarkdown(markdown: string, options: MarkdownParseOptions = {}) {
  return createAgent(parseAgentMarkdown(markdown, options));
}
