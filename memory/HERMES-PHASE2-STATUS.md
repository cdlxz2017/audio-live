# Hermes + OpenClaw Fusion — Phase 2 Status

**Completed**: 2026-04-11  
**File**: `/home/ai/apps/hermes-agent/plugins/memory/openclaw/openclaw_provider.py`

---

## Phase 1 (已完成，见 OPENCLAW-HERMES-FUSION-REPORT.md)
- Step 1.1 ✅: Plugin enhanced with MemoryProvider ABC
- Step 1.2 ✅: Hermes configured with LLM
- Step 1.3 ✅: Hermes Router skill created
- Step 1.4 ✅: OpenClaw memory provider integrated
- Step 1.5 ✅: End-to-end validation passed

---

## Phase 2 (全部完成 ✅)

### Step 2.1: Graphify 代码图谱集成 ✅
- 添加 `query_graphify()` 函数，调用 `http://localhost:31234/query`
- 支持 flat 结构（Graphify v2 API `data` 字段）和 nested `node` 结构
- 添加 `graph_query` 工具到 `get_tool_schemas()` 和 `handle_tool_call()`
- **测试结果**: 返回 20 个代码节点，第一个: `SystemUser @ lingyi-cms/backend/model_user.py`

### Step 2.2: Neo4j 关系推理工具 ✅
- 安装 `neo4j==6.1.0` Python driver
- 添加 `query_neo4j(cypher, params)` 函数
- 添加 `_neo4j_to_python()` 辅助函数处理 DateTime/Duration 序列化
- 添加 `neo4j_query` 工具到 `get_tool_schemas()` 和 `handle_tool_call()`
- **Neo4j 连接**: `bolt://localhost:7687` — 1,808,118 节点，100+ 标签
- **测试结果**: `MATCH (n:PersonalMemory) RETURN n LIMIT 3` → 3 条记录，keys 正常

### Step 2.3: Hermes 自创建 Skills → 回写 OpenClaw ✅
- 添加 `write_procedural_memory(skill_name, description, steps, source)` 函数
- 同时写入 PostgreSQL（`factual` 类型）和 Neo4j（`Procedure` 节点 with MERGE）
- 添加 `write_procedural_memory` 工具到 `get_tool_schemas()` 和 `handle_tool_call()`
- 添加 `on_delegation()` hook：Hermes 从子代理获得结果后，自动持久化程序记忆
- **测试结果**: pg_id=1906630, neo4j_written=True ✅

### Step 2.4: 安全网关集成 ✅
- 添加 `DANGEROUS_PATTERNS` 常量（15+ 危险模式）
- 添加 `security_scan(tool_name, args)` 函数（不区分大小写）
- 在 `handle_tool_call()` 入口处检查所有工具调用
- 被拦截时返回 `{"error": "BLOCKED: ...", "blocked": true}`，并 log warning
- **测试结果**:
  - `DROP TABLE` → blocked=True ✅
  - `rm -rf` → blocked=True ✅
  - 正常写入 → success=True ✅

---

## 工具清单（全量）

| 工具 | 类型 | 说明 |
|------|------|------|
| `recall_memories` | Phase 1 | 向量语义搜索 |
| `search_memories` | Phase 1 | 全文检索 |
| `write_memory` | Phase 1 | 写入 PostgreSQL |
| `get_recall_stats` | Phase 1 | 数据库统计 |
| `graph_query` | Phase 2.1 | Graphify 代码图谱 |
| `neo4j_query` | Phase 2.2 | Cypher 关系查询 |
| `write_procedural_memory` | Phase 2.3 | 程序记忆持久化 |

## 安全网关

所有工具调用在执行前经过 `security_scan()`，匹配任何危险模式即拦截。

## 已知限制

- `memory_type` 字段约束为 `['factual', 'preference', 'event']` — procedural memory 使用 `factual`
- Graphify topK 默认20（API 侧），plugin 默认请求5
- Neo4j 查询无超时保护（未来可加 `timeout=` 参数）
