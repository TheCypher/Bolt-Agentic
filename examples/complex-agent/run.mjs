import fs from 'node:fs/promises';
import path from 'node:path';

let agentsPkg;
let corePkg;
try {
  agentsPkg = await import('@bolt-ai/agents');
  corePkg = await import('@bolt-ai/core');
} catch {
  agentsPkg = await import('../../packages/agents/dist/index.js');
  corePkg = await import('../../packages/core/dist/index.js');
}

const { createAgentFromMarkdown } = agentsPkg;
const { createAppRouter, InMemoryStore, runPlan } = corePkg;
import { tools } from './tools/index.mjs';

const root = path.resolve(process.cwd(), 'examples/complex-agent');

const agentFiles = [
  'agents/main/main.md',
  'agents/research/research.md',
  'agents/validator/validator.md',
].map((p) => path.join(root, p));

const agents = {};
for (const file of agentFiles) {
  const raw = await fs.readFile(file, 'utf8');
  const agent = createAgentFromMarkdown(raw, { filePath: file });
  agents[agent.id] = agent;
}

const mockProvider = {
  id: 'mock:local',
  supports: ['text', 'json'],
  async call({ prompt, kind }) {
    const text = String(prompt ?? '');
    if (text.includes('Collect evidence only')) {
      return {
        output: [
          '- Source A: https://developer.example.com/webgpu\n  Key points: Early adoption, API stability improving.',
          '- Source B: https://benchmarks.example.com/webgpu\n  Key points: GPU throughput gains in specific workloads.',
          '- Source C: https://compat.example.com/webgpu\n  Key points: Browser support is growing but uneven.',
        ].join('\n'),
      };
    }
    if (text.includes('Validate claims')) {
      return {
        output: {
          valid: true,
          issues: ['Evidence is limited to mock sources in this demo.'],
          confidence: 0.6,
        },
      };
    }
    return {
      output:
        'Summary:\n- WebGPU shows strong potential for performance gains.\n- Adoption is viable with browser support caveats.\n\nEvidence:\n- Source A/B/C (see research).\n\nRisks:\n- Compatibility gaps and driver variability.\n\nNext Steps:\n- Prototype on top workloads and measure gains.\n\nRecommendation:\nProceed with a phased pilot on a constrained scope.',
    };
  },
};

const router = createAppRouter({
  providers: [mockProvider],
  memory: new InMemoryStore(),
  preset: 'auto',
});

router.registerAgents(agents);

const plan = {
  id: 'complex-agent-demo',
  steps: [
    {
      id: 'search',
      kind: 'tool',
      toolId: 'web.search',
      args: { query: '${input}' },
    },
    {
      id: 'fetch0',
      kind: 'tool',
      toolId: 'http.fetch',
      args: { url: '${search.results.0.url}' },
    },
    {
      id: 'fetch1',
      kind: 'tool',
      toolId: 'http.fetch',
      args: { url: '${search.results.1.url}' },
    },
    {
      id: 'fetch2',
      kind: 'tool',
      toolId: 'http.fetch',
      args: { url: '${search.results.2.url}' },
    },
    {
      id: 'research',
      kind: 'model',
      agent: 'research',
      inputFrom: ['fetch0', 'fetch1', 'fetch2'],
    },
    {
      id: 'validate',
      kind: 'model',
      agent: 'validator',
      inputFrom: ['research'],
    },
    {
      id: 'main',
      kind: 'model',
      agent: 'main',
      inputFrom: ['research', 'validate'],
    },
  ],
  outputs: ['main'],
};

const result = await runPlan(
  router,
  plan,
  { taskId: plan.id, agentId: 'main', input: 'Should we adopt WebGPU for our rendering pipeline?', tools },
  {}
);

console.log('\n=== FINAL OUTPUT ===\n');
console.log(result.outputs.main);
