#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { createMarkdownRuntime } from "@bolt-ai/agents";
import { InMemoryStore, type ModelProvider } from "@bolt-ai/core";

export interface CliIo {
  stdout?: Pick<typeof process.stdout, "write">;
  stderr?: Pick<typeof process.stderr, "write">;
  env?: NodeJS.ProcessEnv;
}

export type CliProviderName = "openai" | "gemini" | "groq";
export type ProviderModuleLoader = (specifier: string) => Promise<Record<string, any>>;

export interface RunCommandOptions {
  agentId: string;
  agentsDir: string;
  skillsDir?: string;
  input: unknown;
  preset?: "fast" | "cheap" | "strict" | "auto";
  provider?: CliProviderName;
  mockOutput?: string;
}

function usage() {
  return [
    "Usage:",
    "  bolt run <agentId> --agents-dir <dir> --input <text-or-json> [--skills-dir <dir>] [--provider openai|gemini|groq]",
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
    else if (flag === "--provider") options.provider = parseProvider(value);
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
    const providers = await createCliProviders(options, env);
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

export async function createCliProviders(
  options: RunCommandOptions,
  env: NodeJS.ProcessEnv,
  loadProvider: ProviderModuleLoader = defaultProviderLoader
): Promise<ModelProvider[]> {
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

  const candidates = [
    {
      name: "openai" as const,
      key: env.OPENAI_API_KEY,
      specifier: "@bolt-ai/providers-openai",
      factory: "createOpenAIProvider",
    },
    {
      name: "gemini" as const,
      key: env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY,
      specifier: "@bolt-ai/providers-gemini",
      factory: "createGeminiProvider",
    },
    {
      name: "groq" as const,
      key: env.GROQ_API_KEY,
      specifier: "@bolt-ai/providers-groq",
      factory: "createGroqProvider",
    },
  ];
  const selected = options.provider
    ? candidates.filter((candidate) => candidate.name === options.provider)
    : candidates.filter((candidate) => Boolean(candidate.key));

  if (options.provider && !selected[0]?.key) {
    throw new Error(`No API key configured for provider '${options.provider}'.`);
  }

  const providers: ModelProvider[] = [];
  for (const candidate of selected) {
    if (!candidate.key) continue;
    const module = await loadProvider(candidate.specifier);
    const factory = module[candidate.factory];
    if (typeof factory !== "function") {
      throw new Error(`Provider package '${candidate.specifier}' does not export ${candidate.factory}.`);
    }
    providers.push(factory({ apiKey: candidate.key }));
  }

  if (providers.length) return providers;
  throw new Error(
    "No provider configured. Set OPENAI_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY, or GROQ_API_KEY; or pass --mock-output."
  );
}

async function defaultProviderLoader(specifier: string): Promise<Record<string, any>> {
  return import(/* @vite-ignore */ specifier);
}

function parseProvider(value: string): CliProviderName {
  if (value === "openai" || value === "gemini" || value === "groq") return value;
  throw new Error(`Invalid provider '${value}'. Expected openai, gemini, or groq.`);
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
