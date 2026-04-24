#!/usr/bin/env node
/**
 * 写入链路测试 — 真实数据写入 memories / memory_summaries / personal_memories
 */
const db = require('../src/db');
const redis = require('../src/redis');
const { memoryWriter } = require('../src/memory-writer');
const { writeMessage } = require('../src/session-capture-hook');

const TEST_TENANT = '65f9b737-c46c-400d-90f0-4f42aab15732';
const TEST_USER = '65f9b737-c46c-400d-90f0-4f42aab15733';
const TEST_SESSION = '65f9b737-c46c-400d-90f0-4f42aab15734';

async function main() {
  console.log('=== Write Chain Test ===\n');
  const results = {};

  // 1. 写入 conversation_messages
  console.log('--- 1. conversation_messages ---');
  try {
    const msgId1 = await writeMessage({
      sessionId: TEST_SESSION,
      role: 'user',
      content: '记忆系统重建完成后，需要测试写入链路是否正常工作',
      channel: 'test',
      metadata: { source: 'test-write' },
    });
    const msgId2 = await writeMessage({
      sessionId: TEST_SESSION,
      role: 'assistant',
      content: '好的，我来帮你测试写入链路。首先检查 PostgreSQL 连接，然后测试 embedding 生成和向量写入。',
      channel: 'test',
      metadata: { source: 'test-write' },
    });
    results.conversation_messages = { ok: true, ids: [msgId1, msgId2] };
    console.log(`✅ Written: user msg=${msgId1}, assistant msg=${msgId2}`);
  } catch (err) {
    results.conversation_messages = { ok: false, error: err.message };
    console.log(`❌ FAIL: ${err.message}`);
  }

  // 2. 写入 memories
  console.log('\n--- 2. memories ---');
  try {
    const memId = await memoryWriter.writeMemory({
      tenantId: TEST_TENANT,
      userId: TEST_USER,
      sessionId: TEST_SESSION,
      messageIndex: 1,
      entity: '记忆系统',
      attribute: '状态',
      value: '重建完成，写入链路测试通过',
      memoryType: 'factual',
      rawText: '记忆系统重建完成后，写入链路测试通过',
      confidence: 0.9,
      source: 'test',
    });
    results.memories = { ok: true, id: memId };
    console.log(`✅ Written: memory id=${memId}`);
  } catch (err) {
    results.memories = { ok: false, error: err.message };
    console.log(`❌ FAIL: ${err.message}`);
  }

  // 3. 写入 memory_summaries
  console.log('\n--- 3. memory_summaries ---');
  try {
    const sumId = await memoryWriter.writeSummary({
      summary: '用户在 2026-04-21 进行了记忆系统重建，包括 PostgreSQL 表结构重建、HNSW 索引创建、BGE-m3 向量嵌入测试。所有写入链路测试通过。',
      summaryType: 'session_summary',
      sourceSessionId: TEST_SESSION,
      sourceMessageIds: [1, 2],
      confidence: 0.85,
      metadata: { test: true },
    });
    results.memory_summaries = { ok: true, id: sumId };
    console.log(`✅ Written: summary id=${sumId}`);
  } catch (err) {
    results.memory_summaries = { ok: false, error: err.message };
    console.log(`❌ FAIL: ${err.message}`);
  }

  // 4. 写入 personal_memories
  console.log('\n--- 4. personal_memories ---');
  try {
    const pmId = await memoryWriter.writePersonal({
      content: '主脑 PostgreSQL 在 2026-04-21 05:30 被初始化为空壳，导致记忆数据全部丢失。副脑 Problem Thread 数据完整未受影响。需要重建记忆链路系统。',
      category: 'system_event',
      insightType: 'incident',
      originSessionId: TEST_SESSION,
      confidence: 0.95,
      metadata: { event: 'db_reset', date: '2026-04-21' },
    });
    results.personal_memories = { ok: true, id: pmId };
    console.log(`✅ Written: personal memory id=${pmId}`);
  } catch (err) {
    results.personal_memories = { ok: false, error: err.message };
    console.log(`❌ FAIL: ${err.message}`);
  }

  // 5. 验证 Redis Stream 事件
  console.log('\n--- 5. Redis Stream ---');
  try {
    const len = await redis.xlen('graph:sync:events');
    results.redis_stream = { ok: true, graphSyncLength: len };
    console.log(`✅ graph:sync:events length=${len}`);
  } catch (err) {
    results.redis_stream = { ok: false, error: err.message };
    console.log(`❌ FAIL: ${err.message}`);
  }

  // 6. 验证数据库行数
  console.log('\n--- 6. Verification ---');
  try {
    const counts = {};
    for (const t of ['memories', 'memory_summaries', 'personal_memories', 'conversation_messages']) {
      const r = await db.query(`SELECT count(*) as c FROM ${t}`);
      counts[t] = parseInt(r.rows[0].c);
    }
    results.verification = { ok: true, counts };
    console.log(`✅ Row counts: ${JSON.stringify(counts)}`);
  } catch (err) {
    results.verification = { ok: false, error: err.message };
    console.log(`❌ FAIL: ${err.message}`);
  }

  // Summary
  console.log('\n=== Write Test Summary ===');
  const allOk = Object.values(results).every(r => r.ok);
  console.log(allOk ? '✅ All write tests passed' : '⚠️ Some write tests failed');
  console.log(JSON.stringify(results, null, 2));

  await db.close();
  await redis.close();
  process.exit(allOk ? 0 : 1);
}

main().catch(err => { console.error('Write test failed:', err); process.exit(1); });
