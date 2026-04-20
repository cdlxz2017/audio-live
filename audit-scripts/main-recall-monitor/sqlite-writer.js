/**
 * sqlite-writer.js — 主脑召回审计 SQLite 写入模块
 * 被 session-recall.js 的 monkey-patch 调用
 */
'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = '/home/ai/.openclaw/audit/main_recall_audit.db';

let db;
function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
  }
  return db;
}

const insertDetail = getDb().prepare(`
  INSERT INTO recall_audit_detail
    (recall_log_id, session_id, sender_id, query_text, intent, latency_ms, memory_id, memory_source, score, memory_summary)
  VALUES
    (@recall_log_id, @session_id, @sender_id, @query_text, @intent, @latency_ms, @memory_id, @memory_source, @score, @memory_summary)
`);

const upsertStats = getDb().prepare(`
  INSERT INTO memory_recall_stats (memory_id, memory_source, total_recalls, unique_sessions, last_recalled_at, avg_score)
  VALUES (@memory_id, @memory_source, 1, 1, @last_recalled_at, @score)
  ON CONFLICT (memory_id, memory_source) DO UPDATE SET
    total_recalls = total_recalls + 1,
    unique_sessions = unique_sessions + 1,
    last_recalled_at = @last_recalled_at,
    avg_score = (avg_score * (total_recalls - 1) + @score) / total_recalls
`);

function writeAudit(record) {
  try {
    const { recall_log_id, session_id, sender_id, query_text, intent, latency_ms, memories } = record;
    const ts = new Date().toISOString();

    for (const m of memories) {
      insertDetail.run({
        recall_log_id: recall_log_id || null,
        session_id: session_id || null,
        sender_id: sender_id || null,
        query_text: query_text || '',
        intent: intent || null,
        latency_ms: latency_ms || 0,
        memory_id: m.id,
        memory_source: m._table || 'unknown',
        score: m.score || m.embedding_cosine_distance || null,
        memory_summary: m.summary || (m.entity && m.attribute ? `${m.entity}.${m.attribute}` : null) || null,
      });

      upsertStats.run({
        memory_id: m.id,
        memory_source: m._table || 'unknown',
        last_recalled_at: ts,
        score: m.score || m.embedding_cosine_distance || 0,
      });
    }
  } catch (e) {
    console.error('[main-recall-audit] write error:', e.message);
  }
}

module.exports = { writeAudit };
