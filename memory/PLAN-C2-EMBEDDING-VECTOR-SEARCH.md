# 方案 C2：Embedding 向量搜索

> 分析时间：2026-04-11
> 分析模型：Claude Opus
> 前提：C1（Neo4j全文索引）已完成

---

## 背景

C1 修复了 `queryGraphify()` 的 CONTAINS 子串匹配问题，但 GraphifyCode 节点本身**没有代码内容向量表示**。

现有数据：
- Neo4j：79,108 个 GraphifyCode 节点（name/type/tags/file_path，无 code_content 向量）
- PostgreSQL：memory_summaries + memories + personal_memories（已有 HNSW 向量索引）
- Ollama：BGE-m3（1024维，本地部署）

---

## 核心问题

1. **GraphifyCode 无 embedding**：节点只有 name/type/tags，无法做语义相似度匹配
2. **对齐链路未激活**：即使 C1 修复了查询，GraphifyCode 节点的语义表达能力仍然有限
3. **长期价值**：Embedding 是真正解决语义匹配的方案，比全文索引更强大

---

## 方案 A：PostgreSQL 辅助向量表（推荐）

### 实现路径

**Step 1：为 GraphifyCode 生成 embedding**

从 Neo4j 导出 79,108 个节点的 `name + type + tags + file_path` 组合文本，批量调用 Ollama bge-m3 生成 1024 维向量，存入 PostgreSQL 辅助表。

```sql
CREATE TABLE graphify_code_embeddings (
  id TEXT PRIMARY KEY,           -- GraphifyCode node id
  embedding vector(1024),         -- BGE-m3 1024维向量
  text_preview TEXT,              -- 用于调试的原始文本
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX ON graphify_code_embeddings USING hnsw (embedding vector_cosine_ops);
```

**Step 2：修改 query-layer.js**

```javascript
// 用户查询 → embed → pgvector HNSW 检索
const queryEmbedding = await embedder.embed(userQuery);

// pgvector 检索 topK
const result = await pgClient.query(
  `SELECT id, text_preview,
     1 - (embedding <=> $1) AS similarity
   FROM graphify_code_embeddings
   ORDER BY embedding <=> $1
   LIMIT $2`,
  [queryEmbedding, maxResults]
);

// 返回的 id → Neo4j 补全节点信息
const neo4jIds = result.rows.map(r => r.id);
```

**Step 3：与现有 recall 融合**

`session-recall.js` 的 `fetchGraphifyContext()` 调用 31234 端口 → 新的 Graphify 查询走 pgvector → 返回 graphify IDs → `extractAlignedIds()` → graphifyBonus 生效

---

## 方案 B：专用向量数据库（Pinecone）

将 79,108 节点 embedding 存入 Pinecone，查询时先在 Pinecone 语义检索 → 获取 topK IDs → Neo4j 补全关系。

**问题**：引入新基础设施，改动最大。

---

## 对现有系统的影响

| 模块 | 方案A影响 |
|------|----------|
| session-recall.js | 无变化（收益自动传导） |
| query-layer.js | 新增向量查询路径 |
| bridge-layer.js | 写入 Neo4j 后同步生成 embedding |
| Neo4j 数据 | 无变化（仍是 name/type/tags） |
| PostgreSQL | 新增 graphify_code_embeddings 表 + HNSW 索引 |
| Ollama BGE-m3 | 批量推理负载（79,108 次） |

---

## 收益/风险

| 维度 | 评估 |
|------|------|
| **收益** | 真正的语义匹配；多词查询完美解决；对中文/代码语义理解更强 |
| **风险** | 79,108 节点需批量生成 embedding（计算成本高）；新增数据表和同步逻辑 |
| **改动量** | 中（新增辅助表 + query 修改 + bridge-layer 同步） |
| **停机风险** | 低（批量生成期间服务正常，历史数据补录可离线处理） |
| **可回滚** | 高（C1 全文索引作为降级路径） |

---

## 迁移步骤（方案A）

1. **创建辅助表**（DDL）
2. **批量生成 embedding**（离线任务，分批处理 79,108 节点）
3. **修改 query-layer.js**：新增向量查询路径
4. **修改 bridge-layer.js**：新增写入 Neo4j 时的同步 embedding 生成
5. **验证**：测试多词查询结果质量
6. **观察**：monitor graphifyBonus 命中率变化

---

## 与 C1 的关系

- **C1（Neo4j全文索引）**：当前生效，解决多词查询 = 0 的问题
- **C2（Embedding向量）**：长期增强，真正语义匹配
- **两者互补**：C1 作为基础查询 + C2 作为语义增强

---

## 待研究问题

1. 批量 embedding 生成的具体实现（Ollama batch API？）
2. bridge-layer.js 增量同步时 embedding 的更新策略
3. 向量查询与全文索引查询的合并策略
4. 对现有 backfill-alignments.js 的影响
