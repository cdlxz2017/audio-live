#!/usr/bin/env node
/**
 * Recall System 健康检查脚本
 * 每 4 小时检查一次，发送邮件报告
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ─── 复用 memory-system 的 db 模块 ────────────────────────
const db = require('/home/ai/.openclaw/workspace/memory-system/scripts/db');

async function getRecallStats() {
  const pool = db.getPool();
  const client = await pool.connect();
  try {
    // 4 小时内调用统计
    const stats = await client.query(`
      SELECT 
        COUNT(*)::int as total_calls,
        AVG(latency_ms)::int as avg_latency_ms,
        MAX(latency_ms)::int as max_latency_ms,
        MIN(latency_ms)::int as min_latency_ms
      FROM recall_logs 
      WHERE created_at > NOW() - INTERVAL '4 hours'
    `);

    // 按意图分布
    const byIntent = await client.query(`
      SELECT 
        COALESCE(intent, 'null') as intent,
        COUNT(*)::int as count
      FROM recall_logs 
      WHERE created_at > NOW() - INTERVAL '4 hours'
      GROUP BY intent
      ORDER BY count DESC
      LIMIT 10
    `);

    // 最近的错误
    const errors = await client.query(`
      SELECT id, intent, latency_ms, created_at
      FROM recall_logs 
      WHERE created_at > NOW() - INTERVAL '4 hours'
        AND latency_ms > 200
      ORDER BY latency_ms DESC
      LIMIT 5
    `);

    return {
      stats: stats.rows[0] || { total_calls: 0, avg_latency_ms: 0, max_latency_ms: 0, min_latency_ms: 0 },
      byIntent: byIntent.rows,
      errors: errors.rows,
    };
  } finally {
    client.release();
  }
}

function getPm2Status() {
  try {
    const out = execSync('pm2 list --no-color 2>/dev/null', { encoding: 'utf8', timeout: 10000 });
    const lines = out.split('\n').filter(l => 
      l.includes('session-extractor') || 
      l.includes('graph-linker') || 
      l.includes('summary-extractor') ||
      l.includes('memory-recall')
    );
    return lines.join('\n') || 'No memory-system processes found';
  } catch (err) {
    return `PM2 check failed: ${err.message}`;
  }
}

function getRecentLogs() {
  try {
    const logFile = '/tmp/openclaw/openclaw-2026-04-10.log';
    if (!fs.existsSync(logFile)) return 'Log file not found';
    
    const content = execSync(`tail -100 "${logFile}" 2>/dev/null`, { encoding: 'utf8', timeout: 5000 });
    
    const lines = content.split('\n').filter(l => 
      l.includes('memory-recall') || 
      l.includes('before_prompt_build') ||
      l.includes('before_dispatch')
    );
    
    return lines.slice(-20).join('\n') || 'No relevant logs';
  } catch (err) {
    return `Log check failed: ${err.message}`;
  }
}

async function main() {
  console.log('[Recall Monitor] Starting check...');
  
  let stats = { stats: { total_calls: 0, avg_latency_ms: 0, max_latency_ms: 0, min_latency_ms: 0 }, byIntent: [], errors: [] };
  let pm2Status = '';
  let recentLogs = '';
  
  try {
    stats = await getRecallStats();
  } catch (err) {
    console.error('[Recall Monitor] DB query failed:', err.message);
  }
  
  try {
    pm2Status = getPm2Status();
  } catch (err) {
    pm2Status = `PM2 failed: ${err.message}`;
  }
  
  try {
    recentLogs = getRecentLogs();
  } catch (err) {
    recentLogs = `Log failed: ${err.message}`;
  }
  
  // ─── 构建邮件内容 ────────────────────────────────────────
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const s = stats.stats;
  
  const latencyClass = s.avg_latency_ms < 100 ? '✅ 良好' : 
                        s.avg_latency_ms < 200 ? '⚠️ 一般' : '❌ 需关注';
  
  const intentRows = stats.byIntent.map(r => 
    `  - ${r.intent}: ${r.count} 次`
  ).join('\n') || '  无数据';

  const errorRows = stats.errors.map(r => 
    `  - 延迟 ${r.latency_ms}ms (${r.intent || 'null'}) @ ${r.created_at}`
  ).join('\n') || '  无高延迟记录';

  const body = `
[Recall System] 健康检查报告
时间: ${now}
周期: 最近 4 小时

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 召回统计
━━━━━━━━━━━━━━━━━━━━━━━━━━━
  总调用次数: ${s.total_calls} 次
  平均延迟: ${s.avg_latency_ms} ms ${latencyClass}
  最大延迟: ${s.max_latency_ms} ms
  最小延迟: ${s.min_latency_ms} ms

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 按意图分布
━━━━━━━━━━━━━━━━━━━━━━━━━━━
${intentRows}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ 高延迟记录 (>200ms)
━━━━━━━━━━━━━━━━━━━━━━━━━━━
${errorRows}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔧 PM2 进程状态
━━━━━━━━━━━━━━━━━━━━━━━━━━━
${pm2Status}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 最近日志 (memory-recall 相关)
━━━━━━━━━━━━━━━━━━━━━━━━━━━
${(recentLogs.slice(-500))}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

  // ─── 发送邮件 ───────────────────────────────────────────
  const sendEmailPath = '/home/ai/.openclaw/workspace/custom-skills/send-email/scripts/send-email.py';
  const emailSubject = `[Recall System] 健康检查报告 ${now}`;
  
  return new Promise((resolve) => {
    const py = spawn('python3', [
      sendEmailPath,
      '--to', 'cdlxz2017@qq.com',
      '--subject', emailSubject,
      '--body', body,
      '--html'
    ], { stdio: 'pipe' });
    
    let stderr = '';
    py.stderr.on('data', (d) => { stderr += d.toString(); });
    
    py.on('close', (code) => {
      if (code === 0) {
        console.log('[Recall Monitor] ✅ Report sent successfully');
        console.log(body);
      } else {
        console.error('[Recall Monitor] ❌ Email send failed:', stderr);
      }
      resolve();
    });
    
    py.on('error', (err) => {
      console.error('[Recall Monitor] ❌ Email send error:', err.message);
      resolve();
    });
  });
}

main().catch(err => {
  console.error('[Recall Monitor] Fatal error:', err);
  process.exit(1);
});
