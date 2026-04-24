/**
 * BGE-m3 Ollama 向量嵌入 (1024维)
 */
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

const cfgPath = path.join(__dirname, '..', 'config.yaml');
const cfg = yaml.load(fs.readFileSync(cfgPath, 'utf8'));

class Embedder {
  constructor() {
    this.model = cfg.embedding.model;
    this.url = cfg.embedding.url;
    this.dimensions = cfg.embedding.dimensions;
  }

  async embed(text) {
    const response = await fetch(`${this.url}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });
    if (!response.ok) throw new Error(`Embedding failed: ${response.status} ${response.statusText}`);
    const data = await response.json();
    return data.embedding;
  }

  async embedBatch(texts) {
    const results = [];
    for (const text of texts) {
      try { results.push(await this.embed(text)); }
      catch (err) { console.error(`[Embedder] Failed: ${text.substring(0, 50)}...`, err.message); results.push(null); }
    }
    return results;
  }
}

const embedder = new Embedder();

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; normA += a[i]*a[i]; normB += b[i]*b[i]; }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

module.exports = { embedder, cosineSimilarity };
