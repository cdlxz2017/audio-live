/**
 * init-db.js — 主脑召回审计 SQLite 初始化
 * 幂等设计，可重复执行
 */
'use strict';

const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = '/home/ai/.openclaw/audit/main_recall_audit.db';
const DIR = '/home/ai/.openclaw/audit';

if (!fs.existsSync(DIR)) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
} else {
  try { fs.chmodSync(DIR, 0o700); } catch {}
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS recall_audit_detail (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ts              TEXT    DEFAULT CURRENT_TIMESTAMP,
    recall_log_id   TEXT,
    session_id      TEXT,
    sender_id       TEXT,
    query_text      TEXT,
    intent          TEXT,
    latency_ms      INTEGER,
    memory_id       INTEGER,
    memory_source   TEXT,
    score           REAL,
    memory_summary  TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_detail_session
    ON recall_audit_detail(session_id);

  CREATE INDEX IF NOT EXISTS idx_detail_memory
    ON recall_audit_detail(memory_id);

  CREATE TABLE IF NOT EXISTS memory_recall_stats (
    memory_id        INTEGER,
    memory_source    TEXT,
    total_recalls   INTEGER DEFAULT 0,
    unique_sessions  INTEGER DEFAULT 0,
    last_recalled_at TEXT,
    avg_score        REAL,
    PRIMARY KEY (memory_id, memory_source)
  );

  CREATE INDEX IF NOT EXISTS idx_stats_recalls
    ON memory_recall_stats(total_recalls DESC);
`);

db.close();

try { require('child_process').execSync(`chmod 600 "${DB_PATH}"`, { stdio: 'ignore' }); } catch {}
console.log('[main-recall-audit] init-db: SQLite initialized at', DB_PATH);
