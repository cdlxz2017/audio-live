#!/usr/bin/env node
/**
 * audit-monitor.js — 审计系统健康监控
 * v1.0 — 2026-04-20
 * 
 * 检查项目：
 * 1. 审计目录是否可写
 * 2. 今日日志文件是否存在且可读
 * 3. 最近的审计记录是否正常（过去5分钟内）
 * 4. JSONL 格式是否完整（每行可解析）
 * 5. 与上一次检查对比，是否有新增记录
 * 
 * 使用方式：
 *   node audit-monitor.js              # 检查并输出状态
 *   node audit-monitor.js --json         # JSON 格式输出
 *   node audit-monitor.js --alert        # 发现异常则发送告警
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AUDIT_DIR = process.env.AUDIT_DIR || '/home/ai/.openclaw/audit';
const STATE_FILE = path.join(AUDIT_DIR, '.monitor-state.json');
const MAX_AGE_MINUTES = 30;  // 超过30分钟无新记录 → 告警

// 工具函数
function getDateStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getAuditFilePath(dateStr = getDateStr()) {
  return path.join(AUDIT_DIR, `${dateStr}.jsonl`);
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { lastCount: 0, lastTs: null };
  }
}

function writeState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn('[audit-monitor] Failed to write state:', err.message);
  }
}

/**
 * 检查审计目录
 */
function checkDirectory() {
  const issues = [];
  
  // 目录是否存在
  if (!fs.existsSync(AUDIT_DIR)) {
    issues.push('AUDIT_DIR_NOT_EXISTS');
    return { ok: false, issues };
  }
  
  // 是否可写
  try {
    const testFile = path.join(AUDIT_DIR, '.write-test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
  } catch (err) {
    issues.push('AUDIT_DIR_NOT_WRITABLE: ' + err.message);
  }
  
  // 权限是否正确（应该是 700）
  try {
    const stat = fs.statSync(AUDIT_DIR);
    const mode = (stat.mode & 0o777).toString(8);
    if (mode !== '700') {
      issues.push('AUDIT_DIR_WRONG_PERMISSION: expected 700, got ' + mode);
    }
  } catch (err) {
    issues.push('AUDIT_DIR_STAT_FAILED: ' + err.message);
  }
  
  return { ok: issues.length === 0, issues };
}

/**
 * 检查今日日志文件
 */
function checkTodayFile() {
  const issues = [];
  const today = getDateStr();
  const filePath = getAuditFilePath(today);
  
  let stats = {
    exists: false,
    size: 0,
    lineCount: 0,
    lastLine: null,
    lastTs: null,
    malformedLines: 0,
    categories: {},
    ops: {},
    success: 0,
    failed: 0,
  };
  
  if (!fs.existsSync(filePath)) {
    issues.push('TODAY_FILE_NOT_EXISTS');
    return { ok: false, issues, stats };
  }
  
  stats.exists = true;
  
  try {
    const stat = fs.statSync(filePath);
    stats.size = stat.size;
    
    // 权限检查
    const mode = (stat.mode & 0o777).toString(8);
    if (mode !== '600') {
      issues.push('TODAY_FILE_WRONG_PERMISSION: expected 600, got ' + mode);
    }
    
    // 读取并解析每一行
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    stats.lineCount = lines.length;
    
    if (lines.length > 0) {
      // 解析最后一行
      try {
        const lastEntry = JSON.parse(lines[lines.length - 1]);
        stats.lastTs = lastEntry.ts;
        stats.lastLine = {
          category: lastEntry.category,
          op: lastEntry.op,
          target: lastEntry.target,
          success: lastEntry.result?.success,
        };
      } catch {
        issues.push('TODAY_FILE_LAST_LINE_MALFORMED');
      }
      
      // 检查格式和统计
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        try {
          const entry = JSON.parse(line);
          stats.categories[entry.category] = (stats.categories[entry.category] || 0) + 1;
          stats.ops[entry.op] = (stats.ops[entry.op] || 0) + 1;
          if (entry.result?.success) stats.success++;
          else if (entry.result?.success === false) stats.failed++;
        } catch {
          stats.malformedLines++;
        }
      }
    }
    
    if (stats.malformedLines > 0) {
      issues.push(`MALFORMED_LINES: ${stats.malformedLines}/${lines.length}`);
    }
    
  } catch (err) {
    issues.push('TODAY_FILE_READ_FAILED: ' + err.message);
  }
  
  return { ok: issues.length === 0, issues, stats };
}

/**
 * 检查记录时效性
 */
function checkFreshness(stats) {
  const issues = [];
  
  if (!stats.lastTs) {
    issues.push('NO_RECORDS_TODAY');
    return { ok: false, issues };
  }
  
  const lastTime = new Date(stats.lastTs);
  const now = new Date();
  const ageMinutes = (now - lastTime) / 1000 / 60;
  
  if (ageMinutes > MAX_AGE_MINUTES) {
    issues.push(`STALE_RECORDS: last record ${Math.round(ageMinutes)} minutes ago (max ${MAX_AGE_MINUTES})`);
  }
  
  return { ok: issues.length === 0, issues, ageMinutes };
}

/**
 * 检查增量
 */
function checkIncrement(stats) {
  const issues = [];
  const state = readState();
  const now = new Date().toISOString();
  
  let isIncrementing = false;
  let newRecords = 0;
  
  if (state.lastCount > 0 && stats.lineCount > state.lastCount) {
    newRecords = stats.lineCount - state.lastCount;
    isIncrementing = true;
  } else if (stats.lineCount === 0 && state.lastCount === 0) {
    // 第一次记录，正常
    isIncrementing = true;
  } else if (stats.lineCount > 0 && state.lastCount === 0) {
    newRecords = stats.lineCount;
    isIncrementing = true;
  }
  
  // 更新状态
  writeState({
    lastCount: stats.lineCount,
    lastTs: now,
  });
  
  return {
    ok: true,
    isIncrementing,
    newRecords,
    previousCount: state.lastCount,
    currentCount: stats.lineCount,
  };
}

/**
 * 主检查
 */
async function runChecks(args = {}) {
  const results = {
    ts: new Date().toISOString(),
    directory: null,
    todayFile: null,
    freshness: null,
    increment: null,
    overall: 'OK',
    alerts: [],
  };
  
  // 1. 目录检查
  results.directory = checkDirectory();
  
  // 2. 今日文件检查
  results.todayFile = checkTodayFile();
  
  // 3. 时效性检查
  if (results.todayFile.stats.lastTs) {
    results.freshness = checkFreshness(results.todayFile.stats);
  }
  
  // 4. 增量检查
  results.increment = checkIncrement(results.todayFile.stats);
  
  // 5. 综合判断
  const allOk = [
    results.directory.ok,
    results.todayFile.ok,
    results.freshness === null || results.freshness.ok,
    results.increment.ok,
  ].every(Boolean);
  
  results.overall = allOk ? 'OK' : 'ISSUE';
  
  if (!allOk) {
    results.alerts = [
      ...(results.directory.issues || []),
      ...(results.todayFile.issues || []),
      ...(results.freshness?.issues || []),
    ].filter(Boolean);
  }
  
  // 输出
  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    printHuman(results);
  }
  
  return results;
}

function printHuman(results) {
  console.log(`
🔍 审计系统监控报告 — ${results.ts}
─────────────────────────────────────────────`);

  // 目录状态
  const dirOk = results.directory.ok;
  console.log(`\n📁 审计目录: ${dirOk ? '✅ 正常' : '❌ 异常'}`);
  if (!dirOk) {
    results.directory.issues.forEach(i => console.log(`   ⚠️  ${i}`));
  }
  
  // 今日文件
  const fileOk = results.todayFile.ok;
  const stats = results.todayFile.stats;
  console.log(`\n📄 今日日志: ${fileOk ? '✅ 正常' : '❌ 异常'} (${stats.lineCount} 条记录)`);
  if (!fileOk) {
    results.todayFile.issues.forEach(i => console.log(`   ⚠️  ${i}`));
  } else {
    console.log(`   大小: ${(stats.size / 1024).toFixed(2)} KB`);
    console.log(`   最后记录: ${stats.lastTs || '无'}`);
    
    // 各类别统计
    const cats = Object.entries(stats.categories).sort((a, b) => b[1] - a[1]);
    if (cats.length > 0) {
      console.log(`   类别: ${cats.map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }
  }
  
  // 时效性
  if (results.freshness) {
    const freshOk = results.freshness.ok;
    console.log(`\n⏱️  时效性: ${freshOk ? '✅ 正常' : '❌ 异常'}`);
    if (!freshOk) {
      results.freshness.issues.forEach(i => console.log(`   ⚠️  ${i}`));
    } else {
      console.log(`   最近记录: ${Math.round(results.freshness.ageMinutes)} 分钟前`);
    }
  }
  
  // 增量
  if (results.increment) {
    console.log(`\n📈 增量: ${results.increment.isIncrementing ? '✅ 有新增' : '⚠️ 无新增'}`);
    console.log(`   今日累计: ${results.increment.currentCount} 条`);
    if (results.increment.newRecords > 0) {
      console.log(`   本次新增: +${results.increment.newRecords} 条`);
    }
  }
  
  // 综合状态
  console.log(`\n${results.overall === 'OK' ? '✅' : '❌'} 综合状态: ${results.overall}`);
  if (results.alerts.length > 0) {
    console.log('\n告警项:');
    results.alerts.forEach(a => console.log(`  - ${a}`));
  }
  
  console.log('');
}

// 入口
const args = process.argv.includes('--json')
  ? { json: true }
  : process.argv.includes('--alert')
    ? { alert: true }
    : {};

runChecks(args).then(results => {
  if (args.alert && results.overall !== 'OK') {
    console.error('ALERT: Audit system issues detected');
    process.exit(1);
  }
  process.exit(results.overall === 'OK' ? 0 : 1);
}).catch(err => {
  console.error('Monitor error:', err.message);
  process.exit(1);
});

module.exports = { runChecks, checkDirectory, checkTodayFile, checkFreshness, checkIncrement };
