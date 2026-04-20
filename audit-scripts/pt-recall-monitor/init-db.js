/**
 * pt-recall-monitor/init-db.js
 * 初始化副脑召回审计 SQLite 数据库
 * 运行一次即可，幂等设计可重复执行
 */
'use strict';

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = '/home/ai/.openclaw/audit/pt_recall_audit.db';
const DIR = '/home/ai/.openclaw/audit';

// 确保目录存在且权限 700
if (!fs.existsSync(DIR)) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
} else {
  fs.chmodSync(DIR, 0o700);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS pt_recall_audit (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ts            TEXT    DEFAULT CURRENT_TIMESTAMP,
    source        TEXT    DEFAULT 'plugin',
    method        TEXT,
    path          TEXT,
    query         TEXT,
    status        INTEGER,
    latency_ms    INTEGER,
    result_count  INTEGER,
    thread_ids    TEXT,
    raw_body      TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_pt_audit_ts
    ON pt_recall_audit(ts DESC);

  CREATE INDEX IF NOT EXISTS idx_pt_audit_source
    ON pt_recall_audit(source);
`);

db.close();

// 设置文件权限 600
require('child_process').execSync(`chmod 600 "${DB_PATH}"`, { stdio: 'ignore' });
console.log('[pt-audit] init-db: SQLite initialized at', DB_PATH);
