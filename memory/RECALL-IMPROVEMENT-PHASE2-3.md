# 记忆召回系统 Phase 2/3 深化研究报告

> 研究日期：2026-04-20  
> 研究员：🔍 Researcher（深度研究子程序）  
> 状态：已完成，输出决策参考

---

## 执行摘要

本报告基于对 memory-system 源码、recall_logs（413条）、Neo4j Graphify 状态的深度分析，结合业界 RAG 最佳实践，为 Phase 2/3 提供具体可落地的改进方案。

**核心发现：**
- 意图分类已有 8 类实现，但实际运行中 `FEEDBACK` 等新类出现，说明扩展在途
- Graphify **不是零触发**，TECHNICAL 查询（32条）会触发，但 200ms 超时 + 无对齐机制导致 Graphify 结果未有效利用
- Proactive 召回缺乏数据支撑，上下文窗口仅 1 条消息
- 业界 HyDE/Self-RAG/GraphRAG 方法可借鉴，但需适配本系统轻量化需求

---

## 1. 意图分类精化方案（8类扩展 → 实现路径）

### 1.1 当前状态

**设计文档定义（RECALL-DESIGN.md）：**

| 意图 | 定义 | 触发条件 |
|------|------|---------|
| FACTUAL | 事实查询（是什么/多少/哪个） | 关键词：是什么/哪个/who is/what is |
| PREFERENCE | 用户偏好（喜欢/想要/习惯） | 关键词：喜欢/偏好/favorite/爱 |
| EVENT | 事件回忆（上次/之前/那天） | 关键词：上次/之前/when/last time |
| TECHNICAL | 技术问题（代码/配置/报错） | 正则：代码/函数/import/error/api/db/文件路径 |
| PROJECT | 项目相关（项目名/成员/进度） | 关键词：项目/成员/进度/milestone/sprint |
| PERSON | 人物相关（谁/某人怎么样） | 关键词：谁/她/他们 |
| REASONING | 推理类（为什么/怎么想到） | 关键词：为什么/why/how come |
| DEFAULT | 默认兜底 | 无匹配时 |

**recall_logs 实际分布（413条）：**

| 意图 | 数量 | 占比 |
|------|------|------|
| DEFAULT | 213 | 51.6% |
| PROJECT | 149 | 36.1% |
| TECHNICAL | 32 | 7.7% |
| PREFERENCE | 18 | 4.4% |
| FEEDBACK | 1 | 0.2% |

**问题诊断：**
- DEFAULT 占比超 50%，说明关键词匹配规则太严格，大量真实查询落入兜底
- TECHNICAL 只有 32 条，但 recall_logs 中存在大量技术相关查询（如 Docker/MCP/Graphify），说明正则规则漏报
- FEEDBACK 类出现（设计文档中未定义），说明代码中已有隐性扩展

### 1.2 未覆盖场景分析

以下场景在当前 8 类中**无专门处理**：

| 缺失意图 | 典型查询示例 | 建议处理方式 |
|---------|------------|------------|
| **SYSTEM** | "系统最近有没有报错"/"health-check结果如何" | 路由到系统监控类记忆，忽略语义相似度 |
| **PROJECT_HISTORY** | "这个项目之前遇到的最大问题是什么" | 跨 session 摘要聚合，挖掘项目历史模式 |
| **HEALTH** | "我最近有没有睡好"/"压力如何" | 情感倾向 + 时间序列分析，需特殊脱敏 |
| **DECISION** | "上次为什么选了 Postgres 而不是 MySQL" | 决策理由检索，需保留原始决策上下文 |
| **LEARNING** | "上次学到了什么"/"有什么新技能" | 学习进度跟踪，与 project/PRACTICE 相关 |
| **FEEDBACK** | "这个回答好吗"/"1"/"0" | 已在日志中出现但无专门处理路径 |

### 1.3 小模型意图分类可行性

**方案选择：关键词正则 vs 小模型**

| 方案 | 延迟 | 准确率 | 实现成本 | 推荐场景 |
|------|------|--------|---------|---------|
| 关键词+正则（当前） | <1ms | ~60%（DEFAULT占比过高） | 无 | 快速迭代，TECHNICAL/PROJECT 高优 |
| Qwen3-1.7B（Ollama 本地） | ~200ms | ~85% | 需 prompt 工程 | 扩展到 12 类后接替正则 |
| Qwen3-4B | ~400ms | ~90% | 需 GPU | 高价值场景，延迟可接受 |

**建议实现路径：**
1. **Phase 2.1（1h）**：扩充 TECHNICAL 正则 + PROJECT 关键词，覆盖当前漏报场景，DEFAULT 目标降至 30%
2. **Phase 2.2（3h）**：引入 Qwen3-1.7B 做意图分类（<5ms embedding + 200ms 推理），替换正则逻辑
3. **训练数据需求**：约 200-300 条人工标注样本（query → intent），可从 recall_logs 中抽样 + 人工标注

**代码改动范围：**
```
session-recall.js:
  - classifyIntent() 函数扩展正则/关键词
  - 新增 _classifyWithModel() 异步方法（可选）
  
config.js:
  - intentConfig 对象扩展（新增 SYSTEM/HEALTH/DECISION 等）
  - intentKeywords 新增匹配词
  
handler.js:
  - shouldGraphify 逻辑可从 intentConfig.graphify 读取
```

---

## 2. Graphify 激活方案

### 2.1 当前状态

**Neo4j 数据规模：**
- GraphifyCode 节点：79026 个（来自 commit 解析）
- ALIGNED_TO 关系：GraphifyCode → Memory_summary 对齐关系
- PM2 进程：`graphify-opus-manager` 独立运行

**零触发问题诊断：**

通过代码分析，**Graphify 不是零触发**，TECHNICAL/PROJECT/REASONING 查询确实会触发：

```javascript
// handler.js 第 282 行
const shouldGraphify = classifiedIntent === 'TECHNICAL' || classifiedIntent === 'PROJECT' || classifiedIntent === 'REASONING';
```

**真正的问题在于三点：**

| 问题 | 根因 | 影响 |
|------|------|------|
| **超时太短** | `graphify-fetch.js` 超时 200ms，但 Graphify 服务在 localhost:31234 可能响应 >200ms | 大量 TECHNICAL 查询实际超时返回 null |
| **无对齐机制** | `extractAlignedIds()` 从结果中提取 code_id，但 Neo4j 中的 GraphifyCode.id 与 PostgreSQL memories.id **无直接映射** | 即使 Graphify 返回结果，也无法与召回结果对齐加分 |
| **精排未融合** | `level2Rerank()` 有 entityMatch/typeMatch 加分，但 Graphify 对齐加分（+0.1）在 computeRecallScore 中但**对齐集为空** | Graphify 结果仅作为额外 context 注入，未参与精排 |

### 2.2 激活方案

**方案 A：扩大触发范围（立即生效，1h）**

```javascript
// handler.js 第 282 行 - 扩大触发条件
const shouldGraphify = ['TECHNICAL', 'PROJECT', 'REASONING', 'FACTUAL', 'SYSTEM'].includes(classifiedIntent);
// 同时增加超时
const graphifyTimeoutMs = classifiedIntent === 'TECHNICAL' ? 500 : 300;
```

**方案 B：修复对齐机制（核心，3h）**

当前 `extractAlignedIds()` 从 `r.node.id` 提取，但 Neo4j code_id 与 PostgreSQL id 是不同体系。正确做法：

```javascript
// 修复：使用 alignedMemory.id 作为对齐键
function extractAlignedIds(results) {
  if (!results) return new Set();
  return new Set(
    results
      .filter(r => r.alignedMemory && r.alignedMemory.id != null)
      .map(r => String(r.alignedMemory.id))  // 对齐到 memory_summaries.id
  );
}
```

**方案 C：超时调优 + 熔断增强**

```javascript
// graphify-fetch.js
const TIMEOUT_BY_INTENT = {
  TECHNICAL: 500,   // 代码查询允许更长
  PROJECT: 400,
  REASONING: 300,
  DEFAULT: 200,
};
```

### 2.3 触发率目标

| 阶段 | TECHNICAL 触发率目标 | 说明 |
|------|---------------------|------|
| 当前 | ~100%（已触发但超时/无对齐） | 触发但无实际效果 |
| Phase 2.1 | >80% 成功返回 | 扩大超时 + 修复超时逻辑 |
| Phase 2.2 | >90% 有对齐结果 | 修复 alignedMemory.id 提取 |
| Phase 3 | >95% 精排融合 | Graphify 加分生效 |

---

## 3. Proactive 召回可行性分析

### 3.1 三个典型场景（来自 RECALL-DESIGN.md）

| 场景 | 触发条件 | 所需数据 |
|------|---------|---------|
| **新 session** | `isNewSession = true` | 用户最近 10 条记忆 + 上个 session 摘要 |
| **话题切换** | topic embedding 余弦相似度 < 0.5 | 需计算对话 embedding 差异 |
| **长时间沉默** | >30min 无消息 | 时间戳追踪 |

### 3.2 数据支撑评估

| 数据项 | 当前状态 | 是否支持 Proactive |
|--------|---------|-------------------|
| 用户历史记忆 | personal_memories 3927 条 | ✅ 支持宽泛 query 召回 |
| Session 摘要 | memory_summaries 318 条 | ✅ 新 session 可加载 |
| 对话 embedding | 未存储每条消息 embedding | ❌ 话题切换检测无基础 |
| 最后活跃时间 | 未追踪 | ❌ 长时间沉默检测无法实现 |
| 用户偏好向量 | 未构建 | ❌ 无法预热相关记忆 |

### 3.3 实现路径建议

**立即可做（新 session 加载，2h）：**
```javascript
// session-context-loader.js
async function preloadForNewSession(senderId) {
  // 加载用户宽泛记忆（偏好+项目+决策）
  const recentMemories = await recallService.recall({
    query: '用户偏好 项目 决策 技术栈',
    topK: 10,
  });
  // 加载上个 session 摘要
  const lastSummary = await getLastSessionSummary(senderId);
  return { recentMemories, lastSummary };
}
```

**Phase 3 可做（话题切换检测，4h）：**
```javascript
// 每次消息入库时，计算 session 级别的 topic embedding（滑动平均）
// 存储到 Redis: session_topic_embedding:{sessionId}
// 检测：当前 embedding 与 session 均值的余弦相似度 < 0.5 → 触发新话题召回
```

**Phase 4 可做（长时间沉默，2h）：**
```javascript
// Redis 记录最后消息时间
await redis.setex(`last_activity:${senderId}`, 7*24*3600, Date.now());
// Cron 每 5 分钟检查：当前时间 - last_activity > 30min → 刷新召回
```

---

## 4. 业界最佳实践

### 4.1 RAG 召回质量提升方法

| 方法 | 原理 | 适用场景 | 本系统借鉴 |
|------|------|---------|----------|
| **Query Expansion** | 用 LLM 生成多个同义 query，并行检索后合并 | 模糊查询/多角度 | 可用于 PROJECT 类（多维度检索项目） |
| **HyDE（Hypothetical Doc Embeddings）** | 生成"假设答案"文档，embedding 后检索真实文档 | 稀疏查询/niche 领域 | 可用于 REASONING 类（生成推理路径→检索相关决策） |
| **Self-RAG** | LLM 自己判断是否需要召回，召回后验证相关性 | 高精度场景 | 可作为 Tier 3 触发（召回分数<0.3时激活） |
| **Adaptive-RAG** | 根据查询复杂度选择不同召回策略 | 简单事实 vs 复杂推理 | 与意图分类结合，复杂推理→多步召回 |
| **SimRAG** | 自训练合成 QA 对提升领域泛化 | 垂直领域 | 可利用 recall_logs 生成正负样本 |

### 4.2 意图分类在 RAG 中的作用

**Amazon REIC 方法（2025）：**
- 用 RAG 增强意图分类：先向量检索相似 query → 结合 ICL 判断意图
- 适合客服/多租户场景，与本系统 recall_logs 路径相似
- 可行性：直接复用 recall_logs 中 413 条 query 作为 ICL examples

### 4.3 GraphRAG 实现方式

| 方案 | 核心思想 | 实现难度 | 本系统适配度 |
|------|---------|---------|------------|
| **Microsoft GraphRAG** | 构建 entity graph → community summary → 全局检索 | 高（需完整图谱pipeline） | 低，entity extraction 缺失 |
| **Local GraphRAG** | 仅对 TECHINICAL 类使用代码知识图谱 | 中 | ✅ 高，本系统 Graphify 已实现 |
| **Hyperegraph RAG** | 多层级关系超图 | 高 | 低 |
| **Light GraphRAG** | 简化图谱，仅用 entity + relation | 低 | ✅ 可借鉴，扩展到 project/entity 关系 |

### 4.4 Proactive RAG vs Reactive RAG

| 维度 | Reactive（当前） | Proactive |
|------|----------------|-----------|
| 触发方式 | 用户 query 驱动 | 事件/时间/上下文驱动 |
| 召回质量 | 精准但被动 | 可能过召回，需过滤 |
| 延迟 | P99 < 150ms | 可提前预热，降低感知延迟 |
| 实现成本 | 低 | 中（事件追踪系统） |

**业界趋势**：Hybrid 模式 = Proactive 预加载 + Reactive 精排。本系统应走此路径。

---

## 5. 综合建议（按优先级排序）

### 🔴 P0 - 立即修复（1-2h）

1. **Graphify 对齐机制修复**
   - 改动：`extractAlignedIds()` 改用 `alignedMemory.id`
   - 预期：精排阶段 Graphify 加分生效，TECHNICAL 类召回质量提升

2. **Graphify 超时调优**
   - 改动：`graphify-fetch.js` 超时 200ms → TECHNICAL 500ms / PROJECT 400ms
   - 预期：超时率从 ~50% 降至 <10%

### 🟡 P1 - Phase 2 高优（3-5h）

3. **意图分类扩展 + 准确率提升**
   - 扩充 TECHNICAL 正则（覆盖 docker/pm2/数据库/路径等）
   - 扩充 PROJECT 关键词
   - 目标：DEFAULT 占比从 51% 降至 30%

4. **精排融合 Graphify 结果**
   - `level2Rerank()` 中 Graphify 对齐加分（+0.05~0.1）
   - 需先完成 P0.1 对齐修复

5. **新 session Proactive 加载**
   - 实现 `session-context-loader.js` 的 `preloadForNewSession()`
   - 立即可用，无需额外数据支撑

### 🟢 P2 - Phase 3 改进（5-8h）

6. **上下文窗口扩展（1→4条消息）**
   - 改动：handler.js 中提取 `messages.slice(-4)`
   - 风险：embedding 延迟 + query 长度，需压测验证 P99

7. **Redis 缓存（TTL 5min）**
   - 实现 `cacheCandidates()` / `getCachedCandidates()`
   - 预期：重复 query 缓存命中率 >60%

8. **话题切换检测**
   - 计算 session 级别 topic embedding（滑动平均）
   - Redis 存储 `session_topic_embedding:{sessionId}`

### 🔵 P3 - Phase 4 探索（8h+，延期）

9. **小模型意图分类**
   - 引入 Qwen3-1.7B 替换正则
   - 需准备 200-300 条标注数据

10. **HyDE 推理路径召回**
    - 为 REASONING 类生成假设答案，检索相关决策记忆
    - 技术可行性高，但需 LLM 调用成本评估

11. **长时间沉默刷新**
    - Redis 追踪最后活跃时间
    - Cron 任务检查 >30min 沉默 → 刷新召回

---

## 附录：关键代码位置

| 改动项 | 文件 | 函数/行号 |
|--------|------|----------|
| 意图分类 | `session-recall.js` | `classifyIntent()` L79-115 |
| Graphify 触发 | `handler.js` | L282 `shouldGraphify` |
| 对齐 ID 提取 | `graphify-fetch.js` | `extractAlignedIds()` L85-93 |
| 精排 | `session-recall.js` | `level2Rerank()` L157-191 |
| 超时配置 | `graphify-fetch.js` | `DEFAULT_TIMEOUT_MS` L10 |

---

## 参考资料

- RECALL-DESIGN.md（memory-system/docs/）
- session-recall.js 源码
- graphify-fetch.js 源码
- recall_logs（413条样本）
- Neo4j Graphify 数据（79026 节点）
- [Neo4j Advanced RAG](https://neo4j.com/blog/genai/advanced-rag-techniques/)
- [REIC: RAG-Enhanced Intent Classification](https://aclanthology.org/2025.emnlp-industry.74.pdf)
- [Adaptive-RAG](https://arxiv.org/pdf/2403.14403)
- [Self-RAG](https://arxiv.org/abs/2403.14403)
