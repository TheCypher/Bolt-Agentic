const records = {
  shipping: {
    summary: 'Order status lives in the customer portal. Shipping emails include the same tracking link.',
    source: 'local-demo-kb',
  },
};

export const localKnowledgeTool = {
  id: 'local.kb.lookup',
  schema: {
    type: 'object',
    required: ['topic'],
    properties: {
      topic: { type: 'string' },
    },
  },
  async run(args) {
    const topic = String(args?.topic ?? '').toLowerCase();
    return records[topic] ?? {
      summary: `No local record found for ${topic || 'unknown'}.`,
      source: 'local-demo-kb',
    };
  },
};
