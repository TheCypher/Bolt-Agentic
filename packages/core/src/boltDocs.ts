// packages/core/src/boltDocs.ts

import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

export type BoltDocScope = "global" | "project";

export interface BoltDocFile {
  path: string;
  scope: BoltDocScope;
  dir: string;
  name: string;
  content: string;
  bytes: number;
  truncated?: boolean;
}

export interface BoltDocChain {
  text: string;
  files: BoltDocFile[];
  truncated: boolean;
  maxBytes: number;
}

export interface BoltDocOptions {
  cwd?: string;
  projectRoot?: string | null;
  homeDir?: string;
  overrideName?: string;
  defaultName?: string;
  fallbackNames?: string[];
  maxBytes?: number;
  includeGlobal?: boolean;
  includeProject?: boolean;
}

export interface BoltDocMeta {
  extends: boolean;
}

const DEFAULT_MAX_BYTES = 32 * 1024;

function resolveHomeDir(homeDir?: string): string {
  if (homeDir) return homeDir;
  if (process.env.BOLT_HOME) return process.env.BOLT_HOME;
  return path.join(os.homedir(), ".bolt");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeDir(value: string): string {
  return path.resolve(value);
}

export async function findProjectRoot(startDir: string): Promise<string | null> {
  let dir = normalizeDir(startDir);
  // Walk up to filesystem root
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (await exists(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function truncateByBytes(text: string, maxBytes: number): { text: string; bytes: number; truncated: boolean } {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return { text, bytes: buf.length, truncated: false };
  const sliced = buf.slice(0, maxBytes);
  return { text: sliced.toString("utf8"), bytes: maxBytes, truncated: true };
}

function parseFrontmatter(raw: string): { meta: BoltDocMeta; body: string } {
  const trimmed = raw ?? "";
  if (!trimmed.startsWith("---")) {
    return { meta: { extends: false }, body: trimmed };
  }

  const lines = trimmed.split(/\r?\n/);
  if (lines.length < 2 || lines[0].trim() !== "---") {
    return { meta: { extends: false }, body: trimmed };
  }

  let endIdx = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      endIdx = i;
      break;
    }
  }

  if (endIdx === -1) {
    return { meta: { extends: false }, body: trimmed };
  }

  const metaLines = lines.slice(1, endIdx);
  let extendsFlag = false;
  for (const line of metaLines) {
    const match = line.match(/^\s*extends\s*:\s*(true|false)\s*$/i);
    if (match) {
      extendsFlag = match[1].toLowerCase() === "true";
    }
  }

  const body = lines.slice(endIdx + 1).join("\n");
  return { meta: { extends: extendsFlag }, body };
}

async function readFirstNonEmpty(
  dir: string,
  names: string[]
): Promise<{ name: string; path: string; content: string; meta: BoltDocMeta } | null> {
  for (const name of names) {
    const filePath = path.join(dir, name);
    let raw: string | null = null;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch {
      raw = null;
    }
    if (raw == null) continue;
    if (!raw.trim()) continue;
    const parsed = parseFrontmatter(raw);
    const body = parsed.body.trim();
    if (!body) continue;
    return { name, path: filePath, content: body, meta: parsed.meta };
  }
  return null;
}

function buildDirectoryChain(root: string, cwd: string): string[] {
  const resolvedRoot = normalizeDir(root);
  const resolvedCwd = normalizeDir(cwd);
  if (!resolvedCwd.startsWith(resolvedRoot)) return [resolvedCwd];
  const rel = path.relative(resolvedRoot, resolvedCwd);
  if (!rel) return [resolvedRoot];
  const parts = rel.split(path.sep).filter(Boolean);
  const dirs = [resolvedRoot];
  let current = resolvedRoot;
  for (const part of parts) {
    current = path.join(current, part);
    dirs.push(current);
  }
  return dirs;
}

export async function discoverBoltDocs(options: BoltDocOptions = {}): Promise<BoltDocChain> {
  const cwd = options.cwd ? normalizeDir(options.cwd) : process.cwd();
  const homeDir = resolveHomeDir(options.homeDir);
  const overrideName = options.overrideName ?? "BOLT.override.md";
  const defaultName = options.defaultName ?? "BOLT.md";
  const fallbackNames = options.fallbackNames ?? [];
  const maxBytes = Math.max(0, options.maxBytes ?? DEFAULT_MAX_BYTES);
  const includeGlobal = options.includeGlobal !== false;
  const includeProject = options.includeProject !== false;

  let projectRoot: string | null | undefined = options.projectRoot;
  if (projectRoot === undefined) {
    projectRoot = await findProjectRoot(cwd);
  }
  if (!projectRoot) projectRoot = cwd;

  const chain: BoltDocChain = {
    text: "",
    files: [],
    truncated: false,
    maxBytes,
  };

  let remainingBytes = maxBytes;

  const appendContent = (meta: { name: string; path: string; scope: BoltDocScope; dir: string }, content: string) => {
    if (remainingBytes <= 0) return false;
    if (!content.trim()) return false;

    const separator = chain.text ? "\n\n" : "";
    const sepBytes = Buffer.byteLength(separator, "utf8");
    if (remainingBytes <= sepBytes) {
      chain.truncated = true;
      return false;
    }

    const available = remainingBytes - sepBytes;
    const { text: sliced, bytes: contentBytes, truncated } = truncateByBytes(content.trim(), available);
    if (!sliced.trim()) return false;

    chain.text += separator + sliced;
    remainingBytes -= sepBytes + contentBytes;

    chain.files.push({
      name: meta.name,
      path: meta.path,
      dir: meta.dir,
      scope: meta.scope,
      content: sliced,
      bytes: contentBytes,
      truncated: truncated || undefined,
    });

    if (truncated || remainingBytes <= 0) {
      chain.truncated = true;
      return false;
    }
    return true;
  };

  if (includeGlobal && remainingBytes > 0) {
    const globalDoc = await readFirstNonEmpty(homeDir, [overrideName, defaultName]);
    if (globalDoc) {
      appendContent(
        {
          name: globalDoc.name,
          path: globalDoc.path,
          dir: homeDir,
          scope: "global",
        },
        globalDoc.content
      );
    }
  }

  if (includeProject && remainingBytes > 0) {
    const dirChain = buildDirectoryChain(projectRoot, cwd);

    let idx = dirChain.length - 1;
    const picked: Array<{ dir: string; doc: { name: string; path: string; content: string; meta: BoltDocMeta } }> = [];
    let shouldContinue = true;
    let anyDoc = false;

    while (idx >= 0) {
      const dir = dirChain[idx];
      const doc = await readFirstNonEmpty(dir, [overrideName, defaultName, ...fallbackNames]);
      if (doc) {
        anyDoc = true;
        picked.push({ dir, doc });
        shouldContinue = doc.meta.extends;
        if (!shouldContinue) break;
      }
      idx -= 1;
    }

    if (anyDoc) {
      const ordered = picked.reverse();
      for (const entry of ordered) {
        const keepGoing = appendContent(
          {
            name: entry.doc.name,
            path: entry.doc.path,
            dir: entry.dir,
            scope: "project",
          },
          entry.doc.content
        );
        if (!keepGoing) break;
      }
    }
  }

  return chain;
}
