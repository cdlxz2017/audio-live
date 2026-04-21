# 系统注册表 — 触发词：系统 / 调用 / 触发 / 所有系统 / 系统清单

> 输入以下关键词任一，即输出完整系统清单和使用方法
> 触发词不区分大小写

---

## 通讯与语音

### 142G语音通讯系统 v2
- **触发词**：语音、打电话、拨号、SMS、短信、通讯录
- **CLI命令**：
  ```bash
  cd /home/ai/.openclaw/workspace/voice-system/v2
  python3 cli/voice_cli.py contact list          # 查看通讯录
  python3 cli/voice_cli.py call <手机号>        # 发起外呼
  python3 cli/voice_cli.py sms <手机号> <内容>  # 发送短信
  python3 cli/voice_cli.py broadcast <标签> <内容>  # 群发短信
  python3 cli/voice_cli.py contact add <手机号> <姓名> [标签]  # 添加联系人
  ```
- **微信推送**：来电/录音完成后自动推送到微信
- **录音设备**：自动检测（plughw:1,0）
- **状态**：✅ 运行中（PM2）

---

### 远程录音系统（Audio Stream）
- **触发词**：远程录音、开始录音、停止录音、录音状态
- **使用**：
  ```bash
  python3 /home/ai/.openclaw/workspace/custom-skills/camera-recorder/scripts/camera.py start   # 开始
  python3 /home/ai/.openclaw/workspace/custom-skills/camera-recorder/scripts/camera.py stop    # 停止
  python3 /home/ai/.openclaw/workspace/custom-skills/camera-recorder/scripts/camera.py status  # 状态
  ```
- **手机访问**：https://192.168.31.200:18792/audio-live.html
- **自动流程**：录音 → Whisper转写 → LLM摘要 → 邮件发送
- **状态**：✅ 运行中

---

## 记忆与知识

### 三层记忆追溯系统（Three-Layer Memory Lookup）
- **触发词**：追溯原始对话、三层记忆、查原始消息、摘要来源、lookup
- **使用方法**：
  ```bash
  node /home/ai/.openclaw/workspace/custom-skills/three-layer-memory-lookup/lookup.js <summary_id>
  ```
  示例：`node lookup.js 1710`
- **Skill 路径**：`custom-skills/three-layer-memory-lookup/SKILL.md`
- **架构**：
  ```
  memory_summaries
    ├─ source_session_id ──→ conversation_messages（整段会话）
    └─ source_message_ids ──→ conversation_messages（触发消息）
  ```
- **适用场景**：摘要 → 原始对话追溯、核实决策背景、审计对话记录
- **状态**：✅ 已创建

### 主脑（记忆链路系统）

> **⚠️ 绝对禁区**：未经主人灵须子明确授权，不得对主脑任何组件进行任何操作。
> 详见 MEMORY.md「主脑保护铁律」。

#### 一、定位与架构

主脑是玄枢（主脑）的核心记忆引擎，负责在每次对话前自动召回相关记忆并注入到 LLM prompt 上下文中。



#### 二、数据链路详解

**链路A：消息捕获**


**链路B：记忆写入**


**链路C：摘要提取**


**链路D：召回（核心）**


**链路E：Redis Stream**


**链路F：副脑 Problem Thread**


#### 三、数据库表手册

| 表名 | 存储内容 | 关键字段 | 索引 |
|------|---------|---------|------|
| **memories** | 结构化记忆 | id/tenant_id/user_id/entity/attribute/value/embedding/memory_type/confidence/is_active | HNSW(embedding) / (tenant_id,session_id,message_index,entity,attribute) UNIQUE |
| **memory_summaries** | LLM摘要 | id/summary/summary_type/embedding/source_session_id/confidence/content_hash | HNSW(embedding) / created_at DESC |
| **personal_memories** | 原始内容 | id/content/category/embedding/origin_session_id/confidence | HNSW(embedding) / category / created_at DESC |
| **conversation_messages** | 会话消息 | id/session_id/turn_index/role/content/channel/metadata | (session_id,turn_index,role) UNIQUE |
| **recall_logs** | 召回日志 | id/query_text/query_embedding/recalled_ids/scores/latency_ms/intent/feedback | (tenant_id,created_at) / intent |
| **conversation_sessions** | 会话元数据 | id/session_key/title/topics/l0_summary/l1_summary | PRIMARY KEY(id) |
| **summary_message_links** | 摘要-消息关联 | summary_id/message_id | PRIMARY KEY(summary_id,message_id) |
| **session_summary_cursor** | 摘要提取游标 | session_id/last_message_id/last_extracted_at | PRIMARY KEY(session_id) |

#### 四、脚本地图

| 脚本 | 职责 | 链路 |
|------|------|------|
|  | 捕获消息写入 conversation_messages | 链路A |
|  | before_prompt_build 召回入口 | 链路D |
|  | 召回服务：三表HNSW + 意图分类 + 排序 | 链路D |
|  | 记忆写入：memories/memory_summaries/personal_memories | 链路B |
|  | Session级摘要Daemon | 链路C |
|  | 会话文件轮询提取 | 链路B |
|  | Redis Stream → Neo4j 图谱同步 | 链路E |
|  | BGE-m3 Ollama 向量嵌入 | 链路D |
|  | Redis 连接：Stream + 缓存 | 链路D/E |
|  | PostgreSQL 连接池 | 全链路 |
|  | 全局配置 | 全链路 |
|  | Proactive 上下文加载 | 链路D |
|  | Graphify 代码对齐 | 链路D |
|  | 模块E：冷存储激活 | 链路D后 |
|  | 模块F：推理模式 | 链路D后 |
|  | 模块D：置信度检测触发 | 链路D后 |
|  | 模块D：后台主动研究 | 链路D后 |

#### 五、PM2 进程

| 进程名 | 脚本 | 职责 | 状态 |
|--------|------|------|------|
| session-summary-extractor | session-summary-extractor.js | Session摘要Daemon | online |
| graph-linker | graph-linker.js | Redis Stream → Neo4j | online |
| outbox-writer | outbox-writer.js | Outbox模式写入 | online |
| graphify-opus-manager | start-opus-manager.js | Graphify代码管理 | online |

#### 六、Hook 事件流

| 事件 | 触发时机 | 脚本 |
|------|---------|------|
| before_message_write | 消息写盘前 | session-capture-hook → conversation_messages |
| before_prompt_build | LLM调用前 | recall-hook → RecallService → 注入记忆 |
| after_response | LLM响应后 | recall-hook后处理：评分更新/置信度检测 |

#### 七、副脑 Problem Thread

| 服务 | 端口 | 说明 |
|------|------|------|
| Problem Thread API | 54321 | 独立 Docker，7条 Thread 完整 |
| pt-postgres | 54320 | 独立数据库，problem_threads 表 |
| pt-neo4j | 7688 | 关系图谱 |

**API端点**：
-  — 列出 threads
-  — 新建 thread
-  — 追加 Stage
-  — 更新状态
-  — 推送 session 摘要

#### 八、Redis 数据结构

| Key/Stream | 类型 | 生产者 | 消费者 | 说明 |
|-----------|------|--------|--------|------|
|  | Stream | memory-writer / summary-extractor | graph-linker | 图谱同步事件 |
|  | Stream | session-summary-extractor | memory-workers | 消息流 |
|  | String | recall-service | recall-service | 召回缓存，TTL=300s |
|  | String | recall-hook | recall-hook | 上下文已加载标记，TTL=24h |
|  | String | recall-hook | recall-hook | Proactive已加载标记，TTL=24h |

#### 九、意图分类（8类）

| 意图 | 触发关键词示例 | 召回表优先级 | 半衰期 |
|------|-------------|------------|--------|
| TECHNICAL | 代码、bug、api、docker、pm2、hook | memories > summaries > personal | 4h |
| PROJECT | 项目、进度、milestone、计划 | summaries > memories > personal | 4h |
| REASONING | 为什么、分析、推理、原因 | summaries > memories > personal | 2h |
| FACTUAL | 是什么、定义、解释 | summaries > memories > personal | 2h |
| PREFERENCE | 喜欢、偏好、习惯 | personal > summaries > memories | 8h |
| EVENT | 昨天、上次、会议、发生 | personal > summaries > memories | 0.5h |
| PERSON | 谁、联系人、团队 | personal > summaries > memories | 4h |
| DEFAULT | 其他 | summaries > memories > personal | 2h |

#### 十、关键配置



#### 十一、测试命令


════════════════════════════════════════════════════════════════
  记忆系统健康检查 2026/4/21 07:36:38
════════════════════════════════════════════════════════════════

【PM2 进程】
  ✅ session-extractor: online | 运行 35min
     脚本: session-file-extractor-loop.js
  ✅ session-summary-extractor: online | 重启 4 次 | 运行 51min
     脚本: session-summary-extractor.js
  ✅ outbox-writer: online | 重启 1 次 | 运行 63min
     脚本: outbox-writer.js
  ✅ graph-linker: online | 重启 1 次 | 运行 63min
     脚本: graph-linker.js
  ✅ graphify-opus-manager: online | 运行 1044min
     脚本: start-opus-manager.js
  ✅ hermes-server: online | 运行 1044min
     脚本: hermes_server.py
  ✅ hermes-web: online | 运行 1044min
     脚本: server.js
  ✅ cowrie-tianxing: online | 运行 1044min
     脚本: cowrie-to-tianxing.sh（攻击IP→天刑扫描）

【基础设施】
[DB] New client connected
  ✅ PostgreSQL
  ✅ Neo4j
  ✅ Redis (延迟: 15ms, 内存: 2.05M, graph:sync长度: 5)
  ✅ Ollama (bge-m3: huihui_ai/gemma-4-abliterated:e2b, bge-m3:latest)

【玄一 Services】
  ✅ hermes-server (31235): ok | sessions: 0 | 延迟: 3ms
  ✅ hermes-web (31236): ok | 延迟: 2ms

【session-extractor】(文件扫描 → 对话存档+记忆提取)
  ⚠️ conversation_messages: 近1h +80 条 | 总 80 条 (+80条)
  ⚠️ memories: 近1h +3 条 | 总 3 条 (+3条)
     ⚠️ memories 表总量过少 (<100)，请检查 LLM 提取是否正常

【graph-linker】(PersonalMemory → Neo4j 图关联)
  ✅ PersonalMemory 节点: 2506 (+0节点)
     PersonalMemory → PersonalEntity 关系: 6950
     PersonalEntity 节点: 3

【graphify-opus-manager】(代码图谱 → GraphifyCode + Neo4j 对齐)
  ✅ 整体状态: healthy (来自 manager 日志)
  ✅ collection 层: running
  ✅ bridge 层: running
  ✅ query 层: running (端口 31234)
     query uptime: 1044min | 查询量: 25 | 失败: 7 | 缓存命中率: 8.0%

  ✅ GraphifyCode 节点: 80420 (+0)
     ALIGNED_TO 关系: 36831 (+0)
     Memory_summary 节点: 113
     PersonalEntity 节点: 3

【熔断器】
  ✅ 整体: 全部关闭
  ✅ llm_extraction: CLOSED
  ✅ vector_search: CLOSED
  ✅ neo4j_sync: CLOSED
  ✅ postgres: CLOSED
  ✅ redis: CLOSED
  ✅ neo4j: CLOSED

【蜜罐防御系统 (Cowrie)】
  ✅ cowrie.service (systemd): active | PID 2296
  ✅ 端口监听: SSH 2222 / Telnet 2223 ✅

────────────────────────────────────────────────────────────────
【总结】
  ⚠️ memories 表总量过少 (<100)，请检查 LLM 提取是否正常

  运行中: 7/7 个进程

════════════════════════════════════════════════════════════════

[DB] New client connected
[DB] New client connected
[DB] New client connected
  [SYSTEMS.md] 数据量快照已更新并提交
  [DB] 数据快照已写入 memory_snapshots 表
=== Memory System Health Check ===

PostgreSQL ... ✅ OK (12ms)
pgvector   ... ✅ OK (v0.8.2)
Tables     ... ✅ OK — {"memories":3,"memory_summaries":3,"personal_memories":48,"conversation_messages":80,"recall_logs":22}
HNSW Index ... ✅ OK (3 indexes)
Redis      ... ✅ OK
BGE-m3     ... ✅ OK (dim=1024, 70ms)
主脑 PG    ... ✅ OK (7 threads)

=== Summary ===
✅ All systems healthy
{
  "postgresql": {
    "ok": true,
    "latencyMs": 12
  },
  "pgvector": {
    "ok": true,
    "version": "0.8.2"
  },
  "tables": {
    "ok": true,
    "counts": {
      "memories": 3,
      "memory_summaries": 3,
      "personal_memories": 48,
      "conversation_messages": 80,
      "recall_logs": 22
    }
  },
  "hnsw": {
    "ok": true,
    "count": 3,
    "indexes": [
      "idx_memories_embedding_hnsw",
      "idx_memory_summaries_embedding_hnsw",
      "idx_personal_memories_embedding_hnsw"
    ]
  },
  "redis": {
    "ok": true
  },
  "bge_m3": {
    "ok": true,
    "dimensions": 1024,
    "latencyMs": 70
  },
  "pt_postgres": {
    "ok": true,
    "threads": 7
  }
}
=== Write Chain Test ===

--- 1. conversation_messages ---
[capture] written id=1247 role=user session=65f9b737-c46c-400d-90f0-4f42aab15734 len=24
[capture] written id=1248 role=assistant session=65f9b737-c46c-400d-90f0-4f42aab15734 len=56
✅ Written: user msg=1247, assistant msg=1248

--- 2. memories ---
✅ Written: memory id=ae91b571-77ad-46a8-acf3-91f419938294

--- 3. memory_summaries ---
✅ Written: summary id=3

--- 4. personal_memories ---
✅ Written: personal memory id=49

--- 5. Redis Stream ---
✅ graph:sync:events length=6

--- 6. Verification ---
✅ Row counts: {"memories":3,"memory_summaries":3,"personal_memories":49,"conversation_messages":82}

=== Write Test Summary ===
✅ All write tests passed
{
  "conversation_messages": {
    "ok": true,
    "ids": [
      "1247",
      "1248"
    ]
  },
  "memories": {
    "ok": true,
    "id": "ae91b571-77ad-46a8-acf3-91f419938294"
  },
  "memory_summaries": {
    "ok": true,
    "id": "3"
  },
  "personal_memories": {
    "ok": true,
    "id": "49"
  },
  "redis_stream": {
    "ok": true,
    "graphSyncLength": 6
  },
  "verification": {
    "ok": true,
    "counts": {
      "memories": 3,
      "memory_summaries": 3,
      "personal_memories": 49,
      "conversation_messages": 82
    }
  }
}
=== Recall Chain Test ===

--- 1. Intent Classification ---
  ⚠️ "记忆系统的状态是什么？" → FACTUAL (expected: TECHNICAL)
  ⚠️ "上次数据库出了什么问题？" → TECHNICAL (expected: EVENT)
  ⚠️ "副脑 Problem Thread 的数据还在吗？" → DEFAULT (expected: TECHNICAL)
  ⚠️ "重建记忆链路需要哪些步骤？" → DEFAULT (expected: TECHNICAL)
  ✅ "PostgreSQL HNSW 索引性能如何？" → TECHNICAL (expected: TECHNICAL)

--- 2. Recall Tests ---

  Query: "记忆系统的状态是什么？"
  Intent: FACTUAL | Cached: false | Latency: 96ms | Results: 5
    [personal_memories] score=0.6703 sim=0.5432 — 主脑 PostgreSQL 在 2026-04-21 05:30 被初始化为空壳，导致记忆数据全部丢失。副脑 Problem Thread 数据完整未受影响。需
    [personal_memories] score=0.6701 sim=0.5432 — 主脑 PostgreSQL 在 2026-04-21 05:30 被初始化为空壳，导致记忆数据全部丢失。副脑 Problem Thread 数据完整未受影响。需
    [personal_memories] score=0.6701 sim=0.5432 — 主脑 PostgreSQL 在 2026-04-21 05:30 被初始化为空壳，导致记忆数据全部丢失。副脑 Problem Thread 数据完整未受影响。需

  Query: "上次数据库出了什么问题？"
  Intent: TECHNICAL | Cached: false | Latency: 57ms | Results: 5
    [personal_memories] score=0.7869 sim=0.6634 — 主脑 PostgreSQL 在 2026-04-21 05:30 被初始化为空壳，导致记忆数据全部丢失。副脑 Problem Thread 数据完整未受影响。需
    [personal_memories] score=0.7859 sim=0.6634 — 主脑 PostgreSQL 在 2026-04-21 05:30 被初始化为空壳，导致记忆数据全部丢失。副脑 Problem Thread 数据完整未受影响。需
    [personal_memories] score=0.7858 sim=0.6634 — 主脑 PostgreSQL 在 2026-04-21 05:30 被初始化为空壳，导致记忆数据全部丢失。副脑 Problem Thread 数据完整未受影响。需

  Query: "副脑 Problem Thread 的数据还在吗？"
  Intent: DEFAULT | Cached: false | Latency: 63ms | Results: 5
    [personal_memories] score=0.7776 sim=0.6460 — 主脑 PostgreSQL 在 2026-04-21 05:30 被初始化为空壳，导致记忆数据全部丢失。副脑 Problem Thread 数据完整未受影响。需
    [personal_memories] score=0.7520 sim=0.6460 — 主脑 PostgreSQL 在 2026-04-21 05:30 被初始化为空壳，导致记忆数据全部丢失。副脑 Problem Thread 数据完整未受影响。需
    [personal_memories] score=0.7500 sim=0.6460 — 主脑 PostgreSQL 在 2026-04-21 05:30 被初始化为空壳，导致记忆数据全部丢失。副脑 Problem Thread 数据完整未受影响。需

  Query: "重建记忆链路需要哪些步骤？"
  Intent: DEFAULT | Cached: false | Latency: 58ms | Results: 5
    [personal_memories] score=0.7483 sim=0.5972 — 主脑 PostgreSQL 在 2026-04-21 05:30 被初始化为空壳，导致记忆数据全部丢失。副脑 Problem Thread 数据完整未受影响。需
    [personal_memories] score=0.7228 sim=0.5972 — 主脑 PostgreSQL 在 2026-04-21 05:30 被初始化为空壳，导致记忆数据全部丢失。副脑 Problem Thread 数据完整未受影响。需
    [personal_memories] score=0.7208 sim=0.5972 — 主脑 PostgreSQL 在 2026-04-21 05:30 被初始化为空壳，导致记忆数据全部丢失。副脑 Problem Thread 数据完整未受影响。需

  Query: "PostgreSQL HNSW 索引性能如何？"
  Intent: TECHNICAL | Cached: false | Latency: 64ms | Results: 5
    [memory_summaries] score=0.7031 sim=0.5671 — 用户在 2026-04-21 进行了记忆系统重建，包括 PostgreSQL 表结构重建、HNSW 索引创建、BGE-m3 向量嵌入测试。所有写入链路测试通过。
    [personal_memories] score=0.6364 sim=0.4485 — 主脑 PostgreSQL 在 2026-04-21 05:30 被初始化为空壳，导致记忆数据全部丢失。副脑 Problem Thread 数据完整未受影响。需
    [personal_memories] score=0.6354 sim=0.4485 — 主脑 PostgreSQL 在 2026-04-21 05:30 被初始化为空壳，导致记忆数据全部丢失。副脑 Problem Thread 数据完整未受影响。需

--- 3. Cache Hit Test ---
  Second call cached: true
  ✅ Cache hit confirmed

--- 4. Memory Prompt Build ---
  Prompt length: 403 chars
  Preview:
[Recalled Memories]
- [system_event] 主脑 PostgreSQL 在 2026-04-21 05:30 被初始化为空壳，导致记忆数据全部丢失。副脑 Problem Thread 数据完整未受影响。需要重建记忆链路系统。 (score: 0.721)
- [system_event] 主脑 PostgreSQL 在 2026-04-21 05:30 被初始化为空壳，导致记忆数据全部丢失。副脑 Problem Thread 数据完整未受影响。需要重建记忆链路系统。 (score: 0.696)
- [system_event] 主脑 PostgreSQL 在 2

--- 5. Recall Logs ---
  ✅ recall_logs count: 29

=== Recall Test Summary ===
Total queries: 5
Avg latency: 68ms
✅ All recall tests passed
│ 17 │ graph-linker                 │ default     │ 4.0.0   │ fork    │ 2410350  │ 63m    │ 1    │ online    │ 0%       │ 73.2mb   │ ai       │ disabled │
│ 19 │ session-extractor            │ default     │ 4.0.0   │ fork    │ 2690674  │ 35m    │ 0    │ online    │ 0%       │ 60.0mb   │ ai       │ disabled │
│ 18 │ session-summary-extractor    │ default     │ 4.0.0   │ fork    │ 2436198  │ 51m    │ 4    │ online    │ 0%       │ 85.5mb   │ ai       │ disabled │
 count 
-------
     3
(1 row)

 count 
-------
     3
(1 row)

 count 
-------
    49
(1 row)

#### 十二、详细技术报告

完整架构文档：

报告包含：8张表完整字段手册、10个脚本地图、7条链路时序图、PM2进程详解、Hook事件流、Redis数据结构、配置参数。
### 记忆完整性自检（Memory Integrity Check）
- **触发词**：记忆完整性、自检、完整性检查、integrity
- **脚本**：`memory-system/scripts/memory-integrity-check.js`
- **运行方式**：
  ```bash
  node /home/ai/.openclaw/workspace/memory-system/scripts/memory-integrity-check.js
  ```
- **逻辑**：
  ```
  IF 最近30分钟有对话消息:
      IF L2 有新摘要: ✅ 正常 → 静默
      ELSE: ❌ 异常 → 通知（extractor 卡了）
  ELSE:
      💤 没事 → 静默（没对话本来就不该有摘要）
  ```
- **检测项（完整六层链路）**：
  | 层 | 检测项 | 说明 |
  |---|--------|------|
  | L1 | conversation_messages | 原始对话新增 |
  | L2 | memory_summaries | Session摘要新增 |
  | L3 | personal_memories | 个人记忆新增（outbox-writer）|
  | L4 | recall_logs | 实际召回记录 |
  | L5 | Redis graph:sync:events | 队列积压（>50000告警）|
  | L6 | Neo4j PersonalMemory | 节点数量 |
  | 进程 | extractor/outbox/graph-linker | PM2进程状态 |
- **调度**：每30分钟自动执行（cron job）
- **告警**：仅在「有对话但无摘要」或「进程停止」时触发
- **状态**：✅ 已部署

---

### 自我监控系统
- **触发词**：健康检查、巡检、自动监控、系统状态
- **使用**：
  ```bash
  bash /home/ai/.openclaw/workspace/scripts/security-check.sh   # 安全检查（UFW/OSSEC/fail2ban）
  bash /home/ai/.openclaw/workspace/scripts/comprehensive-health-check.js
  ```
- **自动**：每4小时cron自动巡检，异常自动告警到微信
- **状态**：✅ 运行中

---

### 中央凭证管理系统（Centralized API Key Management）
- **触发词**：API Key管理、凭证管理、统一密钥、API管理
- **目的**：所有敏感凭证集中管理，消除硬编码，支持安全轮换
- **档案**：`memory/API-KEY-MANAGEMENT.md`

**目录结构**：
```
~/.openclaw/credentials/
├── database.env      # PostgreSQL / Neo4j 密码
├── api-keys.env      # DeepSeek / MiniMax / Brave / DashScope
├── qqmail.env        # QQ 邮箱凭证
├── loader.js         # Node.js 读取器
├── loader.py         # Python 读取器
└── README.md
```

**接入组件**：
| 组件 | 状态 | 读取方式 |
|------|------|---------|
| memory-system/config.js | ✅ 已接入 | 中央凭证 fallback |
| active-researcher.js | ✅ 已接入 | 中央凭证优先 |
| session-summary-now.js | ✅ 已接入 | 中央凭证 fallback |
| send-email.py | ✅ 已接入 | 中央凭证优先 |
| receive-email.py | ✅ 已接入 | 中央凭证优先 |

**读取优先级**（永不断裂）：
```
process.env  >  中央凭证文件  >  fallback值
```

**安全措施**：
- 目录权限：chmod 700（仅本人可读）
- 文件权限：chmod 600（仅本人可读写）
- 不提交 git（.gitignore 已在 workspace 配置）
- openclaw.json 权限：chmod 600

**Git 提交记录**：
- memory-system 子仓库：commit 92772bc（Phase 3）
- memory-system 子仓库：commit 05276c8（Phase 0-1）
- workspace 主仓库：commit 3c2ff15（方案报告）

**状态**：✅ Phase 0-5 全部完成（2026-04-20）

---

### 操作审计日志系统（Audit Logging System）
- **触发词**：审计日志、查审计、操作记录、谁改的、什么时候改的、audit
- **档案**：`memory/AUDIT-SYSTEM-DESIGN.md`

**核心文件**：
```
audit-scripts/
├── append-audit.js   # 核心写入模块（append-only + 批量合并 + fallback）
├── audit-redact.js   # 敏感信息脱敏（P0=完全隐藏，P1=部分隐藏）
└── audit-query.js    # CLI查询工具
```

**存储位置**：`/home/ai/.openclaw/audit/YYYY-MM-DD.jsonl`

**已捕获的操作类别**：
| 类别 | 状态 | 说明 |
|------|------|------|
| DATABASE | ✅ 已部署 | session-capture-hook 数据库写入 |
| FILE | ⏳ 待实施 | inotifywait 监控（Phase 2） |
| PROCESS | ⏳ 待实施 | PM2 event hook（Phase 2） |
| GIT | ⏳ 待实施 | Git hooks（Phase 2） |
| CONFIG | ⏳ 待实施 | 配置文件监控（Phase 2） |
| EXTERNAL_API | ⏳ 待实施 | HTTP 拦截（Phase 2） |
| CRON | ⏳ 待实施 | cron 包装脚本（Phase 2） |

**查询命令**：
```bash
node audit-scripts/audit-query.js --stats                    # 今日统计
node audit-scripts/audit-query.js --category DATABASE       # 按类别查
node audit-scripts/audit-query.js --op db:insert --limit 20 # 按操作查
node audit-scripts/audit-monitor.js                         # 监控检查
```

**监控方式**：每4小时健康检查邮件包含审计系统状态，监控指标：
- 目录可写性（日志权限 700，文件权限 600）
- 记录时效性（超过30分钟无新记录告警）
- 增量检测（对比上次记录数）
- JSONL格式完整性（每行可解析）

**日志格式**（示例）：
```json
{"id":"uuid","ts":"2026-04-20T03:56:00.000Z","category":"DATABASE","op":"db:insert","target":"conversation_messages (id=123)","before":null,"after":{"session_id":"...","role":"user","content_length":150},"result":{"success":true,"latencyMs":0},"metadata":{"hostname":"ai-MS-S1-MAX","source":"session-capture-hook"}}
```

**状态**：✅ Phase 1 完成（2026-04-20）

---

### 技术知识库（Tech Knowledge）
- **触发词**：技术知识、tech-knowledge、查技术文档
- **使用**：告诉我要查什么技术主题，自动从知识库检索
- **覆盖**：SOP文档 / memory-system架构 / a2a-gateway / lingyi-cms
- **方式**：向量搜索（BGE-m3）+ PostgreSQL全文检索
- **状态**：✅ 可用

---

### 目标追踪系统（Goal Tracker）
- **触发词**：目标追踪、Goal Tracker、当前目标、任务进度
- **使用**：告诉我要追踪什么项目/任务，自动创建Goal + SubGoal + Milestone
- **查看**：`memory/AGI-SYSTEM-DEEP-ANALYSIS-2026-04-14.md`
- **状态**：✅ Neo4j中运行

---

### 反思系统
- **触发词**：反思、元认知、今日反思
- **自动**：每天23:00自动生成反思摘要
- **输出路径**：`memory/reflection/YYYY-MM-DD.md`
- **状态**：✅ 已修复（评分门槛已调整）

---

## 靈一民宿管理系统（lingyi-cms）

- **触发词**：民宿、lingyi、CRM、客人管理、预订
- **Docker容器**：lingyi-frontend / lingyi-backend / lingyi-db
- **访问地址**：
  | 服务 | 地址 | 说明 |
  |------|------|------|
  | 前台网站 | http://192.168.0.100:3001 | 靈一民宿官网 |
  | 后台API | http://192.168.0.100:8001 | 后端REST API |
- **数据库**：localhost:5433（lingyi-db容器）
  - 用户：linyi_user / 密码：E4jZRKt3xN8qLp2v
  - 数据库：linyi_db
- **项目路径**：`/home/ai/.openclaw/workspace/projects/lingyi-cms/`
- **核心修改**：bills.py（次卡/月包营收修复）、reports.py（报表营收修复）
- **状态**：✅ Docker运行中

---

## 天道·系统（Tiandao Microservices）

- **触发词**：天道、系统后台
- **管理后台**：http://localhost:3003
- **服务端口**：
  | 服务 | 端口 | 说明 |
  |------|------|------|
  | tiandao-member | 3002 | 成员管理 |
  | tiandao-auth | 3004 | 认证服务 |
  | tiandao-karma | 3006 | 业力系统 |
  | tiandao-worldevent | 3011 | 现实事件接入 |
  | tiandao-admin-app | 3013 | 管理后台API |
- **状态**：✅ 运行中（PM2）

---

## 天道成员管理平台（tiandao_members）

- **触发词**：天道成员、成员管理、成员录入、成员目录、tiandao_members
- **项目路径**：`/home/ai/projects/tiandao-system/tiandao_members/`
- **Git 仓库**：已初始化（commit e92e560 / 0a61265）

### 访问地址（HTTPS）

| 服务 | 地址 |
|------|------|
| **React SPA（推荐）** | https://100.89.109.20:5173/ |
| 登录页（静态） | https://100.89.109.20:5173/login.html |
| 主页面（静态） | https://100.89.109.20:5173/dashboard.html |
| 后端 API | https://100.89.109.20:3010/api |
| 后端健康检查 | https://100.89.109.20:3010/health |

### 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React + Vite（HTTPS）+ 静态 HTML（古风页面） |
| 后端 | Express.js + Node.js（HTTPS） |
| 数据库 | PostgreSQL（与主脑共用 localhost:5432）|
| 认证 | JWT（24h 过期）+ bcrypt |
| OCR | 阿里云百炼 Qwen3.6-Plus（qwen-vl-plus）|
| 证书 | 自签发（/backend/cert.pem + key.pem）|

### 数据库表（4张）

| 表名 | 说明 |
|------|------|
| admin_users | 管理员账户（id / username / password_hash / title）|
| members | 成员信息（id / title / name / birthday / lunar_birthday / address / notes / id_card_image）|
| departments | 部门信息（id / name / parent_id / responsibility / manager_member_id / assistant_member_id）|
| department_members | 成员-部门多对多关联（member_id / department_id）|

### 核心 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/auth/login | 登录 |
| GET | /api/auth/me | 当前用户信息 |
| PUT | /api/auth/update-profile | 修改天道称号/用户名 |
| PUT | /api/auth/change-password | 修改密码 |
| GET | /api/departments/tree | 部门树（扁平）|
| GET | /api/members | 全部成员 |
| POST | /api/members | 创建成员 |
| PUT | /api/members/:id | 更新成员 |
| DELETE | /api/members/:id | 删除成员 |

### 成员表单字段规则

| 字段 | 添加时 | 编辑时 |
|------|--------|--------|
| 天道称号 | 必填 | 只读 |
| 姓名 | 扫描只读 | 只读 |
| 生日 | 扫描只读 | 只读 |
| 居住地址 | 扫描只读 | 只读 |
| 农历生日 | 自动换算 | 只读 |
| 备注 | 选填 | 选填 |
| 所属部门 | 选填 | 选填 |
| 身份证图片 | 扫描上传 | 显示/删除 |

### PM2 进程

| 进程 | 端口 | 说明 |
|------|------|------|
| tiandao_members 前端 | 5173（HTTPS） | Vite dev server |
| tiandao_members 后端 | 3010（HTTPS） | Express API |

### 登录凭证

| 字段 | 值 |
|------|------|
| 用户名 | admin |
| 密码 | admin123 |
| 天道称号 | 天帝 |

### 状态

- **状态**：✅ 运行中
- **最后提交**：commit 0a61265（2026-04-22 03:28）
- **文档**：`docs/CHANGELOG.md`

---

## 天道成员管理平台·跨平台安装包（tiandao_members_package）

- **触发词**：打包、跨平台安装、mac安装包、ubuntu安装包、成员平台打包
- **项目路径**：`/home/ai/projects/tiandao-system/tiandao_members_package/`
- **打包规模**：3910 行脚本代码，15 个脚本文件，后端 + 前端完整源码（约 73MB）
- **Git 仓库**：复用 tiandao_members 同一仓库

### 目标平台

| 平台 | 版本 | 架构 |
|------|------|------|
| macOS | 10.15+ | Apple Silicon（arm64）+ Intel（x64） |
| Ubuntu | 20.04 / 22.04 / 24.04 | x64 |

### 隔离保证

| 项目 | 值 |
|------|------|
| 后端端口 | 30132（冲突自动递增到 30137） |
| 前端端口 | 51732（冲突自动递增到 51737） |
| 数据库端口 | 54332（冲突自动递增到 54337） |
| 数据库名 | `tiandao_members_pack`（静态） |
| 数据库用户 | `tiandao_members_user` |
| PM2 进程前缀 | `pack_` |

### 目录结构

```
tiandao_members_package/
├── install-run.sh              # 主入口脚本
├── README.md                  # 完整安装文档
├── scripts/
│   ├── common/               # 全平台通用
│   │   ├── utils.sh         日志/颜色/错误处理
│   │   ├── detect_os.sh     OS + 架构检测
│   │   ├── check_ports.sh   端口分配
│   │   └── generate_cert.sh 自签 HTTPS 证书生成
│   ├── macos/               # macOS 专用
│   │   ├── install_node.sh
│   │   ├── install_postgresql.sh
│   │   └── setup_launchd.sh  # launchd 服务配置
│   ├── ubuntu/              # Ubuntu 专用
│   │   ├── install_node.sh
│   │   ├── install_postgresql.sh
│   │   └── setup_systemd.sh  # systemd 服务配置
│   └── app/
│       ├── init_database.sh  # 数据库初始化（4张表）
│       ├── build_frontend.sh # 前端生产构建
│       └── start_services.sh # 服务启动
├── bundles/                  # 离线安装包目录（Node.js + PostgreSQL）
│   ├── macos-arm64/
│   ├── macos-x64/
│   └── ubuntu-x64/
├── app/
│   ├── backend/             # Express.js 后端（完整源码）
│   └── frontend/            # React + Vite 前端（完整源码）
├── config/                  # 运行时配置
├── data/ssl/               # SSL 证书目录
└── logs/                   # 运行日志
```

### 脚本清单

| 脚本 | 行数 | 功能 |
|------|------|------|
| `install-run.sh` | 126 | 主入口，OS检测 + 流程调度 |
| `scripts/common/utils.sh` | 130 | 日志/颜色/错误处理 |
| `scripts/common/detect_os.sh` | 119 | OS + 架构检测 |
| `scripts/common/check_ports.sh` | 156 | 端口分配（30132/51732/54332） |
| `scripts/common/generate_cert.sh` | 198 | 自签 HTTPS 证书（10年有效期） |
| `scripts/macos/install_node.sh` | 209 | macOS Node.js 安装 |
| `scripts/macos/install_postgresql.sh` | 297 | macOS PostgreSQL 16 安装 |
| `scripts/macos/setup_launchd.sh` | 381 | launchd 服务配置 |
| `scripts/ubuntu/install_node.sh` | 252 | Ubuntu Node.js 安装 |
| `scripts/ubuntu/install_postgresql.sh` | 300 | Ubuntu PostgreSQL 16 安装 |
| `scripts/ubuntu/setup_systemd.sh` | 397 | systemd 服务配置 |
| `scripts/app/init_database.sh` | 281 | 数据库初始化（4张表） |
| `scripts/app/build_frontend.sh` | 285 | 前端生产构建 |
| `scripts/app/start_services.sh` | 445 | 服务启动 |
| `scripts/app/stop_services.sh` | 180 | 服务停止 |

### 核心特性

| 特性 | 实现方式 |
|------|---------|
| HTTPS 自签证书 | 启动时检测本机局域网 IP，openssl 生成含 SAN 证书，有效期 10 年 |
| 开机自启 | macOS：launchd plist；Ubuntu：systemd service |
| 离线安装 | bundles/ 目录预置 Node.js + PostgreSQL，优先离线再在线 |
| Git 更新 | tag 发布，手动同步 |
| 幂等脚本 | 所有脚本可重复执行，不破坏现有配置 |

### 使用方式

```bash
# 1. 下载安装包到目标机器
git clone <repo> tiandao_members_package
cd tiandao_members_package

# 2. 运行安装
sudo ./install-run.sh

# 3. 安装完成后访问
# macOS: 打开 https://<本机IP>:51732
# Ubuntu: 浏览器访问同上
```

### 状态

- **状态**：✅ 构建完成（2026-04-22）
- **交付物**：tiandao_members_package/ 目录
- **最后更新**：2026-04-22 04:24

---

## 邮件系统

- **触发词**：发邮件、发送邮件、测试邮件
- **发送**：
  ```bash
  node /home/ai/.openclaw/workspace/custom-skills/send-email/scripts/send-mail.js \
    --to cdlxz2017@qq.com --subject "标题" --body "内容"
  ```
- **配置**：SMTP smtp.qq.com:587 / 授权码已配置
- **状态**：✅ 正常

---

## Hermes Agent（玄一）

- **触发词**：玄一、Hermes、深度分析
- **使用**：告诉我需要分析什么，自动调用Hermes执行
- **工具**：recall_memories / search_memories / write_memory / neo4j_query / graph_query
- **调用方式**：
  ```javascript
  node /home/ai/.openclaw/workspace/custom-skills/hermes-router/hermes-router.js
  ```

### 网页入口

| 服务 | 地址 | 说明 |
|------|------|------|
| **Hermes Web UI** | http://192.168.0.100:31236 | 玄一网页控制台（推荐）|
| **Hermes API Server** | http://192.168.0.100:31235 | API接口（/health、/chat、/sessions）|

- **PM2进程**：hermes-server（31235）、hermes-web（31236）均 ✅ online
- **状态**：✅ Phase 1-3已完成

---

## 安全系统

### OSSEC HIDS（主机入侵检测）
- **用途**：文件完整性检查、rootkit检测、异常行为告警、Active Response自动封禁
- **进程**：✅ 6个进程运行中
- **配置路径**：`/var/ossec/etc/ossec.conf`
- **管理命令**：`/var/ossec/bin/ossec-control status`
- **日志路径**：`/var/ossec/logs/`
- **告警邮件**：cdlxz2017@qq.com
- **Active Response**：firewall-drop (iptables封禁600秒)
- **状态**：✅ 运行中

### fail2ban（暴力破解防护）
- **用途**：SSH/服务登录暴力破解防护
- **进程**：✅ fail2ban-server 运行中
- **状态**：✅ 运行中

### UFW 防火墙
- **状态**：✅ 已激活
- **入站规则**：
  - 允许 192.168.31.0/24（内网）
  - 允许 172.17.0.0/16（Docker）
  - 允许 127.0.0.0/8（本地）
  - 允许 18790/tcp（OpenClaw）
  - 允许 3001,8001/tcp（Tailscale）
  - 允许 41641/udp（Tailscale tunnel）
  - 允许 5256/tcp（Tailscale serve）
  - 拒绝 USB网络接口（enxae0c29a39b6d）入站

### 蜜罐防御系统（Honeypot Defense）
- **用途**：诱捕攻击者、记录攻击行为、联动天刑系统
- **组件**：
  - **Cowrie SSH/Telnet 蜜罐**：端口 2222/2223，捕获恶意SSH登录
  - **Python HTTP 蜜罐**：端口 8080，伪装 Apache/2.4.41，提供/admin、/api/status等诱饵路径
  - **天刑联动**：cowrie-tianxing PM2进程，攻击事件自动触发IP扫描
  - **fail2ban 联动**：cowrie-ssh / cowrie-telnet jail，登录失败自动封禁
- **进程管理**：
  | 进程 | 托管方式 | 端口 | 状态 |
  |------|----------|------|------|
  | cowrie（twistd） | systemd（cowrie.service） | 2222/2223 | ✅ online |
  | cowrie-to-tianxing | PM2（cowrie-tianxing） | — | ✅ online |
  | beelzebub-http | PM2（beelzebub-http） | 8080 | ✅ online |
- **systemd 管理命令**：
  ```bash
  sudo systemctl start cowrie     # 启动
  sudo systemctl stop cowrie      # 停止
  sudo systemctl restart cowrie   # 重启
  sudo systemctl status cowrie    # 状态
  ```
- **注意**：cowrie-ssh PM2 进程因与 systemd 托管实例冲突（端口冲突）已删除，改用 systemd 托管实现自愈
- **UFW 规则**：2222/tcp、2223/tcp、8080/tcp 已放行
- **SSH 指纹**：与真实系统 OpenSSH_9.6p1 对齐
- **日志路径**：
  - Cowrie：`/home/ai/services/honeypot/cowrie-src/log/cowrie.log`（JSON格式）
  - HTTP蜜罐：`/home/ai/services/honeypot/beelzebub.log`
- **scan-ip.sh**：`/home/ai/projects/tianxing-defense/scripts/scan-ip.sh`
- **Goal追踪**：Neo4j Goal honeypot-defense-2026 ✅ 100% 完成
- **状态**：✅ 全部部署完成并验证通过

### 天雷系统（TianLei Penetration Testing System）⚡
- **用途**：专业级全流程渗透测试自动化框架，从侦察、扫描、渗透到后渗透和报告生成
- **触发词**：天雷、渗透测试、天雷系统、pentest
- **路径**：`/home/ai/.openclaw/workspace/deliverables/tianlei/`
- **一键执行**：
  ```bash
  cd /home/ai/.openclaw/workspace/deliverables/tianlei
  ./run-all.sh                    # 交互式一键全流程
  ```
- **分步执行**：
  ```bash
  ./01-recon/recon.sh             # 阶段1：侦察（被动+主动）
  ./02-scan/vuln-scan.sh          # 阶段2：漏洞扫描（Nmap+Nuclei+CVE）
  ./02-scan/web-scan.sh           # Web应用扫描
  ./02-scan/api-scan.sh           # API接口扫描
  ./02-scan/db-scan.sh            # 数据库扫描
  ./03-exploit/exploit.sh         # 阶段3：渗透利用
  ./03-exploit/waf-bypass.sh      # WAF绕过
  ./03-exploit/web-exploit.py     # Web漏洞利用（SQL注入等）
  ./03-exploit/host-exploit.sh    # 主机渗透
  ./04-post-exploit/post-exploit.sh  # 阶段4：后渗透
  ./04-post-exploit/privesc-linux.sh  # Linux提权
  ./04-post-exploit/privesc-windows.sh # Windows提权
  ./04-post-exploit/lateral.sh    # 横向移动
  ./04-post-exploit/cleanup.sh    # 痕迹清理
  python3 ./05-report/report-gen.py  # 阶段5：生成HTML/Markdown报告
  ```
- **配置**：编辑 `config/target.conf` 设置目标网段/域名/IP和授权文件路径
- **输出**：`results/<project>/<date>/` 下按阶段分类，含漏洞JSON和HTML报告
- **特性**：
  - 授权文件验证（执行前强制检查）
  - 工具缺失自动提示并跳过
  - 彩色日志 + 文件日志双输出
  - 自动HTML报告（含CVSS评分、修复建议、统计图表）
  - 痕迹清理（远程主机+本地）
- **脚本数**：23个完整可执行脚本，约5,800行代码
- **状态**：✅ 已部署

### ClamAV（恶意文件扫描引擎）
- **用途**：扫描系统中的病毒、木马、恶意文件，填补OSSEC HIDS不具备的文件级杀毒能力
- **版本**：1.4.3（Ubuntu 24.04 apt源）
- **触发词**：ClamAV、病毒扫描、恶意文件
- **扫描命令**：
  ```bash
  # 手动扫描
  /usr/bin/clamscan --recursive --infected --move=/var/quarantine/ \
    --exclude-dir=/home/ai/.openclaw/ \
    --exclude-dir=/home/ai/projects/ \
    --exclude-dir=/home/ai/apps/ \
    /tmp /var/tmp /home/ai
  ```
- **定时任务**：每日凌晨5:00（ai用户，nice -n 19，低优先级）
- **隔离目录**：`/var/quarantine/`（700权限，仅ai可访问）
- **日志路径**：`/home/ai/.openclaw/workspace/logs/clamav-scan.log`
- **重要**：发现威胁时仅**隔离**而非自动删除，确保可恢复
- **与OSSEC联动**：可疑文件由OSSEC检测后触发ClamAV扫描
- **状态**：✅ 已部署

### Lynis（系统安全审计）
- **用途**：自动化安全审计、合规检测（ISO27001/PCI DSS/HIPAA）、漏洞检测
- **版本**：3.0.9（apt源）
- **触发词**：Lynis、安全审计、合规检测
- **审计命令**：
  ```bash
  /usr/sbin/lynis audit system  # 完整审计
  /usr/sbin/lynis show report    # 查看上次报告
  ```
- **定时任务**：每周一凌晨2:00（root用户，只读扫描）
- **日志路径**：`/var/log/lynis-cron.log`
- **特点**：完全只读，不修改系统文件，与OSSEC无冲突
- **报告输出**：`/var/log/lynis-report.dat`（机器可读）
- **状态**：✅ 已部署

### 隔离区分析系统（Quarantine Analyzer）
- **用途**：ClamAV隔离文件后，自动分析数据链归属、影响范围、威胁等级，发送邮件报告供主人决策
- **触发词**：隔离区、quarantine、分析文件
- **分析维度**：SHA256哈希、文件类型、熵值分析、字符串提取、数据链归属、进程关联、包管理器归属
- **工作流程**：
  ```
  ClamAV扫描发现威胁 → 隔离到/var/quarantine/
      ↓
  自动分析 → 生成报告 → 发送邮件至cdlxz2017@qq.com
      ↓
  3小时无操作 → 提醒邮件
      ↓
  7天无操作 → 自动归档（/var/quarantine/archive/，非删除）
  ```
- **操作命令**（邮件回复）：
  - `删除 [SHA256前8位]` → 永久删除
  - `保留 [SHA256前8位]` → 移出隔离区
  - `分析 [SHA256前8位]` → 深度逆向分析
- **安全特性**：三层验证（发件人+命令格式+文件存在性），静态分析优先
- **分析脚本**：`/home/ai/.openclaw/workspace/scripts/quarantine-analyzer.js`
- **守护脚本**：`/home/ai/.openclaw/workspace/scripts/quarantine-watcher.js`
- **日志**：`/home/ai/.openclaw/workspace/logs/quarantine-analyzer.log`
- **状态**：✅ 已部署

### 安全检查脚本
```bash
bash /home/ai/.openclaw/workspace/scripts/security-check.sh
```
- **检查内容**：UFW状态 / OSSEC状态 / fail2ban状态 / 登录失败日志
- **触发词**：安全检查、系统安全

---

## 标准操作流程（SOP）

> 所有 SOP 均可在 `/home/ai/.openclaw/workspace/` 目录下找到

### 记忆系统工作流 SOP（强制）
- **触发词**：记忆系统、修复记忆、检查记忆系统
- **规则**：记忆系统问题 → 必须用 Claude Opus 4-6 子程序处理
- **重试**：失败立即重试，最多3次；3次失败后报告主人
- **路径**：`SOP-MEMORY-SYSTEM.md`

### 文档更新 SOP（强制）
- **触发词**：更新文档、更新手册、文档规范
- **规则**：任何代码/配置/架构变更后，必须走此 SOP 检查文档同步
- **检查清单**：SYSTEMS.md → MEMORY.md → 今日日记 → TOOLS.md → 项目文档 → Git提交
- **路径**：`SOP-DOCUMENTATION-UPDATE.md`

### 邮件收发 SOP
- **触发词**：发邮件、发送邮件、测试邮件
- **路径**：`SOP-EMAIL.md`
- **发送**：`python3 custom-skills/send-email/scripts/send-email.py --to <邮箱> --subject "标题" --body "内容"`

### 视频录制 SOP
- **触发词**：摄像头、录制、开始录制、停止录制
- **路径**：`SOP-VIDEO-RECORDING.md`
- **命令**：
  ```bash
  python3 custom-skills/camera-recorder/scripts/camera.py start   # 开始录制
  python3 custom-skills/camera-recorder/scripts/camera.py stop    # 停止
  python3 custom-skills/camera-recorder/scripts/camera.py status  # 状态
  ```

### 系统清洁 SOP
- **触发词**：清洁系统、清理空间、卸载软件
- **路径**：`SOP-CLEAN-SYSTEM.md`

### Gateway 重启 SOP
- **触发词**：重启Gateway、重启网关
- **路径**：`SOP-GATEWAY-RESTART.md`
- **禁止**：禁止用 systemctl restart openclaw-gateway（会SIGTERM）
- **正确**：`openclaw gateway restart` 或 `gateway tool action=restart`

### 系统修改 SOP
- **触发词**：修改系统、更改配置
- **路径**：`SOP-SYSTEM-MODIFICATION.md`

### 故障分析 SOP（深度链路分析法）
- **触发词**：故障分析、深度分析、数据链路、追根溯源
- **核心原则**：每个故障/信息点必须绘制完整数据链路图，找出所有关联点
- **五步法**：锁定信息点 → 绘制链路图 → 识别关联点 → 评估影响 → 制定根因方案
- **路径**：`SOP-FAULT-ANALYSIS.md`
- **禁止**：跳步分析、凭感觉修改、半成品输出

### Skill 更新检查 SOP
- **触发词**：检查 skill 更新、skill 有没有新版本、更新 skill
- **机制**：每日 09:00 自动检查 → 生成报告 → 邮件通知 → 主人决策 → 我执行（带快照保护）
- **路径**：`SOP-SKILL-UPDATE.md`
- **禁止**：全自动更新（必须主人确认）、同时更新多个 skill、无快照更新生产环境 skill

---

## 工具脚本

### 系统安全检查
```bash
bash /home/ai/.openclaw/workspace/scripts/security-check.sh
```

### 记忆系统深度检查
```bash
node /home/ai/.openclaw/workspace/memory-system/scripts/system-deep-inspector.js
```

### Git 提交（配置文件变更）
```bash
cd ~/.config && git add . && git commit -m "描述"
```

---

## 硬件设备

| 设备 | 接口/地址 |
|------|----------|
| 4G模块 AT命令口 | /dev/ttyUSB1（自动检测）|
| 4G模块 短信口 | /dev/ttyUSB2（自动检测）|
| 录音设备 | plughw:1,0（自动检测）|
| TTS播放设备 | plughw:0,3 HDMI（自动检测）|
| 摄像头 | OBSBOT Tiny 2（USB）|

---

## 所有系统状态总览

| 系统 | 状态 |
|------|------|
| 4G语音v2 | ✅ 运行中 |
| 远程录音 | ✅ 运行中 |
| 记忆系统 | ✅ 运行中（7/7进程，session-extractor 已移除）|
| 三层记忆追溯 | ✅ 已创建 |
| 自我监控 | ✅ 运行中 |
| 邮件系统 | ✅ 正常 |
| 天道成员管理平台 | ✅ 运行中（HTTPS 前后端）|
| 天道成员管理平台·跨平台安装包 | ✅ 构建完成 |
| 洞鉴院（tiandao_dongjianyuan）| ✅ 运行中（前端3012 / 后端3014）|
| 天道·系统 | ✅ 运行中（5服务）|
| Hermes Agent | ✅ 可用 |
| Goal Tracker | ✅ 可用 |
| 反思系统 | ✅ 已修复 |
| Tech Knowledge | ✅ 可用 |
| OSSEC HIDS | ✅ 运行中（6进程）|
| fail2ban | ✅ 运行中 |
| UFW 防火墙 | ✅ 已激活 |
| 蜜罐防御系统 | ✅ 全部生效 |
| 天雷系统 | ✅ 已部署 |
| ClamAV | ✅ 已部署（每日凌晨5点）|
| Lynis | ✅ 已部署（每周一凌晨2点）|
| 隔离区分析 | ✅ 已部署（每小时监控）|
| SOP文档 | ✅ 6份可用 |

---

## 能力图谱（capability-graph）

> 2026-04-19 新建，与 SYSTEMS.md 互补：SYSTEMS.md 是详细注册表，能力图谱是结构化知识卡片

### 目录结构

```
capability-graph/
├── SOP-EXCELLENCE-FRAMEWORK.md   ← 卓越执行框架 SOP v2.1
├── PLAN-BUILD-OUT.md             ← 三阶段搭建计划
├── NAVIGATION.md                 ← 总导航仪表盘
│
├── systems/          (7)         ← 系统卡片
├── tools/            (6)         ← 工具卡片
├── skills/
│   ├── custom/       (8+3)       ← 自制 Skill（8完善 + 3开发中）
│   ├── workspace/    (1)         ← 工作区 Skill 索引（8个）
│   └── builtin/      (1)         ← 系统 Skill 索引（53个）
├── frameworks/       (1)         ← 方法论卡片
├── risk-patterns/    (1)         ← 危险点（3条）
└── pitfalls/         (1)         ← 避坑经验（4条）
```

### 能力图谱索引

| 类别 | 文件数 | 路径 |
|------|--------|------|
| 系统卡片 | 7 | `capability-graph/systems/` |
| 工具卡片 | 6 | `capability-graph/tools/` |
| 自制 Skill | 11 | `capability-graph/skills/custom/` |
| 工作区 Skill | 8 | `capability-graph/skills/workspace/` |
| 系统 Skill | 53 | `capability-graph/skills/builtin/` |
| 方法论 | 1 | `capability-graph/frameworks/` |
| 危险点 | 3 | `capability-graph/risk-patterns/` |
| 避坑经验 | 4 | `capability-graph/pitfalls/` |

### 卓越执行框架 SOP

| 项目 | 值 |
|------|-----|
| 版本 | v2.1 |
| 生效日期 | 2026-04-19 |
| 评审 | Claude Opus + DeepSeek Reasoner |
| 核心 | 三级通道（快速/标准/完整）+ 团队模式 + 危险点前置 + 文档闭环 |
| 文件 | `capability-graph/SOP-EXCELLENCE-FRAMEWORK.md` |

### 主脑召回监控系统
- **触发词**：主脑召回监控、主脑监控、主脑记忆召回
- **使用**：`node /home/ai/.openclaw/workspace/audit-scripts/main-recall-monitor/main-recall-report.js`
- **Cron**：每5分钟自动执行
- **监控指标**：各Intent召回统计 / Top召回记忆(提成参考) / 各Session明细 / P99延迟告警
- **数据隔离**：SQLite（600权限），零侵入Monkey-patch
- **状态**：✅ 运行中（2026-04-21 05:03）

### 主脑召回监控系统
- **触发词**：主脑召回监控、主脑监控、pt-monitor、召回报告
- **使用**：`node /home/ai/.openclaw/workspace/audit-scripts/pt-recall-monitor/pt-recall-report.js`
- **Cron**：每5分钟自动执行
- **监控指标**：各店召回次数 / P99延迟 / 具体thread ID / 延迟告警阈值500ms
- **数据隔离**：SQLite（600权限），主脑零影响，完全独立
- **状态**：✅ 运行中

### 主脑 Thread

当前活跃任务记录在 Problem Thread（主脑），API: `http://localhost:54321/threads?status=active`

---

## 洞鉴院（tiandao_dongjianyuan）

- **触发词**：洞鉴院、dongjianyuan、情报监控、新闻监控
- **项目路径**：`/home/ai/projects/tiandao_dongjianyuan/`
- **Git**：已提交（commit f3963ed / develop 分支）

### 访问地址（HTTPS）

| 服务 | 地址 |
|------|------|
| **前端界面** | https://100.89.109.20:3012/ |
| 后端 API | https://100.89.109.20:3014 |
| 后端健康检查 | https://100.89.109.20:3014/api/health |

### 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + Vite（HTTPS）+ Tailwind CSS |
| 后端 | Express.js + Node.js（HTTPS，端口 3014）|
| 数据库 | PostgreSQL（独立库 dongjianyuan_db，5432）|
| 认证 | JWT（24h）+ bcrypt |
| 实时推送 | SSE（Server-Sent Events，各模块独立刷新）|
| 定时任务 | node-cron |

### 数据库（独立库：dongjianyuan_db）

| 表名 | 说明 |
|------|------|
| admin_users | 管理员账户 |
| earthquake_intl | 国际地震（USGS）|
| earthquake_dom | 国内地震（CENC）|
| news_cache | 新闻缓存（BBC / 新华社）|
| gold_forecast | 黄金走势分析 |
| climate_alerts | 极端气候预警 |

### 7 个子模块（均独立 SSE 刷新，不刷新主页面）

| 模块 | 数据源 | 刷新频率 |
|------|--------|---------|
| 🔍 搜索 | Brave Search API | 实时 |
| 🌍 国际地震 | USGS | 每5分钟 |
| 🇨🇳 国内地震 | CENC（中国地震台网）| 每5分钟 |
| 📰 国际新闻 | BBC RSS | 每4小时 |
| 🏛️ 国内新闻 | 新华社 | 每4小时 |
| 🌪️ 极端气候 | Brave 搜索权威源 | 每2小时 |
| 💰 黄金走势 | Brave + AI 分析 | 每日 8:00 |

### 登录凭证

| 字段 | 值 |
|------|------|
| 用户名 | admin |
| 密码 | Admin@123456 |

### 核心 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/auth/login | 登录 |
| PUT | /api/auth/change-password | 修改密码（验旧密码）|
| GET | /api/earthquake/international | 国际地震 |
| GET | /api/earthquake/domestic | 国内地震 |
| GET | /api/news/international | 国际新闻 |
| GET | /api/news/domestic | 国内新闻 |
| GET | /api/climate/alerts | 极端气候 |
| GET | /api/financial/gold-forecast | 黄金走势 |
| POST | /api/search | Brave 搜索 |
| GET | /api/sse/:module | SSE 实时推送 |

### 启动命令

```bash
# 后端
cd ~/projects/tiandao_dongjianyuan/backend && node src/index.js

# 前端
cd ~/projects/tiandao_dongjianyuan/frontend && npm run dev
```

### 状态

- **后端**：✅ 运行中（3014）
- **前端**：✅ 运行中（3012）
- **数据库**：✅ dongjianyuan_db 已创建
- **文档**：`docs/TECHNICAL_PROPOSAL_v1.2.md`

---

_最后更新：2026-04-22（新增洞鉴院 tiandao_dongjianyuan）_
