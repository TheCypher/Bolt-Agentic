#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { createMarkdownRuntime } from "@bolt-ai/agents";
import { InMemoryStore, type ModelProvider } from "@bolt-ai/core";

export interface CliIo {
  stdout?: Pick<typeof process.stdout, "write">;
  stderr?: Pick<typeof process.stderr, "write">;
  env?: NodeJS.ProcessEnv;
}

export interface RunCommandOptions {
  agentId: string;
  agentsDir: string;
  skillsDir?: string;
  input: unknown;
  preset?: "fast" | "cheap" | "strict" | "auto";
  mockOutput?: string;
}

function usage() {
  return [
    "Usage:",
    "  bolt run <agentId> --agents-dir <dir> --input <text-or-json> [--skills-dir <dir>]",
    "",
    "Development:",
    "  bolt run support --agents-dir agents --skills-dir skills --input '{\"question\":\"Hi\"}' --mock-output 'ok'",
  ].join("\n");
}

export function parseCliArgs(argv: string[]): RunCommandOptions {
  const [command, agentId, ...rest] = argv;
  if (command !== "run" || !agentId) {
    throw new Error(usage());
  }

  const options: Partial<RunCommandOptions> = { agentId };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag.startsWith("--")) {
      throw new Error(`Unexpected argument: ${flag}`);
    }
    if (value == null || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    index += 1;
    if (flag === "--agents-dir") options.agentsDir = value;
    else if (flag === "--skills-dir") options.skillsDir = value;
    else if (flag === "--input") options.input = parseInput(value);
    else if (flag === "--preset") options.preset = value as RunCommandOptions["preset"];
    else if (flag === "--mock-output") options.mockOutput = value;
    else throw new Error(`Unknown option: ${flag}`);
  }

  if (!options.agentsDir) throw new Error("Missing required option: --agents-dir");
  if (options.input == null) throw new Error("Missing required option: --input");
  return options as RunCommandOptions;
}

export async function runCli(argv: string[], io: CliIo = {}): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const env = io.env ?? process.env;

  try {
    const options = parseCliArgs(argv);
    const providers = await createProviders(options, env);
    const runtime = createMarkdownRuntime({
      agentsDir: options.agentsDir,
      skillsDir: options.skillsDir,
      preset: options.preset,
      providers,
      memory: new InMemoryStore(),
    });

    await runtime.ready();
    const result = await runtime.run(options.agentId, options.input, { throwOnError: false });
    if (!result.ok) {
      stderr.write(`${result.error?.message ?? "Runtime failed"}\n`);
      return 1;
    }

    stdout.write(formatOutput(result.output));
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function createProviders(options: RunCommandOptions, env: NodeJS.ProcessEnv): Promise<ModelProvider[]> {
  if (options.mockOutput != null) {
    return [
      {
        id: "mock:cli",
        supports: ["text", "json"],
        async call() {
          return { output: options.mockOutput };
        },
      },
    ];
  }
  if (env.GROQ_API_KEY) {
    const spec = "@bolt-ai/providers-groq";
    const { createGroqProvider } = await import(/* @vite-ignore */ spec);
    return [createGroqProvider({ apiKey: env.GROQ_API_KEY })];
  }
  throw new Error("No provider configured. Set GROQ_API_KEY or pass --mock-output for local testing.");
}

function parseInput(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

function formatOutput(output: unknown): string {
  if (typeof output === "string") return `${output}\n`;
  return `${JSON.stringify(output, null, 2)}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
