import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localKnowledgeTool } from './tools/localKnowledge.mjs';

async function loadWorkspacePackages() {
  try {
    const agentsPkg = await import('@bolt-ai/agents');
    const corePkg = await import('@bolt-ai/core');
    return { agentsPkg, corePkg };
  } catch (workspaceError) {
    try {
      const agentsPkg = await import('../../packages/agents/dist/index.js');
      const corePkg = await import('../../packages/core/dist/index.js');
      return { agentsPkg, corePkg };
    } catch (distError) {
      throw new Error(
        [
          'Unable to load Bolt workspace packages.',
          'Run from the repo root after installing dependencies and building packages:',
          '  pnpm install',
          '  pnpm build',
          `Original import error: ${workspaceError.message}`,
          `Dist import error: ${distError.message}`,
        ].join('\n'),
      );
    }
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const agentsDir = path.join(__dirname, 'agents');
const skillsDir = path.join(__dirname, 'skills');

const { agentsPkg, corePkg } = await loadWorkspacePackages();
const { createMarkdownRuntime } = agentsPkg;
const { InMemoryStore } = corePkg;

const mockProvider = {
  id: 'mock:markdown-runtime',
  supports: ['text'],
  async call({ prompt }) {
    const text = String(prompt ?? '');
    if (!text.includes('local.kb.lookup')) {
      throw new Error('Expected the support agent prompt to include the local tool allow-list.');
    }
    if (!text.includes('Use at most two short sentences.')) {
      throw new Error('Expected the concise skill to be resolved into the prompt.');
    }
    if (!text.includes('Order status lives in the customer portal.')) {
      throw new Error('Expected local tool facts to be passed into runtime.run input.');
    }

    return {
      output:
        'Order status lives in the customer portal. Next action: open the tracking link from your shipping email.',
    };
  },
};

const runtime = createMarkdownRuntime({
  agentsDir,
  skillsDir,
  tools: [localKnowledgeTool],
  providers: [mockProvider],
  memory: new InMemoryStore(),
});

const agents = await runtime.ready();
const lookup = runtime.tools.get('local.kb.lookup');

if (!lookup) {
  throw new Error('local.kb.lookup was not registered.');
}

const facts = await lookup.run({ topic: 'shipping' }, {});
const result = await runtime.run('support', {
  question: 'Where can I check my order?',
  facts: facts.summary,
});

if (!result.ok) {
  console.error(result.error);
  process.exitCode = 1;
} else {
  console.log(`Loaded agents: ${agents.map((agent) => agent.id).join(', ')}`);
  console.log(`Registered tools: ${runtime.listTools().join(', ')}`);
  console.log('\n=== RESULT ===');
  console.log(result.output);
}
