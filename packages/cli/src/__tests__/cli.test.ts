import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseCliArgs, runCli } from "../index";

async function makeTempDir(prefix: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeFile(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

function capture() {
  let text = "";
  return {
    stream: {
      write(chunk: string) {
        text += chunk;
        return true;
      },
    },
    read() {
      return text;
    },
  };
}

describe("bolt CLI", () => {
  it("parses run command options", () => {
    expect(parseCliArgs([
      "run",
      "support",
      "--agents-dir",
      "agents",
      "--skills-dir",
      "skills",
      "--input",
      "{\"question\":\"Hi\"}",
      "--mock-output",
      "ok",
    ])).toEqual({
      agentId: "support",
      agentsDir: "agents",
      skillsDir: "skills",
      input: { question: "Hi" },
      mockOutput: "ok",
    });
  });

  it("runs a Markdown agent from agentsDir with a mock provider", async () => {
    const root = await makeTempDir("bolt-cli-");
    await writeFile(
      path.join(root, "agents", "support.md"),
      `---
id: support
memory:
  write: false
---
## User
Question: {{input}}
`,
    );
    const stdout = capture();
    const stderr = capture();

    const code = await runCli(
      [
        "run",
        "support",
        "--agents-dir",
        path.join(root, "agents"),
        "--input",
        "Where is my order?",
        "--mock-output",
        "Mocked answer",
      ],
      { stdout: stdout.stream, stderr: stderr.stream, env: {} }
    );

    expect(code).toBe(0);
    expect(stdout.read()).toBe("Mocked answer\n");
    expect(stderr.read()).toBe("");
  });

  it("fails clearly without a provider", async () => {
    const stdout = capture();
    const stderr = capture();

    const code = await runCli(
      ["run", "support", "--agents-dir", "agents", "--input", "Hi"],
      { stdout: stdout.stream, stderr: stderr.stream, env: {} }
    );

    expect(code).toBe(1);
    expect(stderr.read()).toMatch(/No provider configured/);
  });
});
