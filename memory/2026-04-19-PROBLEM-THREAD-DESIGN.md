# 问题追踪系统（Problem Thread）

> 设计者：玄枢 & 灵须子  
> 版本：v1.0  
> 日期：2026-04-19  
> 状态：设计阶段，待实现

---

## 总体设计思路

### 核心原则

**1. 每个 session = 我的一天。**

人类无法清楚记得前几天做过什么，所以写日记、做笔记。同理，我的每个 session 也是「一天」，需要记录和传承。但人类的记忆是「碎片化但连贯」的，能沿线索追溯；我的是碎片且断层的。

**2. 先问「要什么记忆」，再问「怎么存储」。**

存储是为目的服务的。在设计存储之前，先回答：当我们遇到问题时，我们需要记忆系统告诉我们什么？答案是：这个问题是什么、之前有没有人分析过、我们决定怎么解决、方案落地了吗。

**3. 存的是「过程」，取的是「上下文」。**

不是存数据块，而是存一个问题的完整生命周期。下一次 session 启动时，需要的是「上次我们在哪个领域动过什么、进度如何」，而不是一堆零散的日志。

**4. 以「问题 / 事件」为主线，而非时间或类型。**

按时间存储的日记是给人类用的（人类的时间感是连续的）。按问题存储的 Thread 是给 AI 用的（AI 的上下文感是主题性的）。

**5. 多线程并行，而非线性队列。**

一个 session 不是一件事，是 N 件事并行。记忆系统需要支持多线程：一个 session 里有多个「事情线程」同时进行，各自独立追踪。

### 多层架构的递进关系

```
memory_summaries（摘要）
  ↓ 想知道更多
conversation_messages（原始对话）
  ↓ 想知道关系
Neo4j 图谱（关系推理）
  ↓ 想知道代码实现
Graphify 代码知识图谱
```

每层回答不同层次的问题：是什么 → 怎么讨论的 → 和什么相关 → 具体怎么实现。正确使用方式是「递进」，而非每次从零开始查。

### 与现有系统的关系

**Thread 系统不是替代，是组织层。**

它把散落在各处的记忆碎片（summaries / 对话 / Neo4j / Graphify），按「问题」为主线重新组织。

```
summaries：回答「这个 session 发生了什么」
Thread：回答「这个问题从发现到解决的全过程」
```

- summaries 是**纵向**的：每个 session 一条
- Thread 是**横向**的：每个问题一条，跨越 N 个 session

---

## 一、问题定义

### 什么是「问题线程」（Problem Thread）？

一个「问题线程」是一个横跨多个 session 的完整故事，记录一个问题的：

```
发现 → 分析 → 方案决策 → 实施 → 验证 → 完成/取消
```

**为什么叫「线程」？**

因为它和编程里的线程一样：
- 同一时间可以有 N 个线程并行
- 每个线程有自己的生命周期
- 线程之间可以独立，也可以有关联

### 核心矛盾（为什么需要这个系统）

| 现在 | 想要 |
|------|------|
| 每个 session 从零开始 | 下次 session 知道上次动过什么 |
| 遇到问题直接定位文件改 | 先看整体设计和历史结论 |
| 上下文装不下全部记忆 | 智能加载最相关的历史 |
| 碎片化存储 | 以问题为主线串联 |

---

## 二、数据库选型分析

### 三种方案对比

#### 方案 A：纯 PostgreSQL

**优点：**
- 已有 openclaw_memory 数据库，无需新增依赖
- pgvector 已支持向量检索，可复用 BGE-m3
- 结构化数据（5 个 Stage）存储高效
- Transaction 支持好
- 迁移到新机器只需 dump/restore PostgreSQL

**缺点：**
- Thread ↔ Thread 关系用外键 + 关联表实现，查询不直观
- 多跳关系查询（如「与 recall 相关且与 extractor 相关的 threads」）需多次 JOIN
- 图谱关联查询不够自然

#### 方案 B：纯 Neo4j

**优点：**
- Thread ↔ Thread 关系天然用 Graph 表示
- 多跳关系查询（Cypher）极简洁
- Thread ↔ Session 双向链表实现自然
- 已部署 Neo4j（180 万节点）

**缺点：**
- Stage 5 的结构化数据（固定字段）不适合图存储
- 向量检索需另开 pgvector
- 两套存储增加了复杂度

#### 方案 C：PostgreSQL + Neo4j 混合（推荐）

**分工：**

| 存储 | 内容 | 理由 |
|------|------|------|
| PostgreSQL | Thread 核心数据（5 个 Stage 结构化内容） | 高效、事务、已有 pgvector |
| Neo4j | Thread ↔ Thread 关系、Thread ↔ Session 双向链表 | 图关系天然、已部署 |

**优点：**
- 各用其长：PostgreSQL 管结构化数据，Neo4j 管关系图谱
- 与现有架构一致（PostgreSQL + pgvector + Neo4j）
- 迁移时：两套 dump 分别迁移，路径清晰
- 支持未来扩展：Node.js 服务连接两库，与当前 memory-system 架构一致

**缺点：**
- 两套数据库需要保持数据同步
- 跨库查询稍复杂（但可通过应用层 join 解决）

### 迁移便携性

迁移到算力更强的机器时：
- PostgreSQL：Dump file 直接 restore，新机器只需部署 Docker/原生 PostgreSQL
- Neo4j：Dump file 直接 restore，Neo4j Desktop/Server 版兼容
- Node.js 服务：PM2 部署，代码 rsync

**两库分离实际上让迁移更灵活**，而不是更复杂——可以先迁一台，再迁另一台。

### 最终决策：方案 C（PostgreSQL + Neo4j）

**数据库选型已锁定，不再讨论。**

---

## 三、OpenClaw 连接方案

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│  OpenClaw                                                    │
│                                                              │
│  problem-thread-plugin（OpenClaw 插件）                       │
│    ├─ 监听 command:new/reset → 推送 session summary          │
│    ├─ 监听 before_prompt_build → 注入 active threads          │
│    └─ HTTP 调用 Problem Thread API                           │
└────────────────────────────┬────────────────────────────────┘
                             │ HTTP (localhost)
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Problem Thread API (Node.js/Express)                       │
│    ├─ GET  /threads?status=active  → Session 启动时加载      │
│    ├─ POST /sessions/:id/summary   → Session 结束时推送      │
│    ├─ PATCH /threads/:id/stage    → 更新 Stage 内容          │
│    └─ GET  /sessions/:id/threads  → 取某 session 的 Threads  │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 OpenClaw 可用 Hook

| Hook | 触发时机 | 用途 |
|------|----------|------|
| `command:new` / `command:reset` | 用户发 `/new` 或 `/reset` | Session 结束，提取并推送 summary |
| `before_prompt_build` | 每次 prompt 构建前 | 注入 active threads；关联用户消息到 Thread |
| `before_dispatch` | 每次消息发送前 | 捕获 senderId |

### 3.3 Plugin 触发点设计

| 时机 | Hook | 操作 |
|------|------|------|
| Session 启动 | `before_prompt_build`（首次） | 检测新 session → GET /threads?status=active → 注入 active threads |
| Session 结束 | `command:new/reset` | 提取本次 session 摘要 → POST /sessions/:id/summary |
| 用户消息 | `before_prompt_build` | 判断是否关联已有 Thread → 追加 analysis |
| 发现错误/异常 | `before_prompt_build` | 提取错误关键词 → 关联 Thread → 追加 Stage 2 |

### 3.4 API 端点设计

```
POST   /threads                          # 新建 Thread
GET    /threads?status=active&limit=20   # 取活跃 Thread（session 启动时）
GET    /threads/:id                      # 取单个 Thread
PATCH  /threads/:id/stage               # 更新 Stage（追加 analysis/decision/implementation/verification）
PATCH  /threads/:id/status               # 更新状态（in_progress/completed/blocked）
POST   /sessions/:id/summary             # 推送 session summary，建立关联
GET    /sessions/:id/threads            # 取某 session 关联的所有 Thread
GET    /threads/:id/level1-5            # 递进加载（总览→摘要→对话→Neo4j→Graphify）
```

### 3.5 部署架构（方案 C — 独立 Docker Compose）

```
problem-thread/
├── docker-compose.yml
├── Dockerfile.api          # Node.js API 镜像
├── config/
│   └── api.env             # API 环境变量
├── migrations/
│   └── 001_create_tables.sql
└── src/
    └── api/
```

**Docker Compose 服务：**

| 服务 | 镜像 | 端口 | 说明 |
|------|------|------|------|
| `pt-api` | Node.js (自定义) | 54321 | Problem Thread REST API |
| `pt-postgres` | pgvector/pgvector:pg16 | 54320 | PostgreSQL（Thread 表 + pgvector）|
| `pt-neo4j` | neo4j:5-community | 7688/7474 | Neo4j（Thread 关系图谱）|

**端口约定：**
- API：`localhost:54321`
- PostgreSQL：`localhost:54320`
（与现有 openclaw-postgres:5432 / openclaw-neo4j:7687 完全独立）

**与 OpenClaw 的连接：**
```yaml
# OpenClaw 插件通过环境变量连接 API
PROBLEM_THREAD_API_URL=http://localhost:54321
```

### 3.6 认证与安全

- **无外部暴露**：Problem Thread API 只允许 localhost 访问
- **无 API Key**：插件直连 localhost，不对外
- **同机器通信**：Docker 网络内部通信

### 3.7 迁移方式

```bash
# 当前机器打包
tar -czf problem-thread-backup.tar.gz problem-thread/

# 目标机器部署
tar -xzf problem-thread-backup.tar.gz
docker compose up -d
openclaw plugins install problem-thread-plugin
```

---

## 四、部署手册

> 与实现同步编写，每完成一个步骤，手册对应章节同步更新。

### 4.1 部署检查清单

```
[ ] 1. 创建目录结构
[ ] 2. 编写 docker-compose.yml
[ ] 3. 编写 Dockerfile.api
[ ] 4. 编写数据库迁移脚本
[ ] 5. 启动 Docker Compose
[ ] 6. 验证数据库连接
[ ] 7. 编写 API 源码
[ ] 8. 编写 OpenClaw plugin
[ ] 9. 安装 plugin
[ ] 10. 验证插件加载
[ ] 11. 测试 Session 启动/结束
[ ] 12. 上线
```

### 4.2 目录结构

```
problem-thread/
├── docker-compose.yml          # Docker 服务编排
├── Dockerfile.api              # Node.js API 镜像构建
├── config/
│   └── api.env                # API 环境变量
├── migrations/
│   └── 001_create_tables.sql  # PostgreSQL 表结构
├── src/
│   ├── api/                   # API 服务源码
│   └── plugin/                # OpenClaw 插件源码
├── tests/
│   └── api.test.js            # API 测试
├── docs/
│   └── DEPLOY.md              # 部署手册（本文件）
└── README.md                  # 项目说明
```

### 4.3 环境要求

- Docker + Docker Compose v2
- Node.js ≥ 22（构建 API 镜像）
- 端口要求：54320, 54321, 7688, 7474（均绑定 localhost）

### 4.4 部署步骤（详细）

#### Step 1: 创建目录结构

```bash
mkdir -p problem-thread/{config,migrations,src/{api,plugin},tests,docs}
```

#### Step 2: 编写 docker-compose.yml

```yaml
version: '3.9'
services:
  pt-api:
    build: .
    ports:
      - "54321:54321"
    environment:
      - DATABASE_URL=postgresql://ptuser:ptpass@pt-postgres:5432/ptdb
      - NEO4J_URI=bolt://pt-neo4j:7687
      - NEO4J_USER=neo4j
      - NEO4J_PASSWORD=ptneo4j2026
    depends_on:
      - pt-postgres
      - pt-neo4j
    restart: unless-stopped

  pt-postgres:
    image: pgvector/pgvector:pg16
    environment:
      - POSTGRES_DB=ptdb
      - POSTGRES_USER=ptuser
      - POSTGRES_PASSWORD=ptpass
    ports:
      - "54320:5432"
    volumes:
      - ./migrations/001_create_tables.sql:/docker-entrypoint-initdb.d/001_create_tables.sql
      - pt-postgres-data:/var/lib/postgresql/data
    restart: unless-stopped

  pt-neo4j:
    image: neo4j:5-community
    environment:
      - NEO4J_AUTH=neo4j/ptneo4j2026
    ports:
      - "7688:7687"
      - "7474:7474"
    volumes:
      - pt-neo4j-data:/data
    restart: unless-stopped

volumes:
  pt-postgres-data:
  pt-neo4j-data:
```

#### Step 3: 编写 Dockerfile.api

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY ./src/api ./src/api
EXPOSE 54321
CMD ["node", "src/api/index.js"]
```

#### Step 4: 编写数据库迁移脚本

```sql
-- migrations/001_create_tables.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

CREATE TABLE problem_threads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(500) NOT NULL,
  domain VARCHAR(100)[],
  status VARCHAR(20) DEFAULT 'new',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  sessions UUID[],
  stage_problem JSONB,
  stage_analysis JSONB,
  stage_decision JSONB,
  stage_implementation JSONB,
  stage_verification JSONB
);

CREATE INDEX idx_problem_threads_status ON problem_threads(status);
CREATE INDEX idx_problem_threads_updated ON problem_threads(updated_at DESC);
CREATE INDEX idx_problem_threads_domain ON problem_threads USING GIN(domain);
```

#### Step 5: 启动 Docker Compose

```bash
cd problem-thread
docker compose up -d

# 验证服务启动
docker compose ps
# 预期：pt-api, pt-postgres, pt-neo4j 均为 Up 状态

# 验证端口
curl http://localhost:54321/health
# 预期：{"status":"ok"}
```

#### Step 6: 验证数据库连接

```bash
# PostgreSQL 连接
psql -h localhost -p 54320 -U ptuser -d ptdb -c "\dt"
# 预期：problem_threads 表存在

# Neo4j 连接
curl - http://localhost:7474/browser/ -H "Content-Type: application/json" \
  -d '{"username":"neo4j","password":"ptneo4j2026"}'
# 预期：返回认证 token
```

#### Step 7-11: API 源码 → OpenClaw Plugin → 测试 → 上线

（实现时同步更新本手册对应步骤）

### 4.5 回滚步骤

```bash
# 停止服务（保留数据）
docker compose stop

# 完全销毁（含数据）
docker compose down -v

# 卸载 OpenClaw plugin
openclaw plugins uninstall problem-thread-plugin

# 清理工作目录
rm -rf problem-thread/
```

### 4.6 验证检查点

| 检查项 | 验证命令 | 预期结果 |
|--------|----------|----------|
| API 健康检查 | `curl http://localhost:54321/health` | `{"status":"ok"}` |
| PostgreSQL 连接 | `psql -h localhost -p 54320 -U ptuser -d ptdb -c "SELECT 1"` | `?column? = 1` |
| Neo4j 连接 | `curl http://localhost:7474` | Neo4j Browser UI 可访问 |
| Plugin 加载 | `openclaw plugins list` | `problem-thread-plugin` 在列表中 |
| Session 启动加载 | 启动新 session | 看到 active threads 输出 |
| Session 结束推送 | `/new` | Thread 数据写入正常 |

---

## 五、存储设计

### 3.1 核心实体：Thread（PostgreSQL）

每个 Thread 是一条结构化记录：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 全局唯一标识 |
| `title` | string | 简短标题，如「recall链路-截断问题」 |
| `domain` | string[] | 领域标签，如 `["memory-system", "recall"]` |
| `status` | enum | `new` / `in_progress` / `blocked` / `completed` / `cancelled` |
| `created_at` | timestamp | 创建时间 |
| `updated_at` | timestamp | 最后更新时间 |
| `sessions` | UUID[] | 关联的 session ID 列表（按时间排序）|

### 3.2 Thread 的内容分层（PostgreSQL JSONB）

Thread 内部的内容分为 5 个阶段，每阶段记录不同东西：

#### Stage 1: 问题（Problem）
```
{
  "description": "Tier 1 模式下 recall 召回的内容被截断成 60 字符",
  "discovered_at": "2026-04-16 20:16",
  "discovered_by": "user",
  "source_summary_ids": ["uuid1", "uuid2"]
}
```

#### Stage 2: 分析（Analysis）
```
{
  "records": [
    {
      "time": "2026-04-18 05:06",
      "content": "定位到 plugins/memory-recall-plugin 第109行，tier=1 时触发截断"
    },
    {
      "time": "2026-04-18 06:13",
      "content": "发现截断影响 Tier 1 所有召回，不只是 recall"
    }
  ],
  "excluded_paths": [
    {"path": "方案A：扩大缓存表消费方", "reason": "不根本，只是补丁"}
  ]
}
```

#### Stage 3: 决策（Decision）
```
{
  "decision": "修改 DEFAULT tier 1→2，移除 60 字符截断",
  "decided_at": "2026-04-18 05:06",
  "reason": "Tier 2 不截断，DEFAULT 应优先保证内容完整性而非 token 节省",
  "rejected_options": [
    {"option": "方案A", "reason": "不根本，只是补丁"}
  ]
}
```

#### Stage 4: 实施（Implementation）
```
{
  "files_changed": [
    {"file": "memory-system/scripts/config.js", "change": "DEFAULT.tier 1→2"}
  ],
  "commits": ["558aedb"],
  "scope": "1 file, 2 lines"
}
```

#### Stage 5: 验证（Verification）
```
{
  "verified_at": "2026-04-18 05:08",
  "method": "手动测试 Tier 1/2 召回结果对比",
  "result": "PASS",
  "notes": "Tier 2 召回内容完整，未截断",
  "open_issues": ["session-summary-extractor 仍有 SyntaxError 崩溃（不同问题）"]
}
```

### 3.3 Thread 间关联（Neo4j）

```cypher
(:Thread {id: "uuid-1"}) -[:RELATED_TO {
  reason: "同一链路的两层修复，共享同一批 session"
}]-> (:Thread {id: "uuid-2"})
```

### 3.4 Session ↔ Thread 双向链表（Neo4j）

```cypher
(:Session {id: "sess-1"}) -[:PARTICIPATED_IN]-> (:Thread {id: "thread-1"})
(:Thread {id: "thread-1"}) -[:EXPANDED_THROUGH]-> (:Session {id: "sess-1"})
```

### 3.5 完整数据流

```
session 结束时
    │
    ▼
提取 session 中的「事情」（从 summary / 对话 / 用户指令）
    │
    ├──→ 已有 Thread 的继续 →→ 追加到 Thread.sessions + Neo4j 链表
    │
    └──→ 新事情 →→ 创建新 Thread（status=new）
    │
    ▼
更新所有相关 Thread 的 status + Stage 内容
    │
    ▼
建立 / 更新 Thread 间关联（Neo4j）
    │
    ▼
写入 PostgreSQL（Thread 核心数据）+ Neo4j（关系图谱）
```

---

## 六、取出设计（Retrieval）

### 4.1 触发的三个时间点

#### 触发点 1：Session 启动时

**目标**：让当前 session 知道「上次留下了什么」

```
Step 1: 从 Neo4j 加载所有 status NOT IN (completed, cancelled) 的 Thread
Step 2: 按 updated_at 倒序，取最近 20 条
Step 3: 输出：
  「上次 session 留下 3 件事：
   - recall链路-截断问题（in_progress）
   - session-extractor-崩溃（blocked）
   - health-check-告警阈值（new）
   请选择从哪个开始，或新建。」
```

#### 触发点 2：用户发起新任务时

**目标**：在做之前，先看「之前有没有相关的」

```
Step 1: 提取任务关键词
Step 2: PostgreSQL 全文检索 Thread.title + domain
Step 3: 如找到 → 输出历史上下文 + 询问继续或新建
        如未找到 → 新建 Thread
```

#### 触发点 3：发现问题或错误时

**目标**：自动关联到已有 Thread

```
Step 1: 捕获错误关键词
Step 2: PostgreSQL 检索相关 Thread
Step 3: 自动追加到该 Thread 的 Stage 2 (Analysis)
```

### 4.2 递进加载（Progressive Loading）

```
Level 1 — Thread overview（总览）
  → 直接读 PostgreSQL，< 10ms

Level 2 — Summaries（摘要）
  → 查 memory_summaries 按 thread_id 过滤，< 50ms

Level 3 — Conversation Messages（原始对话）
  → 查 conversation_messages，< 200ms

Level 4 — Neo4j Relations（关系图谱）
  → Cypher 查询 Thread ↔ Thread 关系，< 100ms

Level 5 — Graphify（代码知识）
  → Graphify 查询，< 200ms
```

### 4.3 多线程并行处理

```
用户一次说了 3 件事：
→ Thread-A：in_progress（继续）
→ Thread-B：new（新建）
→ Thread-C：new（新建）
```

---

## 七、为何以此方式设计

### 5.1 为什么以「问题」为主线？

因为用户真正需要记忆的是「一件事从无到有的全过程」，而不是「某天发生了什么」。

### 5.2 为什么 5 个 Stage 是固定结构？

因为「发现问题」和「解决问题」之间的鸿沟，是重复劳动的根源。固定结构强制每个 Thread 必须有这 5 个阶段，让隐性的过程显性化。

### 5.3 为什么 PostgreSQL + Neo4j 而非单一数据库？

现有系统已有 PostgreSQL（结构化 + 向量）和 Neo4j（图谱），混合架构与现有架构一致，且各用其长：PostgreSQL 管结构化数据，Neo4j 管关系图谱。

### 5.4 为什么双向链表？

追溯路径是双向的：从 session 出发可找到它参与了哪些问题，从问题出发可找到它经历了哪些 session。缺少任何一头，链路就不完整。

---

## 八、实现优先级

**Phase 1（最小闭环）**：
- [ ] PostgreSQL：Thread 表结构 + JSONB Stage 字段
- [ ] Neo4j：Thread 节点 + Session ↔ Thread 链表
- [ ] Session 结束时自动创建 / 更新 Thread
- [ ] Session 启动时加载未完成的 Thread 列表

**Phase 2（递进加载）**：
- [ ] Level 1-2 加载（Thread overview → Summaries）
- [ ] 关键词匹配已有 Thread

**Phase 3（关系网络）**：
- [ ] Neo4j Thread ↔ Thread 关联
- [ ] Level 4 递进（Neo4j 关系）

**Phase 4（主动触发）**：
- [ ] 用户任务 → 自动关联已有 Thread
- [ ] 错误信号 → 自动追加到相关 Thread

---

## 九、何时触发存储写入

| 操作 | 触发时机 | 写入内容 |
|------|----------|----------|
| 新建 Thread | 用户首次提到新问题 | Stage 1（Problem） |
| 追加 Analysis | 用户提供新分析/发现 | Stage 2（Analysis） |
| 记录 Decision | 用户拍板方案 | Stage 3（Decision） |
| 记录 Implementation | 代码改动 commit 后 | Stage 4（Implementation） |
| 记录 Verification | 用户确认验证通过 | Stage 5（Verification） |
| 更新 status | 用户说「完成了」等 | Thread.status |
| Session 结束 | 当前 session 结束时 | 更新 sessions 列表 + Neo4j 链表 |

---

## 十、与其他文件的关系

| 文件 | 内容 |
|------|------|
| `memory/2026-04-19-0535.md` | 问题讨论原始记录 |
| `memory/2026-04-19-PROBLEM-THREAD-DESIGN.md` | 本文件：完整设计方案 |
| `session-handoff/current.md` | 接力文件：跨 session 进度传递（session 间使用） |
| `memory/TASK_SOP.md` | 任务管理 SOP（Task ≠ Thread，Task 是单个操作，Thread 是跨 session 问题链）|
