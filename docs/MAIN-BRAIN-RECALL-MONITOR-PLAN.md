# 主脑召回监控系统扩展方案
> 生成时间：2026-04-21 04:55
> 状态：**✅ 已实施（2026-04-21 05:03）**
> 团队分析：Opus 4-6 + DeepSeek 并行审查

---

## 一、现状分析

**recall_logs 已有字段：**
- `recalled_ids` — integer[] 数组，存储被召回的记忆 ID
- `recalled_sources` — text[] 标记来源表
- `session_id` / `sender_id_text` / `query_text` / `intent` / `latency_ms` / `scores`

**缺失：**
- 没有"ID → 记忆摘要"的关联映射
- 没有"某条记忆被哪些 session 召回过"的**反向索引**（提成基础）
- recall-live-monitor 只聚合，无明细

---

## 二、推荐方案：方案一（Monkey-patch）✅

**核心思路**：在 RecallService.prototype.recall 上动态包装，不改源码，不改表结构。

### 架构

```
RecallService.recall() — 进程内调用
        ↓ Monkey-patch 拦截返回值（异步）
/home/ai/.openclaw/audit/main_recall_audit.db
        ↓ cron 每5分钟
    报告生成器
```

### SQLite 表设计

```sql
-- 召回明细表
CREATE TABLE recall_audit_detail (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT DEFAULT CURRENT_TIMESTAMP,
  recall_log_id TEXT,
  session_id   TEXT,
  sender_id    TEXT,
  query_text   TEXT,
  intent       TEXT,
  latency_ms   INTEGER,
  memory_id    INTEGER,
  memory_source TEXT,
  score        REAL,
  memory_summary TEXT
);

-- 反向统计表（提成基础）
CREATE TABLE memory_recall_stats (
  memory_id      INTEGER,
  memory_source  TEXT,
  total_recalls INTEGER DEFAULT 0,
  unique_sessions INTEGER DEFAULT 0,
  last_recalled_at TEXT,
  avg_score      REAL,
  PRIMARY KEY (memory_id, memory_source)
);

CREATE INDEX idx_detail_session ON recall_audit_detail(session_id);
CREATE INDEX idx_detail_memory ON recall_audit_detail(memory_id);
CREATE INDEX idx_stats_recalls ON memory_recall_stats(total_recalls DESC);
```

### 实施步骤

1. 创建 `audit-scripts/main-recall-monitor/`
2. 初始化 SQLite 数据库
3. Monkey-patch 脚本（启动时执行一次）
4. 报告生成器（复用副脑模式）
5. 注册 cron

---

## 三、约束

- ✅ 不修改 recall_logs 表结构
- ✅ 不改 RecallService 核心逻辑
- ✅ 监控数据完全隔离（其他程序无法访问）
- ✅ 对主脑零影响
