# 记忆召回系统架构审查报告

> **审查日期**: 2026-04-20  
> **审查者**: 玄枢 · Reviewer 子程序  
> **被审系统**: 记忆召回系统 Phase 2/3 改进方案  

---

## 1. Graphify 对齐 Bug 验证结论

### 1.1 Bug 确认

**严重级别**: 🔴 高危（功能完全失效）

**根因定位**: `extractAlignedIds()` 使用了错误的 ID 字段进行对齐。

**代码证据**（`graphify-fetch.js` 第 103-104 行）:
```javascript
function extractAlignedIds(results) {
  if (!results || !results.length) return new Set();
  return new Set(
    results
      .filter(r => r.node && r.node.id != null)
      .map(r => String(r.node.id))   // ← 提取了 Graphify 内部节点 ID
  );
}
```

**调用链**（`session-recall.js`）:
```javascript
const graphifyAlignedIds = extractAlignedIds(graphifyResults);  // 如 {"json_key_18484", "json_key_29103"}

// 评分阶段:
const { graphifyAlignedIds, candidateId } = options;
const graphifyBonus = (graphifyAlignedIds && candidateId && graphifyAlignedIds.has(candidateId)) ? 0.1 : 0;
//                          ↑ candidateId 来自 c.id（数据库记录 ID，如 "61"）
```

**不匹配示例**:
| 来源 | ID 格式 | 示例 |
|------|---------|------|
| `extractAlignedIds()` 返回 | Graphify 节点 ID | `"json_key_18484"` |
| `c.id`（数据库） | PostgreSQL 自增 ID | `"61"`, `"183"` |

**结论**: 两者永远不匹配 → `graphifyBonus` 恒为 0 → **Graphify 对齐加权从未触发**。

### 1.2 修复方案

根据 `formatGraphifyContext()` 中已有的 `r.alignedMemory` 引用，对齐 ID 应来自 `alignedMemory`：

```javascript
// 修复后的 extractAlignedIds（建议）
function extractAlignedIds(results) {
  if (!results || !results.length) return new Set();
  const ids = new Set();
  for (const r of results) {
    // 优先使用 alignedMemory.id（对齐到数据库记录）
    if (r.alignedMemory && r.alignedMemory.id != null) {
      ids.add(String(r.alignedMemory.id));
    }
    // 其次使用 node.code_id（Graphify 关联的代码 ID）
    else if (r.node && r.node.code_id != null) {
      ids.add(String(r.node.code_id));
    }
  }
  return ids;
}
```

**需要验证**: Graphify API 返回的 `alignedMemory.id` 是否确实是 PostgreSQL 数据库记录 ID。建议先打印一次完整 Graphify 返回值确认结构。

### 1.3 副作用评估

- **风险**: 低。修复仅影响 bonus 计算，原有 HNSW 召回逻辑完全不变
- **影响**: `graphifyBonus` 从恒 0 → 实际生效，技术/项目类查询的精排质量提升
- **回滚**: 改一行即可回滚

---

## 2. 意图分类质量评估

### 2.1 分布数据（412 条 recall_logs）

| Intent | 次数 | 占比 | 平均延迟 | 最大延迟 |
|--------|------|------|---------|---------|
| DEFAULT | 213 | 51.7% | ~235ms | 1671ms |
| PROJECT | 149 | 36.2% | ~180ms | 455ms |
| TECHNICAL | 31 | 7.5% | **~281ms** | 1305ms |
| PREFERENCE | 18 | 4.4% | ~94ms | 242ms |
| EVENT | 0 | 0% | - | - |
| PERSON | 0 | 0% | - | - |
| REASONING | 0 | 0% | - | - |
| FACTUAL | 0 | 0% | - | - |

**严重问题**:
- 8 类意图中仅 4 类被触发，EVENT/PERSON/REASONING/FACTUAL 共 0 次
- TECHNICAL 占 7.5% 但贡献了最高延迟（281ms avg）
- PROJECT 和 DEFAULT 合计占 87.9%，分布极不均衡

### 2.2 TECHNICAL 类过低的原因

**可能因素 1**: 正则过于严格
`config.js` 中 TECHNICAL_PATTERNS 部分模式如下：
```javascript
/代码|函数|class |def |import |require\(|报错|bug|error/i,
/api|route|endpoint|config|数据库|db|sql|docker|pm2|nginx/i,
/\/[a-zA-Z_]+\.(py|js|ts|vue|tsx|go|java|rs)/,
```
- `class `（空格）会漏掉 `className`、`class=` 等
- 技术缩写如 `SQL`、`API` 大写时不匹配（虽然有 `/i` 修饰符，但关键词本身小写）
- 中途切换中英文时如 "这个 bug" 会被匹配，但纯英文 "there's a bug" 可能因标点问题漏掉

**可能因素 2**: 用户实际查询偏项目/日常，技术查询少
- 当前主人对话以项目协作、系统设计为主，真正的代码调试查询较少
- **建议**: 查一下 recall_logs 中 TECHNICAL 的具体 query_text，验证是正则漏匹配还是真的没有技术查询

### 2.3 小模型意图分类评估

**不推荐在召回主路径引入小模型**，原因：
1. TECHNICAL 类平均 281ms（已经偏高），引入 Ollama 调用（Qwen3-1.7B 约 100-200ms）会使 P99 恶化
2. 关键词判断 < 1ms，8 类场景下完全够用
3. 真正的问题是分类体系本身（EVENT/PERSON/REASONING 零触发）而非判断精度

**建议**: 先扩展关键词池，验证是否覆盖率提升，再考虑小模型。

---

## 3. 延迟问题根因分析

### 3.1 延迟分解（基于 recall_logs 412 条数据）

| 分位数 | 延迟 | 目标 | 超出幅度 |
|--------|------|------|---------|
| P50 | 176ms | <100ms | +76% |
| P90 | 275ms | <150ms | +83% |
| P95 | 304ms | <150ms | +103% |
| P99 | **1184ms** | <150ms | **+690%** |

**关键观察**: P50 已超出目标，P99 达到 1.2 秒，延迟分布极度右偏。

### 3.2 根因分析

**1. Embedding (< 30ms budget)**
- `embedder.js` 通过 Ollama 本地 BGE-m3（1024 维）
- 实测约 30ms，符合预期
- **无问题**

**2. HNSW 检索（< 50ms budget）**
- `memory_summaries` 表（有 embedding 索引）
- P50=176ms 远超 budget，说明延迟主要不在 embedding 而在 HNSW 或后续处理
- recall_logs 中 `latency_ms` 是端到端，包含：embedding + HNSW + 排序 + 网络
- **可能问题**: `memory_summaries` 表的 HNSW 索引效率，或候选数量过多

**3. TECHNICAL 类 281ms 根因**
- TECHNICAL 唯一启用了 Graphify 并行查询（200ms timeout）
- 但 TECHNICAL_PATTERNS 判断 + Graphify 超时后还要继续执行主流程
- Graphify 200ms timeout 本身消耗掉大量 budget
- **可能的因果链**: TECHNICAL 触发 Graphify → Graphify 超时 200ms → 主流程等待 → 平均延迟 281ms

**4. DEFAULT/ PROJECT 类延迟来源**
- DEFAULT 213 条平均 235ms（无 Graphify），说明 HNSW 本身可能存在性能问题
- PROJECT 149 条平均 180ms，略好于 DEFAULT

### 3.3 延迟异常峰值（4 月 12 日 P99=2460ms）

- 当日 52 条记录，最大 2460ms
- 可能原因：pgvector 向量索引重建、数据库负载高峰、或 Graphify 异常未降级

### 3.4 Redis 缓存影响

recall_logs 中无 `cache_hit` 字段，无法从现有数据判断缓存命中率。但 recall 代码显示缓存查询在主流程前，命中时直接返回（不写 `latency_ms`）。412 条记录全部有 latency 说明**缓存命中率为 0 或几乎为 0**。

---

## 4. Phase 2/3 各方案风险评估

### 4.1 修复 Graphify 对齐 Bug（Week 1）

| 维度 | 评分 |
|------|------|
| 风险等级 | 🟢 低 |
| 落地难度 | 极低（改 1 个函数） |
| 验证难度 | 低（加日志输出对齐 ID） |
| 副作用 | 无负面影响 |
| 预期收益 | TECHNICAL/PROJECT 精排质量提升 |

**结论**: 立即可落地，无风险。

### 4.2 意图分类精化（8 类扩展）

| 维度 | 评分 |
|------|------|
| 风险等级 | 🟡 中 |
| 落地难度 | 低（扩关键词池 + 修改 classifyIntent） |
| 验证难度 | 中（需离线分析 412 条 query_text 验证覆盖率） |
| 主要风险 | 分类过拟合——扩关键词后可能把 DEFAULT 误判为 PROJECT |

**具体风险**:
- "项目" 关键词宽泛，可能误捕获无关内容
- EVENT/PERSON/REASONING/FACTUAL 零触发，需确定是查询不存在还是关键词缺失
- TECHNICAL_PATTERNS 已有 12 个正则，叠加后判断耗时仍 < 1ms，但需避免冲突

**建议**: 保留现有 DEFAULT 兜底，确保扩分类不降低基线质量。

### 4.3 HitRate 质量指标采集

| 维度 | 评分 |
|------|------|
| 风险等级 | 🟡 中 |
| 落地难度 | 中（需改 recall_logs 表或日志格式） |
| 验证难度 | 高（需要 ground truth 标注数据） |
| 主要风险 | feedback 率 0.2% 意味着无法靠用户反馈积累 ground truth |

**核心问题**: HitRate 需要「哪些召回结果实际相关」的标注数据。当前无标注体系。

**可行替代方案**:
1. **分数阈值法**: 定义 recall_score > X 为"相关"，统计 top-K 命中率（无标注依赖）
2. **人工抽检**: 随机抽取 50 条离线评估，作为 recall_score 阈值校准
3. **Recall_score 字段**: 在 `_logRecall` 时取 `results[0].score` 写入日志（纯工程改动，无业务风险）

### 4.4 Proactive 召回

| 维度 | 评分 |
|------|------|
| 风险等级 | 🔴 高 |
| 落地难度 | 高（需改 hook 架构 + session-context-loader） |
| 验证难度 | 高（新功能无历史数据对照） |
| 主要风险 | 引入新的代码路径，可能影响主流程稳定性 |

**具体风险**:
- Proactive 触发条件（话题切换/新 session/长沉默）需要准确判断，误触发会浪费计算资源
- 新 session 预加载若使用宽泛 query（如 RECALL-DESIGN 中 `query: '用户偏好 项目 技术 决策'`），可能导致无关记忆注入
- session-context-loader 改动需要完整测试覆盖

**建议**: 作为 Phase 3 单独里程碑推进，不与 Phase 2 并行。

---

## 5. 优先实施建议（Top 3）

### 🥇 Top 1: 修复 Graphify 对齐 Bug（立即，< 1 小时）

**动作**:
1. 在 `extractAlignedIds()` 中增加日志：打印 `r.node.id` 和 `r.alignedMemory.id` 的实际值
2. 确认 `alignedMemory.id` 是否对应该数据库 `memories` 表的 `id` 字段
3. 替换 `String(r.node.id)` → `String(r.alignedMemory.id)` 或 `String(r.node.code_id)`
4. 写单元测试验证对齐

**预期效果**: `graphifyBonus` 从 0 → 实际生效，TECHNICAL 类精排质量提升。

### 🥈 Top 2: 意图关键词扩展 + 离线质量分析（1-2 小时）

**动作**:
1. 导出 412 条 recall_logs 的 query_text，按现有规则重新分类
2. 识别 EVENT/PERSON/REASONING/FACTUAL 零触发的原因（是真的没有还是关键词缺失）
3. 补充缺失关键词（如 FACTUAL 的 "什么是"/"什么叫"，PERSON 的人名识别）
4. 收紧 PROJECT 关键词避免误扩

**验证方法**:
```sql
-- 检查 TECHNICAL 类的 query_text（验证正则覆盖情况）
SELECT query_text FROM recall_logs
WHERE intent = 'TECHNICAL'
ORDER BY created_at DESC LIMIT 20;
```

### 🥉 Top 3: 延迟根因拆解 + 缓存优化（2-3 小时）

**动作**:
1. 在 `recall()` 返回时记录 `embedMs` 和 `searchMs`（目前只有 `totalTime`）
2. 分析 TECHNICAL 类延迟是否由 Graphify 超时导致
3. 若 Graphify 超时是主因：将 TECHNICAL 类 Graphify timeout 从 200ms 降至 80ms
4. Redis 缓存优化：检查 query hash 算法是否导致缓存失效

**关键 SQL**:
```sql
-- TECHNICAL 类延迟分解（需先在代码中埋点 embedMs/searchMs）
SELECT
  AVG(embed_ms) as avg_embed,
  AVG(search_ms) as avg_search,
  AVG(latency_ms - embed_ms - search_ms) as avg_other
FROM recall_logs
WHERE intent = 'TECHNICAL'
  AND created_at > NOW() - INTERVAL '7 days';
```

---

## 附录：快速验证命令

```bash
# 1. 验证 Graphify 对齐 bug
node -e "
const { extractAlignedIds } = require('./memory-system/scripts/graphify-fetch');
// 模拟 Graphify 返回（需替换为真实 API 调用）
const fakeResults = [{ node: { id: 'json_key_18484' }, alignedMemory: { id: 61 } }];
console.log('Extracted IDs:', [...extractAlignedIds(fakeResults)]);
console.log('Should match candidateId=61:', extractAlignedIds(fakeResults).has('61'));
"

# 2. 检查 TECHNICAL 类实际 query
node -e "
const db = require('./memory-system/scripts/db');
db.query(\`SELECT query_text FROM recall_logs WHERE intent='TECHNICAL' ORDER BY created_at DESC LIMIT 10\`).then(r => console.table(r.rows));
"
```

---

*报告结束*
