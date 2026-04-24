#!/usr/bin/env node
/**
 * 健康检查 — 检测所有依赖服务状态
 */
const db = require('../src/db');
const redis = require('../src/redis');
const { embedder } = require('../src/embedder');

async function main() {
  console.log('=== Memory System Health Check ===\n');
  const results = {};

  // 1. PostgreSQL
  process.stdout.write('PostgreSQL ... ');
  const pgHealth = await db.healthCheck();
  results.postgresql = pgHealth;
  console.log(pgHealth.ok ? `✅ OK (${pgHealth.latencyMs}ms)` : `❌ FAIL: ${pgHealth.error}`);

  // 2. pgvector 扩展
  process.stdout.write('pgvector   ... ');
  try {
    const ext = await db.query("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
    if (ext.rows.length > 0) {
      results.pgvector = { ok: true, version: ext.rows[0].extversion };
      console.log(`✅ OK (v${ext.rows[0].extversion})`);
    } else {
      results.pgvector = { ok: false, error: 'not installed' };
      console.log('❌ NOT INSTALLED');
    }
  } catch (err) {
    results.pgvector = { ok: false, error: err.message };
    console.log(`❌ FAIL: ${err.message}`);
  }

  // 3. 核心表
  process.stdout.write('Tables     ... ');
  try {
    const tables = ['memories', 'memory_summaries', 'personal_memories', 'conversation_messages', 'recall_logs'];
    const counts = {};
    for (const t of tables) {
      const r = await db.query(`SELECT count(*) as c FROM ${t}`);
      counts[t] = parseInt(r.rows[0].c);
    }
    results.tables = { ok: true, counts };
    console.log(`✅ OK — ${JSON.stringify(counts)}`);
  } catch (err) {
    results.tables = { ok: false, error: err.message };
    console.log(`❌ FAIL: ${err.message}`);
  }

  // 4. HNSW 索引
  process.stdout.write('HNSW Index ... ');
  try {
    const idx = await db.query(`SELECT indexname, indexdef FROM pg_indexes WHERE indexdef LIKE '%hnsw%'`);
    results.hnsw = { ok: idx.rows.length > 0, count: idx.rows.length, indexes: idx.rows.map(r => r.indexname) };
    console.log(idx.rows.length > 0 ? `✅ OK (${idx.rows.length} indexes)` : '⚠️ No HNSW indexes found');
  } catch (err) {
    results.hnsw = { ok: false, error: err.message };
    console.log(`❌ FAIL: ${err.message}`);
  }

  // 5. Redis
  process.stdout.write('Redis      ... ');
  const redisHealth = await redis.healthCheck();
  results.redis = redisHealth;
  console.log(redisHealth.ok ? '✅ OK' : `❌ FAIL: ${redisHealth.error}`);

  // 6. Ollama BGE-m3
  process.stdout.write('BGE-m3     ... ');
  try {
    const start = Date.now();
    const vec = await embedder.embed('health check test');
    const latency = Date.now() - start;
    results.bge_m3 = { ok: true, dimensions: vec.length, latencyMs: latency };
    console.log(`✅ OK (dim=${vec.length}, ${latency}ms)`);
  } catch (err) {
    results.bge_m3 = { ok: false, error: err.message };
    console.log(`❌ FAIL: ${err.message}`);
  }

  // 7. 副脑 PostgreSQL
  process.stdout.write('副脑 PG    ... ');
  try {
    const { Pool } = require('pg');
    const ptPool = new Pool({ host: 'localhost', port: 54320, database: 'ptdb', user: 'ptuser', password: 'ptpass', connectionTimeoutMillis: 3000 });
    const r = await ptPool.query('SELECT count(*) as c FROM problem_threads');
    results.pt_postgres = { ok: true, threads: parseInt(r.rows[0].c) };
    console.log(`✅ OK (${r.rows[0].c} threads)`);
    await ptPool.end();
  } catch (err) {
    results.pt_postgres = { ok: false, error: err.message };
    console.log(`❌ FAIL: ${err.message}`);
  }

  // Summary
  console.log('\n=== Summary ===');
  const allOk = Object.values(results).every(r => r.ok);
  console.log(allOk ? '✅ All systems healthy' : '⚠️ Some systems have issues');
  console.log(JSON.stringify(results, null, 2));

  await db.close();
  await redis.close();
  process.exit(allOk ? 0 : 1);
}

main().catch(err => { console.error('Health check failed:', err); process.exit(1); });
