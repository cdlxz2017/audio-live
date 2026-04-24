/**
 * Redis Client (ioredis) + Stream 操作
 */
const Redis = require('ioredis');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

const cfgPath = path.join(__dirname, '..', 'config.yaml');
const cfg = yaml.load(fs.readFileSync(cfgPath, 'utf8'));

let _client = null;

function getClient() {
  if (!_client) {
    _client = new Redis({
      host: cfg.redis.host,
      port: cfg.redis.port,
      retryStrategy(times) { return Math.min(times * 500, 10000); },
      maxRetriesPerRequest: 30,
      lazyConnect: true,
      connectTimeout: 10000,
      commandTimeout: 30000,
    });
    _client.on('error', (err) => console.error('[Redis] Error:', err.message));
    _client.on('close', () => { _client = null; });
  }
  return _client;
}

// Stream 操作
async function xadd(stream, id, fields) {
  const client = getClient();
  const flat = [];
  for (const [k, v] of Object.entries(fields)) flat.push(k, String(v));
  return await client.xadd(stream, '*', ...flat);
}

async function xreadgroup(options) {
  const client = getClient();
  const { stream, group, consumer, count = 10, blockMs = 5000 } = options;
  return await client.xreadgroup('GROUP', group, consumer, 'COUNT', count, 'BLOCK', blockMs, 'STREAMS', stream, '>');
}

async function xack(stream, group, ...ids) {
  return await getClient().xack(stream, group, ...ids);
}

async function xlen(stream) {
  return await getClient().xlen(stream);
}

// KV 操作
async function get(key) { return await getClient().get(key); }
async function set(key, value, ttlSeconds = null) {
  const c = getClient();
  return ttlSeconds ? await c.set(key, value, 'EX', ttlSeconds) : await c.set(key, value);
}
async function del(key) { return await getClient().del(key); }

// Recall 缓存
const RECALL_CACHE_PREFIX = 'recall:';

async function getCachedCandidates(queryHash) {
  try {
    const cached = await getClient().get(`${RECALL_CACHE_PREFIX}${queryHash}`);
    return cached ? JSON.parse(cached) : null;
  } catch { return null; }
}

async function cacheCandidates(queryHash, candidates, ttl = 300) {
  try {
    await getClient().set(`${RECALL_CACHE_PREFIX}${queryHash}`, JSON.stringify(candidates), 'EX', ttl);
  } catch {}
}

async function invalidateRecallCache() {
  try {
    const client = getClient();
    let cursor = '0', deleted = 0;
    do {
      const [next, keys] = await client.scan(cursor, 'MATCH', 'recall:*', 'COUNT', 100);
      cursor = next;
      if (keys.length > 0) { await client.del(...keys); deleted += keys.length; }
    } while (cursor !== '0');
    return deleted;
  } catch { return 0; }
}

async function healthCheck() {
  try {
    const result = await getClient().ping();
    return { ok: result === 'PONG' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function close() {
  if (_client) { await _client.quit(); _client = null; }
}

module.exports = {
  getClient, xadd, xreadgroup, xack, xlen,
  get, set, del,
  getCachedCandidates, cacheCandidates, invalidateRecallCache,
  healthCheck, close, RECALL_CACHE_PREFIX,
};
