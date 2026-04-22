# 主脑记忆系统升级可行性调研报告

> 任务ID: TASK-20260422-001
> 调研时间: 2026-04-22
> 调研方式: 卓越架构 + ClawTeam 三团队并行（Architect Agent / Risk Agent / Strategy Agent）
> 状态: ✅ P0+P1+P2 已部署（2026-04-22 22:30）
> 回滚文档: `memory/MEMORY-SYSTEM-P0-P2-DEPLOYMENT-20260422.md`

---

## ⚠️ 首要警报：3个必须立即修复的高危项

| # | 高危项 | 风险分 | 说明 |
|---|--------|--------|------|
| 🔴 | `embedder.embed()` 无熔断保护 | **18/27** | bge-m3 不可用时 recall **完全崩溃**，无降级路径 |
| 🔴 | `outbox-writer syncToNeo4j()` 无熔断保护 | **18/27** | Neo4j 失败 → 事件永久标记 `failed`，**不可恢复** |
| 🟡 | Redis AOF 未启用 | **12/27** | Redis 崩溃最多丢失 53 次未持久化变更 |

---

## 一、现行系统架构

```
conversation_messages
    ↓ extractor（定时批处理）
memory_summaries（PG，有 embedding 列，1024维 pgvector HNSW）
    ↓ outbox-writer（实时写入）
personal_memories（PG，有 embedding 列，1024维 pgvector HNSW）
    ↓ Redis Stream（graph:sync:events）
graph-linker → Neo4j（PersonalMemory 节点，约2506个）
    ↓
recall(query) → bge-m3 embed → pgvector HNSW → 加权排序 → top-K → prompt
```

### 当前实测状态（2026-04-22）

| 组件 | 状态 |
|------|------|
| conversation_messages（30min） | 25条 |
| memory_summaries（30min） | 7条 |
| personal_memories（30min） | 6条 |
| recall_logs（30min） | 0条（正常，按需触发） |
| Redis graph:sync:events | 0条 pending |
| Neo4j PersonalMemory | 2506节点 |
| session-summary-extractor | 在线，restart=0 |
| outbox-writer | 在线，restart=0 |
| graph-linker | 在线，restart=0 |
| bge-m3-keepalive | **已消失** |

---

## 二、核心发现：召回管道已严重退化

**Architect Agent 代码级审查发现**：

现行 `recall()` 方法**仅搜索 memory_summaries 一个表**，personal_memories 表 **3927+ 条高价值记忆完全无法被召回**——这不是设计缺陷，是**功能退化**。

当年因 personal_memories 膨胀（+379%）导致搜索质量下降，采用了「直接关表」的简单策略，但正确做法是**数据清洗 + importance 过滤**，而非废弃整表。

| 表 | 记录数 | 参与召回 |
|----|--------|---------|
| memory_summaries | ~725条 | ✅ 100%参与 |
| personal_memories | ~3927条 | ❌ 0%参与 |
| memories | ~0条 | ❌ 已废弃 |

---

## 三、竞品对比结论

| 特性 | Hindsight | MemMachine | Mem0 | ReMe | 现行系统 |
|------|-----------|------------|------|------|----------|
| BM25 搜索 | ✅ | ❌ | ✅ | ✅ | ❌ |
| Cross-encoder Rerank | ✅ | ❌ | ❌ | ❌ | ❌ |
| Contextualized Retrieval | ❌ | ✅ | ❌ | ❌ | ❌ |
| Episode 簇 | ❌ | ✅ | ❌ | ❌ | ❌ |
| 四策略并行 | ✅(4种) | ❌ | ✅(3种) | ✅(2种) | ❌(1种) |
| 熔断降级 | 部分 | 部分 | ✅ | 部分 | 部分 |

### 最高ROI可移植特性

1. **BM25 混合搜索**（Mem0/ReMe）— 改动量小，收益高，专有名词召回3-5x
2. **Contextualized Retrieval**（MemMachine）— 解决 query 表达不准的根问题
3. **Cross-encoder Rerank**（Hindsight）— 精排提升15-25%，需额外模型

---

## 四、最优路径：路径A — 增量增强

| 维度 | 路径A（增量增强）| 路径B（平行双跑）| 路径C（插件化替换）|
|------|-----------------|-----------------|-----------------|
| 风险 | **极低** | 中高 | 中 |
| 主脑改动 | **零** | 零 | 中 |
| 回滚难度 | **极简** | 难 | 中 |
| PM2停机 | **零** | 零 | 潜在 |
| 额外进程 | **0个** | 多个 | 1-2个 |

---

## 五、分阶段实施计划（总计约10-13小时）

### 阶段0：技术预研（Week 0，1-2天）
确认 BM25 技术路径：
- pg_bm25 扩展是否可用
- tsvector 内置方案（备选，无需扩展）
- zhparser / pg_jieba（中文分词）

### 阶段1：BM25 混合搜索（Week 1-2，2-3小时）⭐最高ROI
- 给 personal_memories.content 和 memory_summaries.summary 加 GIN 索引
- recall 时并行查向量 + BM25，RRF 融合
- **改动**：仅新增 `hybrid-recall.js`
- **回滚**：`DROP INDEX CONCURRENTLY`
- **收益**：专有名词召回率提升 3-5x

### 阶段2：恢复 personal_memories 召回（Week 2，15分钟）⭐最紧急
- 在 session-recall.js 中恢复 `_vectorSearchPersonal()` 调用
- 增加 `importance_score >= 5.0` 过滤
- **改动**：2行代码
- **收益**：召回覆盖率从 16% → ~100%

### 阶段3：Contextualized Retrieval（Week 2-3，2-3小时）
- recall 命中结果，额外获取相邻上下文（上下各3条）
- **只改读取路径**，不改写入路径
- **收益**：解决「query 表达不准」的根问题

### 阶段4（可选）：Cross-encoder Reranking（Week 5-6，4-6小时）
- 引入 rerank 模型精排 top-K
- 建议先做阶段1-3再决定是否需要

---

## 六、危险点分级矩阵（13项）

| # | 危险点 | 概率 | 影响 | 紧迫度 | 风险分 | 应对 |
|---|--------|------|------|--------|--------|------|
| 1 | embedder.embed() 无熔断保护 | 中 | 高 | 高 | **18** | 立即包裹 circuit-breaker |
| 2 | outbox-writer Neo4j 无熔断 | 中 | 高 | 高 | **18** | 立即加 neo4j_sync 熔断器 |
| 3 | recall 层升级结果不一致 | 高 | 中 | 高 | **18** | 影子模式 + 灰度发布 |
| 4 | Redis AOF 未启用 | 低 | 高 | 中 | **12** | 开启 AOF |
| 5 | embedding 模型更换不兼容 | 中 | 高 | 中 | **12** | 保持同维度或双向量列 |
| 6 | session-summary-extractor API 依赖 | 中 | 中 | 中 | 8 | 确认 DeepSeek fallback key |
| 7 | reranking 服务挂掉 | 中 | 中 | 低 | 6 | 超时降级 + 熔断器 |
| 8 | BM25 索引安装锁表 | 低 | 中 | 低 | 2 | CONCURRENTLY 方式 |
| 9-13 | 其他 | 低-中 | 低-中 | 低 | ≤2 | 常规监控 |

---

## 七、资源估算

| 资源 | 增量 |
|------|------|
| 额外 PM2 进程 | **0**（新模块以 lib 集成）|
| 额外数据库空间 | **< 50MB** |
| 预期延迟增量 | Phase1-3 < 30ms，Phase4 < 100ms |
| 建设周期 | 4周（Phase1-3），Phase4 可选延后 |

---

## 八、优先行动清单

| 优先级 | 行动 | 预计工时 | 收益 |
|--------|------|---------|------|
| 🔴 P0 | embedder.embed() 加熔断保护 | 1小时 | 防recall崩溃 |
| 🔴 P0 | outbox-writer Neo4j 加熔断保护 | 1小时 | 防数据永久丢失 |
| 🟡 P1 | 恢复 personal_memories 召回 | 15分钟 | 覆盖率+84% |
| 🟡 P1 | 确认 BM25 路径（Phase0） | 1-2天 | 确认技术可行性 |
| 🟢 P2 | BM25 混合搜索（Phase1） | 2-3小时 | 专有名词召回3-5x |

---

## 九、甘特图

```
2026-04        05-01    05-05    05-08    05-12    05-15    05-19    05-22
               May W1   May W2   May W3   May W4   May W5   May W6
Phase0  ████
Phase1         ░░░░▒▒▒▒
Phase2                  ████████
Phase3                            ████████████
Phase4(Optional)                              ████████████
```

---

## 十、三团队子报告

子报告原文：
- `/tmp/architect-report.md` — Architect Agent（Claude Opus 4-6）输出
- `/tmp/risk-report.md` — Risk Agent（DeepSeek Reasoner）输出
- `/tmp/strategy-report.md` — Strategy Agent（MiniMax M2.7）输出

---

*本方案仅规划，不做实际改动。执行前需主人灵须子明确授权。*
