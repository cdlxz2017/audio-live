# LinkMem v2.0 — Phase 1 基础设施执行报告

**执行日期**: 2026-06-22
**执行人**: 玄枢（天道AI）
**状态**: ✅ 全部完成

---

## 一、任务执行结果

### T1.1 conversation_pairs_view 物化视图

**目的**: 替代新建 `conversation_pairs` 表，用物化视图提供"对话对"语义（user↔assistant 配对），零存储零迁移。

**SQL 执行**:
```sql
CREATE MATERIALIZED VIEW conversation_pairs_view AS
SELECT u.id AS user_msg_id, a.id AS assistant_msg_id, u.session_id, u.turn_index,
       u.content AS user_content, a.content AS assistant_content, u.channel,
       u.created_at AS user_timestamp, a.created_at AS assistant_timestamp
FROM conversation_messages u
JOIN conversation_messages a
  ON u.session_id = a.session_id AND u.turn_index = a.turn_index
  AND u.role = 'user' AND a.role = 'assistant'
WITH DATA;
```

**索引**:
- `UNIQUE INDEX` on `(session_id, turn_index)` ✅
- `idx_conv_view_session` on `session_id` ✅

**验证结果**:
- 行数: **417 条**对话对
- 数据样本正常，user→assistant 配对正确，turn_index 连续
- 无脏数据

---

### T1.2 memory_outbox 表

**目的**: 为 Phase 2 summary-extractor 改造预写出队列表，实现 Outbox Pattern，确保内存写入的事件可靠性。

**SQL 执行**:
```sql
CREATE TABLE memory_outbox (
  id BIGSERIAL PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);
```

**索引**:
- `idx_outbox_status` — 部分索引，仅索引 `status = 'pending'` ✅
- `idx_outbox_created` — 时间索引 ✅

**表结构验证**:

| 列名 | 类型 | 可空 | 默认值 |
|------|------|------|--------|
| id | bigint | NO | nextval |
| event_type | varchar(50) | NO | — |
| payload | jsonb | NO | — |
| status | varchar(20) | NO | 'pending' |
| created_at | timestamptz | YES | now() |
| processed_at | timestamptz | YES | — |

**验证**: 0 行（空表，符合预期）

---

### T1.3 summary_message_links Junction Table

**目的**: 建立 summary 与原始消息的多对多关联表，替代 BIGINT[] 数组方案，提供外键约束保证引用完整性。

**SQL 执行**:
```sql
CREATE TABLE summary_message_links (
  id BIGSERIAL PRIMARY KEY,
  summary_id BIGINT NOT NULL REFERENCES memory_summaries(id) ON DELETE CASCADE,
  message_id BIGINT NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
  link_order SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(summary_id, message_id)
);
```

**索引**:
- `idx_sml_summary` on `summary_id` ✅
- `idx_sml_message` on `message_id` ✅

**表结构验证**:

| 列名 | 类型 | 可空 | 默认值 |
|------|------|------|--------|
| id | bigint | NO | nextval |
| summary_id | bigint | NO | — |
| message_id | bigint | NO | — |
| link_order | smallint | NO | 0 |
| created_at | timestamptz | YES | now() |

**外键验证**:
- `summary_id` → `memory_summaries.id` (ON DELETE CASCADE) ✅
- `message_id` → `conversation_messages.id` (ON DELETE CASCADE) ✅
- `UNIQUE(summary_id, message_id)` 约束 ✅

---

## 二、三个对象的功能说明

### conversation_pairs_view
将 `conversation_messages` 表中同一 session、同一 turn_index 的 user 消息和 assistant 消息配对，提供"一轮对话"语义。用于替代原本需要新建的 `conversation_pairs` 表，**零存储开销**（物化视图数据来自基表），但需要定期 REFRESH 保持数据最新。

### memory_outbox
Outbox Pattern 的核心表。summary-extractor 写入内存事件时先写入此表（status=pending），由独立消费者轮询处理，处理完成后标记 processed_at。确保即使提取器崩溃，事件也不会丢失（crash-safe）。Phase 2 改造 summary-extractor 时对接此表。

### summary_message_links
Junction table，解决之前用 BIGINT[] 数组存储关联消息 ID 的问题。现在每个关联关系都是独立的行，可以设置外键约束（CASCADE 删除），保证引用完整性。`link_order` 字段支持排序。

---

## 三、风险评估

| 风险 | 等级 | 说明 |
|------|------|------|
| 物化视图数据陈旧 | 低 | 需要定时 REFRESH，建议配合 cron 或 trigger |
| outbox 表堆积 | 低 | 当前无消费者，Phase 2 接入后需监控 pending 数量 |
| 外键级联删除 | 低 | CASCADE 删除是预期行为，summary 删除会自动清理 links |
| 性能影响 | 极低 | 仅添加表和视图，无数据迁移，不影响现有查询 |

**总体风险**: 🟢 **极低** — 均为新建对象，不修改现有表结构或数据

---

## 四、验收清单

- [x] T1.1: `conversation_pairs_view` 物化视图创建成功
- [x] T1.1: 唯一索引 `(session_id, turn_index)` 已创建
- [x] T1.1: `idx_conv_view_session` 索引已创建
- [x] T1.1: 验证 417 行数据，配对正确
- [x] T1.2: `memory_outbox` 表创建成功
- [x] T1.2: 部分索引 `idx_outbox_status` 已创建
- [x] T1.2: `idx_outbox_created` 索引已创建
- [x] T1.2: 表结构验证通过（6列，类型正确）
- [x] T1.3: `summary_message_links` 表创建成功
- [x] T1.3: `idx_sml_summary` 索引已创建
- [x] T1.3: `idx_sml_message` 索引已创建
- [x] T1.3: 两个外键约束验证通过（CASCADE 删除）
- [x] T1.3: UNIQUE 约束验证通过
- [x] 无现有数据受到影响
- [x] 所有对象在 `openclaw_memory` 数据库中

**Phase 1 全部完成 ✅**
