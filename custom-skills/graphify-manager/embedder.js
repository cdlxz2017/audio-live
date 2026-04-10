#!/usr/bin/env node
// custom-skills/graphify-manager/embedder.js
// BGE-m3 嵌入封装模块：单条 + 批量，支持并发控制
'use strict';

const http = require('http');

const DEFAULT_OLLAMA_URL = 'http://localhost:11434/api/embeddings';
const DEFAULT_MODEL = 'bge-m3:latest';
const DEFAULT_BATCH_SIZE = 16;      // BGE-m3 较重，16条/批次性能最优
const DEFAULT_CONCURRENCY = 2;      // 并发批次数（避免 Ollama OOM）
const RETRY_DELAYS = [500, 1500, 4000]; // 三次重试延迟(ms)

/**
 * 构建节点的 embed_text
 * 策略：name（最重要）> type > tags > file_path basename
 * 空节点（仅有id）返回 null
 */
function buildEmbedText(node) {
  const parts = [];
  if (node.name && node.name.trim()) parts.push(node.name.trim());
  if (node.type && node.type.trim()) parts.push(node.type.trim().replace(/_/g, ' '));
  if (node.tags && node.tags.trim()) {
    // tags 是逗号分隔，取前5个最具意义的
    const tags = node.tags.split(',')
      .map(t => t.trim())
      .filter(t => t.length > 1)
      .slice(0, 5);
    if (tags.length > 0) parts.push(tags.join(' '));
  }
  if (node.file_path && node.file_path.trim()) {
    const basename = node.file_path.split('/').pop().replace(/\.[^.]+$/, '');
    if (basename && basename.length > 1) parts.push(basename);
  }
  if (parts.length === 0) return null; // 空节点
  return parts.join(' ');
}

/**
 * 单条 embedding 请求（含重试）
 */
async function embedOne(text, model = DEFAULT_MODEL, ollamaUrl = DEFAULT_OLLAMA_URL) {
  const body = JSON.stringify({ model, prompt: text });

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const result = await httpPost(ollamaUrl, body);
      if (!result.embedding || !Array.isArray(result.embedding)) {
        throw new Error('Ollama returned no embedding array');
      }
      return result.embedding;
    } catch (err) {
      if (attempt < RETRY_DELAYS.length) {
        await sleep(RETRY_DELAYS[attempt]);
        continue;
      }
      throw err;
    }
  }
}

/**
 * 批量 embedding（并发受控）
 * @param {Array<{node_id, embed_text, ...}>} items
 * @param {object} opts
 * @returns {Array<{node_id, embedding, error?}>}
 */
async function embedBatch(items, opts = {}) {
  const {
    model = DEFAULT_MODEL,
    ollamaUrl = DEFAULT_OLLAMA_URL,
    concurrency = DEFAULT_CONCURRENCY,
    onProgress = null   // (done, total) => void
  } = opts;

  const results = [];
  let done = 0;

  // 分批（每批 concurrency 条并发）
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const chunkResults = await Promise.all(
      chunk.map(async (item) => {
        if (!item.embed_text) {
          return { node_id: item.node_id, embedding: null, error: 'empty_text' };
        }
        try {
          const embedding = await embedOne(item.embed_text, model, ollamaUrl);
          return { node_id: item.node_id, embedding };
        } catch (err) {
          return { node_id: item.node_id, embedding: null, error: err.message };
        }
      })
    );
    results.push(...chunkResults);
    done += chunk.length;
    if (onProgress) onProgress(done, items.length);
  }

  return results;
}

// ── 内部工具 ────────────────────────────────────────────

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 80,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse error: ' + data.substring(0, 100))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error('Ollama timeout')); });
    req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { buildEmbedText, embedOne, embedBatch, DEFAULT_BATCH_SIZE };
