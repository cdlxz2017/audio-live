/**
 * PostgreSQL 连接池 (pgvector)
 */
const { Pool } = require('pg');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

const cfgPath = path.join(__dirname, '..', 'config.yaml');
const cfg = yaml.load(fs.readFileSync(cfgPath, 'utf8'));

let _pool = null;

function getPool() {
  if (!_pool) {
    _pool = new Pool({
      host: cfg.database.host,
      port: cfg.database.port,
      user: cfg.database.user,
      password: cfg.database.password,
      database: cfg.database.database,
      max: cfg.database.pool.max,
      idleTimeoutMillis: cfg.database.pool.idleTimeoutMillis,
      connectionTimeoutMillis: cfg.database.pool.connectionTimeoutMillis,
      statement_timeout: 5000,
    });
    _pool.on('error', (err) => console.error('[DB] Pool error:', err.message));
  }
  return _pool;
}

async function query(text, params) {
  const pool = getPool();
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  if (duration > 1000) console.warn(`[DB] Slow query (${duration}ms): ${text.substring(0, 100)}`);
  return result;
}

async function getClient() {
  return await getPool().connect();
}

async function transaction(fn) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function healthCheck() {
  try {
    const start = Date.now();
    await query('SELECT 1 AS ok');
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function close() {
  if (_pool) { await _pool.end(); _pool = null; }
}

module.exports = { getPool, query, getClient, transaction, healthCheck, close };
