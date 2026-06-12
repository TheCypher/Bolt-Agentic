import { discoverBoltDocs, type BoltDocOptions } from "@bolt-ai/core";
import type { Agent, AgentCtx, Capability, Message } from "@bolt-ai/core";

export type ReasoningMode = "direct" | "deliberate" | "reflect";

export interface ReasoningConfig {
  mode?: ReasoningMode;
  /** Total reasoning passes including final response (e.g., 2 = plan + answer). */
  steps?: number;
}

export interface AgentMemoryConfig {
  scope?: string;
  history?: number;
  write?: boolean;
}

export interface AgentPrompt {
  system?: string;
  user?: string;
  prefix?: string;
  suffix?: string;
}

export interface AgentDefinition {
  id: string;
  name?: string;
  description?: string;
  capabilities?: Capability[];
  model?: string;
  prompt?: AgentPrompt;
  instructions?: string | string[];
  inputSchema?: any;
  outputSchema?: any;
  outputKind?: "text" | "json";
  tools?: string[];
  memory?: AgentMemoryConfig;
  reasoning?: ReasoningConfig;
  boltDocs?: boolean | BoltDocOptions;
  metadata?: Record<string, any>;
}

const defaultUserTemplate = "{{input}}";

function normalizeInstructions(instructions?: string | string[]): string {
  if (!instructions) return "";
  return Array.isArray(instructions) ? instructions.join("\n") : instructions;
}

function normalizeInput(input: unknown): string {
  if (typeof input === "string") return input;
  if (input == null) return "";
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

function readPath(root: any, path: string) {
  const parts = String(path)
    .split(".")
    .map((p) => p.trim())
    .filter(Boolean);
  let cur = root;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = cur[part as keyof typeof cur];
  }
  return cur;
}

function renderTemplate(template: string, vars: Record<string, any>): string {
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, key) => {
    const v = readPath(vars, key);
    if (v == null) return "";
    if (typeof v === "string") return v;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  });
}

function formatHistory(history: Message[]): string {
  const lines: string[] = [];
  for (const m of history) {
    const raw = m.text ?? (m.json != null ? JSON.stringify(m.json) : "");
    if (!raw) continue;
    lines.push(`${m.role.toUpperCase()}: ${raw}`);
  }
  return lines.join("\n");
}

function extractJson(raw: string): string | null {
  if (!raw) return null;
  const fence = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1].trim();
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) return raw.slice(first, last + 1);
  return null;
}

function validateSchema(schema: any, value: any): boolean {
  if (!schema) return true;
  if (typeof schema.safeParse === "function") return Boolean(schema.safeParse(value)?.success);
  if (typeof schema.parse === "function") {
    try {
      schema.parse(value);
      return true;
    } catch {
      return false;
    }
  }
  return true;
}

function makeId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function resolveReasoningSteps(reasoning?: ReasoningConfig): number {
  if (!reasoning) return 1;
  if (reasoning.steps && reasoning.steps > 0) return reasoning.steps;
  if (reasoning.mode === "deliberate") return 2;
  if (reasoning.mode === "reflect") return 3;
  return 1;
}

function shouldIncludeHistory(template: string): boolean {
  return !template.includes("{{history}}");
}

export function createAgent(def: AgentDefinition): Agent {
  const outputKind = def.outputKind ?? (def.outputSchema ? "json" : "text");
  const capabilities = def.capabilities?.length
    ? def.capabilities
    : outputKind === "json"
      ? (["json"] as Capability[])
      : (["text"] as Capability[]);

  const systemPrompt = [def.prompt?.system, normalizeInstructions(def.instructions)]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join("\n\n");

  const boltDocsConfig = def.boltDocs;
  let boltDocsText: string | null | undefined = undefined;

  const loadBoltDocs = async () => {
    if (boltDocsConfig === false || boltDocsConfig == null) return "";
    if (boltDocsText !== undefined) return boltDocsText ?? "";
    try {
      const opts = typeof boltDocsConfig === "object" ? boltDocsConfig : undefined;
      const chain = await discoverBoltDocs(opts);
      boltDocsText = chain.text;
      return boltDocsText ?? "";
    } catch {
      boltDocsText = "";
      return "";
    }
  };

  return {
    id: def.id,
    description: def.description ?? def.name,
    capabilities,
    outputSchema: def.outputSchema,
    async run(ctx: AgentCtx): Promise<any> {
      if (def.inputSchema && !validateSchema(def.inputSchema, ctx.input)) {
        throw new Error(`Input schema validation failed for agent '${def.id}'`);
      }

      const memoryScope = def.memory?.scope ?? def.id;
      const historyLimit = Math.max(0, def.memory?.history ?? 0);
      const writeMemory = def.memory?.write !== false;

      const history = historyLimit > 0 ? await ctx.memory.history(memoryScope, historyLimit) : [];
      const historyText = history.length ? formatHistory(history) : "";
      const toolsText = def.tools?.length ? def.tools.join(", ") : "";

      const userTemplate = def.prompt?.user ?? defaultUserTemplate;
      const userText = renderTemplate(userTemplate, {
        input: normalizeInput(ctx.input),
        history: historyText,
        tools: toolsText,
        agent: { id: def.id, name: def.name, description: def.description },
      }).trim();

      const baseParts: string[] = [];
      const boltDocs = await loadBoltDocs();
      if (boltDocs?.trim()) baseParts.push(boltDocs.trim());
      if (systemPrompt) baseParts.push(systemPrompt);
      if (def.prompt?.prefix?.trim()) baseParts.push(def.prompt.prefix.trim());
      if (historyText && shouldIncludeHistory(userTemplate)) {
        baseParts.push(`History:\n${historyText}`);
      }

      const reasoningSteps = resolveReasoningSteps(def.reasoning);
      let notes = "";
      if (reasoningSteps > 1) {
        let currentNotes = "";
        for (let i = 0; i < reasoningSteps - 1; i += 1) {
          const stageInstruction = i === 0
            ? "Write a concise plan (bullet points) for answering the task. Do not answer yet."
            : "Refine the plan. Keep it concise and focused on actionable steps.";
          const thinkParts = [...baseParts];
          thinkParts.push(`Task:\n${userText}`);
          if (currentNotes) thinkParts.push(`Current notes:\n${currentNotes}`);
          thinkParts.push(stageInstruction);
          const note = await ctx.call({ kind: "text", prompt: thinkParts.join("\n\n") });
          currentNotes = [currentNotes, String(note ?? "")].filter(Boolean).join("\n\n").trim();
        }
        notes = currentNotes;
      }

      const finalParts = [...baseParts];
      if (notes) finalParts.push(`Notes (internal):\n${notes}`);
      finalParts.push(userText);
      if (def.prompt?.suffix?.trim()) finalParts.push(def.prompt.suffix.trim());
      const finalPrompt = finalParts.filter(Boolean).join("\n\n");

      const rawOutput = await ctx.call({
        kind: outputKind,
        prompt: finalPrompt,
        schema: def.outputSchema,
      });

      let output = rawOutput;
      if (outputKind === "json" && typeof rawOutput === "string") {
        const block = extractJson(rawOutput) ?? rawOutput;
        try {
          output = JSON.parse(block);
        } catch {
          output = rawOutput;
        }
      }

      if (def.outputSchema && !validateSchema(def.outputSchema, output)) {
        throw new Error(`Output schema validation failed for agent '${def.id}'`);
      }

      if (writeMemory) {
        const inputText = normalizeInput(ctx.input);
        const outputText = typeof output === "string" ? output : JSON.stringify(output);
        await ctx.memory.appendConversation(memoryScope, {
          id: makeId(),
          role: "user",
          text: inputText,
          json: typeof ctx.input === "string" ? undefined : ctx.input,
        });
        await ctx.memory.appendConversation(memoryScope, {
          id: makeId(),
          role: "assistant",
          text: outputText,
          json: outputKind === "json" ? output : undefined,
        });
      }

      return output;
    },
  };
}

export function isAgentDefinition(value: any): value is AgentDefinition {
  return Boolean(value && typeof value === "object" && typeof value.id === "string" && !value.run);
}
