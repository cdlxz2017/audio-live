#!/usr/bin/env node
/**
 * 召回链路测试 — 用真实 query 测试三表 HNSW 召回
 */
const db = require('../src/db');
const redis = require('../src/redis');
const { recallService, buildMemoryPrompt, classifyIntent, QUERY_INTENTS } = require('../src/recall-service');

const TEST_TENANT = '00000000-0000-0000-0000-000000000001';
const TEST_USER = '00000000-0000-0000-0000-000000000002';

const TEST_QUERIES = [
  { query: '记忆系统的状态是什么？', expectedIntent: 'TECHNICAL' },
  { query: '上次数据库出了什么问题？', expectedIntent: 'EVENT' },
  { query: '副脑 Problem Thread 的数据还在吗？', expectedIntent: 'TECHNICAL' },
  { query: '重建记忆链路需要哪些步骤？', expectedIntent: 'TECHNICAL' },
  { query: 'PostgreSQL HNSW 索引性能如何？', expectedIntent: 'TECHNICAL' },
];

async function main() {
  console.log('=== Recall Chain Test ===\n');
  const results = [];

  // 1. 意图分类测试
  console.log('--- 1. Intent Classification ---');
  for (const tc of TEST_QUERIES) {
    const intent = classifyIntent(tc.query);
    const match = intent === tc.expectedIntent;
    console.log(`  ${match ? '✅' : '⚠️'} "${tc.query}" → ${intent} (expected: ${tc.expectedIntent})`);
  }

  // 2. 召回测试
  console.log('\n--- 2. Recall Tests ---');
  for (const tc of TEST_QUERIES) {
    try {
      const start = Date.now();
      const result = await recallService.recall({
        tenantId: TEST_TENANT,
        userId: TEST_USER,
        query: tc.query,
        topK: 5,
      });
      const latency = Date.now() - start;

      console.log(`\n  Query: "${tc.query}"`);
      console.log(`  Intent: ${result.intent} | Cached: ${result.cached} | Latency: ${latency}ms | Results: ${result.memories.length}`);

      if (result.memories.length > 0) {
        for (const m of result.memories.slice(0, 3)) {
          const text = m._table === 'memories'
            ? `${m.entity}.${m.attribute} = ${(m.value||'').substring(0, 60)}`
            : (m.value || '').substring(0, 80);
          console.log(`    [${m._table}] score=${(m.score||0).toFixed(4)} sim=${(m.similarity||0).toFixed(4)} — ${text}`);
        }
      } else {
        console.log('    (no results)');
      }

      results.push({
        query: tc.query,
        intent: result.intent,
        cached: result.cached,
        latencyMs: latency,
        resultCount: result.memories.length,
        ok: true,
      });
    } catch (err) {
      console.log(`\n  Query: "${tc.query}" → ❌ FAIL: ${err.message}`);
      results.push({ query: tc.query, ok: false, error: err.message });
    }
  }

  // 3. 缓存命中测试
  console.log('\n--- 3. Cache Hit Test ---');
  try {
    const q = TEST_QUERIES[0].query;
    const r1 = await recallService.recall({ tenantId: TEST_TENANT, userId: TEST_USER, query: q, topK: 5 });
    console.log(`  Second call cached: ${r1.cached}`);
    if (r1.cached) console.log('  ✅ Cache hit confirmed');
    else console.log('  ⚠️ Cache miss on second call');
  } catch (err) {
    console.log(`  ❌ Cache test failed: ${err.message}`);
  }

  // 4. buildMemoryPrompt 测试
  console.log('\n--- 4. Memory Prompt Build ---');
  try {
    const r = await recallService.recall({ tenantId: TEST_TENANT, userId: TEST_USER, query: '记忆系统', topK: 3 });
    const prompt = buildMemoryPrompt(r.memories);
    console.log(`  Prompt length: ${prompt.length} chars`);
    console.log(`  Preview:\n${prompt.substring(0, 300)}`);
  } catch (err) {
    console.log(`  ❌ FAIL: ${err.message}`);
  }

  // 5. recall_logs 验证
  console.log('\n--- 5. Recall Logs ---');
  try {
    const r = await db.query('SELECT count(*) as c FROM recall_logs');
    console.log(`  ✅ recall_logs count: ${r.rows[0].c}`);
  } catch (err) {
    console.log(`  ❌ FAIL: ${err.message}`);
  }

  // Summary
  console.log('\n=== Recall Test Summary ===');
  const allOk = results.every(r => r.ok);
  const avgLatency = results.filter(r => r.latencyMs).reduce((s, r) => s + r.latencyMs, 0) / results.filter(r => r.latencyMs).length;
  console.log(`Total queries: ${results.length}`);
  console.log(`Avg latency: ${avgLatency.toFixed(0)}ms`);
  console.log(allOk ? '✅ All recall tests passed' : '⚠️ Some recall tests failed');

  await db.close();
  await redis.close();
  process.exit(allOk ? 0 : 1);
}

main().catch(err => { console.error('Recall test failed:', err); process.exit(1); });
