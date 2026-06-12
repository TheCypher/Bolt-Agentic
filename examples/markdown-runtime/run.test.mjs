import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execFileAsync = promisify(execFile);
const exampleRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(exampleRoot, '../..');

test('markdown runtime example command runs deterministically', async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['examples/markdown-runtime/run.mjs'],
    { cwd: repoRoot },
  );

  assert.match(stdout, /Loaded agents: support/);
  assert.match(stdout, /Registered tools: local\.kb\.lookup/);
  assert.match(stdout, /Order status lives in the customer portal\./);
});
