/**
 * append-audit.js — 审计日志核心写入模块
 * v1.0 — 2026-04-20
 * 
 * 使用方式：
 *   const { appendAudit, queryAudit } = require('./append-audit');
 *   
 *   // 记录一次操作
 *   await appendAudit({
 *     category: 'FILE',
 *     op: 'file:create',
 *     target: '/home/ai/.openclaw/workspace/test.js',
 *     before: null,
 *     after: { size: 123 },
 *     result: { success: true },
 *   });
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');

const writeFileAsync = promisify(fs.writeFile);
const appendFileAsync = promisify(fs.appendFile);
const mkdirAsync = promisify(fs.mkdir);
const readFileAsync = promisify(fs.readFile);

// 依赖脱敏模块
const { redact } = require('./audit-redact');

// 配置
const AUDIT_DIR = process.env.AUDIT_DIR || '/home/ai/.openclaw/audit';
const BATCH_INTERVAL_MS = 100;  // 批量写入间隔
const BATCH_SIZE = 10;          // 达到此数量立即写入
const FALLBACK_FILE = '.fallback'; // fallback 保底文件名

// 内存缓冲区
let _buffer = [];
let _lastHash = null;
let _flushTimer = null;
let _hostname = require('os').hostname();

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

function getFallbackPath(dateStr = getDateStr()) {
  return path.join(AUDIT_DIR, `${dateStr}.${FALLBACK_FILE}`);
}

/**
 * 计算单条记录的哈希（用于哈希链）
 */
function computeHash(entry) {
  const content = JSON.stringify(entry);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * 异步批量刷盘
 */
async function _flush() {
  if (_buffer.length === 0) return;
  
  const toFlush = _buffer.splice(0, _buffer.length);
  const dateStr = getDateStr();
  const filePath = getAuditFilePath(dateStr);
  const fallbackPath = getFallbackPath(dateStr);
  
  try {
    // 确保目录存在
    await mkdirAsync(AUDIT_DIR, { recursive: true }).catch(() => {});
    
    // 逐条追加（保证原子性）
    for (const entry of toFlush) {
      try {
        await appendFileAsync(filePath, JSON.stringify(entry) + '\n', 'utf8');
      } catch (err) {
        // fallback：写到保底文件
        console.error(`[AUDIT] Failed to append to ${filePath}, using fallback:`, err.message);
        await appendFileAsync(fallbackPath, JSON.stringify(entry) + '\n', 'utf8').catch(() => {});
      }
    }
  } catch (err) {
    // 最后的保底：console + 内存保留
    console.error('[AUDIT] CRITICAL: All write attempts failed. Entry in memory:', JSON.stringify(toFlush[0]));
    // 不丢失，回调到 buffer
    _buffer.unshift(...toFlush);
  }
}

/**
 * 计划下一次批量刷新
 */
function _scheduleFlush() {
  if (_flushTimer) return;
  _flushTimer = setTimeout(async () => {
    _flushTimer = null;
    await _flush();
  }, BATCH_INTERVAL_MS);
}

/**
 * 主入口：追加一条审计日志
 * 
 * @param {Object} params
 * @param {string} params.category  — 操作类别：FILE|CONFIG|DATABASE|PROCESS|GIT|EXTERNAL_API|CRON
 * @param {string} params.op       — 操作类型：如 file:create, db:insert
 * @param {string} params.target    — 操作目标（文件路径/表名/进程名等）
 * @param {Object} params.before   — 变更前状态（可为 null）
 * @param {Object} params.after    — 变更后状态（可为 null）
 * @param {Object} params.result    — 执行结果 { success, error, latencyMs }
 * @param {Object} params.metadata — 额外元数据（可选）
 */
async function appendAudit(params) {
  const {
    category,
    op,
    target,
    before = null,
    after = null,
    result = { success: true },
    metadata = {},
  } = params;
  
  // 构建审计记录
  const entry = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    category,
    op,
    target,
    before: before ? redact(before) : null,
    after: after ? redact(after) : null,
    result: {
      success: result.success ?? true,
      error: result.error ?? null,
      latencyMs: result.latencyMs ?? null,
    },
    metadata: {
      hostname: _hostname,
      pid: process.pid,
      ...metadata,
    },
    prevHash: _lastHash,
  };
  
  // 计算哈希链
  entry.hash = computeHash(entry);
  _lastHash = entry.hash;
  
  // 加入缓冲区
  _buffer.push(entry);
  
  // 达到批量阈值立即刷新
  if (_buffer.length >= BATCH_SIZE) {
    if (_flushTimer) {
      clearTimeout(_flushTimer);
      _flushTimer = null;
    }
    await _flush();
  } else {
    _scheduleFlush();
  }
  
  return entry.id;
}

/**
 * 同步版本（用于不希望等待的场景）
 * 注意：这是「fire and forget」，不保证写入完成
 */
function appendAuditSync(params) {
  // 立即触发异步版本，不等待
  appendAudit(params).catch(err => {
    console.error('[AUDIT] Async append failed:', err.message);
  });
}

/**
 * 强制刷新（进程退出前调用）
 */
async function flush() {
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  await _flush();
}

/**
 * 查询审计日志
 * 
 * @param {Object} filters
 * @param {string} filters.date      — 日期 YYYY-MM-DD，默认今天
 * @param {string} filters.category — 类别过滤
 * @param {string} filters.op      — 操作类型过滤
 * @param {string} filters.target   — 目标过滤（子串匹配）
 * @param {string} filters.since   — ISO 时间下限
 * @param {string} filters.until   — ISO 时间上限
 * @param {number} filters.limit    — 返回条数上限
 * @returns {Promise<Array>} 匹配的审计记录
 */
async function queryAudit(filters = {}) {
  const {
    date = getDateStr(),
    category,
    op,
    target,
    since,
    until,
    limit = 100,
  } = filters;
  
  const filePath = getAuditFilePath(date);
  
  let content;
  try {
    content = await readFileAsync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  
  const lines = content.trim().split('\n').filter(l => l.trim());
  const results = [];
  
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      
      // 过滤器
      if (category && entry.category !== category) continue;
      if (op && entry.op !== op) continue;
      if (target && !entry.target.includes(target)) continue;
      if (since && entry.ts < since) continue;
      if (until && entry.ts > until) continue;
      
      results.push(entry);
      
      if (results.length >= limit) break;
    } catch (err) {
      // 跳过解析失败的行
      console.warn('[AUDIT] Failed to parse line:', err.message);
    }
  }
  
  return results;
}

/**
 * 获取今日审计统计
 */
async function getAuditStats(date = getDateStr()) {
  const filePath = getAuditFilePath(date);
  
  let content;
  try {
    content = await readFileAsync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { date, total: 0, categories: {}, ops: {} };
    }
    throw err;
  }
  
  const lines = content.trim().split('\n').filter(l => l.trim());
  const stats = {
    date,
    total: lines.length,
    categories: {},
    ops: {},
    success: 0,
    failed: 0,
  };
  
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      stats.categories[entry.category] = (stats.categories[entry.category] || 0) + 1;
      stats.ops[entry.op] = (stats.ops[entry.op] || 0) + 1;
      if (entry.result.success) stats.success++;
      else stats.failed++;
    } catch (err) {
      // 跳过
    }
  }
  
  return stats;
}

// 导出
module.exports = {
  appendAudit,
  appendAuditSync,
  flush,
  queryAudit,
  getAuditStats,
  getDateStr,
  getAuditFilePath,
};
