#!/usr/bin/env node
/**
 * 每日系统健康检查脚本 (daily-health-check.js)
 *
 * 检查范围（基于真实系统状态 2026-04-19）：
 *   - PM2 进程（17个，含 Tiandao / Hermes / Cowrie / AudioStream）
 *   - 数据库（PostgreSQL + pgvector）
 *   - Neo4j 图数据库
 *   - Redis Streams（graph:sync:events / memory:messages）
 *   - Ollama + bge-m3 向量模型
 *   - Tiandao 微服务（member/auth/karma/admin-app/worldevent）
 *   - 蜜罐系统（Cowrie systemd + cowrie-tianxing PM2）
 *   - 磁盘空间
 *   - 记忆链路完整性（memory-integrity-check）
 *   - Outbox 失败率（memory_outbox failed 检测）
 *   - Recall Tier 配置（TECHNICAL/PROJECT 应为 tier=1，其余 tier=2）
 *
 * 使用方式:
 *   node scripts/daily-health-check.js              # 完整报告
 *   node scripts/daily-health-check.js --compact    # 紧凑输出
 */

const { performance } = require('perf_hooks');
const { spawn, execSync: rawExecSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── 工具函数 ───────────────────────────────────────────────

function execCmd(cmd, timeout = 30000) {
  return new Promise((resolve) => {
    const start = performance.now();
    const child = spawn('bash', ['-c', cmd], { timeout, shell: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);
    child.on('close', code => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim(), elapsed: Math.round(performance.now() - start) }));
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

// ─── PM2 进程检查 ───────────────────────────────────────

async function checkPM2() {
  let stdout;
  try { stdout = rawExecSync('pm2 jlist 2>/dev/null', { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }); }
  catch { return { ok: false, error: 'pm2 jlist failed' }; }

  let procs;
  try { procs = JSON.parse(stdout.trim()); } catch { return { ok: false, error: 'pm2 JSON parse failed' }; }

  // 所有进程（按功能分组）
  const GROUPS = {
    '核心记忆': ['session-extractor', 'session-summary-extractor', 'outbox-writer', 'graph-linker'],
    '向量模型': ['bge-m3-keepalive'],
    'Graphify': ['graphify-opus-manager'],
    'Hermes玄一': ['hermes-server', 'hermes-web'],
    'Tiandao民宿': ['tiandao-member', 'tiandao-auth', 'tiandao-karma', 'tiandao-admin-app', 'tiandao-worldevent'],
    '蜜罐防御': ['cowrie-tianxing', 'beelzebub-http', '4g-listener'],
    '音频流': ['audio-stream'],
  };

  const result = { ok: true, processes: {}, groups: {}, alerts: [] };

  for (const p of procs) {
    const name = p.name;
    const status = p.pm2_env?.status;
    const restarts = p.pm2_env?.restart_time || 0;
    const uptime = p.pm2_env?.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : 0;
    const mem = p.monit?.memory || 0;
    const online = status === 'online';

    result.processes[name] = { status, restarts, uptime, mem, online };

    // bge-m3：重启>10000次 = 严重（AMD GPU OOM 是已知问题，参考值：9388次为正常状态）
    if (name === 'bge-m3-keepalive') {
      if (restarts > 10000) result.alerts.push(`🔴 bge-m3-keepalive 重启 ${restarts} 次（超过正常阈值）`);
      // 低于10000均为 AMD GPU + Ollama 已知兼容问题，不告警
    }
    // session-summary-extractor：重启>30 = 异常（17次为修复前累积值，修复后应稳定不涨）
    else if (name === 'session-summary-extractor') {
      if (restarts > 30) result.alerts.push(`🟡 session-summary-extractor 重启 ${restarts} 次（异常，建议检查）`);
    }
    // 任何关键进程离线
    else if (['session-extractor', 'outbox-writer', 'graph-linker'].includes(name) && !online) {
      result.alerts.push(`🔴 ${name} 已停止（${status}）`);
    }
    else if (['bge-m3-keepalive', 'graphify-opus-manager', 'hermes-server'].includes(name) && !online) {
      result.alerts.push(`🔴 ${name} 已停止（${status}）`);
    }
  }

  // 按组别汇总
  for (const [group, names] of Object.entries(GROUPS)) {
    const ps = names.map(n => result.processes[n]).filter(Boolean);
    const allOnline = ps.every(p => p.online);
    const totalRestarts = ps.reduce((s, p) => s + p.restarts, 0);
    result.groups[group] = { allOnline, totalRestarts, processes: ps };
  }

  return result;
}

// ─── 数据库检查 ────────────────────────────────────────────

async function checkDatabase() {
  const result = { ok: true, tables: {}, alerts: [] };

  try {
    const rows = await dbQuery(`
      SELECT 'memories' as tbl, count(*) as cnt FROM memories
      UNION ALL SELECT 'personal_memories', count(*) FROM personal_memories
      UNION ALL SELECT 'memory_summaries', count(*) FROM memory_summaries
      UNION ALL SELECT 'conversation_messages', count(*) FROM conversation_messages
      UNION ALL SELECT 'recall_logs', count(*) FROM recall_logs
      UNION ALL SELECT 'memory_outbox', count(*) FROM memory_outbox
      UNION ALL SELECT 'session_summary_cursor', count(*) FROM session_summary_cursor
    `);
    for (const row of rows.rows) result.tables[row.tbl] = parseInt(row.cnt);

    // outbox 失败率
    const outboxFailed = await dbQuery(`SELECT count(*) as cnt FROM memory_outbox WHERE status = 'failed'`);
    const outboxTotal = await dbQuery(`SELECT count(*) as cnt FROM memory_outbox`);
    const outboxFailedCnt = parseInt(outboxFailed.rows[0].cnt);
    const outboxTotalCnt = parseInt(outboxTotal.rows[0].cnt);
    result.tables.outbox_failed = outboxFailedCnt;
    result.tables.outbox_total = outboxTotalCnt;
    if (outboxTotalCnt > 0) {
      const failRate = outboxFailedCnt / outboxTotalCnt * 100;
      result.tables.outbox_fail_rate = failRate.toFixed(1);
      // 失败全为历史积压（Apr17-18），近期 processed 正常不代表当前有问题
      // 仅当 processed > 0 且失败率 > 80% 且最近1小时有 processed 才告警（新失败持续）
      const recentProcessed = await dbQuery(`SELECT count(*) as cnt FROM memory_outbox WHERE status = 'processed' AND processed_at > now() - INTERVAL '1 hour'`);
      const recentProcessedCnt = parseInt(recentProcessed.rows[0].cnt);
      if (outboxFailedCnt > 0 && recentProcessedCnt === 0) {
        result.alerts.push(`🟡 memory_outbox ${outboxFailedCnt} 条历史失败（最近1小时无新处理，需清理）`);
      }
    }

    // 近1小时增量
    const recentCM = await dbQuery(`SELECT count(*) as cnt FROM conversation_messages WHERE created_at > now() - INTERVAL '1 hour'`);
    const recentMS = await dbQuery(`SELECT count(*) as cnt FROM memory_summaries WHERE created_at > now() - INTERVAL '1 hour'`);
    result.tables.conversation_messages_1h = parseInt(recentCM.rows[0].cnt);
    result.tables.memory_summaries_1h = parseInt(recentMS.rows[0].cnt);

  } catch (e) {
    result.ok = false;
    result.error = e.message;
  }
  return result;
}

// ─── Neo4j 检查 ──────────────────────────────────────────

async function checkNeo4j() {
  const result = { ok: true, nodes: {}, alerts: [] };
  try {
    // HTTP 到 7474 端口（Bolt 驱动在某些环境下静默失败）
    // 使用 LIMIT 50 确保所有关键 label（包括 Memory_summary 在第26位）都被包含
    const curlCmd = `curl -s -u neo4j:openclaw_neo4j_2026 http://localhost:7474/db/neo4j/tx/commit -H 'Content-Type: application/json' -d '{"statements":[{"statement":"MATCH (n) RETURN labels(n)[0] as label, count(*) as cnt ORDER BY cnt DESC LIMIT 50"}]}' 2>/dev/null`;
    let stdout;
    try { stdout = rawExecSync(curlCmd, { encoding: 'utf8', timeout: 15000 }); }
    catch (e) { result.ok = false; result.error = e.message; return result; }

    let data;
    try { data = JSON.parse(stdout.trim()); } catch { result.ok = false; result.error = 'neo4j JSON parse failed'; return result; }

    if (data.results?.[0]?.data) {
      for (const item of data.results[0].data) result.nodes[item.row[0]] = item.row[1];
    }

    // 关键节点阈值
    const THRESHOLD = { GraphifyCode: 50000, PersonalMemory: 1000, Memory_summary: 100 };
    for (const [label, threshold] of Object.entries(THRESHOLD)) {
      const count = result.nodes[label] || 0;
      if (count < threshold) result.alerts.push(`🟡 ${label} 节点 ${count}（低于预期 ${threshold}）`);
    }
    if (Object.keys(result.nodes).length === 0) result.alerts.push('🔴 Neo4j 无节点数据');

  } catch (e) {
    result.ok = false;
    result.error = e.message;
  }
  return result;
}

// ─── Redis 检查 ────────────────────────────────────────────

async function checkRedis() {
  const result = { ok: true, streams: {}, info: {}, alerts: [] };
  try {
    const { Redis } = require('/home/ai/.openclaw/workspace/memory-system/node_modules/ioredis');
    const client = new Redis({ host: 'localhost', port: 6379, lazyConnect: true, connectTimeout: 8000 });
    await client.connect();

    const info = await client.info('memory');
    const memLine = info.split('\n').find(l => l.startsWith('used_memory_human'));
    result.info.mem = memLine ? memLine.split(':')[1].trim() : 'unknown';

    // graph:sync:events（graph-linker 消费）
    const gsLen = await client.xlen('graph:sync:events').catch(() => -1);
    const gsGroups = await client.xinfo('GROUPS', 'graph:sync:events').catch(() => []);
    result.streams['graph:sync:events'] = { len: gsLen, groups: gsGroups.length };

    // memory:messages（outbox-writer 消费）
    const mmLen = await client.xlen('memory:messages').catch(() => -1);
    const mmGroups = await client.xinfo('GROUPS', 'memory:messages').catch(() => []);
    result.streams['memory:messages'] = { len: mmLen, groups: mmGroups.length };

    // 告警
    if (gsLen > 50000) result.alerts.push(`🔴 graph:sync:events 积压 ${gsLen} 条（graph-linker 严重滞后）`);
    else if (gsLen > 10000) result.alerts.push(`🟡 graph:sync:events 积压 ${gsLen} 条`);

    if (mmLen > 1000) result.alerts.push(`🟡 memory:messages 积压 ${mmLen} 条`);

    await client.quit();
  } catch (e) {
    result.ok = false;
    result.error = e.message;
  }
  return result;
}

// ─── Ollama 检查 ─────────────────────────────────────────

async function checkOllama() {
  const result = { ok: true, models: [], alerts: [] };
  try {
    let stdout;
    try { stdout = rawExecSync('curl -s http://localhost:11434/api/tags', { encoding: 'utf8', timeout: 10000 }); }
    catch (e) { result.ok = false; result.error = e.message; return result; }

    let data;
    try { data = JSON.parse(stdout.trim()); } catch { result.ok = false; result.error = 'ollama JSON parse failed'; return result; }

    result.models = (data.models || []).map(m => ({ name: m.name, size: m.size || 0 }));

    const hasBgeM3 = result.models.some(m => m.name === 'bge-m3:latest');
    if (!hasBgeM3) result.alerts.push('🔴 bge-m3:latest 模型缺失（向量嵌入功能将不可用）');

  } catch (e) {
    result.ok = false;
    result.error = e.message;
  }
  return result;
}

// ─── Tiandao 微服务检查 ──────────────────────────────────

async function checkTiandao() {
  const result = { ok: true, services: {}, alerts: [] };
  const SERVICES = [
    { name: 'tiandao-member', port: 3002, path: '/health' },
    { name: 'tiandao-auth', port: 3004, path: '/auth/health' },
    { name: 'tiandao-karma', port: 3006, path: '/karma/health' },
    { name: 'tiandao-admin-app', port: 3013, path: '/health' },
    { name: 'tiandao-worldevent', port: 3011, path: '/' },
  ];

  for (const svc of SERVICES) {
    try {
      const res = await new Promise((resolve) => {
        const req = require('http').get(`http://localhost:${svc.port}${svc.path}`, { timeout: 5000 }, res => resolve({ ok: res.statusCode < 400, status: res.statusCode }));
        req.on('error', e => resolve({ ok: false, error: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
      });
      result.services[svc.name] = { port: svc.port, ...res };
      if (!res.ok) result.alerts.push(`🟡 ${svc.name} (${svc.port}) 返回 ${res.status || res.error}`);
    } catch (e) {
      result.services[svc.name] = { port: svc.port, ok: false, error: e.message };
      result.alerts.push(`🔴 ${svc.name} (${svc.port}) 无法访问`);
    }
  }
  return result;
}

// ─── 蜜罐系统检查 ────────────────────────────────────────

async function checkHoneypots() {
  const result = { ok: true, components: {}, alerts: [] };

  // Cowrie systemd
  try {
    const out = rawExecSync('systemctl is-active cowrie 2>/dev/null', { encoding: 'utf8' }).trim();
    result.components.cowrie_systemd = out === 'active' ? 'active' : out;
    if (out !== 'active') result.alerts.push(`🔴 Cowrie systemd: ${out}`);
  } catch { result.components.cowrie_systemd = 'unknown'; result.alerts.push('🔴 Cowrie systemd 无法检测'); }

  // Cowrie 端口
  try {
    const ss = rawExecSync('ss -tlnp 2>/dev/null | grep -E ":2222|:2223"', { encoding: 'utf8' });
    const has2222 = ss.includes(':2222');
    const has2223 = ss.includes(':2223');
    result.components.cowrie_ports = { 2222: has2222, 2223: has2223 };
    if (!has2222) result.alerts.push('🔴 Cowrie SSH 端口 2222 未监听');
    if (!has2223) result.alerts.push('🔴 Cowrie Telnet 端口 2223 未监听');
  } catch { result.alerts.push('🔴 Cowrie 端口检测失败'); }

  // cowrie-tianxing PM2
  try {
    const out = rawExecSync('pm2 jlist 2>/dev/null', { encoding: 'utf8' });
    const ps = JSON.parse(out.trim());
    const ct = ps.find(p => p.name === 'cowrie-tianxing');
    const bz = ps.find(p => p.name === 'beelzebub-http');
    const gl = ps.find(p => p.name === '4g-listener');
    result.components['cowrie-tianxing'] = ct ? { status: ct.pm2_env?.status, restarts: ct.pm2_env?.restart_time || 0 } : null;
    result.components['beelzebub-http'] = bz ? { status: bz.pm2_env?.status, restarts: bz.pm2_env?.restart_time || 0 } : null;
    result.components['4g-listener'] = gl ? { status: gl.pm2_env?.status, restarts: gl.pm2_env?.restart_time || 0 } : null;
  } catch { /* PM2 检测失败不影响整体 */ }

  return result;
}

// ─── Recall Tier 配置检查 ────────────────────────────────

async function checkRecallConfig() {
  const result = { ok: true, intents: {}, alerts: [] };
  try {
    const cfg = require('/home/ai/.openclaw/workspace/memory-system/scripts/config.js');
    const ic = cfg.intentConfig || {};

    // 技术/项目类应为 tier=1（实时性要求高），其余应为 tier=2（节省资源）
    const EXPECTED_TIER_1 = ['TECHNICAL', 'PROJECT'];
    const EXPECTED_TIER_2 = ['REASONING', 'FACTUAL', 'PREFERENCE', 'EVENT', 'PERSON', 'DEFAULT'];

    for (const [intent, cfg_intent] of Object.entries(ic)) {
      const tier = cfg_intent.tier;
      result.intents[intent] = { tier, graphify: cfg_intent.graphify || false };
      if (EXPECTED_TIER_1.includes(intent) && tier !== 1) {
        result.alerts.push(`🟡 ${intent} 应为 tier=1（当前 tier=${tier}）`);
      }
      if (EXPECTED_TIER_2.includes(intent) && tier !== 2) {
        result.alerts.push(`🟡 ${intent} 应为 tier=2（当前 tier=${tier}）`);
      }
    }
  } catch (e) {
    result.ok = false;
    result.error = e.message;
  }
  return result;
}

// ─── 磁盘空间检查 ────────────────────────────────────────

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
      if (parseInt(pct) > 95) result.alerts.push(`🔴 ${mount} 使用率 ${pct}（紧急）`);
      else if (parseInt(pct) > 85) result.alerts.push(`🟡 ${mount} 使用率 ${pct}`);
    }
  } catch (e) {
    result.ok = false;
    result.error = e.message;
  }
  return result;
}

// ─── 主检查流程 ──────────────────────────────────────────

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
    ['Tiandao微服务', checkTiandao],
    ['蜜罐系统', checkHoneypots],
    ['Recall配置', checkRecallConfig],
    ['磁盘空间', checkDisk],
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

// ─── 报告生成 ────────────────────────────────────────────

function generateReport(data, compact = false) {
  const { results, allAlerts, elapsed } = data;
  const lines = [];
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

  lines.push(`═══════════════════════════════════════════════════════`);
  lines.push(`  📋 系统健康检查报告  ${now}`);
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

  // PM2 进程组
  if (results['PM2进程']?.ok) {
    lines.push(`【PM2 进程】`);
    const g = results['PM2进程'].groups;
    for (const [group, info] of Object.entries(g)) {
      const icon = info.allOnline ? '✅' : '🔴';
      const memStrs = info.processes.map(p => `${p.online ? '✅' : '🔴'}${p.status}(r${p.restarts})`).join(' | ');
      lines.push(`  ${icon} ${group.padEnd(10)} ${memStrs}`);
    }
    lines.push(``);
  }

  // 数据库
  if (results['数据库']?.ok) {
    const t = results['数据库'].tables;
    lines.push(`【数据库】`);
    lines.push(`  ✅ conversation_messages: ${(t.conversation_messages||0).toLocaleString()} 条  (近1h: +${t.conversation_messages_1h||0})`);
    lines.push(`  ✅ memory_summaries:    ${(t.memory_summaries||0).toLocaleString()} 条  (近1h: +${t.memory_summaries_1h||0})`);
    lines.push(`  ✅ personal_memories:   ${(t.personal_memories||0).toLocaleString()} 条`);
    lines.push(`  ✅ memories:            ${(t.memories||0).toLocaleString()} 条`);
    lines.push(`  ✅ recall_logs:         ${(t.recall_logs||0).toLocaleString()} 条`);
    lines.push(`  ✅ session_cursor:      ${(t.session_summary_cursor||0).toLocaleString()} 条`);
    if (t.outbox_total > 0) {
      const failRate = t.outbox_fail_rate || '0';
      // 历史失败率不代表当前状态（有 recent processed 就用绿色）
      const icon = parseFloat(failRate) > 80 ? '🟡' : parseFloat(failRate) > 20 ? '🔴' : parseFloat(failRate) > 5 ? '🟡' : '✅';
      lines.push(`  ${icon} memory_outbox:    ${t.outbox_failed||0}/${t.outbox_total||0} 失败率 ${failRate}%`);
    }
    lines.push(``);
  }

  // Neo4j
  if (results['Neo4j图数据库']?.ok) {
    const n = results['Neo4j图数据库'].nodes;
    // 核心指标（GraphifyCode + PersonalMemory + Memory_summary 共用同一阈值体系）
    const important = ['GraphifyCode', 'PersonalMemory', 'Memory_summary'];
    lines.push(`【Neo4j 图数据库】`);
    for (const k of important) {
      if (n[k] !== undefined) lines.push(`  ${severity(n[k]===0)} ${k.padEnd(50)} ${(n[k]||0).toLocaleString()}`);
    }
    if (Object.keys(n).length === 0) lines.push(`  🔴 无节点数据（可能连接失败）`);
    lines.push(``);
  }

  // Redis
  if (results['Redis']?.ok) {
    const ri = results['Redis'].streams;
    const info = results['Redis'].info;
    lines.push(`【Redis】`);
    lines.push(`  内存: ${info.mem || '?'}`);
    for (const [name, s] of Object.entries(ri)) {
      const icon = s.len > 10000 ? '🟡' : s.len > 50000 ? '🔴' : '✅';
      lines.push(`  ${icon} ${name}: ${s.len} 条  (${s.groups} 个 consumer groups)`);
    }
    lines.push(``);
  }

  // Ollama
  if (results['Ollama']?.ok) {
    lines.push(`【Ollama 模型】`);
    for (const m of results['Ollama'].models) {
      const sizeGB = m.size ? (m.size / 1024 / 1024 / 1024).toFixed(1) + 'GB' : '?';
      const icon = m.name.includes('bge-m3') ? '✅' : '  ';
      lines.push(`  ${icon} ${m.name.padEnd(40)} ${sizeGB}`);
    }
    lines.push(``);
  }

  // Tiandao
  if (results['Tiandao微服务']?.ok) {
    lines.push(`【Tiandao 微服务】`);
    const svc = results['Tiandao微服务'].services;
    const svcMap = {
      'tiandao-member': '成员(3002)',
      'tiandao-auth': '认证(3004)',
      'tiandao-karma': '业力(3006)',
      'tiandao-admin-app': '管理API(3013)',
      'tiandao-worldevent': '事件(3011)',
    };
    for (const [name, info] of Object.entries(svc)) {
      const label = svcMap[name] || name;
      const icon = info.ok ? '✅' : '🔴';
      lines.push(`  ${icon} ${label.padEnd(16)} ${info.ok ? 'OK' : info.error || info.status}`);
    }
    lines.push(``);
  }

  // 蜜罐
  if (results['蜜罐系统']?.ok) {
    const hp = results['蜜罐系统'].components;
    lines.push(`【蜜罐系统】`);
    const cowrieIcon = hp.cowrie_systemd === 'active' ? '✅' : '🔴';
    lines.push(`  ${cowrieIcon} Cowrie systemd: ${hp.cowrie_systemd}`);
    if (hp.cowrie_ports) {
      lines.push(`  ${hp.cowrie_ports[2222] ? '✅' : '🔴'} SSH 端口 2222`);
      lines.push(`  ${hp.cowrie_ports[2223] ? '✅' : '🔴'} Telnet 端口 2223`);
    }
    for (const name of ['cowrie-tianxing', 'beelzebub-http', '4g-listener']) {
      const p = hp[name];
      if (p) lines.push(`  ${p.status === 'online' ? '✅' : '🔴'} ${name} (r${p.restarts})`);
    }
    lines.push(``);
  }

  // Recall 配置
  if (results['Recall配置']?.ok) {
    const ri = results['Recall配置'].intents;
    lines.push(`【Recall Intent Tier】`);
    const tierIcon = (t) => t === 1 ? '1️⃣' : t === 2 ? '2️⃣' : '❓';
    for (const [intent, cfg] of Object.entries(ri)) {
      const graphify = cfg.graphify ? ' 🔗' : '';
      lines.push(`  ${tierIcon(cfg.tier)} ${intent.padEnd(12)} tier=${cfg.tier}${graphify}`);
    }
    lines.push(``);
  }

  // 磁盘
  if (results['磁盘空间']?.ok && results['磁盘空间'].mounts.length > 0) {
    lines.push(`【磁盘空间】`);
    for (const m of results['磁盘空间'].mounts) {
      if (parseInt(m.pct) > 80) lines.push(`  ${warn(parseInt(m.pct) > 90)} ${m.mount.padEnd(20)} ${m.used}/${m.size} (${m.pct}%)`);
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
  const redis = results['Redis']?.streams || {};
  const pm2 = results['PM2进程']?.processes || {};
  const bge = pm2['bge-m3-keepalive'];
  const sess = pm2['session-summary-extractor'];
  const ob = pm2['outbox-writer'];
  const gl = pm2['graph-linker'];

  const parts = [];
  parts.push(`[${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}]`);
  parts.push(`CM=${t.conversation_messages||0} MS=${t.memory_summaries||0} PM=${t.personal_memories||0}`);
  parts.push(`Neo4j GC=${n.GraphifyCode||0} PM=${n.PersonalMemory||0}`);
  parts.push(`Redis gs=${redis['graph:sync:events']?.len||0} mm=${redis['memory:messages']?.len||0}`);
  parts.push(`bge=r${bge?.restarts||0} sess=r${sess?.restarts||0} ob=r${ob?.restarts||0} gl=r${gl?.restarts||0}`);
  if (t.outbox_fail_rate && parseFloat(t.outbox_fail_rate) > 0) parts.push(`ob_fail=${t.outbox_fail_rate}%`);
  if (allAlerts.length > 0) parts.push(`ALERTS=${allAlerts.length}`);
  parts.push(`${elapsed}ms`);

  return parts.join(' | ');
}

// ─── 入口 ────────────────────────────────────────────────

(async () => {
  const args = process.argv.slice(2);
  const compact = args.includes('--compact');

  const data = await runAllChecks();
  const report = compact ? generateCompactReport(data) : generateReport(data);
  console.log('\n' + report);

  // 保存日志
  const logDir = '/home/ai/.openclaw/workspace/logs';
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `daily-health-${Date.now()}.log`);
  fs.writeFileSync(logFile, report);

  if (data.allAlerts.length > 0) {
    const alertFile = path.join(logDir, 'daily-health-alerts.latest');
    fs.writeFileSync(alertFile, data.allAlerts.join('\n'));
  }

  process.exit(data.allAlerts.some(a => a.startsWith('🔴')) ? 1 : 0);
})();
