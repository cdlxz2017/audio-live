/**
 * main-recall-report.js — 主脑召回监控报告生成器
 * 用法: node main-recall-report.js [5 minutes|15 minutes|1 hour|1 day]
 */
'use strict';

const Database = require('better-sqlite3');
const DB_PATH = '/home/ai/.openclaw/audit/main_recall_audit.db';
const VALID_INTERVALS = ['5 minutes', '15 minutes', '1 hour', '1 day', '7 days'];
const since = VALID_INTERVALS.includes(process.argv[2]) ? process.argv[2] : '5 minutes';
const ALERT_LATENCY_MS = 500;

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

// 7天自动清理
db.prepare("DELETE FROM recall_audit_detail WHERE ts < datetime('now', '-7 days')").run();

const rows = db.prepare(`
  SELECT id, ts, session_id, sender_id, query_text, intent, latency_ms,
         memory_id, memory_source, score, memory_summary
  FROM recall_audit_detail
  WHERE ts > datetime('now', '-${since}')
  ORDER BY ts DESC
`).all();

if (rows.length === 0) {
  console.log(`[${new Date().toISOString()}] 主脑召回监控（近${since}）：无召回记录`);
  db.close();
  return;
}

// 按 session 聚合
const bySession = {};
const byIntent = {};
const topMemories = {};
let totalLatency = 0;

for (const r of rows) {
  const sid = r.session_id || 'null';
  bySession[sid] = bySession[sid] || { count: 0, intents: {}, memories: new Set(), totalLat: 0 };
  bySession[sid].count++;
  bySession[sid].totalLat += r.latency_ms;
  bySession[sid].intents[r.intent] = (bySession[sid].intents[r.intent] || 0) + 1;
  bySession[sid].memories.add(r.memory_id);

  byIntent[r.intent] = byIntent[r.intent] || { count: 0, totalLat: 0 };
  byIntent[r.intent].count++;
  byIntent[r.intent].totalLat += r.latency_ms;

  const key = `${r.memory_id}|${r.memory_source}`;
  topMemories[key] = topMemories[key] || { memory_id: r.memory_id, source: r.memory_source, count: 0, summary: r.memory_summary };
  topMemories[key].count++;

  totalLatency += r.latency_ms;
}

const sessions = Object.keys(bySession);
const avgLat = Math.round(totalLatency / rows.length);

// P99
const latencies = rows.map(r => r.latency_ms).sort((a, b) => a - b);
const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;

console.log(`\n=== 主脑召回监控报告（近${since}）==`);
console.log(`生成时间: ${new Date().toISOString()}`);
console.log(`总召回条次: ${rows.length} | Session数: ${sessions.length}`);
console.log(`平均延迟: ${avgLat}ms | P99: ${p99}ms${p99 > ALERT_LATENCY_MS ? ' ⚠️' : ''}`);
console.log('');
console.log('【各Intent召回统计】');
for (const [intent, v] of Object.entries(byIntent)) {
  console.log(`  ${intent}: ${v.count}条 | 平均延迟: ${Math.round(v.totalLat / v.count)}ms`);
}
console.log('');
console.log('【Top召回记忆（提成参考）】');
const sortedMemories = Object.values(topMemories).sort((a, b) => b.count - a.count).slice(0, 10);
for (const m of sortedMemories) {
  const shortSummary = m.summary ? m.summary.slice(0, 40) : '(无摘要)';
  console.log(`  ID=${m.memory_id} [${m.source}] 被召回${m.count}次 | ${shortSummary}`);
}
console.log('');
console.log('【各Session召回明细】');
for (const [sid, v] of Object.entries(bySession)) {
  const shortSid = sid.length > 8 ? sid.slice(0, 8) + '...' : sid;
  const intents = Object.entries(v.intents).map(([k, c]) => `${k}(${c})`).join(', ');
  console.log(`  ${shortSid}: ${v.count}条 | ${intents} | ${v.memories.size}条不同记忆`);
}

if (p99 > ALERT_LATENCY_MS) {
  console.log(`\n⚠️ 告警: P99延迟 ${p99}ms > ${ALERT_LATENCY_MS}ms`);
}

db.close();
