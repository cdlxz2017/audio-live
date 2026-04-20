#!/usr/bin/env node
/**
 * Three-Layer Memory Lookup
 * 通过 source_session_id + source_message_ids 追溯原始对话
 */

// Load pg from memory-system where it's installed
const { Pool } = require('/home/ai/.openclaw/workspace/memory-system/node_modules/pg');

const pool = new Pool({
  connectionString: 'postgresql://openclaw_ai:zyxrcy910128@localhost:5432/openclaw_memory',
});

async function lookupSummary(summaryId) {
  // 1. 查摘要
  const summaryRow = await pool.query(
    `SELECT id, summary, summary_type, source_session_id, source_message_ids, created_at
     FROM memory_summaries WHERE id = $1`,
    [summaryId]
  );

  if (summaryRow.rows.length === 0) {
    console.log(`❌ 未找到摘要 #${summaryId}`);
    return;
  }

  const summary = summaryRow.rows[0];
  const sessionId = summary.source_session_id;
  const msgIds = summary.source_message_ids || [];

  console.log(`\n${'='.repeat(70)}`);
  console.log(`【摘要 #${summary.id}】${summary.summary_type}`);
  console.log(`时间：${summary.created_at}`);
  console.log('='.repeat(70));
  console.log(summary.summary);
  console.log();

  // 2. 查触发消息
  if (msgIds.length > 0) {
    const triggerMsgs = await pool.query(
      `SELECT id, role, content, created_at
       FROM conversation_messages
       WHERE id = ANY($1)
       ORDER BY created_at`,
      [msgIds]
    );

    console.log(`【触发消息】共 ${triggerMsgs.rows.length} 条`);
    for (const msg of triggerMsgs.rows) {
      const preview = (msg.content || '').substring(0, 300);
      console.log(`  【${msg.id}】${msg.role} | ${msg.created_at}`);
      console.log(`  ${preview}${preview.length >= 300 ? '...' : ''}`);
      console.log();
    }
  }

  // 3. 查整个 session 的消息（最近20条）
  if (sessionId) {
    const sessionMsgs = await pool.query(
      `SELECT id, role, content, created_at
       FROM conversation_messages
       WHERE session_id = $1
       ORDER BY created_at
       LIMIT 20`,
      [sessionId]
    );

    console.log(`【会话 #${sessionId.substring(0, 8)}...】共 ${sessionMsgs.rows.length} 条（最近）`);
    for (const msg of sessionMsgs.rows) {
      const preview = (msg.content || '').substring(0, 120);
      console.log(`  【${msg.id}】${msg.role} | ${preview}${preview.length >= 120 ? '...' : ''}`);
    }
  }

  console.log(`\n${'='.repeat(70)}`);
  await pool.end();
}

// CLI 入口
const summaryId = process.argv[2];
if (!summaryId) {
  console.log('用法: node lookup.js <summary_id>');
  console.log('示例: node lookup.js 1710');
  process.exit(1);
}

lookupSummary(summaryId).catch(e => {
  console.error('❌ 错误:', e.message);
  process.exit(1);
});
