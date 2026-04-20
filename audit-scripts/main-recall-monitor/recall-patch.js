/**
 * recall-patch.js — 主脑召回审计 Monkey-patch
 * 被 handler.js require，在 RecallService 定义后、首次调用前执行
 * 仅执行一次，幂等
 */
'use strict';

if (global.__mainBrainRecallPatched) module.exports;
global.__mainBrainRecallPatched = true;

const AuditWriter = require('./sqlite-writer');
const path = require('path');

// ── 在 RecallService 类定义后才打 patch（handler.js require 此文件时 RecallService 尚未加载）───
process.nextTick(() => {
  try {
    // handler.js 在本 patch 之后才 require RecallService，
    // 所以这里通过 require 拿到已缓存的模块引用
    const { RecallService } = require(path.join(__dirname, '../../memory-system/scripts/session-recall'));

    if (!RecallService || !RecallService.prototype) {
      console.error('[main-recall-audit] RecallService not found, patch skipped');
      return;
    }

    const _orig = RecallService.prototype.recall;

    RecallService.prototype.recall = async function(...args) {
      const start = Date.now();
      // 注入 _startTime 供 patch 读取
      if (args[0] && typeof args[0] === 'object') args[0]._startTime = start;
      const result = await _orig.apply(this, args);
      const latency = Date.now() - start;
      try {
        const params = args[0] || {};
        AuditWriter.writeAudit({
          recall_log_id: null,
          session_id: params.sessionId || null,
          sender_id: params.userId || null,
          query_text: params.query || '',
          intent: result.intent || null,
          latency_ms: latency,
          memories: result.memories || [],
        });
      } catch (e) {
        console.error('[main-recall-audit] write error:', e.message);
      }
      return result;
    };

    console.log('[main-recall-audit] RecallService.prototype.recall patched');
  } catch (e) {
    console.error('[main-recall-audit] patch apply error:', e.message);
  }
});
