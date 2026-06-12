import { describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

import { discoverBoltDocs } from "@bolt-ai/core";

async function makeTempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return dir;
}

async function writeFile(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

describe("discoverBoltDocs", () => {
  it("uses nearest BOLT.md by default (auto override)", async () => {
    const root = await makeTempDir("bolt-docs-");
    const agentsDir = path.join(root, "agents");
    const supportDir = path.join(agentsDir, "support");

    await writeFile(path.join(root, "BOLT.md"), "root");
    await writeFile(path.join(agentsDir, "BOLT.md"), "agents");
    await writeFile(path.join(supportDir, "BOLT.md"), "support");

    const chain = await discoverBoltDocs({
      cwd: supportDir,
      projectRoot: root,
      includeGlobal: false,
    });

    expect(chain.text.trim()).toBe("support");
    expect(chain.files.map((f) => f.dir)).toEqual([supportDir]);
  });

  it("extends true merges parent chain", async () => {
    const root = await makeTempDir("bolt-docs-");
    const agentsDir = path.join(root, "agents");
    const supportDir = path.join(agentsDir, "support");

    await writeFile(path.join(root, "BOLT.md"), "root");
    await writeFile(path.join(agentsDir, "BOLT.md"), "---\nextends: true\n---\nagents");
    await writeFile(path.join(supportDir, "BOLT.md"), "---\nextends: true\n---\nsupport");

    const chain = await discoverBoltDocs({
      cwd: supportDir,
      projectRoot: root,
      includeGlobal: false,
    });

    expect(chain.text.trim()).toBe("root\n\nagents\n\nsupport");
    expect(chain.files.map((f) => path.basename(f.dir))).toEqual([path.basename(root), "agents", "support"]);
  });

  it("prefers BOLT.override.md when present", async () => {
    const root = await makeTempDir("bolt-docs-");
    const agentsDir = path.join(root, "agents");
    const supportDir = path.join(agentsDir, "support");

    await writeFile(path.join(root, "BOLT.md"), "root");
    await writeFile(path.join(agentsDir, "BOLT.md"), "agents");
    await writeFile(path.join(supportDir, "BOLT.md"), "support");
    await writeFile(path.join(supportDir, "BOLT.override.md"), "override");

    const chain = await discoverBoltDocs({
      cwd: supportDir,
      projectRoot: root,
      includeGlobal: false,
    });

    expect(chain.text.trim()).toBe("override");
  });
});
