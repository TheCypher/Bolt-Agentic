import fs from "node:fs/promises";
import path from "node:path";
import {
  createRuntime,
  type Agent,
  type BoltRuntime,
  type RuntimeOptions,
} from "@bolt-ai/core";
import { createAgentFromMarkdown, type MarkdownParseOptions } from "./markdown";

export interface MarkdownRuntimeLoadOptions extends Omit<MarkdownParseOptions, "filePath"> {
  skillsDir?: string;
}

export interface MarkdownRuntimeOptions extends RuntimeOptions {
  agentsDir?: string;
  skillsDir?: string;
}

export interface MarkdownRuntime extends BoltRuntime {
  ready(): Promise<Agent[]>;
  loadAgent(filePath: string, options?: MarkdownRuntimeLoadOptions): Promise<Agent>;
  loadAgents(dir?: string, options?: MarkdownRuntimeLoadOptions): Promise<Agent[]>;
}

function isMarkdownAgentCandidate(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  if (!/\.(md|mdx)$/i.test(base)) return false;
  if (base === "bolt.md" || base === "bolt.override.md") return false;
  return base !== "skill.md" && base !== "skill.mdx";
}

async function collectMarkdownAgentFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectMarkdownAgentFiles(fullPath));
      continue;
    }
    if (entry.isFile() && isMarkdownAgentCandidate(fullPath)) {
      files.push(fullPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

export function createMarkdownRuntime(options: MarkdownRuntimeOptions): MarkdownRuntime {
  const runtime = createRuntime(options) as MarkdownRuntime;
  let readyPromise: Promise<Agent[]> | undefined;

  runtime.loadAgent = async (filePath: string, loadOptions: MarkdownRuntimeLoadOptions = {}) => {
    const markdown = await fs.readFile(filePath, "utf8");
    const agent = createAgentFromMarkdown(markdown, {
      ...loadOptions,
      filePath,
      skillsDir: loadOptions.skillsDir ?? options.skillsDir,
    });
    runtime.registerAgents([agent]);
    return agent;
  };

  runtime.loadAgents = async (dir = options.agentsDir, loadOptions: MarkdownRuntimeLoadOptions = {}) => {
    if (!dir) {
      throw new Error("loadAgents requires a directory or MarkdownRuntimeOptions.agentsDir");
    }

    const files = await collectMarkdownAgentFiles(dir);
    const agents = await Promise.all(files.map((file) => runtime.loadAgent(file, loadOptions)));
    return agents.sort((a, b) => a.id.localeCompare(b.id));
  };

  runtime.ready = async () => {
    if (!options.agentsDir) {
      throw new Error("ready requires MarkdownRuntimeOptions.agentsDir");
    }
    readyPromise ??= runtime.loadAgents(options.agentsDir);
    return readyPromise;
  };

  return runtime;
}
