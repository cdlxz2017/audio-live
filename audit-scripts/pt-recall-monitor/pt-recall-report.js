/**
 * pt-recall-report.js — 副脑召回监控报告生成器
 * 用法: node pt-recall-report.js [5 minutes|15 minutes|1 hour|1 day|7 days]
 *
 * P1 fix: since 参数白名单校验，防 SQL 注入
 * P2 fix: 不用 AFTER INSERT trigger，改用 cron 清理（避免每次写入额外扫描）
 */
'use strict';

const Database = require('better-sqlite3');

const DB_PATH = '/home/ai/.openclaw/audit/pt_recall_audit.db';
const VALID_INTERVALS = ['5 minutes', '15 minutes', '1 hour', '1 day', '7 days'];
const since = VALID_INTERVALS.includes(process.argv[2]) ? process.argv[2] : '5 minutes';
const ALERT_LATENCY_MS = 500;

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

function cleanup() {
  // 7天自动清理（不使用 trigger，改为每次报告顺带清理一次）
  const deleted = db.prepare(
    "DELETE FROM pt_recall_audit WHERE ts < datetime('now', '-7 days')"
  ).run();
  if (deleted.changes > 0) {
    console.log(`[pt-audit] cleanup: removed ${deleted.changes} old records`);
  }
}

function generateReport() {
  const rows = db.prepare(`
    SELECT source, method, path, query, status, latency_ms, result_count, thread_ids, ts
    FROM pt_recall_audit
    WHERE ts > datetime('now', '-${since}')
    ORDER BY ts DESC
  `).all();

  const now = new Date().toISOString();

  if (rows.length === 0) {
    console.log(`[${now}] 副脑召回监控报告（近${since}）：无召回记录`);
    cleanup();
    db.close();
    return;
  }

  // 聚合统计
  const bySource = {};
  const bySourceAndQuery = {};
  const slowQueries = [];

  for (const r of rows) {
    bySource[r.source] = bySource[r.source] || { count: 0, totalLatency: 0 };
    bySource[r.source].count++;
    bySource[r.source].totalLatency += r.latency_ms;

    if (r.latency_ms > ALERT_LATENCY_MS) {
      slowQueries.push(r);
    }

    if (r.query) {
      const key = `${r.source}:${r.query}`;
      if (!bySourceAndQuery[key]) {
        bySourceAndQuery[key] = { query: r.query, source: r.source, count: 0, threadIds: new Set() };
      }
      bySourceAndQuery[key].count++;
      try {
        const ids = JSON.parse(r.thread_ids || '[]');
        ids.forEach(id => bySourceAndQuery[key].threadIds.add(id));
      } catch {}
    }
  }

  // 计算 P99
  const sortedLatencies = rows.map(r => r.latency_ms).sort((a, b) => a - b);
  const p99Idx = Math.floor(sortedLatencies.length * 0.99);
  const p99 = sortedLatencies[p99Idx] || 0;

  console.log(`\n=== 副脑召回监控报告（近${since}）===`);
  console.log(`生成时间: ${now}`);
  console.log(`总召回次数: ${rows.length}`);
  console.log(`P99 延迟:   ${p99}ms${p99 > ALERT_LATENCY_MS ? ' ⚠️' : ''}`);
  console.log('');
  console.log('【各店召回统计】');
  for (const [src, s] of Object.entries(bySource)) {
    const avgLat = Math.round(s.totalLatency / s.count);
    const flag = avgLat > ALERT_LATENCY_MS ? ' ⚠️' : '';
    console.log(`  ${src}: ${s.count}次 | 平均延迟: ${avgLat}ms${flag}`);
  }
  console.log('');
  console.log('【具体召回明细】');
  for (const [key, v] of Object.entries(bySourceAndQuery)) {
    const threads = [...v.threadIds];
    const shortIds = threads.length <= 3
      ? threads.join(', ')
      : threads.slice(0, 3).join(', ') + ` (+${threads.length - 3})`;
    console.log(`  [${v.source}] q="${v.query}" → ${v.count}次, 召回线程: ${shortIds}`);
  }

  if (slowQueries.length > 0) {
    console.log('');
    console.log(`⚠️ 告警: ${slowQueries.length} 次召回延迟 > ${ALERT_LATENCY_MS}ms`);
  }

  // 顺便清理
  cleanup();
}

generateReport();
db.close();
