# 玄枢记忆链路系统完整技术报告

**版本**: v5.0
**日期**: 2026-04-21
**状态**: 重建完成
**维护者**: 玄枢（太虚智网灵枢）

---

## 一、系统架构总览

### 1.1 定位

玄枢记忆链路系统是主脑（玄枢/OpenClaw）的核心记忆引擎，负责在每次对话前自动召回相关记忆并注入到 prompt 上下文中，实现"记忆驱动"的人机交互。

### 1.2 架构图（文字版）

```
┌─────────────────────────────────────────────────────────────────┐
│                        OpenClaw Gateway                          │
│                      （端口 18789，Node.js）                      │
└──────┬──────────────────┬──────────────────────┬───────────────┘
       │                  │                      │
       ▼                  ▼                      ▼
┌──────────────┐  ┌──────────────────┐  ┌────────────────────────┐
│  Hook 系统    │  │   Recall Hook    │  │  Summary Extractor    │
│ (事件驱动)    │  │ before_prompt_build│  │ (session-summary-     │
│              │  │                   │  │  extractor.js)        │
└──────┬───────┘  └────────┬─────────┘  └──────────┬─────────────┘
       │                   │                       │
       ▼                   ▼                       ▼
┌──────────────┐  ┌──────────────────┐  ┌────────────────────────┐
│ session-     │  │ RecallService    │  │ memory_writers        │
│ capture-hook │  │ session-recall.js│  │ memory-writer.js     │
│              │  │                  │  │                      │
└──────┬───────┘  └────────┬─────────┘  └──────────┬─────────────┘
       │                   │                       │
       ▼                   ▼                       ▼
┌──────────────┐  ┌──────────────────┐  ┌────────────────────────┐
│conversation_ │  │ 三表 HNSW 搜索   │  │ memories              │
│messages 表    │  │ memories         │  │ memory_summaries      │
│              │  │ memory_summaries │  │ personal_memories     │
│  (原始消息)   │  │ personal_memories│  │                      │
└──────────────┘  └────────┬─────────┘  └──────────┬─────────────┘
                            │                       │
                     ┌──────┴───────┐               │
                     ▼              ▼               ▼
              ┌──────────┐  ┌──────────────┐  ┌──────────────┐
              │ BGE-m3   │  │ Redis Cache  │  │ Redis Stream  │
              │ Ollama   │  │ recall:*     │  │ graph:sync:  │
              │ :11434   │  │              │  │ events       │
              └──────────┘  └──────────────┘  └──────┬───────┘
                                                    │
                                           ┌────────▼────────┐
                                           │  graph-linker    │
                                           │  (Neo4j 同步)    │
                                           └────────┬────────┘
                                                    │
                                           ┌────────▼────────┐
                                           │  Neo4j           │
                                           │  7687           │
                                           │  (知识图谱)      │
                                           └─────────────────┘
```

### 1.3 技术栈

| 组件 | 技术 | 说明 |
|------|------|------|
| 主脑 | OpenClaw Gateway | Node.js，端口 18789 |
| 数据库 | PostgreSQL 16 + pgvector | 端口 5432 |
| 向量模型 | BGE-m3 (1024维) | Ollama localhost:11434 |
| 缓存 | Redis | 端口 6379 |
| 图谱 | Neo4j | 端口 7687 |
| 主脑 | Problem Thread API | 端口 54321 |
| 进程管理 | PM2 | 进程管理 |

---

## 二、数据链路详解

### 链路 A：消息捕获链路（用户消息 → conversation_messages）

```
用户消息（WebChat/Telegram/微信等）
    │
    ▼
OpenClaw Gateway 收到消息
    │
    ▼
[before_message_write] hook 事件触发
    │
    ▼
session-capture-hook/handler.js
    函数: writeMessage()
    │
    ├── 从 event.context 提取:
    │   • sessionKey → session_id
    │   • msg.role → role
    │   • msg.content → content
    │   • channel → channel
    │
    ├── 查询当前最大 turn_index:
    │   SELECT COALESCE(MAX(turn_index), 0) FROM conversation_messages
    │
    ├── 写入 conversation_messages:
    │   INSERT (session_id, turn_index, role, content, channel, metadata)
    │
    └── 返回写入的 message_id
         │
         ▼
conversation_messages 表存储
    (session_id, turn_index, role, content, channel, metadata, created_at)
```

**触发时机**: 每次用户消息发送前（before_message_write）

**脚本路径**: `/home/ai/.openclaw/workspace/memory-system/hooks/session-capture-hook/handler.js`

**核心函数**: `writeMessage({ sessionId, role, content, channel, metadata })`

**数据库写入**:

| 字段 | 来源 | 说明 |
|------|------|------|
| session_id | event.context.conversationId | 会话唯一标识 |
| turn_index | MAX(turn_index) + 1 | 消息序号 |
| role | msg.role | user / assistant |
| content | msg.content | 消息内容 |
| channel | event.context.channelId | 来源渠道 |
| metadata | JSON 拼接 | 附加元数据 |

---

### 链路 B：记忆写入链路（conversation_messages → memories / memory_summaries / personal_memories）

**B1: 会话提取链路（PM2 进程驱动）**

```
PM2 进程: session-extractor
    │
    ▼
session-file-extractor-loop.js（每 30 秒轮询）
    │
    ├── 扫描会话文件目录
    │
    ├── 读取会话 JSONL 文件
    │
    ▼
extractor-file-based.js
    │
    ├── 解析每条消息
    │
    ├── 调用 memory-writer.js
    │
    ▼
memory-writer.js
    │
    ├── writeMemory() → memories 表
    │   ├── 生成 BGE-m3 embedding
    │   ├── 冲突检测（幂等写入）
    │   └── 发布 Redis Stream 事件
    │
    ├── writeSummary() → memory_summaries 表
    │   ├── LLM 生成摘要
    │   ├── 生成 embedding
    │   └── 去重检查（content_hash）
    │
    └── writePersonal() → personal_memories 表
        ├── 生成 embedding
        └── 直接写入
```

**PM2 进程**: `session-extractor`（PM2 ID 0）

**脚本路径**:
- 主循环: `/home/ai/.openclaw/workspace/memory-system/scripts/session-file-extractor-loop.js`
- 提取器: `/home/ai/.openclaw/workspace/memory-system/scripts/extractor-file-based.js`
- 写入器: `/home/ai/.openclaw/workspace/memory-system/scripts/memory-writer.js`

---

### 链路 C：摘要提取链路（会话 → memory_summaries）

```
PM2 进程: session-summary-extractor
    │
    ▼
session-summary-extractor.js（Daemon 模式，每 10 分钟扫描）
    │
    ├── 获取所有会话的摘要游标
    │   查询 session_summary_cursor 表
    │
    ├── 增量处理:
    │   • 未处理的 session → 提取新消息
    │   • 已处理的 session → 跳过
    │
    ├── 全文分段:
    │   • 按固定 token 数分段（≤2000 tokens/段）
    │   • 保留上下文重叠
    │
    ├── 并行 LLM 摘要生成:
    │   • 调用 Qwen-max（DashScope API）
    │   • 每段独立摘要
    │
    ├── 摘要合并:
    │   • 多段 → 合并 → 生成最终摘要
    │
    ├── 生成 embedding（BGE-m3）
    │
    ▼
写入 memory_summaries 表
    │
    ├── 关联 source_session_id
    ├── 记录 source_message_ids
    ├── 发布 Redis Stream 事件
    │
    ▼
graph:sync:events Stream
    │
    ▼
PM2 进程: graph-linker（消费）
    │
    ▼
Neo4j 图谱节点写入
```

**PM2 进程**: `session-summary-extractor`（PM2 ID 18）

**脚本路径**: `/home/ai/.openclaw/workspace/memory-system/scripts/session-summary-extractor.js`

**backfill 命令**:
```bash
node /home/ai/.openclaw/workspace/memory-system/scripts/session-summary-extractor.js --backfill
```

---

### 链路 D：召回链路（用户 query → 注入 LLM prompt）

```
用户发送消息
    │
    ▼
OpenClaw Gateway
    │
    ▼
[before_prompt_build] hook 事件
    │
    ▼
recall-hook/handler.js
    │
    ├── 提取用户消息（≤500字）
    │
    ├── BGE-m3 Embedding（Ollama）
    │   → vector[1024]
    │
    ├── 意图分类 classifyIntent()
    │   → TECHNICAL / PROJECT / REASONING / FACTUAL /
    │     PREFERENCE / EVENT / PERSON / DEFAULT
    │
    ├── 判断是否触发 Graphify（意图为 TECHNICAL/PROJECT/REASONING）
    │   ├── YES → graphify-fetch 查询 Neo4j
    │   └── NO → 跳过
    │
    ├── 判断是否级联召回
    │   ├── 关键词匹配：['上次', '之前说过', '我记得', '继续', '接着']
    │   ├── 话题切换检测
    │   └── 强制刷新
    │
    ├── 三表 HNSW 并行搜索
    │   ├── memory_summaries（HNSW, topK=20）
    │   ├── personal_memories（HNSW, topK=20）
    │   └── memories（无 HNSW, 全表过滤）
    │
    ├── 动态加权排序
    │   score = semantic × w1 + time_decay × w2 + confidence × w3
    │   权重由 intentConfig 根据意图类型决定
    │
    ├── Tier 分级注入
    │   ├── Tier 1: top 3, 60字截断（大部分意图）
    │   └── Tier 2: top 5, 全文（REASONING 意图）
    │
    ├── buildMemoryPrompt() → prependContext
    │
    ▼
注入 LLM Prompt
    │
    ▼
[after_response] hook
    │
    ├── 模块E: 更新记忆召回评分（recall +1）
    ├── 模块D: 检测置信度 → 触发主动学习
    └── 模块F: 记录推理模式
```

**Hook 路径**: `/home/ai/.openclaw/workspace/memory-system/hooks/recall-hook/handler.js`

**召回服务**: `/home/ai/.openclaw/workspace/memory-system/scripts/session-recall.js`

**召回配置** (`config.recall`):

| 参数 | 值 | 说明 |
|------|---|------|
| maxMemories | 5 | 返回 top 5 |
| candidateK | 20 | 向量检索候选数 |
| timeRangeHours | 168 | 7天时间窗口 |
| minConfidence | 0.7 | 最低置信度 |

---

### 链路 E：Redis Stream 链路（事件驱动）

```
事件生产者
    │
    ├── session-summary-extractor
    │   → XADD memory:messages {type, payload}
    │
    └── memory-writer
        → XADD graph:sync:events {type, payload}
            │
            ▼
Redis Stream: memory:messages
    消费者: memory-workers 消费组
    │
    ▼
Redis Stream: graph:sync:events
    消费者: graph-linker 消费组
        │
        ▼
Neo4j 同步写入
```

**Stream 列表**:

| Stream | 生产者 | 消费者 | 说明 |
|--------|--------|--------|------|
| `memory:messages` | session-summary-extractor | memory-workers | 消息流 |
| `graph:sync:events` | memory-writer / summary-extractor | graph-linker | 图谱同步 |

**Redis Key 缓存**:

| Key 前缀 | 类型 | 说明 | TTL |
|----------|------|------|-----|
| `recall:*` | String | 召回缓存（query hash → candidates） | 300s |
| `context_loaded:*` | String | session 上下文已加载标记 | 24h |
| `proactive_loaded:*` | String | proactive 已加载标记 | 24h |

---

### 链路 F：图谱同步链路（PostgreSQL → Neo4j）

```
memory_summaries 写入完成
    │
    ▼
Redis Stream: graph:sync:events
    │
    ▼
PM2 进程: graph-linker
    │
    ▼
graph-linker.js
    │
    ├── XREADGROUP 读取 Stream
    │
    ├── 解析事件类型:
    │   • memory_summary_created
    │   • personal_memory_created
    │   • session_completed
    │
    ├── 根据类型构建 Neo4j 节点/关系:
    │   │
    │   ├── Memory_summary 节点
    │   │   属性: id, summary, summary_type, confidence
    │   │
    │   ├── Session 节点
    │   │   属性: id, title, topics
    │   │
    │   └── PART_OF 关系: Memory_summary → Session
    │
    ▼
Neo4j 写入（Cypher）
```

**PM2 进程**: `graph-linker`（PM2 ID 17）

**脚本路径**: `/home/ai/.openclaw/workspace/memory-system/scripts/graph-linker.js`

---

### 链路 G：主脑集成链路（主脑 ↔ Problem Thread）

```
主脑 Problem Thread API（端口 54321）
    │
    ├── GET /threads?status=active
    │   → 加载活跃 Thread 到 prompt
    │
    ├── POST /sessions/:id/summary
    │   → 推送 session 摘要到 Thread
    │
    └── PATCH /threads/:id/stage
        → 追加 Stage 内容
```

**主脑数据库**: `localhost:54320`（独立于主脑 PostgreSQL）

**主脑表**: `problem_threads`（7条记录完整保留）

---

## 三、数据库表完整手册

### 3.1 memories（结构化记忆）

**用途**: 存储实体-属性-值格式的结构化记忆

**路径**: `/home/ai/.openclaw/workspace/memory-system/scripts/memory-writer.js → writeMemory()`

| 字段 | 类型 | Nullable | 默认值 | 说明 |
|------|------|----------|--------|------|
| id | uuid | NOT NULL | gen_random_uuid() | 主键 |
| tenant_id | uuid | | | 租户ID |
| user_id | uuid | NOT NULL | | 用户ID |
| session_id | uuid | | | 会话ID |
| message_index | integer | | | 消息序号 |
| entity | text | NOT NULL | | 实体名 |
| attribute | text | NOT NULL | | 属性名 |
| value | text | NOT NULL | | 属性值 |
| raw_text | text | | | 原始文本 |
| memory_type | varchar(20) | NOT NULL | 'factual' | 记忆类型 |
| embedding | vector(1024) | | | 向量嵌入 |
| confidence | double precision | NOT NULL | 0.8 | 置信度 |
| superseded_by | uuid | | | 替代记录ID |
| is_active | boolean | NOT NULL | TRUE | 是否活跃 |
| created_at | timestamptz | NOT NULL | now() | 创建时间 |
| updated_at | timestamptz | NOT NULL | now() | 更新时间 |
| last_recalled_at | timestamptz | | | 最后召回时间 |
| content | text | | | 显示内容 |
| source | varchar(50) | | 'realtime' | 来源 |
| schema_version | integer | | 2 | Schema版本 |
| backfill_at | timestamptz | | | 回填时间 |
| source_message_id | bigint | | | 源消息ID |
| value_score | double precision | | 0.5 | 价值评分 |

**索引**:

| 索引名 | 类型 | 字段 | 说明 |
|--------|------|------|------|
| idx_memories_embedding_hnsw | HNSW | embedding | 向量检索（cosine） |
| idx_memories_user | B-tree | (user_id, created_at DESC) | 用户查询 |
| idx_memories_session | B-tree | session_id | 会话查询 |
| idx_memories_type | B-tree | memory_type | 类型过滤 |
| idx_memories_active | B-tree | is_active WHERE is_active=TRUE | 活跃记忆 |
| uq_memories_idempotent | UNIQUE | (tenant_id, session_id, message_index, entity, attribute) | 幂等约束 |

**CHECK 约束**:
- `memory_type IN ('factual', 'preference', 'event')`
- `confidence BETWEEN 0 AND 1`

**关系**: `superseded_by` → memories(id)（自引用，标记旧记录）

---

### 3.2 memory_summaries（会话摘要）

**用途**: LLM 生成的会话摘要，语义化召回的核心表

**路径**: `/home/ai/.openclaw/workspace/memory-system/scripts/memory-writer.js → writeSummary()`

| 字段 | 类型 | Nullable | 默认值 | 说明 |
|------|------|----------|--------|------|
| id | bigserial | NOT NULL | auto | 主键 |
| summary | text | NOT NULL | | 摘要内容 |
| summary_type | varchar(50) | NOT NULL | 'default' | 摘要类型 |
| source_message_ids | bigint[] | | | 关联消息ID数组 |
| source_session_id | varchar(100) | | | 源会话ID |
| time_range_start | timestamptz | | | 时间范围起点 |
| time_range_end | timestamptz | | | 时间范围终点 |
| embedding | vector(1024) | | | 向量嵌入 |
| confidence | double precision | NOT NULL | 0.8 | 置信度 |
| metadata | jsonb | | '{}' | 附加元数据 |
| content_hash | varchar(32) | | | 内容MD5（去重） |
| created_at | timestamptz | NOT NULL | now() | 创建时间 |
| updated_at | timestamptz | NOT NULL | now() | 更新时间 |
| is_active | boolean | NOT NULL | TRUE | 是否活跃 |

**索引**:

| 索引名 | 类型 | 字段 | 说明 |
|--------|------|------|------|
| idx_memory_summaries_embedding_hnsw | HNSW | embedding | 向量检索 |
| idx_memory_summaries_created | B-tree | created_at DESC | 时间排序 |
| idx_memory_summaries_session | B-tree | source_session_id | 会话查询 |
| idx_memory_summaries_type | B-tree | summary_type | 类型查询 |

**去重逻辑**: 写入前检查 `content_hash`，存在则跳过

---

### 3.3 personal_memories（原始内容记忆）

**用途**: 直接存储原始内容，无需 LLM 提取的结构化记忆

**路径**: `/home/ai/.openclaw/workspace/memory-system/scripts/memory-writer.js → writePersonal()`

| 字段 | 类型 | Nullable | 默认值 | 说明 |
|------|------|----------|--------|------|
| id | bigserial | NOT NULL | auto | 主键 |
| content | text | NOT NULL | | 记忆内容 |
| category | varchar(50) | NOT NULL | 'general' | 分类 |
| insight_type | varchar(50) | NOT NULL | 'general' | 洞察类型 |
| embedding | vector(1024) | | | 向量嵌入 |
| embedding_model | varchar(50) | NOT NULL | 'bge-m3' | 嵌入模型 |
| source_ids | jsonb | | '[]' | 来源ID列表 |
| origin_session_id | varchar(100) | | | 原始会话ID |
| confidence | double precision | NOT NULL | 0.8 | 置信度 |
| value_score | double precision | | 0.5 | 价值评分 |
| is_active | boolean | NOT NULL | TRUE | 是否活跃 |
| metadata | jsonb | | '{}' | 附加元数据 |
| created_at | timestamptz | NOT NULL | now() | 创建时间 |
| updated_at | timestamptz | NOT NULL | now() | 更新时间 |

**索引**:

| 索引名 | 类型 | 字段 | 说明 |
|--------|------|------|------|
| idx_personal_memories_embedding_hnsw | HNSW | embedding | 向量检索 |
| idx_personal_memories_category | B-tree | category | 分类查询 |
| idx_personal_memories_created | B-tree | created_at DESC | 时间排序 |
| idx_personal_memories_session | B-tree | origin_session_id | 会话查询 |

---

### 3.4 conversation_messages（会话消息）

**用途**: 原始会话消息存储，记忆链路的数据源

**路径**: `/home/ai/.openclaw/workspace/memory-system/hooks/session-capture-hook/handler.js → writeMessage()`

| 字段 | 类型 | Nullable | 默认值 | 说明 |
|------|------|----------|--------|------|
| id | bigserial | NOT NULL | auto | 主键 |
| session_id | varchar(100) | NOT NULL | | 会话ID |
| message_index | integer | NOT NULL | | 消息序号（已废弃，用turn_index） |
| role | varchar(20) | NOT NULL | | user / assistant |
| content | text | NOT NULL | | 消息内容 |
| sender_id | varchar(100) | | | 发送者ID |
| channel | varchar(50) | | | 来源渠道 |
| metadata | jsonb | | '{}' | 附加元数据 |
| created_at | timestamptz | NOT NULL | now() | 创建时间 |
| turn_index | integer | NOT NULL | 0 | 消息轮次序号 |
| message_type | varchar(20) | | 'chat' | 消息类型 |

**索引**:

| 索引名 | 类型 | 字段 | 说明 |
|--------|------|------|------|
| conversation_messages_pkey | PRIMARY KEY | id | 主键 |
| conversation_messages_session_turn_role_key | UNIQUE | (session_id, turn_index, role) | 唯一约束 |
| idx_conversation_messages_role | B-tree | role | 角色过滤 |
| idx_conversation_messages_session | B-tree | (session_id, message_index) | 会话查询 |

**注意**: `message_index` 和 `turn_index` 并存，`turn_index` 为当前活跃列

---

### 3.5 recall_logs（召回日志）

**用途**: 记录每次召回查询，用于分析和优化

**路径**: `/home/ai/.openclaw/workspace/memory-system/scripts/session-recall.js`

| 字段 | 类型 | Nullable | 默认值 | 说明 |
|------|------|----------|--------|------|
| id | uuid | NOT NULL | gen_random_uuid() | 主键 |
| tenant_id | uuid | NOT NULL | | 租户ID |
| user_id | uuid | | | 用户ID |
| session_id | uuid | | | 会话ID |
| query_text | text | NOT NULL | | 查询文本 |
| query_embedding | vector(1024) | | | 查询向量 |
| recalled_ids | bigint[] | NOT NULL | '{}' | 召回ID列表 |
| recalled_sources | text[] | | | 召回来源表 |
| scores | double precision[] | NOT NULL | '{}' | 相似度分数 |
| latency_ms | integer | NOT NULL | | 延迟（毫秒） |
| feedback | smallint | | | 用户反馈（1有用/-1无用） |
| created_at | timestamptz | NOT NULL | now() | 创建时间 |
| intent | varchar(50) | | 'DEFAULT' | 意图分类 |
| sender_id_text | text | | | 发送者文本ID |

**索引**:

| 索引名 | 类型 | 字段 | 说明 |
|--------|------|------|------|
| idx_recall_logs_tenant | B-tree | (tenant_id, created_at DESC) | 租户查询 |
| idx_recall_logs_user | B-tree | (user_id, created_at DESC) | 用户查询 |
| idx_recall_logs_intent | B-tree | intent | 意图查询 |

---

### 3.6 conversation_sessions（会话元数据）

**用途**: 会话级别元数据存储（标题、主题、L0/L1摘要）

| 字段 | 类型 | Nullable | 默认值 | 说明 |
|------|------|----------|--------|------|
| id | varchar(100) | NOT NULL | | 主键（session_key） |
| session_key | varchar(200) | | | 会话密钥 |
| title | text | | | 会话标题 |
| topics | text[] | | | 主题标签数组 |
| l0_summary | text | | | 一句话摘要 |
| l1_summary | text | | | 段落摘要 |
| message_count | integer | | 0 | 消息数 |
| created_at | timestamptz | NOT NULL | now() | 创建时间 |
| updated_at | timestamptz | NOT NULL | now() | 更新时间 |

**索引**: `conversation_sessions_pkey` (id)

---

### 3.7 summary_message_links（摘要-消息关联）

**用途**: memory_summaries 与 conversation_messages 的多对多关联

| 字段 | 类型 | Nullable | 说明 |
|------|------|----------|------|
| summary_id | bigint | NOT NULL | 摘要ID（FK → memory_summaries.id） |
| message_id | bigint | NOT NULL | 消息ID（FK → conversation_messages.id） |

**主键**: (summary_id, message_id)

---

### 3.8 session_summary_cursor（摘要提取游标）

**用途**: 跟踪每个 session 的摘要提取进度，支持增量处理

| 字段 | 类型 | Nullable | 默认值 | 说明 |
|------|------|----------|--------|------|
| session_id | varchar(100) | NOT NULL | | 会话ID（主键） |
| last_message_id | bigint | NOT NULL | 0 | 最后处理的消息ID |
| last_extracted_at | timestamptz | | NOW() | 最后提取时间 |
| updated_at | timestamptz | | NOW() | 更新时间 |

---

## 四、脚本地图

### 4.1 recall-hook/handler.js

**路径**: `/home/ai/.openclaw/workspace/memory-system/hooks/recall-hook/handler.js`

**职责**: before_prompt_build 事件入口，召回记忆并注入 prompt

**核心函数**:

| 函数 | 职责 |
|------|------|
| `classifyIntent(query)` | 意图分类（8类） |
| `buildMemoryPrompt(memories)` | 格式化召回结果为 prompt 片段 |
| `loadPreviousContext(sessionKey)` | 加载 Proactive 上下文 |
| `detectTopicShift(prev, curr)` | 检测话题切换 |
| `detectIdleSilence(userId)` | 检测长时间沉默 |
| `preloadMemoriesForNewSession(sessionKey)` | 新 session 预加载记忆 |
| `updateScoreOnRecall(memoryIds)` | 模块E：召回后更新评分 |
| `evaluateReasoningSuccess(response)` | 模块F：判断推理是否成功 |

**触发时机**: before_prompt_build（每次 LLM 调用前）

---

### 4.2 session-capture-hook/handler.js

**路径**: `/home/ai/.openclaw/workspace/memory-system/hooks/session-capture-hook/handler.js`

**职责**: 捕获用户消息，写入 conversation_messages

**核心函数**:

| 函数 | 职责 |
|------|------|
| `writeMessage({ sessionId, role, content, channel, metadata })` | 写入单条消息 |
| `toUuid(input)` | 字符串转 UUID |
| `extractContent(msg)` | 提取消息内容（处理多格式） |

**触发时机**: before_message_write（消息写盘前）

---

### 4.3 session-recall.js

**路径**: `/home/ai/.openclaw/workspace/memory-system/scripts/session-recall.js`

**职责**: 核心召回服务，三级 HNSW 并行搜索

**核心类**: `RecallService`

| 方法 | 职责 |
|------|------|
| `recall({ tenantId, userId, query, topK, candidateK })` | 主召回方法 |
| `recallService.recall()` | 单例调用入口 |
| `_vectorSearchSummaries(vec, topK, opts)` | memory_summaries HNSW 搜索 |
| `_vectorSearchPersonal(vec, topK, opts)` | personal_memories HNSW 搜索 |
| `_vectorSearchMemories(vec, topK, opts)` | memories 全表过滤 |
| `_dynamicRerank(candidates, intent)` | 动态加权排序 |
| `cascadeRecall({ query, queryVec })` | 级联召回（多阶段） |
| `loadRecentSummaries(tenantId, userId, hours)` | 最近N小时摘要 |
| `classifyIntent(query)` | 意图分类（8类） |
| `computeRecallScore(mem, intent)` | 计算召回评分 |
| `level2Rerank(candidates, query)` | L2 精排（特征交叉） |

---

### 4.4 memory-writer.js

**路径**: `/home/ai/.openclaw/workspace/memory-system/scripts/memory-writer.js`

**职责**: 记忆写入，幂等保证，Redis Stream 事件发布

**核心类**: `MemoryWriter`

| 方法 | 职责 | 写入表 |
|------|------|--------|
| `writeMemory(mem)` | 写入结构化记忆 | memories |
| `writeSummary(summary)` | 写入会话摘要 | memory_summaries |
| `writePersonal(personal)` | 写入原始记忆 | personal_memories |
| `writeBatch(memories)` | 批量写入 | memories |
| `_publishGraphSync(event)` | 发布图谱同步事件 | Redis Stream |

---

### 4.5 session-summary-extractor.js

**路径**: `/home/ai/.openclaw/workspace/memory-system/scripts/session-summary-extractor.js`

**职责**: Session 级摘要Daemon，全文分段 + 并行 LLM + 合并摘要

**PM2 进程**: `session-summary-extractor`（PM2 ID 18）

**核心流程**:
1. 查询 session_summary_cursor 获取未处理 session
2. 读取会话消息全文
3. 按固定 token 数分段（≤2000 tokens，50 tokens 重叠）
4. 并行调用 Qwen-max 生成每段摘要
5. 合并多段摘要生成最终摘要
6. 生成 embedding（BGE-m3）
7. 写入 memory_summaries
8. 更新 session_summary_cursor

---

### 4.6 graph-linker.js

**路径**: `/home/ai/.openclaw/workspace/memory-system/scripts/graph-linker.js`

**职责**: 消费 Redis Stream，将记忆数据同步到 Neo4j 图谱

**PM2 进程**: `graph-linker`（PM2 ID 17）

**核心流程**:
1. XREADGROUP 读取 graph:sync:events
2. 解析事件类型（memory_summary_created / personal_memory_created）
3. 构建 Neo4j 节点和关系（Cypher）
4. 写入 Neo4j 图谱

---

### 4.7 embedder.js

**路径**: `/home/ai/.openclaw/workspace/memory-system/scripts/embedder.js`

**职责**: BGE-m3 向量嵌入

**核心函数**:

| 函数 | 职责 |
|------|------|
| `embed(text)` | 文本 → vector[1024] |
| `embedBatch(texts)` | 批量嵌入 |

**依赖**: Ollama localhost:11434

---

### 4.8 redis.js

**路径**: `/home/ai/.openclaw/workspace/memory-system/scripts/redis.js`

**职责**: Redis 连接 + Stream 操作 + 缓存

**核心方法**:

| 方法 | 职责 |
|------|------|
| `getCachedCandidates(queryHash)` | 读取召回缓存 |
| `cacheCandidates(queryHash, candidates, ttl)` | 写入召回缓存 |
| `invalidateRecallCache(pattern)` | 清除召回缓存 |
| `xadd(stream, id, fields)` | 添加 Stream 事件 |
| `xlen(stream)` | 获取 Stream 长度 |
| `xreadgroup(stream, group, consumer, count)` | 消费 Stream |

---

### 4.9 db.js

**路径**: `/home/ai/.openclaw/workspace/memory-system/scripts/db.js`

**职责**: PostgreSQL 连接池管理

---

### 4.10 session-file-extractor-loop.js

**路径**: `/home/ai/.openclaw/workspace/memory-system/scripts/session-file-extractor-loop.js`

**职责**: 定期扫描会话文件，提取消息并写入数据库

**PM2 进程**: `session-extractor`（PM2 ID 19）

**轮询间隔**: 30 秒

---

## 五、PM2 进程清单

| PM2 ID | 进程名 | 脚本 | 职责 | 状态 |
|--------|--------|------|------|------|
| 0 | session-extractor | session-file-extractor-loop.js | 会话文件扫描提取 | stopped |
| 17 | graph-linker | graph-linker.js | Neo4j 图谱同步 | online |
| 18 | session-summary-extractor | session-summary-extractor.js | Session 摘要Daemon | online |
| — | outbox-writer | outbox-writer.js | Outbox 模式写入 | online |
| — | graphify-opus-manager | start-opus-manager.js | Graphify 代码管理 | online |

**当前状态（2026-04-21）**:
- session-extractor: **stopped**（05:30 数据库事故后未恢复）
- graph-linker: online
- session-summary-extractor: online

---

## 六、Hook 事件流

### 6.1 OpenClaw 事件系统

```
消息到达 Gateway
    │
    ▼
事件分发（EventEmitter）
    │
    ├── message:received     → 用户消息到达
    ├── message:sent         → 助手消息发送
    ├── message:preprocessed  → 消息预处理完成
    ├── before_message_write → 消息写盘前
    ├── after_message_write  → 消息写盘后
    ├── before_prompt_build  → Prompt 构建前 ← recall-hook
    ├── after_response       → 响应生成后
    └── session:new / session:reset
```

### 6.2 完整对话生命周期事件流

```
用户发送: "帮我查一下记忆系统状态"
    │
    ▼
[before_message_write] ──→ session-capture-hook ──→ conversation_messages
    │
    ▼
[before_prompt_build] ──→ recall-hook
    │                        │
    │                        ├── BGE-m3 embedding
    │                        ├── 意图分类
    │                        ├── HNSW 三表搜索
    │                        ├── 动态排序
    │                        └── buildMemoryPrompt()
    │
    ▼
LLM 处理（携带召回记忆）
    │
    ▼
[after_response] ──→ recall-hook 后处理
    │                   │
    │                   ├── 模块E: updateScoreOnRecall()
    │                   ├── 模块D: 置信度检测
    │                   └── 模块F: 记录推理模式
    │
    ▼
[after_message_write] ──→ 消息持久化
    │
    ▼
30秒后 ──→ session-extractor ──→ memory-writer
    │                              │
    │                              ├── memories
    │                              ├── memory_summaries
    │                              └── personal_memories
    │
    ▼
10分钟后 ──→ session-summary-extractor ──→ memory_summaries 更新
    │                                    │
    │                                    └── Redis Stream ──→ graph-linker ──→ Neo4j
```

---

## 七、Redis 数据结构

### 7.1 Stream

| Stream | 生产者 | 消费者 | 数据 |
|--------|--------|--------|------|
| `graph:sync:events` | memory-writer / session-summary-extractor | graph-linker | `{type, payload, timestamp}` |
| `memory:messages` | session-summary-extractor | memory-workers | `{type, payload}` |

### 7.2 Key-Value 缓存

| Key 模式 | 类型 | 说明 | TTL |
|----------|------|------|-----|
| `recall:{queryHash}` | String (JSON) | 召回候选缓存 | 300s |
| `context_loaded:{sessionKey}` | String | session 上下文已加载 | 24h |
| `proactive_loaded:{sessionKey}` | String | proactive 已加载 | 24h |
| `goal_intent_queue` | List | Goal 意图队列 | — |
| `_pending_reasoning_tasks` | Hash（内存） | 待处理推理任务 | 5min TTL |

### 7.3 Pub/Sub

| Channel | 用途 |
|---------|------|
| `recall:invalidate` | 全量召回失效广播 |

---

## 八、副脑（Problem Thread）集成

### 8.1 主脑系统架构

```
OpenClaw Gateway
    │
    ▼
problem-thread-plugin（OpenClaw 插件）
    │
    ├── before_prompt_build（首次注入 active threads）
    ├── command:new（session 结束时新建 Thread）
    └── command:reset（reset 时新建 Thread）
         │
         ▼
Problem Thread API（端口 54321）
    │
    ├── PostgreSQL（54320）→ problem_threads 表
    │
    └── Neo4j（7688）→ Thread/Session 关系图谱
```

### 8.2 主脑 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /threads | 列出 threads |
| GET | /threads/:id | 获取单个 thread |
| POST | /threads | 新建 thread |
| PATCH | /threads/:id/stage | 更新某 stage 内容 |
| PATCH | /threads/:id/status | 更新状态 |
| POST | /sessions/:id/summary | 推送 session 摘要 |
| GET | /sessions/:id/threads | 查询某 session 关联的 threads |

### 8.3 主脑数据库（54320）

**表**: `problem_threads`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| title | varchar(500) | 标题 |
| domain | varchar(100)[] | 领域标签 |
| status | varchar(20) | new/in_progress/blocked/completed/cancelled |
| sessions | uuid[] | 关联 session ID 数组 |
| stage_problem | jsonb | 问题定义 |
| stage_analysis | jsonb | 分析记录 |
| stage_decision | jsonb | 决策结论 |
| stage_implementation | jsonb | 实施记录 |
| stage_verification | jsonb | 验证结果 |

---

## 九、关键配置参数

### 9.1 数据库连接

```yaml
PostgreSQL:
  host: localhost
  port: 5432
  database: openclaw_memory
  user: openclaw_ai
  password: zyxrcy910128

主脑 PostgreSQL:
  host: localhost
  port: 54320
  database: ptdb
  user: ptuser
  password: ptpass
```

### 9.2 召回延迟预算

| 阶段 | 预算 | 说明 |
|------|------|------|
| Embedding | < 30ms | BGE-m3 Ollama |
| HNSW 搜索 | < 50ms | 三表并行 |
| 排序 | < 10ms | 动态加权 |
| Prompt | < 5ms | 格式化 |
| 网络 | < 255ms | LLM 调用 |
| **总计** | **< 350ms** | P99 目标 |

### 9.3 意图权重配置

| 意图 | 语义权重 | 时间权重 | 置信度权重 | 半衰期 |
|------|---------|---------|-----------|--------|
| TECHNICAL | 0.5 | 0.1 | 0.4 | 4h |
| PROJECT | 0.4 | 0.3 | 0.3 | 4h |
| REASONING | 0.4 | 0.2 | 0.4 | 2h |
| FACTUAL | 0.6 | 0.2 | 0.2 | 2h |
| PREFERENCE | 0.3 | 0.4 | 0.3 | 8h |
| EVENT | 0.2 | 0.6 | 0.2 | 0.5h |
| PERSON | 0.5 | 0.3 | 0.2 | 4h |
| DEFAULT | 0.5 | 0.3 | 0.2 | 2h |

---

## 十、测试验证方法

### 10.1 健康检查

```bash
node /home/ai/.openclaw/workspace/memory-system/scripts/health-check.js
```

**检查项**: PostgreSQL / pgvector / 表存在 / HNSW 索引 / Redis / BGE-m3 / 主脑

### 10.2 写入链路测试

```bash
node /home/ai/.openclaw/workspace/memory-system-rebuild/scripts/test-write.js
```

**验证**: 4张表写入 + Redis Stream 事件

### 10.3 召回链路测试

```bash
node /home/ai/.openclaw/workspace/memory-system-rebuild/scripts/test-recall.js
```

**验证**: 5个 query + 意图分类 + 缓存命中 + recall_logs

### 10.4 数据库表数据量

```bash
PGPASSWORD=zyxrcy910128 psql -h localhost -p 5432 -U openclaw_ai -d openclaw_memory \
  -c "SELECT count(*) FROM memories; SELECT count(*) FROM memory_summaries; SELECT count(*) FROM personal_memories; SELECT count(*) FROM conversation_messages; SELECT count(*) FROM recall_logs;"
```

### 10.5 Redis Stream 状态

```bash
redis-cli XLEN graph:sync:events
redis-cli XLEN memory:messages
```

### 10.6 PM2 进程状态

```bash
pm2 list | grep -E "session-extractor|summary-extractor|graph-linker"
```

### 10.7 BGE-m3 向量生成测试

```bash
curl -s -X POST http://localhost:11434/api/embeddings \
  -H "Content-Type: application/json" \
  -d '{"model":"bge-m3","input":"测试文本"}'
```

---

## 附录 A：当前数据统计（2026-04-21）

| 表名 | 记录数 | 说明 |
|------|--------|------|
| memories | 2 | 事故后残留 + 测试写入 |
| memory_summaries | 3 | 事故后残留 |
| personal_memories | 13 | 事故后残留 + 测试写入 |
| conversation_messages | 66 | 事故后残留 + 测试写入 |
| recall_logs | 14+ | 召回测试产生 |

**Redis Stream**:
- `graph:sync:events`: 4 条
- `memory:messages`: 0 条

---

## 附录 B：文件路径索引

### 核心脚本

| 路径 | 职责 |
|------|------|
| `memory-system/scripts/session-recall.js` | 召回服务 |
| `memory-system/scripts/memory-writer.js` | 记忆写入 |
| `memory-system/scripts/embedder.js` | 向量嵌入 |
| `memory-system/scripts/redis.js` | Redis 连接 |
| `memory-system/scripts/db.js` | 数据库连接 |
| `memory-system/scripts/config.js` | 全局配置 |
| `memory-system/scripts/session-context-loader.js` | Proactive 上下文 |
| `memory-system/scripts/graphify-fetch.js` | Graphify 代码对齐 |
| `memory-system/scripts/session-summary-extractor.js` | 摘要提取Daemon |
| `memory-system/scripts/session-file-extractor-loop.js` | 会话文件提取循环 |
| `memory-system/scripts/graph-linker.js` | 图谱同步 |
| `memory-system/scripts/memory-garbage-collector.js` | 模块E: 冷存储激活 |
| `memory-system/scripts/reasoning-pattern-manager.js` | 模块F: 推理模式 |

### Hooks

| 路径 | 触发时机 |
|------|---------|
| `memory-system/hooks/recall-hook/handler.js` | before_prompt_build |
| `memory-system/hooks/session-capture-hook/handler.js` | before_message_write |

### 重建版本（独立）

| 路径 | 说明 |
|------|------|
| `memory-system-rebuild/src/recall-service.js` | 重建版召回服务 |
| `memory-system-rebuild/src/memory-writer.js` | 重建版记忆写入 |
| `memory-system-rebuild/src/embedder.js` | 重建版向量嵌入 |
| `memory-system-rebuild/src/redis.js` | 重建版 Redis |
| `memory-system-rebuild/src/session-capture-hook.js` | 重建版消息捕获 |
| `memory-system-rebuild/src/recall-hook.js` | 重建版召回 hook |
| `memory-system-rebuild/scripts/health-check.js` | 健康检查 |
| `memory-system-rebuild/scripts/test-write.js` | 写入测试 |
| `memory-system-rebuild/scripts/test-recall.js` | 召回测试 |
| `memory-system-rebuild/migrations/001_init.sql` | 数据库迁移 |

---

*报告生成时间: 2026-04-21 07:25 GMT+8*
*玄枢 · 太虚智网灵枢*
