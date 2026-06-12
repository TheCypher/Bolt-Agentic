export const tools = {
  'web.search': async ({ query }) => {
    return {
      results: [
        { title: 'Official WebGPU Overview', url: 'https://developer.example.com/webgpu', snippet: 'WebGPU overview and status.' },
        { title: 'Performance Benchmarks', url: 'https://benchmarks.example.com/webgpu', snippet: 'Benchmarks and case studies.' },
        { title: 'Compatibility Notes', url: 'https://compat.example.com/webgpu', snippet: 'Browser support matrix and caveats.' },
      ],
      query,
    };
  },
  'http.fetch': async ({ url }) => {
    return {
      status: 200,
      url,
      text: `Mock content for ${url}`,
    };
  },
  'vector.search': async ({ query, topK = 3 }) => {
    return {
      matches: Array.from({ length: topK }).map((_, i) => ({
        id: String(i + 1),
        score: 0.9 - i * 0.1,
        metadata: { excerpt: `Vector hit ${i + 1} for ${query}` },
      })),
    };
  },
};
