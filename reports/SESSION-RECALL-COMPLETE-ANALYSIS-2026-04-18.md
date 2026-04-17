# Session 新建召回分析：三方对比报告

> 日期：2026-04-18 | 分析者：玄枢、qwen3.6-plus、Claude Opus 4-6
> 问题：每次新建 session 的时候，召回的不是"最近生成的5条完整摘要"

---

## 一、问题现象

主人反馈：每次新建 session 时，召回的不是"最近生成的 5 条完整摘要"。

---

## 二、系统现状（已确认的架构）

### 召回链路（before_prompt_build 钩子）

```
新建 session
    ↓
步骤1: loadPreviousContext(senderId, sessionKey)
    ├─ getLastSessionId(senderId) → sessionKey（如 agent:main:main）
    ├─ loadSessionSummaryFromRedis(lastSessionId) → Redis查 session:summary:{sessionKey} → 大概率无数据
    └─ memory_summaries 查询：
         sessionKey → Redis查UUID → miss时sessionIdToUuid() → UUID
         → WHERE source_session_id = UUID
         → 取最多 3 条，每条截断到 200 字
    ↓
步骤2: preloadMemoriesForNewSession(recallService, senderId)
    ├─ 优先用上一 session 摘要全文作为 query（长文本 embedding 会被稀释）
    ├─ recallService.recall({ query: 上一摘要全文, topK: 10 })
    │   └─ 向量搜索 memory_summaries（语义相似度，非时间排序）
    └─ 输出：[Proactive: User Context Preload] 格式
    ↓
步骤3: 每轮对话的语义召回
    ├─ 最后 4 条用户消息构建 query
    ├─ classifyIntent(query) → 8 类意图
    ├─ 向量搜索 memory_summaries
    ├─ Level 2 rerank（实体匹配 + 类型匹配）
    ├─ applyTierFilter() → Tier 1: top3 且截断 60 字！！！
    └─ buildMemoryPrompt → [Recalled Memories]
```

### 关键数据表

| 表 | 用途 |
|----|------|
| `conversation_messages` | 原始对话，`session_id` = UUID（MD5 from sessionKey） |
| `memory_summaries` | pair 级摘要（每 4 条消息生成一次），含 `summary`/`summary_type`/`source_session_id`/`embedding` |
| `latest_summaries_cache` | 2026-04-17 刚建，未接入任何召回链路 |

---

## 三、三方分析对比

### 问题 1：为什么召回的不是"最近 5 条完整摘要"？

| 模型 | 结论 |
|------|------|
| **玄枢** | 三重断裂叠加：①preload 用"摘要全文"做向量搜索→语义匹配而非时间排序；②只取上一 session 摘要，范围锁死；③Tier 1 截断到 60 字，内容残缺 |
| **qwen3.6-plus** | 三个断裂点叠加：①loadPreviousContext 只查上一 session 而非全局最近；②语义搜索替代了时间排序；③60 字截断把摘要切成残片 |
| **Opus** | 设计哲学错位：系统以"语义相关性优先"，主人要的是"时间连续性优先"。三层叠加：范围窄 + 语义漂移 + 截断致残 |

**三方一致确认**：

```
想要：最近5条（时间排序）+ 完整呈现（不截断）
实际：
  loadPreviousContext → 只取上一 session 的 3 条（范围窄）
  preloadMemoriesForNewSession → 向量语义搜索（语义 ≠ 时间）
  applyTierFilter → Tier 1 截断 60 字（内容残缺）
```

### 问题 2：主人想要的"最近 5 条完整摘要"具体指什么？

| 模型 | 答案 |
|------|------|
| **玄枢** | pair 级摘要（memory_summaries 表中最近 5 条），完整呈现不截断 |
| **qwen3.6-plus** | memory_summaries 表中按 created_at 降序的最近 5 条 pair 级摘要，全文不截断 |
| **Opus** | memory_summaries 表中 ORDER BY created_at DESC LIMIT 5，取完整 summary 字段 |

**三方一致**：指 `memory_summaries` 表中按时间排序的最近 5 条 pair 级摘要，全文呈现。不是 session 级摘要，不是 latest_summaries_cache（未接入）。

### 问题 3：最小改动方案

| 模型 | 方案 |
|------|------|
| **玄枢** | 在 `preloadMemoriesForNewSession()` 中新增直接时间排序查询：`SELECT ... FROM memory_summaries ORDER BY created_at DESC LIMIT 5`，完整呈现不做截断 |
| **qwen3.6-plus** | 同玄枢，增加时间排序分支 + 对预加载摘要不做 Tier 1 截断（或将阈值从 60 提升到 200） |
| **Opus** | 在 `loadPreviousContext()` 或其后增加独立时间排序查询路径，与语义搜索并行不干扰，新增独立 prompt 段落注入 |

**三方一致的核心方案**：

在现有召回链路中新增一条**时间排序直查路径**，不过向量搜索，不走语义匹配，直接：

```sql
SELECT summary, summary_type, created_at
FROM memory_summaries
ORDER BY created_at DESC
LIMIT 5
```

注入为独立的 prompt 段落（如 `[Recent Session Summaries]`），完整呈现不做截断。

### 问题 4：latest_summaries_cache 为什么没有接入？能直接用吗？

| 模型 | 分析 |
|------|------|
| **玄枢** | 悬空状态，只有写入没有读取端，没有任何召回链路使用它 |
| **qwen3.6-plus** | 2026-04-17 刚建，属于"先建表后接入"的开发节奏，尚未接线。能用但需先验证表结构和数据完整性 |
| **Opus** | 意图正确但未完工的半成品。写入端和读取端都没有接入。建议：先用直接查 memory_summaries 方案上线，cache 表作为后续性能优化层 |

**三方一致**：表已建但未使用，不是当前必需的，可以先用直接查 memory_summaries 的方案。

### 问题 5：60 字截断是否是问题？

| 模型 | 评价 |
|------|------|
| **玄枢** | 严重问题。60 字截断几乎毁掉所有有价值内容，是看不到完整摘要的直接原因之一 |
| **qwen3.6-plus** | 毁灭性伤害。一条 200 字摘要截断到 60 字后只剩主语和谓语，关键信息全部丢失 |
| **Opus** | 不是根因但是放大器。即使语义搜索命中了正确结果，60 字截断也会把它变成无用碎片 |

**三方一致**：60 字截断是严重问题。建议：
- 预加载摘要（preload）：完全不截断
- 日常对话召回：截断阈值从 60 提升到 200，或限制条数而非限制长度

---

## 四、三方共识总结

### 根因

```
系统设计：语义相关性优先（向量搜索）
主人需求：时间连续性优先（最近5条完整摘要）
错位导致：时间维度被语义维度替代 + 截断致残
```

### 最小改动方案（三方一致）

**改动位置**：`session-context-loader.js` 的 `preloadMemoriesForNewSession()` 函数

**改动内容**：新增一条时间排序直查路径

```javascript
// 新增：直接取最近 5 条摘要（不走向量搜索，不截断）
const recentResult = await db.query(`
  SELECT summary, summary_type, created_at
  FROM memory_summaries
  WHERE is_active = TRUE
  ORDER BY created_at DESC
  LIMIT 5
`);

if (recentResult.rows.length > 0) {
  const lines = ['[Recent Session Summaries]'];
  for (const r of recentResult.rows) {
    lines.push(`- [${r.summary_type}] ${r.summary} (${r.created_at})`);
  }
  lines.push('[/Recent Session Summaries]');
  injectionParts.push(lines.join('\n'));
}
```

**注入位置**：`before_prompt_build` 的 contextParts，与 preload 并行存在

### 额外优化建议

| 优先级 | 改动 | 说明 |
|--------|------|------|
| **P0（立即）** | 时间排序直查路径（见上方代码） | 解决核心问题 |
| **P1（建议）** | 去掉预加载摘要的 60 字截断 | 在 index.js applyTierFilter 中对 preload 来源的记忆跳过截断 |
| **P2（可选）** | 验证并接入 latest_summaries_cache | 作为后续性能优化，但非必须 |
| **P3（长期）** | CJK token 估算修复 | smartTruncate 函数的 token 估算精度问题 |

### 不需要改动的

| 模块 | 原因 |
|------|------|
| recallService | 向量搜索本身没问题，只是需要与时间排序并行 |
| session-summary-extractor | 写入链路正常，不需要动 |
| PM2 进程 | 记忆系统禁区，不动 |
| memory_summaries 表结构 | 不需要改动 |

---

## 五、结论

**根因**：系统用"语义相似度搜索"替代了"时间最近查找"，又用"60 字截断"把结果切成碎片。主人的需求（时间连续性）和系统设计（语义相关性）是两种不同的优先策略，需要并行而非替换。

**最小改动**：在 `preloadMemoriesForNewSession()` 中增加一条 `ORDER BY created_at DESC LIMIT 5` 的直查路径，与现有语义搜索并行，完整呈现不截断。约 15-20 行代码，不动 recallService，不动 PM2 进程，不动表结构。
