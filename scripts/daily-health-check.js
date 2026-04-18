#!/usr/bin/env node
/**
 * 每日系统健康检查脚本 (daily-health-check.js)
 * 替代旧的 comprehensive-health-check.js，按日/小时维度报告系统状态
 * 
 * 使用方式:
 *   node daily-health-check.js              # 执行一次检查并输出报告
 *   node daily-health-check.js --compact    # 紧凑输出（适合 cron email）
 *   node daily-health-check.js --watch      # 持续监控模式（每30秒一次）
 * 
 * Cron 设置 (推荐每日 09:00):
 *   0 9 * * * cd /home/ai/.openclaw/workspace && node scripts/daily-health-check.js --compact >> logs/daily-health.log 2>&1
 */

const { performance } = require('perf_hooks');
const { spawn, execSync: rawExecSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ============================================================
// 工具函数
// ============================================================

function execCmd(cmd, timeout = 30000) {
  return new Promise((resolve) => {
    const start = performance.now();
    const child = spawn('bash', ['-c', cmd], { timeout, shell: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);
    child.on('close', code => {
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim(), elapsed: Math.round(performance.now() - start) });
    });
    child.on('error', e => resolve({ code: -1, stdout: '', stderr: e.message, elapsed: Math.round(performance.now() - start) }));
  });
}

async function dbQuery(sql) {
  const { Pool } = require('/home/ai/.openclaw/workspace/memory-system/node_modules/pg');
  const pool = new Pool({ connectionString: 'postgresql://openclaw_ai:zyxrcy910128@localhost:5432/openclaw_memory', statement_timeout: 15000 });
  try {
    const r = await pool.query(sql);
    await pool.end();
    return r;
  } catch (e) {
    await pool.end().catch(() => {});
    throw e;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + 'MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + 'GB';
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h';
  return Math.floor(h / 24) + 'd';
}

function severity(cond) { return cond ? '🔴' : '✅'; }
function warn(cond) { return cond ? '🟡' : '✅'; }

// ============================================================
// 各模块检查
// ============================================================

async function checkPM2() {
  // 使用 execSync 避免 spawn 大输出缓冲问题
  let stdout;
  try { stdout = rawExecSync('pm2 jlist 2>/dev/null', { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }); } 
  catch { return { ok: false, error: 'pm2 jlist failed' }; }
  
  let procs;
  try { procs = JSON.parse(stdout.trim()); } catch { return { ok: false, error: 'pm2 JSON parse failed' }; }
  
  const CRITICAL_NAMES = [
    'bge-m3-keepalive', 'session-extractor',
    'graph-linker', 'graphify-opus-manager', 'hermes-server'
  ];
  
  const result = { ok: true, processes: {}, alerts: [] };
  for (const p of procs) {
    const name = p.name;
    const status = p.pm2_env?.status;
    const restarts = p.pm2_env?.restart_time || 0;
    const uptime = p.pm2_env?.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : 0;
    const mem = p.monit?.memory || 0;
    const online = status === 'online';
    
    result.processes[name] = { status, restarts, uptime, mem, online };
    
    if (CRITICAL_NAMES.includes(name)) {
      if (!online) result.alerts.push(`🔴 ${name} is ${status}`);
      else if (restarts > 5) result.alerts.push(`🟡 ${name} 重启 ${restarts} 次`);
    }
  }
  
  // 特殊检查：bge-m3-keepalive 重启次数
  if (result.processes['bge-m3-keepalive']) {
    const r_count = result.processes['bge-m3-keepalive'].restarts;
    if (r_count > 100) result.alerts.push(`🔴 bge-m3-keepalive 重启 ${r_count} 次（严重异常）`);
    else if (r_count > 10) result.alerts.push(`🟡 bge-m3-keepalive 重启 ${r_count} 次`);
  }
  
  return result;
}

async function checkDatabase() {
  const result = { ok: true, tables: {}, alerts: [] };
  
  try {
    const rows = await dbQuery(`
      SELECT 'memories' as tbl, count(*) as cnt FROM memories
      UNION ALL SELECT 'personal_memories', count(*) FROM personal_memories
      UNION ALL SELECT 'memory_summaries', count(*) FROM memory_summaries
      UNION ALL SELECT 'conversation_messages', count(*) FROM conversation_messages
      UNION ALL SELECT 'recall_logs', count(*) FROM recall_logs
    `);
    for (const row of rows.rows) result.tables[row.tbl] = parseInt(row.cnt);
    
    // 检查近1小时增量
    const hourAgo = await dbQuery(`SELECT now() - INTERVAL '1 hour' as ts`);
    const recentCM = await dbQuery(`SELECT count(*) as cnt FROM conversation_messages WHERE created_at > now() - INTERVAL '1 hour'`);
    const recentMS = await dbQuery(`SELECT count(*) as cnt FROM memory_summaries WHERE created_at > now() - INTERVAL '1 hour'`);
    
    result.tables['conversation_messages_1h'] = parseInt(recentCM.rows[0].cnt);
    result.tables['memory_summaries_1h'] = parseInt(recentMS.rows[0].cnt);
    
  } catch (e) {
    result.ok = false;
    result.error = e.message;
  }
  
  return result;
}

async function checkNeo4j() {
  const result = { ok: true, nodes: {}, alerts: [] };
  try {
    // 使用 execSync 避免 spawn 的引号转义问题
    const curlCmd = `curl -s -u neo4j:openclaw_neo4j_2026 http://localhost:7474/db/neo4j/tx/commit -H 'Content-Type: application/json' -d '{"statements":[{"statement":"MATCH (n) RETURN labels(n)[0] as label, count(*) as cnt ORDER BY cnt DESC LIMIT 15"}]}'`;
    let stdout;
    try { stdout = rawExecSync(curlCmd, { encoding: 'utf8', timeout: 15000 }); } 
    catch (e) { result.ok = false; result.error = e.message; return result; }
    
    let data;
    try { data = JSON.parse(stdout.trim()); } catch { result.ok = false; result.error = 'neo4j JSON parse failed'; return result; }
    
    if (data.results?.[0]?.rows) {
      for (const row of data.results[0].rows) {
        result.nodes[row.label] = row.cnt;
      }
    }
    
    // 关键节点检查
    const THRESHOLD = { GraphifyCode: 50000, PersonalMemory: 1000 };
    if (result.nodes.GraphifyCode < THRESHOLD.GraphifyCode) result.alerts.push(`🟡 GraphifyCode 节点 ${result.nodes.GraphifyCode}（低于预期 ${THRESHOLD.GraphifyCode}）`);
    if (result.nodes.PersonalMemory < THRESHOLD.PersonalMemory) result.alerts.push(`🟡 PersonalMemory 节点 ${result.nodes.PersonalMemory}（低于预期 ${THRESHOLD.PersonalMemory}）`);
    
  } catch (e) {
    result.ok = false;
    result.error = e.message;
  }
  return result;
}

async function checkRedis() {
  const result = { ok: true, info: {}, alerts: [] };
  try {
    const { Redis } = require('/home/ai/.openclaw/workspace/memory-system/node_modules/ioredis');
    const client = new Redis({ host: 'localhost', port: 6379, lazyConnect: true, connectTimeout: 8000 });
    await client.connect();
    
    const info = await client.info('memory');
    const memLine = info.split('\n').find(l => l.startsWith('used_memory_human'));
    const mem = memLine ? memLine.split(':')[1].trim() : 'unknown';
    
    // ioredis 没有 dbSize() 方法，用 INFO keyspace 代替
    let dbSize = '?';
    try {
      const ksInfo = await client.info('keyspace');
      const dbLine = ksInfo.split('\n').find(l => l.startsWith('db0'));
      if (dbLine) {
        const match = dbLine.match(/keys=(\d+)/);
        dbSize = match ? parseInt(match[1]) : '?';
      }
    } catch { /* ignore */ }
    
    const graphSyncLen = await client.xlen('graph:sync').catch(() => 0);
    
    result.info = { mem, graphSyncLen, dbSize };
    
    if (graphSyncLen > 10000) result.alerts.push(`🟡 Redis graph:sync 队列积压 ${graphSyncLen} 条`);
    if (graphSyncLen > 50000) result.alerts.push(`🔴 Redis graph:sync 队列严重积压 ${graphSyncLen} 条`);
    
    await client.quit();
  } catch (e) {
    result.ok = false;
    result.error = e.message;
  }
  return result;
}

async function checkOllama() {
  const result = { ok: true, models: [], alerts: [] };
  try {
    let stdout;
    try { stdout = rawExecSync('curl -s http://localhost:11434/api/tags', { encoding: 'utf8', timeout: 10000 }); }
    catch (e) { result.ok = false; result.error = e.message; return result; }
    
    let data;
    try { data = JSON.parse(stdout.trim()); } catch { result.ok = false; result.error = 'ollama JSON parse failed'; return result; }
    
    result.models = (data.models || []).map(m => ({ name: m.name, size: m.size || 0, modified: m.modified_at }));
    
    const hasBgeM3 = result.models.some(m => m.name === 'bge-m3:latest');
    if (!hasBgeM3) result.alerts.push('🔴 bge-m3:latest 模型缺失');
    
  } catch (e) {
    result.ok = false;
    result.error = e.message;
  }
  return result;
}

async function checkDisk() {
  const result = { ok: true, mounts: [], alerts: [] };
  try {
    const r = await execCmd("df -h | grep -E '^/dev' | awk '{print $1,$2,$3,$4,$5,$6}'");
    if (r.code !== 0) { result.ok = false; return result; }
    
    for (const line of r.stdout.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) continue;
      const [fs, size, used, avail, pct, mount] = parts;
      result.mounts.push({ fs, size, used, avail, pct: pct.replace('%', ''), mount });
      if (parseInt(pct) > 85) result.alerts.push(`🟡 ${mount} 使用率 ${pct}`);
      if (parseInt(pct) > 95) result.alerts.push(`🔴 ${mount} 使用率 ${pct}（紧急）`);
    }
  } catch (e) {
    result.ok = false;
    result.error = e.message;
  }
  return result;
}

async function checkRecall() {
  const result = { ok: true, intents: {}, alerts: [] };
  try {
    const config = require('/home/ai/.openclaw/workspace/memory-system/scripts/config.js');
    const ic = config.intentConfig || {};
    const intentList = ['DEFAULT', 'REASONING', 'TECHNICAL', 'FACTUAL', 'PREFERENCE', 'EVENT', 'PERSON', 'PROJECT'];
    for (const intent of intentList) {
      if (ic[intent]) result.intents[intent] = { tier: ic[intent].tier || '?' };
    }
    
    const defaultTier = ic.DEFAULT?.tier;
    if (defaultTier === 1) result.alerts.push('🟡 recall DEFAULT tier=1，会截断到60字符');
    if (defaultTier !== 2) result.alerts.push(`🟡 recall DEFAULT tier=${defaultTier}（推荐 tier=2）`);
    
    for (const [intent, cfg] of Object.entries(ic)) {
      if (intent === 'REASONING') continue;
      if (cfg.tier === 1) result.alerts.push(`🟡 recall ${intent} tier=1（建议改为 tier=2）`);
    }
  } catch (e) {
    result.ok = false;
    result.error = e.message;
  }
  return result;
}

async function checkCronJobs() {
  // 系统 crontab 可能为空（OpenClaw cron 由 gateway 管理），只检查有效行
  try {
    const out = rawExecSync('crontab -l 2>/dev/null | grep -v "^#" | grep -v "^$"', { encoding: 'utf8' });
    return { ok: true, jobs: out.split('\n').filter(l => l.trim()) };
  } catch {
    return { ok: true, jobs: [], note: 'system crontab empty (OpenClaw cron via gateway)' };
  }
}

// ============================================================
// 主检查流程
// ============================================================

async function runAllChecks() {
  const start = performance.now();
  const results = {};
  const allAlerts = [];
  
  console.log('🔍 开始系统健康检查...\n');
  
  const checks = [
    ['PM2进程', checkPM2],
    ['数据库', checkDatabase],
    ['Neo4j图数据库', checkNeo4j],
    ['Redis', checkRedis],
    ['Ollama', checkOllama],
    ['磁盘空间', checkDisk],
    ['Recall配置', checkRecall],
    ['Crontab', checkCronJobs],
  ];
  
  for (const [name, fn] of checks) {
    process.stdout.write(`  检查 ${name}... `);
    try {
      const r = await fn();
      results[name] = r;
      if (r.alerts) allAlerts.push(...r.alerts.map(a => `[${name}] ${a}`));
      console.log(r.ok ? '✅' : `❌ (${r.error || 'failed'})`);
    } catch (e) {
      results[name] = { ok: false, error: e.message };
      console.log(`❌ ${e.message}`);
    }
  }
  
  const elapsed = Math.round(performance.now() - start);
  return { results, allAlerts, elapsed };
}

// ============================================================
// 报告生成
// ============================================================

function generateReport(data, compact = false) {
  const { results, allAlerts, elapsed } = data;
  const lines = [];
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  
  lines.push(`═══════════════════════════════════════════════════════`);
  lines.push(`  📋 每日系统健康检查报告  ${now}`);
  lines.push(`═══════════════════════════════════════════════════════`);
  lines.push(``);
  
  // 告警汇总
  if (allAlerts.length > 0) {
    lines.push(`🚨 告警 (${allAlerts.length} 项):`);
    for (const a of allAlerts) lines.push(`  ${a}`);
    lines.push(``);
  } else {
    lines.push(`✅ 系统状态正常`);
    lines.push(``);
  }
  
  // PM2 进程
  if (results['PM2进程']?.ok && results['PM2进程']?.processes) {
    lines.push(`【PM2 进程】`);
    const CRITICAL = ['bge-m3-keepalive', 'session-extractor', 'session-summary-extractor', 'graph-linker', 'graphify-opus-manager', 'hermes-server', 'hermes-web', 'outbox-writer'];
    for (const [name, p] of Object.entries(results['PM2进程'].processes)) {
      if (!CRITICAL.includes(name)) continue;
      const s = severity(!p.online);
      const memStr = formatBytes(p.mem || 0);
      const upStr = formatUptime(p.uptime || 0);
      lines.push(`  ${s} ${name.padEnd(28)} ${p.status.padEnd(8)} 内存:${memStr.padEnd(10)} 运行:${upStr.padEnd(8)} 重启:${p.restarts}`);
    }
    lines.push(``);
  }
  
  // 数据库
  if (results['数据库']?.ok) {
    lines.push(`【数据库表统计】`);
    const t = results['数据库'].tables;
    lines.push(`  ✅ memories:                  ${(t.memories || 0).toLocaleString()} 条`);
    lines.push(`  ✅ personal_memories:         ${(t.personal_memories || 0).toLocaleString()} 条`);
    lines.push(`  ✅ memory_summaries:          ${(t.memory_summaries || 0).toLocaleString()} 条`);
    lines.push(`  ✅ conversation_messages:     ${(t.conversation_messages || 0).toLocaleString()} 条  (近1h: +${t.conversation_messages_1h || 0})`);
    lines.push(`  ✅ recall_logs:               ${(t.recall_logs || 0).toLocaleString()} 条`);
    lines.push(``);
  }
  
  // Neo4j
  if (results['Neo4j图数据库']?.ok) {
    lines.push(`【Neo4j 图数据库】`);
    const n = results['Neo4j图数据库'].nodes;
    const important = ['GraphifyCode', 'PersonalMemory', 'Memory_default', 'Memory_00000000000000000000000000000000'];
    for (const k of important) {
      if (n[k] !== undefined) lines.push(`  ${severity(n[k] === 0)} ${k.padEnd(50)} ${(n[k] || 0).toLocaleString()} 节点`);
    }
    lines.push(``);
  }
  
  // Redis
  if (results['Redis']?.ok) {
    const ri = results['Redis'].info;
    lines.push(`【Redis】`);
    lines.push(`  内存使用: ${ri.mem || '?'}`);
    lines.push(`  graph:sync 队列: ${ri.graphSyncLen || 0} 条`);
    lines.push(`  DB size: ${ri.dbSize || 0}`);
    lines.push(``);
  }
  
  // Ollama
  if (results['Ollama']?.ok) {
    lines.push(`【Ollama 模型】`);
    for (const m of results['Ollama'].models) {
      const sizeGB = m.size ? (m.size / 1024 / 1024 / 1024).toFixed(1) + 'GB' : '?';
      lines.push(`  ${severity(!m.name.includes('bge-m3'))} ${m.name.padEnd(40)} ${sizeGB}`);
    }
    lines.push(``);
  }
  
  // 磁盘
  if (results['磁盘空间']?.ok && results['磁盘空间'].mounts) {
    lines.push(`【磁盘空间】`);
    for (const m of results['磁盘空间'].mounts) {
      if (parseInt(m.pct) > 80) lines.push(`  ${warn(parseInt(m.pct) > 90)} ${m.mount.padEnd(20)} ${m.used}/${m.size} (${m.pct}%)`);
    }
    lines.push(``);
  }
  
  // Recall配置
  if (results['Recall配置']?.ok) {
    const ri = results['Recall配置'].intents;
    lines.push(`【Recall Intent Tier 配置】`);
    const tierIcon = (t) => t === 2 ? '✅' : t === 1 ? '🟡' : '❓';
    for (const [intent, cfg] of Object.entries(ri)) {
      lines.push(`  ${tierIcon(cfg.tier)} ${intent.padEnd(12)} tier=${cfg.tier}`);
    }
    lines.push(``);
  }
  
  // Cron 任务
  if (results['Crontab']?.ok) {
    lines.push(`【活跃 Cron 任务】`);
    for (const j of results['Crontab'].jobs) {
      lines.push(`  ${j}`);
    }
    lines.push(``);
  }
  
  lines.push(`═══════════════════════════════════════════════════════`);
  lines.push(`  检查完成，耗时 ${elapsed}ms`);
  lines.push(`═══════════════════════════════════════════════════════`);
  
  return lines.join('\n');
}

function generateCompactReport(data) {
  const { results, allAlerts, elapsed } = data;
  const t = results['数据库']?.tables || {};
  const n = results['Neo4j图数据库']?.nodes || {};
  const ri = results['Redis']?.info || {};
  const bgeRestarts = results['PM2进程']?.processes?.['bge-m3-keepalive']?.restarts || 0;
  const sessRestarts = results['PM2进程']?.processes?.['session-summary-extractor']?.restarts || 0;
  
  const parts = [];
  parts.push(`[${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}]`);
  parts.push(`DB: cm=${t.conversation_messages||0} ms=${t.memory_summaries||0} pm=${t.personal_memories||0}`);
  parts.push(`Neo4j: GC=${n.GraphifyCode||0} PM=${n.PersonalMemory||0}`);
  parts.push(`Redis: gs=${ri.graphSyncLen||0}`);
  parts.push(`Restarts: bge=${bgeRestarts} sess=${sessRestarts}`);
  if (allAlerts.length > 0) parts.push(`ALERTS: ${allAlerts.length}`);
  parts.push(`(${elapsed}ms)`);
  
  return parts.join(' | ');
}

// ============================================================
// 入口
// ============================================================

(async () => {
  const args = process.argv.slice(2);
  const compact = args.includes('--compact');
  const watch = args.includes('--watch');
  
  if (watch) {
    console.log('👁 监控模式 (Ctrl+C 退出)，每30秒检查一次...\n');
    let count = 0;
    while (true) {
      count++;
      process.stdout.write(`\n[${count}] ${new Date().toLocaleTimeString('zh-CN')}\n`);
      const data = await runAllChecks();
      console.log(generateCompactReport(data));
      await new Promise(r => setTimeout(r, 30000));
    }
  } else {
    const data = await runAllChecks();
    const report = compact ? generateCompactReport(data) : generateReport(data);
    console.log('\n' + report);
    
    // 保存到日志文件
    const logDir = '/home/ai/.openclaw/workspace/logs';
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, `daily-health-${Date.now()}.log`);
    fs.writeFileSync(logFile, report);
    console.log(`\n📁 报告已保存: ${logFile}`);
    
    // 检查发现问题写入警报文件
    if (data.allAlerts.length > 0) {
      const alertFile = path.join(logDir, 'daily-health-alerts.latest');
      fs.writeFileSync(alertFile, data.allAlerts.join('\n'));
    }
  }
})();
