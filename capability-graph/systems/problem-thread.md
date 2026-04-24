# 副脑（Problem Thread）

> **铭刻日期**：2026-04-21  
> **状态**：✅ 正常运行（降级模式：召回使用 LIKE 而非语义向量）

---

## 一、系统定位

副脑是独立于主脑的记忆召回系统之外的**问题追踪与协作系统**。

每个 Thread（线索）完整记录一个问题从发现、分析、决策、执行到验证的全生命周期。

| 对比项 | 主脑（记忆召回） | 副脑（Problem Thread） |
|--------|----------------|----------------------|
| **核心功能** | 语义记忆召回 | 问题全生命周期追踪 |
| **数据模型** | memories / recall_logs | problem_threads（5阶段） |
| **召回方式** | pgvector 余弦相似度 | pgvector（降级为 LIKE） |
| **存储** | PostgreSQL 54320 | PostgreSQL 54320 |
| **关系图谱** | — | Neo4j 7688 |
| **端口** | — | API 54321 |

---

## 二、架构

```
OpenClaw → problem-thread-plugin → Problem Thread API (54321)
                                              ↓
                              ┌───────────────┴───────────────┐
                              pt-postgres (54320)              pt-neo4j (7688)
                              Thread 核心数据                  关系图谱
```

### Docker 容器

| 容器名 | 镜像 | 端口映射 | 状态 |
|--------|------|----------|------|
| `pt-api` | problem-thread | 127.0.0.1:54321→54321 | ✅ healthy |
| `pt-postgres` | postgres | 127.0.0.1:54320→5432 | ✅ 运行中 |
| `pt-neo4j` | neo4j | 127.0.0.1:7688→7687, 7474→7474 | ✅ 运行中 |

---

## 三、数据库配置

| 配置项 | 值 |
|--------|-----|
| 数据库名 | `ptdb` |
| 用户 | `ptuser` |
| 密码 | `ptpass` |
| Host | `pt-postgres`（Docker 内网） |
| API 端口 | 54321 |

### 核心表：`problem_threads`

```sql
id              UUID PRIMARY KEY
title           TEXT NOT NULL
title_embedding vector(1024)    -- bge-m3 embedding，降级时为 NULL
domain          TEXT[]           -- 领域标签
status          TEXT             -- new/in_progress/blocked/completed/cancelled
stage_problem   JSONB
stage_analysis  JSONB
stage_decision  JSONB
stage_implementation JSONB
stage_verification   JSONB
sessions        JSONB
created_at      TIMESTAMPTZ
updated_at      TIMESTAMPTZ
```

---

## 四、召回链路

### 语义搜索（当前降级）

```
GET /threads?q=<query>
    ↓
getEmbedding(query) → POST http://172.21.0.1:11434/api/embeddings
    → ❌ 容器内网络不通（socket hang up）
    → embedding = null
    ↓
FALLBACK: ILIKE '%query%'
    → ✅ 返回匹配 Thread
```

### 降级说明

- **正常模式**：Ollama bge-m3 向量 + pgvector 余弦相似度排序
- **当前模式**：ILIKE 模糊匹配（title 和 domain 字段）
- **不可用原因**：pt-api 容器无法访问宿主机 Ollama（网络隔离）
- **影响**：语义相关性排序失效，按更新时间排序而非相似度

---

## 五、Thread 生命周期

```
new → in_progress → blocked/completed/cancelled
```

| Stage | 说明 | JSONB 字段 |
|-------|------|-----------|
| `problem` | 问题描述与发现 | `stage_problem` |
| `analysis` | 根因分析记录 | `stage_analysis` |
| `decision` | 决策与方案确定 | `stage_decision` |
| `implementation` | 执行与变更记录 | `stage_implementation` |
| `verification` | 验证状态与结果 | `stage_verification` |

---

## 六、活跃 Thread 清单

### in_progress

| ID | 标题 | 领域 | 创建时间 | 最后更新 |
|----|------|------|----------|----------|
| `b8bec86e` | 自学习记忆引擎 | memory-system, learning, adaptive | 2026-04-19 18:23 | 2026-04-21 08:50 |
| `29c64b9d` | Trace Chain 端到端追溯系统 | memory-system, trace-chain, monitoring | 2026-04-19 17:53 | 2026-04-21 08:50 |
| `c433b07f` | 卓越执行框架 SOP 设计 | capability-graph, sop, framework, clawteam | 2026-04-19 13:31 | 2026-04-19 14:05 |

### new（测试）

| ID | 标题 | 创建时间 |
|----|------|----------|
| `7960b70c` | 核查测试 | 2026-04-21 00:04 |
| `5b219e3f` | 建造方案核查测试 | 2026-04-21 00:04 |
| `a3a9d0e1` | 测试：验证 command:new 推送链路 | 2026-04-18 22:40 |
| `89d924d0` | 测试 session 关联 | 2026-04-18 22:40 |

---

## 七、API 完整清单

| 方法 | 路径 | 功能 |
|------|------|------|
| `GET` | `/health` | 健康检查 |
| `GET` | `/threads` | 列出 Thread（支持 `?status=active` / `?q=语义搜索`） |
| `GET` | `/threads/:id` | 获取单个 Thread 详情 |
| `POST` | `/threads` | 新建 Thread |
| `PATCH` | `/threads/:id/stage` | 更新某 Stage 内容 |
| `PATCH` | `/threads/:id/status` | 更新 Thread 状态 |
| `GET` | `/threads/:id/level1` ~ `/level5` | 加载指定深度的 Thread 数据 |
| `GET` | `/relate/:id` | 查询相关 Thread |
| `POST` | `/sessions/:id/summary` | 推送 session 摘要 |

### 召回 API 示例

```bash
# 语义搜索（当前实际为 LIKE 降级）
curl "http://localhost:54321/threads?q=memory"

# 获取活跃 Thread
curl "http://localhost:54321/threads?status=active"

# 获取单个 Thread 详情
curl "http://localhost:54321/threads/b8bec86e-fcec-4a14-b43a-9c12fb5fd416"
```

---

## 八、审计日志

- **存储位置**：`/home/ai/.openclaw/audit/pt_recall_audit.db`
- **格式**：SQLite WAL 模式
- **记录内容**：所有 `/threads` 和 `/sessions` 请求的来源、路径、延迟、命中数

---

## 九、铁律

**副脑同为主脑级别的绝对禁区。没有主人灵须子（姚旭）的明确确认，任何操作都不能触碰副脑任何组件。**

| 操作类型 | 要求 |
|---------|------|
| 表结构修改 | 必须主人确认 |
| 脚本/配置修改 | 必须主人确认 |
| 新建/删除 Thread | 必须主人确认 |
| Docker 容器操作 | 必须主人确认 |
| API 路径变更 | 必须主人确认 |
| 查询/读取 | 可自由执行 |

---

## 十、路径索引

| 文件 | 说明 |
|------|------|
| `/home/ai/problem-thread/src/api/` | API 源码 |
| `/home/ai/problem-thread/src/api/routes/threads.js` | Thread CRUD + 召回逻辑 |
| `/home/ai/problem-thread/src/api/index.js` | 主入口 + 审计中间件 |
| `/home/ai/.openclaw/audit/pt_recall_audit.db` | 召回审计数据库 |
| `capability-graph/systems/problem-thread.md` | 本文档 |

---

## 十一、召回降级问题（归档）

- **发现日期**：2026-04-21
- **根因**：pt-api 容器内 `OLLAMA_HOST=172.21.0.1:11434` 无法访问（网络隔离）
- **状态**：已知，不修复，降级使用 LIKE
- **影响**：语义排序失效，但基本召回功能正常
- **后续**：如需修复，将 Ollama 加入 `problem-thread_pt-network` 网络
