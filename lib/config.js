// Central configuration. Everything can be overridden with environment variables.
export const config = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || '127.0.0.1',            // set HOST=0.0.0.0 to serve your LAN / a tunnel
  backend: process.env.NN_BACKEND || 'ollama',       // 'ollama' | 'anthropic' | 'mock'
  ollamaUrl: (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, ''),
  model: process.env.NN_MODEL || 'qwen3:14b',
  anthropicModel: process.env.NN_ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  batchSize: Number(process.env.NN_BATCH || 8),
  maxHeadlines: Number(process.env.NN_MAX_HEADLINES || 160),
  numCtx: Number(process.env.NN_NUM_CTX || 8192),
  temperature: Number(process.env.NN_TEMPERATURE || 0.2),
  cacheFile: process.env.NN_CACHE || '.cache/results.json',
  fetchTimeoutMs: 20000,
};

export function activeModel() {
  if (config.backend === 'anthropic') return config.anthropicModel;
  if (config.backend === 'mock') return 'mock-lexicon';
  return config.model;
}
