# LinkMem v2.0 详细实施方案

> 版本：v2.0（经源码审查修正）
> 日期：2026-04-16
> 状态：待主人审批
> 预计总工时：7-10 周（分4阶段）

---

## 一、方案背景与修正说明

### v1.0 原始方案的 6 个关键假设错误（已修正）

| 假设 | 原假设 | 修正后 |
|------|--------|--------|
| A. source_message_ids 类型 | 字符串索引 | 已是 `BIGINT[]`，指向 conversation_messages.id |
| B. summary-extractor 三写 | 同时写 3 个目标 | 仅占 personal_memories 的 <1% 来源 |
| C. memory_summaries 未接入 recall | 需要额外接入 | `_vectorSearchSummaries()` 早已存在 |
| D. graph-linker Redis Stream | 待验证 | 确认消费 `graph:sync:events` Stream |
| E. personal_memories 来源 | 只有 summary-extractor | 78% 来自 session-file-extractor，18.5% 来自 tech-doc |
| F. P99 延迟余量 | 还剩 5ms | P99 = 431ms，已超预算 81.6ms |

### 源码审查新增关键发现

- P99 延迟已超出预算 81.6ms（不是"只剩 5ms"，而是"已超 81ms"）
- personal_memories 有 3 个数据来源，summary-extractor 不是主要来源
- summary-extractor 的 `saveSummary()` 缺少幂等逻辑，导致同一对话被重复摘要

---

## 二、最终实施路径总览

```
Phase 0: 止血（1周）
  ├── T0.1 摘要幂等写入修复
  ├── T0.2 历史重复摘要清理
  └── T0.3 P99 延迟优化

Phase 1: 基础设施（2周）
  ├── T1.1 conversation_pairs 物化视图
  ├── T1.2 三写事务化（Outbox Pattern）
  └── T1.3 junction table 建立（source_message_links）

Phase 2: 链路追溯（2周）
  ├── T2.1 逆向追溯查询接口
  └── T2.2 entity_registry 表

Phase 3: 关系网络（2-3周）
  ├── T3.1 Neo4j DERIVED_FROM 关系
  ├── T3.2 summary↔summary 跨 session 关系
  └── T3.3 memory_relations 表 DROP
```

---

## 三、Phase 0：止血

**目标**：修复已知问题，为后续重构提供稳定基础

### T0.1 摘要幂等写入修复

**问题**：`summary-extractor.js` 的 `saveSummary()` 缺少幂等逻辑，同一 source_session_id + source_message_ids 可产生多条摘要（LLM 非确定性）。

**改动文件**：`memory-system/scripts/summary-extractor.js`

**改动内容**：
在 `saveSummary()` 方法开头增加判重逻辑：

```javascript
// 在 saveSummary() 开头新增
async function saveSummary(conversationId, messages, summaryData) {
  // 检查是否已存在相同 source 的摘要（幂等）
  const existing = await db.query(`
    SELECT id FROM memory_summaries
    WHERE source_session_id = $1
    AND encode(sha256(summary), 'hex') = encode(sha256($2), 'hex')
    LIMIT 1
  `, [conversationId, summaryData.summaryText]);

  if (existing.rows.length > 0) {
    console.log(`[summary-extractor] Duplicate summary skipped for session ${conversationId}`);
    return existing.rows[0].id;
  }
  // ... 原有写入逻辑
}
```

**影响范围**：仅 summary-extractor.js，无其他组件耦合
**风险等级**：🟡 中（单文件改动，有回滚方案）

---

### T0.2 历史重复摘要清理

**问题**：memory_summaries 中存在同一 session 的多条重复摘要（id=1/2/3 内容几乎相同）。

**改动文件**：新建 `scripts/cleanup-duplicate-summaries.js`

**改动内容**：
```javascript
// 1. 找出重复摘要（按 source_session_id 分组）
const dupGroups = await db.query(`
  SELECT source_session_id, array_agg(id ORDER BY created_at) as ids
  FROM memory_summaries
  GROUP BY source_session_id
  HAVING COUNT(*) > 1
`);

// 2. 每组保留最新一条，标记其余为 is_active=false
for (const group of dupGroups.rows) {
  const [keepId, ...removeIds] = group.ids;
  await db.query(`
    UPDATE memory_summaries
    SET is_active = false, updated_at = NOW()
    WHERE id = ANY($1)
  `, [removeIds]);
}
```

**影响范围**：仅读 memory_summaries，不影响运行中组件
**风险等级**：🟢 低（只读不写，清理脚本可重复运行）

---

### T0.3 P99 延迟优化

**问题**：P99 = 431ms，已超 350ms 预算 81.6ms

**数据现状**：
- personal_memories: 17,917 条（tech-doc 类型 3,317 条占 18.5%）
- memory_summaries: 723 条
- recall P50=78ms, P95=257ms, P99=431ms

**改动文件**：`memory-system/hooks/recall-hook/handler.js`
`memory-system/scripts/session-recall.js`

**改动内容**：

```javascript
// session-recall.js - 优化 HNSW 候选数
const RECALL_CONFIG = {
  // ... 原有配置

  // T0.3 改动：减少 tech-doc 类型的召回权重
  categoryWeights: {
    'dialogue': 1.0,
    'tech-doc': 0.3,      // 降权，tech-doc 召回价值低
    'decision': 1.5,       // 加权，decision 类型高价值
    'technical': 1.3,      // 加权
    'factual': 1.0,
    'preference': 1.0,
    'event': 1.0,
    'plan': 1.2,
    // 其他 type 默认 0.8
  },

  // T0.3 改动：减少 personal_memories 的候选数
  // 从 17,917 条中减少扫描量
  personalMemoriesTopK: 15,   // 原为 dynamic，现限制最大 15
};

// handler.js - 增加意图分类精度，减少无效召回
const QUERY_INTENTS = {
  // ... 原有 4 类
  // T0.3 新增 8 类，减少低质量召回
  TECHNICAL: {
    prefilter: ['memories(technical)', 'memory_summaries'],
    graphify: true,
    topK: 5,
  },
  PROJECT: {
    prefilter: ['memory_summaries(project)', 'memories(project)'],
    graphify: true,
    topK: 3,
  },
  // ...
};
```

**验收标准**：
- [ ] recall P99 < 250ms（优化后重新测试）
- [ ] P50 / P95 无明显恶化
- [ ] tech-doc 类型召回率下降但精准度提升

**影响范围**：recall-hook/handler.js + session-recall.js
**风险等级**：🟡 中（recall 热路径，改动后需压测验证）

---

## 四、Phase 1：基础设施

**目标**：建立可追溯的链路，不改运行中逻辑

### T1.1 conversation_pairs 物化视图

**替代方案**：不新建表，用物化视图替代（避免 ID 空间冲突）

**改动文件**：新建 migration SQL

**SQL 内容**：
```sql
-- 不创建 conversation_pairs 表，创建物化视图
CREATE MATERIALIZED VIEW conversation_pairs_view AS
SELECT
  u.id AS user_msg_id,
  a.id AS assistant_msg_id,
  u.session_id,
  u.turn_index,
  u.content AS user_content,
  a.content AS assistant_content,
  u.channel,
  u.created_at AS user_timestamp,
  a.created_at AS assistant_timestamp
FROM conversation_messages u
JOIN conversation_messages a
  ON u.session_id = a.session_id
  AND u.turn_index = a.turn_index
  AND u.role = 'user'
  AND a.role = 'assistant'
WITH DATA;

-- 创建索引
CREATE UNIQUE INDEX ON conversation_pairs_view(session_id, turn_index);
CREATE INDEX idx_conv_view_session ON conversation_pairs_view(session_id);

-- 定期刷新（如每天）
-- REFRESH MATERIALIZED VIEW CONCURRENTLY conversation_pairs_view;
```

**影响范围**：仅创建视图，不影响现有组件
**风险等级**：🟢 低（只读视图，零侵入）
**回滚**：`DROP MATERIALIZED VIEW conversation_pairs_view;`

---

### T1.2 三写事务化（Outbox Pattern）

**问题**：summary-extractor 同时写 memory_summaries + personal_memories + Neo4j，无事务保障

**现状**：
- personal_memories 的 78% 来自 session-file-extractor（extractor-file-based.js）
- summary-extractor 仅占 <1%，但仍存在一致性问题
- Neo4j 同步为 fire-and-forget

**改动文件**：
- `memory-system/scripts/summary-extractor.js`
- 新建 `scripts/outbox-writer.js`

**改动内容**：

```javascript
// summary-extractor.js - 改造 saveSummary
async function saveSummary(conversationId, messages, summaryData) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // 1. 写入 memory_summaries（主表）
    const summaryResult = await client.query(`
      INSERT INTO memory_summaries (summary, summary_type, source_session_id,
        embedding, confidence, metadata, source_message_ids)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `, [...]);

    // 2. 写入 outbox 表（替代直接写 personal_memories 和 Neo4j）
    await client.query(`
      INSERT INTO memory_outbox (event_type, payload, status, created_at)
      VALUES ('summary_created', $1, 'pending', NOW())
    `, [JSON.stringify({
      summary_id: summaryResult.rows[0].id,
      source_session_id: conversationId,
      summary: summaryData.summaryText,
      summary_type: summaryData.type,
    })]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

```sql
-- 新建 outbox 表
CREATE TABLE memory_outbox (
  id BIGSERIAL PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX idx_outbox_status ON memory_outbox(status) WHERE status = 'pending';
CREATE INDEX idx_outbox_created ON memory_outbox(created_at);
```

```javascript
// 新建 outbox-writer.js（PM2 独立进程）
// 每 10 秒轮询 outbox 表，驱动下游同步
async function processOutbox() {
  const events = await db.query(`
    SELECT * FROM memory_outbox
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT 50
  `);

  for (const event of events.rows) {
    try {
      if (event.event_type === 'summary_created') {
        const payload = event.payload;
        // 写 personal_memories
        await writePersonalMemory(payload);
        // 发 Neo4j 同步事件
        await publishNeo4jEvent(payload);
      }
      await db.query(
        `UPDATE memory_outbox SET status = 'processed', processed_at = NOW() WHERE id = $1`,
        [event.id]
      );
    } catch (err) {
      console.error(`[outbox-writer] Failed to process event ${event.id}:`, err.message);
      // 保留 pending 状态，重试
    }
  }
}
```

**影响范围**：summary-extractor.js（高），新增 outbox-writer.js（中）
**风险等级**：🟠 高（事务改造，有回滚窗口期）
**回滚**：git checkout summary-extractor.js 旧版，停止 outbox-writer PM2 进程

---

### T1.3 junction table 建立（source_message_links）

**目的**：将 source_message_ids 从 BIGINT[] 数组改为标准关系表，解决外键完整性问题

**注意**：source_message_ids 已是 BIGINT[] 类型（指向 conversation_messages.id），无需迁移 ID 类型，只需建立 junction table 提供反向查询能力。

**改动文件**：新建 migration SQL

**SQL 内容**：
```sql
-- 建立 junction table
CREATE TABLE summary_message_links (
  id BIGSERIAL PRIMARY KEY,
  summary_id BIGINT NOT NULL REFERENCES memory_summaries(id) ON DELETE CASCADE,
  message_id BIGINT NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
  link_order SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(summary_id, message_id)
);

CREATE INDEX idx_sml_summary ON summary_message_links(summary_id);
CREATE INDEX idx_sml_message ON summary_message_links(message_id);

-- 迁移历史数据（从 source_message_ids 数组展开）
-- 注意：source_message_ids 已是 BIGINT[]，直接展开
INSERT INTO summary_message_links (summary_id, message_id, link_order)
SELECT
  ms.id AS summary_id,
  (unnest(ms.source_message_ids))::BIGINT AS message_id,
  generate_subscripts(ms.source_message_ids, 1) AS link_order
FROM memory_summaries ms
WHERE ms.source_message_ids IS NOT NULL
AND ms.source_message_ids != '{}'
ON CONFLICT(summary_id, message_id) DO NOTHING;

-- 验证迁移
SELECT
  (SELECT COUNT(*) FROM summary_message_links) AS link_count,
  (SELECT SUM(array_length(source_message_ids, 1)) FROM memory_summaries
   WHERE source_message_ids IS NOT NULL) AS expected_count;
```

**验收标准**：
- [ ] link_count = expected_count（完全一致）
- [ ] 外键约束生效（无效 message_id 无法写入）

**影响范围**：仅新建表，不影响运行中组件
**风险等级**：🟢 低（只增表，不改现有数据）
**回滚**：`DROP TABLE summary_message_links;`

---

## 五、Phase 2：链路追溯

**目标**：建立可执行的逆向追溯路径

### T2.1 逆向追溯查询接口

**目的**：给定 summary_id，可查询原始对话内容

**改动文件**：新建 `scripts/get-summary-sources.js`

**查询 SQL**：
```sql
-- 逆向追溯：给定 summary_id → 原始对话
SELECT
  sml.link_order,
  cm.role,
  cm.content,
  cm.created_at,
  cp.user_content AS user_msg,
  cp.assistant_content AS assistant_msg
FROM summary_message_links sml
JOIN conversation_messages cm ON cm.id = sml.message_id
LEFT JOIN conversation_pairs_view cp
  ON cp.user_msg_id = cm.id OR cp.assistant_msg_id = cm.id
WHERE sml.summary_id = $1
ORDER BY sml.link_order;
```

```javascript
// get-summary-sources.js
async function getSummarySources(summaryId) {
  const result = await db.query(`
    SELECT
      sml.link_order,
      cm.role,
      cm.content,
      cp.user_content,
      cp.assistant_content,
      cp.session_id,
      cp.turn_index
    FROM summary_message_links sml
    JOIN conversation_messages cm ON cm.id = sml.message_id
    LEFT JOIN conversation_pairs_view cp
      ON (cp.user_msg_id = cm.id OR cp.assistant_msg_id = cm.id)
      AND cp.session_id = cm.session_id
    WHERE sml.summary_id = $1
    ORDER BY sml.link_order
  `, [summaryId]);

  return result.rows;
}
```

**影响范围**：仅新增查询函数，无写入改动
**风险等级**：🟢 低

---

### T2.2 entity_registry 表

**目的**：统一管理跨 session 的实体别名，解决"同一实体不同名称"的问题

**SQL**：
```sql
CREATE TABLE entity_registry (
  id BIGSERIAL PRIMARY KEY,
  canonical_name TEXT NOT NULL,          -- 规范名称
  aliases TEXT[] NOT NULL,               -- 别名列表
  entity_type VARCHAR(30),               -- person/project/system/preference
  tenant_id UUID,
  user_id UUID,
  confidence DOUBLE PRECISION DEFAULT 0.8,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_entity_canonical ON entity_registry(canonical_name, tenant_id);

-- 自动发现别名（基于 entity 共现分析）
-- 由 relation-discoverer 在 Phase 3 调用
```

**影响范围**：新增表，不影响现有组件
**风险等级**：🟢 低

---

## 六、Phase 3：关系网络

**目标**：在 Neo4j 中建立记忆间关系，不在 PG 预存

### T3.1 Neo4j DERIVED_FROM 关系

**目的**：将 summary 与原始对话通过 junction table 建立 Neo4j 关系

**改动文件**：`memory-system/scripts/sync-summaries-to-neo4j.js`（扩展）

**Cypher 语句**：
```javascript
// 给定 summary_id，在 Neo4j 中建立关系
async function syncDerivedFrom(summaryId) {
  const sources = await getSummarySources(summaryId);

  const session = neo4jDriver.session();
  try {
    await session.run(`
      MATCH (s:PersonalMemory {node_id: $summaryId})
      FOREACH (msg IN $sources |
        MERGE (m:ConversationMessage {msg_id: msg.message_id})
        MERGE (s)-[r:DERIVED_FROM {link_order: msg.link_order}]->(m)
      )
    `, { summaryId: String(summaryId), sources });
  } finally {
    await session.close();
  }
}
```

---

### T3.2 summary↔summary 跨 session 关系

**目的**：跨 session 的语义关系（同主题、同项目、相关决策）

**策略**：只建立 L1↔L1 关系（summary ↔ summary），不做 memory ↔ memory

**关系类型**：
- `RELATED_TO`（语义相关）
- `SAME_TOPIC`（同一话题）
- `FOLLOWS`（后续 session 延续）

**发现策略**：
1. 基于向量相似度（余弦距离 < 0.15）
2. 基于 entity 共现（同 entity 出现在不同 session）
3. 基于 intent 类型（technical↔technical 高概率相关）

**限制**：
- 每个 summary 最多建立 20 条关系
- 关系权重低于 0.3 不写入

---

### T3.3 memory_relations 表 DROP

**执行条件**：确认 Neo4j 关系已覆盖所有需求，且无外部依赖

```sql
-- 确认 0 行
SELECT COUNT(*) FROM memory_relations;

-- 确认无外部查询依赖
-- (需人工检查所有调用 memory_relations 的代码)

-- 执行 DROP
DROP TABLE memory_relations;
```

---

## 七、组件影响清单

| 组件 | Phase 0 | Phase 1 | Phase 2 | Phase 3 |
|------|---------|---------|---------|---------|
| summary-extractor.js | 🔴 修改 | 🔴 修改 | — | — |
| session-recall.js | 🟡 修改 | — | — | — |
| handler.js (recall-hook) | 🟡 修改 | — | — | — |
| extractor-file-based.js | — | — | — | — |
| graph-linker.js | — | 🟡 扩展 | — | 🟡 扩展 |
| outbox-writer.js (新建) | — | 🔴 新建 | — | — |
| sync-summaries-to-neo4j.js | — | 🟡 扩展 | — | 🟡 扩展 |
| get-summary-sources.js (新建) | — | — | 🟢 新建 | — |
| entity_registry (新建) | — | — | 🟢 新建 | — |
| health-check.js | — | 🟢 新增检查 | — | 🟢 新增检查 |
| PM2 进程 | — | 🔴 新增1个 | — | — |

**影响组件总数**：4 个修改，5 个新建，2 个扩展

---

## 八、危险点清单

| # | 危险点 | 影响 | 缓解措施 |
|---|--------|------|---------|
| H1 | summary-extractor 事务改造可能丢数据 | 🔴 高 | 双写过渡期：outbox + 直接写入同时进行，验证后切换 |
| H2 | P99 延迟优化可能影响召回质量 | 🟠 中 | 压测验证，优化前后 A/B 对比 |
| H3 | junction table 迁移数据不一致 | 🟠 中 | 迁移后校验 COUNT 一致性 |
| H4 | conversation_pairs_view 刷新时机 | 🟡 低 | 使用 CONCURRENTLY 刷新，不阻塞读 |
| H5 | entity_registry 别名冲突 | 🟡 低 | canonical_name 唯一约束，自动合并 |
| H6 | Neo4j 关系写入失败 | 🟢 低 | fire-and-forget + 批量回填兜底 |
| H7 | memory_relations DROP 后外部依赖 | 🟠 中 | DROP 前人工检查所有依赖代码 |
| H8 | outbox-writer PM2 进程故障 | 🟡 中 | recall 有 memory_summaries 兜底，不依赖 personal_memories |

---

## 九、验收标准汇总

### Phase 0 验收
- [ ] T0.1: 同一对话重复调用 saveSummary 不产生重复摘要
- [ ] T0.2: memory_summaries 重复率降至 < 1%
- [ ] T0.3: recall P99 < 250ms，P50/P95 无恶化

### Phase 1 验收
- [ ] T1.1: `SELECT * FROM conversation_pairs_view LIMIT 10` 正确返回配对
- [ ] T1.2: outbox-writer 进程运行稳定，personal_memories 写入延迟 < 5s
- [ ] T1.3: summary_message_links 行数 = SUM(array_length)，外键约束生效

### Phase 2 验收
- [ ] T2.1: `getSummarySources(summaryId)` 返回完整对话内容
- [ ] T2.2: entity_registry 可正确管理别名

### Phase 3 验收
- [ ] T3.1: Neo4j 中 PersonalMemory 节点有 DERIVED_FROM 关系
- [ ] T3.2: 每个 summary 最多 20 条跨 session 关系
- [ ] T3.3: memory_relations 已 DROP

---

## 十、回滚方案

| Phase | 回滚命令 |
|-------|---------|
| Phase 0 | `git checkout summary-extractor.js`，重跑清理脚本 |
| Phase 1 | `git checkout summary-extractor.js`，`DROP TABLE IF EXISTS summary_message_links`，`DROP MATERIALIZED VIEW IF EXISTS conversation_pairs_view`，停止 outbox-writer |
| Phase 2 | `DROP TABLE IF EXISTS entity_registry` |
| Phase 3 | 重新创建 memory_relations 表结构（从 schema 历史恢复） |

---

## 十一、PM2 进程变更

### 当前 PM2 进程（memory-system）
```
#0 session-extractor  ✅ 运行中
#1 graph-linker        ✅ 运行中
#2 summary-extractor   ✅ 运行中
```

### Phase 1 后新增
```
#9 outbox-writer      🔴 新增（消费 outbox 表事件）
```

### Phase 3 后变更
```
#0 session-extractor  ✅
#1 graph-linker       ✅（扩展支持 DERIVED_FROM）
#2 summary-extractor  ✅（事务改造）
#9 outbox-writer      ✅
```

---

_文档版本：v2.0_
_最后更新：2026-04-16_
_方案状态：待主人审批_
