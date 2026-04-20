# 记忆召回系统实时监控研究分析报告

> **研究日期**: 2026-04-20  
> **研究者**: 玄枢 · Researcher 子程序  
> **目标**: 为记忆召回系统建立实时监控体系，研究现状与改进方向

---

## 1. 现有召回监控全貌

### 1.1 当前监控组件一览

| 组件 | 类型 | 采样频率 | 监控内容 | 文件位置 |
|------|------|---------|---------|---------|
| `recall-monitor.js` | 定时检查 | 每4小时 | 调用次数、平均/最大延迟、按意图分布、高延迟记录 | `scripts/recall-monitor.js` |
| `recall-deep-inspector.js` | 手动诊断 | 按需执行 | 历史趋势、意图分类测试、真实召回测试、Redis一致性 | `memory-system/scripts/recall-deep-inspector.js` |
| `learning-engine-monitor.js` | 手动诊断 | 按需执行 | learned文件数、feedback统计、研究日志 | `memory-system/scripts/learning-engine-monitor.js` |
| `health-check.js` | 定时检查 | 每日9am | 记忆系统整体健康状态 | `memory-system/scripts/health-check.js` |
| **recall_logs 表** | 数据存储 | 每次召回写入 | 原始调用明细 | PostgreSQL `openclaw_memory` |

### 1.2 recall_logs 表结构

```
recall_logs (2026-04-04 ~ 2026-04-20, 共412条记录)
├── id                 uuid       NOT NULL
├── tenant_id          uuid       NOT NULL
├── user_id            uuid
├── session_id         uuid
├── query_text         text       NOT NULL
├── query_embedding    vector(1024)  -- BGE-m3 1024维
├── recalled_ids       bigint[]   NOT NULL
├── scores             float[]    NOT NULL  -- 原始 cosine 距离
├── latency_ms         integer    NOT NULL
├── feedback           smallint              -- 用户反馈: 1正向/-1负向
├── created_at         timestamptz NOT NULL
├── intent             varchar(50)          -- DEFAULT/PROJECT/TECHNICAL/PREFERENCE/FEEDBACK
├── sender_id_text     text
└── recalled_sources   text[]              -- 召回来源: [memory_summaries, memories, personal_memories]
```

**关键字段缺失**:
- ❌ `source` — 无法区分 user call / proactive call / cron call
- ❌ `recall_score` — 精排后的综合评分未记录
- ⚠️ `feedback` — 仅1条记录（未真正启用）
- ⚠️ `recalled_sources` — 已有字段但未被任何监控脚本分析

### 1.3 现有监控架构图

```
                    ┌─────────────────────────────┐
                    │   before_prompt_build hook   │
                    │   → RecallService.recall()  │
                    └──────────────┬──────────────┘
                                   │ 每次召回写入
                                   ▼
                         ┌─────────────────────┐
                         │   recall_logs 表     │
                         │  (PG openclaw_memory) │
                         └──────────┬──────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          │                         │                         │
          ▼                         ▼                         ▼
  ┌───────────────┐       ┌─────────────────┐       ┌──────────────────┐
  │ recall-monitor │       │deep-inspector.js│       │learning-engine   │
  │  (每4小时邮件)  │       │   (按需手动)    │       │ -monitor (按需)  │
  └───────────────┘       └─────────────────┘       └──────────────────┘
          │
          ▼
  📧 邮件报告 (cdlxz2017@qq.com)
```

**问题**: 监控完全被动，无实时告警，无 Dashboard，无主动巡检。

---

## 2. recall_logs 数据分析

### 2.1 数据时间范围与规模

| 指标 | 值 |
|------|-----|
| 总记录数 | **412 条** |
| 数据起始 | 2026-04-04 00:30 (16天前) |
| 最新记录 | 2026-04-20 04:10 (今日凌晨) |
| 日均记录 | ~25条/天 |

### 2.2 按日期分布

| 日期 | 总调用 | 平均延迟ms | 最大延迟ms | 备注 |
|------|--------|-----------|-----------|------|
| 2026-04-20 | 6 | 270 | 1030 | 今日凌晨，活跃中 |
| 2026-04-19 | 11 | 211 | 301 | |
| 2026-04-18 | 21 | 269 | 1305 | ⚠️ 有异常高延迟 |
| 2026-04-17 | 3 | 167 | 281 | |
| 2026-04-16 | 40 | 145 | 303 | |
| 2026-04-15 | 24 | 142 | 301 | |
| 2026-04-14 | 34 | 245 | 1671 | ⚠️ 有极端值 |
| 2026-04-13 | 8 | 200 | 265 | |
| 2026-04-12 | 52 | 219 | **2460** | 🔴 全局最大延迟 |
| 2026-04-11 | **150** | 61 | 255 | 🟢 最高活跃日 |
| 2026-04-10 | 42 | 65 | 173 | 🟢 早期优质数据 |
| 2026-04-04 | 21 | 94 | 133 | |

**观察**: 4月11日出现调用高峰(150条)，之后骤降并趋于稳定(~20-40条/天)。4月18日-20日调用量极低，可能与系统运行状态有关。

### 2.3 按意图分布（近7天）

| Intent | 调用次数 | 平均延迟ms | 最大延迟ms | 平均召回数 |
|--------|---------|-----------|-----------|-----------|
| PROJECT | 68 | 180 | 455 | 10 |
| DEFAULT | 31 | 235 | 1671 | 9 |
| TECHNICAL | 27 | **281** | 1305 | 10 |
| PREFERENCE | 18 | **94** | 242 | 10 |
| FEEDBACK | 1 | 0 | 0 | - |

**分析**:
- TECHNICAL 类延迟最高（281ms avg），是 PREFERENCE 的 3 倍
- DEFAULT 类有极端值（1671ms），明显异常
- FEEDBACK 类仅1条，说明用户反馈机制未激活

### 2.4 延迟分位数（近7天）

| 分位数 | 延迟ms | 目标 | 状态 |
|--------|--------|------|------|
| P50 | **176** | <100ms | ⚠️ 超出 |
| P90 | **275** | <150ms | ❌ 严重超出 |
| P95 | **304** | <150ms | ❌ 严重超出 |
| P99 | **1184** | <150ms | 🔴 极端异常 |

**结论**: 当前 P50 已超过目标值，P99 达到 1184ms（近1.2秒），急需优化。

### 2.5 近4小时窗口

| 指标 | 值 |
|------|-----|
| 调用次数 | 6 |
| 平均延迟 | 270ms |
| 最大延迟 | 1030ms |
| 慢调用(>200ms) | 1次 |

**观察**: 仅6次调用/4小时，采样极稀疏，无法支撑实时监控的可靠性。

### 2.6 Feedback 使用情况

| Feedback值 | 记录数 | 说明 |
|-----------|--------|------|
| 1 | 1 | 正向反馈 |
| NULL | 411 | 99.8%未反馈 |

**结论**: feedback 机制完全未启用，recall_logs 中没有召回质量的人工标注数据。

---

## 3. 缺失的监控指标清单

### 3.1 已有数据但未被监控的指标

| 指标 | 字段 | 监控状态 | 说明 |
|------|------|---------|------|
| 召回来源分布 | `recalled_sources` | ❌ 未分析 | 可分析 memory_summaries/memories/personal_memories 各来源贡献 |
| 召回数量 | `recalled_ids` | ⚠️ 仅avg，无趋势 | 未监控各 intent 的召回数量变化 |
| embedding 质量 | `query_embedding` | ❌ 未使用 | 1024维向量未被分析（稀疏/异常检测） |
| 分数据源调用量 | `sender_id_text` | ❌ 未分析 | 可区分不同渠道的召回触发量 |

### 3.2 有价值但未采集的指标

| 指标 | 采集方式 | 优先级 |
|------|---------|--------|
| **recall_score（精排综合分）** | recall返回后写入日志 | 🔴 极高 |
| **source（调用来源）** | hook注入: 'user'/'proactive'/'cron'/'test' | 🔴 极高 |
| **P50/P90/P95/P99 分位数** | 定时 SQL 查询 | 🔴 极高 |
| **每小时调用量趋势** | cron 每15min 查询 | 🔴 极高 |
| **意图分类准确率** | 人工抽检 + feedback | 🟡 高 |
| **Embedding 延迟** | HNSW前后计时差 | 🟡 高 |
| **缓存命中率** | Redis recall_metric 对比 | 🟡 高 |
| **Graphify 触发率** | recall_logs 新增 graphify_hit 字段 | 🟡 高 |
| **无结果召回率** | `WHERE array_length(recalled_ids) = 0` | 🟡 高 |
| **Token 消耗** | LLM 调用日志 | 🟢 中 |
| **用户满意度（CSAT）** | 主动收集 | 🟢 中 |

### 3.3 召回质量评估维度（当前缺失）

| 维度 | 指标 | 当前状态 |
|------|------|---------|
| **相关性** | recall_score, HitRate@K | ❌ 未采集 recall_score |
| **准确性** | 无结果召回率、虚假召回率 | ❌ 未监控 |
| **响应速度** | P50/P90/P95/P99 latency | ⚠️ recall-monitor 仅有 avg/max |
| **覆盖度** | recall@1/3/10, 意图覆盖率 | ❌ 未实现 |
| **新鲜度** | 召回记忆的平均年龄 | ❌ 未监控 |
| **多样性** | 召回来源分布、重复召回率 | ❌ 未监控 |

---

## 4. 业界召回监控最佳实践

### 4.1 标准召回评估指标（来自 LlamaIndex / Pinecone / Weaviate）

#### 核心指标

| 指标 | 公式/含义 | 目标值 | 适用场景 |
|------|----------|--------|---------|
| **HitRate@K** | top-K 中包含相关结果的比例 | >0.8@3 | 快速衡量召回质量 |
| **MRR (Mean Reciprocal Rank)** | 第一个相关结果排名的倒数均值 | >0.6 | 排名敏感性场景 |
| **NDCG@K** | 归一化折损累计增益（考虑排名位置） | >0.5@10 | 排序质量评估 |
| **Recall@K** | 相关文档在 top-K 中的比例 | >0.7@10 | 漏检敏感场景 |
| **Precision@K** | top-K 中相关文档的比例 | >0.5@5 | 噪音敏感场景 |

#### recall@K 详解

- **recall@1**: 仅看第一名，适合"正确答案就在顶部"的场景
- **recall@3**: 看前三名，适合大多数 RAG 场景
- **recall@10**: 看前10名，适合需要广泛探索的查询
- **公式**: `recall@K = |relevant_in_topK| / |total_relevant|`

#### 本系统参考

当前 recall_logs 有 `scores`（原始 cosine 距离）和 `recalled_ids`，但**没有精排后的 recall_score**，无法计算 HitRate@K。

### 4.2 实时监控技术方案

#### 推荐监控架构

```
RecallService.recall()
       │
       ├── embedding latency  ──► Vector DB (pgvector)
       ├── HNSW latency      ──► PostgreSQL (pg_stats)
       ├── rerank latency    ──► Memory
       └── recall_score      ──► recall_logs ──► Prometheus ──► Grafana
                                                              │
       ┌──────────────────────────────────────────────────────┘
       ▼
recall_logs (PG) ──► Cron Job (每15min) ──► 指标聚合 ──► Alert
                                              │
                                              ▼
                                        Redis (缓存)
                                              │
                                              ▼
                                        Telegram/DingTalk (告警)
```

#### 关键技术组件

1. **Prometheus + Grafana**: 采集 recall_logs 分位数指标，可视化 Dashboard
2. **Alertmanager**: P99 > 500ms 或调用量为0时触发告警
3. **Langfuse / Phoenix**: LLM 应用可观测性平台，支持 RAG trace（参考 langfuse.com 2025-10-28 文章）
4. **自定义 Cron**: 每15min 采集一次关键指标，写入 Redis，供 Dashboard 消费

### 4.3 关键监控指标阈值建议

| 指标 | 警告阈值 | 严重阈值 | 当前状态 |
|------|---------|---------|---------|
| P99 延迟 | >300ms | >800ms | ❌ 1184ms (严重) |
| P50 延迟 | >150ms | >250ms | ⚠️ 176ms (警告) |
| 每小时调用量 | <2次 | <1次 | ⚠️ ~0.25次/h (严重) |
| 无结果召回率 | >5% | >10% | ❓ 未知 |
| feedback 缺失率 | >95% | - | ❌ 99.8% |

---

## 5. 推荐新增的监控指标（带优先级）

### 🔴 P0 - 必须立即实现（不影响现有逻辑）

| # | 指标名称 | 采集位置 | 实现方式 |
|---|---------|---------|---------|
| P0-1 | **recall_score 写入** | `RecallService.recall()` 返回后 | 在写入 recall_logs 时增加 `recall_score` 字段 = `topResult.score`，现有 SQL 无需改 schema（用 scores[] 平均值作为替代） |
| P0-2 | **source 来源标记** | hook 调用处 | 在 `before_prompt_build` 注入 `source='user'`，proactive/cron 单独处理 |
| P0-3 | **P50/P90/P95/P99 分位数** | recall-monitor 新增 | 新增 SQL: `percentile_cont() WITHIN GROUP` |
| P0-4 | **每小时调用量趋势** | cron 每15min | `SELECT date_trunc('hour')... GROUP BY` 写入 Redis |

### 🟠 P1 - 高优先级（增强监控能力）

| # | 指标名称 | 采集位置 | 实现方式 |
|---|---------|---------|---------|
| P1-1 | **HitRate@3** | 离线分析 | recall_score > 阈值(如0.5) 的比例，或等效用 scores 平均值 |
| P1-2 | **Graphify 触发率** | `fetchGraphifyContext()` 调用处 | 新增字段 `graphify_hit = true/false` 写入日志 |
| P1-3 | **无结果召回率** | `RecallService.recall()` | `WHERE array_length(recalled_ids) = 0` 监控 |
| P1-4 | **recalled_sources 分布分析** | recall-deep-inspector 新增模块 | 分析 text[] 数组中各来源贡献 |
| P1-5 | **意图分类分布趋势** | cron 每小时 | 按 intent 分组计数，Redis 时序 |

### 🟡 P2 - 中优先级（系统优化）

| # | 指标名称 | 实现方式 |
|---|---------|---------|
| P2-1 | **Embedding 延迟拆解** | 在 embedder 调用前后计时，写入 latency_ms 的子阶段 |
| P2-2 | **Redis 缓存命中率** | 对比 recall_metric vs recall_logs 的调用量 |
| P2-3 | **召回记忆新鲜度** | 监控 recalled_ids 对应记忆的 `created_at` 平均年龄 |
| P2-4 | **实时 Dashboard** | Grafana + PostgreSQL 数据源，15min 刷新 |
| P2-5 | **Telegram 告警** | P99 > 800ms 或调用量骤降时推送到微信 |

### 🟢 P3 - 长期优化

| # | 指标名称 | 说明 |
|---|---------|------|
| P3-1 | 用户主动 feedback 收集 | 在召回结果旁增加 👍/👎 按钮，积累标注数据 |
| P3-2 | MRR / NDCG@K 计算 | 待 recall_score 稳定后，计算排名质量指标 |
| P3-3 | A/B 测试框架 | 对比不同意图权重配置的效果 |

---

## 附录：快速 SQL 参考

```sql
-- 1. 延迟分位数（核心指标）
SELECT
  percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) as p50,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY latency_ms) as p90,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) as p95,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms) as p99
FROM recall_logs WHERE created_at > NOW() - INTERVAL '7 days';

-- 2. 每小时活跃度（监控调用量异常）
SELECT date_trunc('hour', created_at) as hour, COUNT(*)
FROM recall_logs WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY hour ORDER BY hour;

-- 3. 无结果召回（需要新增 scores 阈值判断）
SELECT COUNT(*) FROM recall_logs
WHERE created_at > NOW() - INTERVAL '7 days'
  AND array_length(recalled_ids, 1) = 0;

-- 4. recalled_sources 分布（新增分析）
SELECT
  unnest(recalled_sources) as source,
  COUNT(*)
FROM recall_logs, unnest(recalled_sources)
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY source ORDER BY COUNT(*) DESC;
```

---

## 总结

| 维度 | 当前状态 | 推荐行动 |
|------|---------|---------|
| 监控频率 | 4小时一次（太稀疏）| 提升到15分钟，告警实时推送 |
| 延迟目标 | P99=1184ms (超标7倍) | 需专项优化，尤其是 TECHNICAL 类 |
| 召回质量 | 无 recall_score，无法评估 | 立即新增 recall_score 字段 |
| 调用量 | 极低 (~20条/天) | 排查是否系统正常运行 |
| feedback | 99.8% 缺失 | 启动用户反馈收集机制 |
| source 区分 | 无法区分 user/proactive | 新增 source 字段 |
| 实时性 | 无 Dashboard | 搭建 Grafana + Cron 采集 |
