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

### 记忆系统
- **触发词**：记忆系统、检查记忆、health check、数据链路、召回系统
- **使用**：
  ```bash
  node /home/ai/.openclaw/workspace/memory-system/scripts/health-check.js
  node /home/ai/.openclaw/workspace/memory-system/scripts/system-deep-inspector.js
  ```
- **包含**：session-summary-extractor（Session级摘要Daemon，10分钟扫描）、session-extractor、graph-linker、summary-extractor、outbox-writer、graphify-opus-manager
- **端口**：18789（Gateway）/ 31234（Graphify Query）
- **版本**：v4.5+（新Session摘要召回 + Session级摘要Daemon：2026-04-16，**2026-04-17已部署daemon**）
- **状态**：✅ 运行中（**7/7进程**，含session-summary-extractor daemon）

#### Session级摘要系统（session-summary-extractor）

> **文件**：`memory-system/scripts/session-summary-extractor.js`
> **PM2进程**：`session-summary-extractor`（Daemon模式，每10分钟扫描）
> **特点**：整个Session全文提取 → 分段 → 并行LLM → 合并摘要，完整率>90%

**与旧summary-extractor的区别**：

| 维度 | 旧summary-extractor | 新session-summary-extractor |
|------|--------------------|------------------------------|
| 触发方式 | 30秒轮询，4条消息触发 | Session结束后1分钟空闲检测 |
| 内容范围 | 固定窗口+turn_index配对 | **整个Session全文** |
| 摘要数量 | 每2-4条消息1条 | 每Session多条（按长度分段）|
| 摘要格式 | 短摘要（1-2句）| **结构化5字段**（核心主题/用户需求/AI回复/事实决策/结果跟进）|
| 内容完整率 | ~10% | **>90%** |
| 向量检索质量 | 中等 | **优秀（语义相似度0.68-0.78）** |
| 进度跟踪 | 无 | `session_summary_cursor`表 |

**backfill命令**（手动重新处理某Session）：
```bash
node /home/ai/.openclaw/workspace/memory-system/scripts/session-summary-extractor.js --backfill
```

**监控命令**：
```bash
pm2 logs session-summary-extractor --nostream --lines 20
```

**关键指标**（2026-04-16实测）：
- 最大Session处理：2780条消息 / 459K token / 72段 / ~15分钟
- LLM重试率：**0%**（qwen3.6-plus一次成功率100%）
- 每段耗时：~10-20秒
- 向量召回相似度：0.68-0.78（语义相关）

#### 记忆系统 — 数据链路一览（完整版）

| 链路 | 路径 | 说明 | 状态 |
|------|------|------|------|
| **L0** | OpenClaw Gateway → recall hook | before_prompt_build 触发 recall hook | ✅ |
| **L1** | Session JSONL → conversation_messages | session-extractor PM2 轮询 JSONL 文件 | ✅ 畅通 |
| **L2** | conversation_messages → memory_summaries | summary-extractor PM2 30秒轮询，4条消息触发摘要 | ✅ 畅通 |
| **L3** | memory_summaries → summary_message_links | 迁移脚本一次性写入（604条历史关系） | ✅ 完成 |
| **L4** | summary-extractor → memory_outbox | Outbox Pattern：事务双写（memory_summaries + memory_outbox）| ✅ |
| **L5** | memory_outbox → personal_memories | outbox-writer PM2 每10秒消费 pending 事件 | ✅ |
| **L6** | memory_outbox → Neo4j PersonalMemory | outbox-writer 异步写入 Neo4j | ✅ |
| **L7** | session-extractor → personal_memories | 直接写入（主写入路径）| ✅ 主要来源 |
| **L8** | Redis Stream → graph-linker → Neo4j | graph-linker PM2 消费 graph:sync:events | ✅ |
| **L9** | 用户消息 → recall hook → session-recall | recall hook → session-recall.js → pgvector HNSW 召回 | ✅ |
| **L10** | recall hook → cascadeRecall | 三级级联召回（新增 v4.4）| ✅ |
| **L11** | get-summary-sources 追溯接口 | get-summary-sources.js 双向追溯（summary↔message）| ✅ |

#### 召回系统架构（v4.4 — Week 3 完成）

**核心组件**：

| 组件 | 文件 | 职责 |
|------|------|------|
| Recall Hook | `hooks/recall-hook/handler.js` | before_prompt_build 入口，三级路由 |
| RecallService | `scripts/session-recall.js` | 两套召回：普通 recall + cascadeRecall 级联 |
| Config | `scripts/config.js` | 意图配置 + cascadeRecallConfig |
| Graphify Fetch | `scripts/graphify-fetch.js` | 代码图谱对齐（已修复 node.id）|
| Redis Module | `scripts/redis.js` | 缓存 + invalidateRecallCache |
| Embedder | `scripts/embedder.js` | BGE-m3 Ollama 向量嵌入 |
| Session Context | `scripts/session-context-loader.js` | Session 管理 + Proactive |

**召回流程**：

```
用户消息
  │
  ▼
[before_prompt_build] handler.js 触发
  │
  ▼
classifyIntent() → 8类意图
  │
  ├── TECHNICAL/PROJECT/REASONING → shouldGraphify = true
  └── 其他 → shouldGraphify = false
  │
  ▼
级联路由判断（shouldCascade）
  ├── 触发关键词：'上次'、'之前说过'、'我记得'、'继续'、'接着'
  ├── 话题切换 + query ≥ 4字
  └── 强制刷新（长时间沉默）
  │
  ├── YES → cascadeRecall 三级召回
  │   ├── Phase1: memory_summaries + 3h时间窗口（HNSW）
  │   ├── Phase2: 摘要关键词 → memories entity 匹配
  │   └── Phase3: summary_message_links → conversation_messages 溯源
  │
  └── NO → 普通 recall
      ├── HNSW 三表并行（memories / memory_summaries / personal_memories）
      ├── 动态加权排序（语义 + 时间衰减 + 置信度）
      ├── importance_score ≥ 5 过滤（personal_memories）
      └── Graphify 代码上下文（仅 TECHNICAL/PROJECT/REASONING）
  │
  ▼
buildMemoryPrompt() → prependContext 注入 LLM
  │
  ▼
[after_response] → 后台异步任务（Promise.allSettled）
```

**意图配置（8类）**：

| 意图 | Graphify | Tier | 半衰期 |
|------|----------|------|--------|
| TECHNICAL | ✅ | 1 | 4h |
| PROJECT | ✅ | 1 | 4h |
| REASONING | ✅ | 2 | 2h |
| FACTUAL | ❌ | 1 | 2h |
| PREFERENCE | ❌ | 1 | 8h |
| EVENT | ❌ | 1 | 0.5h |
| PERSON | ❌ | 1 | 4h |
| DEFAULT | ❌ | 1 | 2h |

**级联召回配置**：

```javascript
cascadeRecallConfig: {
  enabled: true,
  triggerKeywords: ['上次', '之前说过', '我记得', '上次聊', '继续', '接着'],
  minQueryLength: 4,
  defaultTimeWindow: 3,  // 小时
}
```

#### latest_summaries_cache — 最新5条摘要滚动缓存
> **B2方案**：新建专用表 `latest_summaries_cache`，每次摘要创建后自动写入，维护最新5条
> **写入钩子**：`summary-extractor.js` → `_cacheLatestSummary()`
> **维护策略**：INSERT后立即DELETE淘汰最旧条，保留created_at最新的5条

| 字段 | 说明 |
|------|------|
| `summary_id` | 关联 memory_summaries.id |
| `query_keywords` | 从摘要提取的合成关键词 |
| `summary_preview` | 前120字预览 |
| `summary_full` | **完整摘要**（主人要求）|
| `summary_type` | 类型：factual/decision/event/preference |
| `created_at` | 滚动窗口排序依据 |

**查询命令**：
```bash
PGPASSWORD=zyxrcy910128 psql -h localhost -U openclaw_ai -d openclaw_memory -c \
  "SELECT id, summary_id, left(summary_preview,80), summary_type, created_at FROM latest_summaries_cache ORDER BY created_at DESC;"
```

---

#### 关键表数据量（2026/4/17 更新）

| 表 | 数量 | 说明 |
|----|------|------|
| conversation_messages | **5474** | 原始对话存档 |
| memory_summaries | **108** | 摘要（v4.5+ Session级）|
| memories | **2653** | 结构化 entity/attr/value（content 填充率 100%）|
| personal_memories | **33063** | 主记忆 |
| summary_message_links | 604 | 摘要↔消息 junction table |
| recall_logs | **383** | 召回日志 |
| latest_summaries_cache | **5** | 最新5条摘要滚动缓存（B2方案）|
| graphify_code_embeddings | **80364** | 代码图谱节点 |
| memory_outbox | 0 | 无积压 |
| session_summary_cursor | **146** | Session级摘要进度跟踪 |

#### 数据库快照表（方案二 — 长期可观测）

> **表名**：`memory_snapshots`
> **写入方**：`health-check.js`（每次巡检自动写入）
> **用途**：SYSTEMS.md 数据量手动更新容易滞后，数据库快照提供时序可观测性，支持历史趋势查询

**查询命令**：
```bash
# 查看最新快照
PGPASSWORD=zyxrcy910128 psql -h localhost -U openclaw_ai -d openclaw_memory -c \
  "SELECT snapshot_time, conversation_messages, personal_memories, memory_summaries, session_summary_cursor FROM memory_snapshots ORDER BY snapshot_time DESC LIMIT 1;"

# 查看历史趋势（最近N条）
PGPASSWORD=zyxrcy910128 psql -h localhost -U openclaw_ai -d openclaw_memory -c \
  "SELECT snapshot_time, conversation_messages, personal_memories, memory_summaries FROM memory_snapshots ORDER BY snapshot_time DESC LIMIT 10;"

# 计算两次快照之间的增长量
PGPASSWORD=zyxrcy910128 psql -h localhost -U openclaw_ai -d openclaw_memory -c \
  "SELECT (personal_memories - LAG(personal_memories) OVER (ORDER BY snapshot_time)) as growth FROM memory_snapshots ORDER BY snapshot_time DESC LIMIT 10;"
```

**表结构**：
| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL | 主键 |
| snapshot_time | TIMESTAMPTZ | 快照时间 |
| conversation_messages | INT | 对话存档条数 |
| memories | INT | 结构化记忆条数 |
| memories_content_fill_rate | FLOAT | content字段填充率 |
| personal_memories | INT | 主记忆条数 |
| memory_summaries | INT | 摘要条数 |
| recall_logs | INT | 召回日志条数 |
| session_summary_cursor | INT | Session摘要进度 |
| personal_memory_nodes | INT | Neo4j PersonalMemory节点数 |
| graphify_code_nodes | INT | Neo4j GraphifyCode节点数 |
| aligned_relationships | INT | 对齐关系数 |
| memory_summary_nodes | INT | Neo4j Memory_summary节点数 |
| personal_entity_nodes | INT | Neo4j PersonalEntity节点数 |
| redis_graph_sync_len | INT | Redis Stream graph:sync 长度 |
| redis_latency_ms | INT | Redis延迟（ms）|

**状态**：✅ 运行中（5条快照记录，最早 2026-04-16 20:03）

#### PM2 进程清单（2026-04-17 核实）

| 进程 | 职责 | 状态 |
|------|------|------|
| session-summary-extractor | Session级摘要Daemon（每5分钟扫描，已部署）| ✅ online（v4.5+，daemon）|
| session-extractor | JSONL → conversation_messages | ✅ online |
| summary-extractor | conversation_messages → memory_summaries + outbox | ✅ online |
| outbox-writer | memory_outbox → personal_memories + Neo4j | ✅ online |
| graph-linker | Redis Stream → Neo4j ALIGNED_TO | ✅ online |
| graphify-opus-manager | Graphify 代码节点管理 | ✅ online |
| hermes-server | 玄一推理服务（端口31235）| ✅ online |
| hermes-web | 玄一 Web 服务（端口31236）| ✅ online |
| cowrie-tianxing | 蜜罐攻击IP → 天刑扫描 | ✅ online |

#### EXEC 改动清单（Week 1-3 完成记录）

| EXEC | 改动 | 危险点 | 状态 |
|------|------|--------|------|
| EXEC-001 | shouldGraphify 配置驱动 | P0-1 | ✅ |
| EXEC-002 | config.js 非技术意图 graphify=false | P0-1配套 | ✅ |
| EXEC-003 | extractAlignedIds node.id 修复 | P1-1 | ✅ |
| EXEC-004 | setImmediate → Promise.allSettled | P0-2 | ✅ |
| EXEC-005 | _vectorSearchSummaries + recentHours | P1-2 | ✅ |
| EXEC-006 | invalidateRecallCache 新增 | P1-3 | ✅ |
| EXEC-007 | recall_logs user_id→nullable + sender_id_text | P1-4 | ✅ |
| EXEC-008 | _vectorSearchMemories + entities 参数 | P1-5 | ✅ |
| EXEC-009 | TECHNICAL 正则扩展中文技术词汇 | P2-1 | ✅ |
| EXEC-010 | cascadeRecall() 三级管道（核心）| P0-3 | ✅ |
| EXEC-011 | personal_memories importance_score ≥ 5 过滤 | P2-2 | ✅ |
| EXEC-012 | 动态 candidateK 分配 | P2-3 | ✅ |
| EXEC-013 | cascadeRecall 路由逻辑 | P0-3配套 | ✅ |

#### 新Session摘要召回（EXEC-NEW-01~05）

> **版本**：v4.5（2026-04-16）
> **Git Commit**：`2ccc0b4 feat(recall): Week1-3 EXEC全部完成 + 新Session摘要召回方案`

**核心改进**：新 Session 冷启动时，用上一条 Session 的 `conversation_sessions.summary` 作为 recall query，替代随机 query 池。

**修复的危险点**：

| 危险点 | 根因 | EXEC | 状态 |
|--------|------|------|------|
| P0-1：`markSessionForUser` 在 `loadPreviousContext` 之前调用 | Redis key 被覆盖，永远查到当前 session | EXEC-NEW-01 | ✅ |
| P0-2：subagent/cron session 污染 | 每次事件都标记，覆盖用户 session | EXEC-NEW-01 | ✅ |
| P1-3：summary 为空或极短 | 无有效检查直接用作 query | EXEC-NEW-03 | ✅ |
| P1-4：Redis 与 DB 数据不一致 | Redis miss 时无 DB fallback | EXEC-NEW-02 | ✅ |
| P2-5：query 过长稀释向量搜索 | 无截断直接作为 query | EXEC-NEW-03 | ✅ |
| P1-7：时间间隔过长导致记忆过时 | 无陈旧检测 | EXEC-NEW-03 | ✅ |

**新 Session 召回流程（v4.5）**：

```
新 session 到来
  │
  ▼
loadPreviousContext()     ← ✅ 先执行（在 markSessionForUser 之前）
  │
  ▼
markSessionForUser()      ← ✅ 后执行（仅主会话，排除 subagent/cron）
  │
  ▼
preloadMemoriesForNewSession()
  │
  ├── getLastUserSessionSummary()  ← 新增
  │   ├── Redis优先：session:summary:{sessionKey}
  │   └── DB兜底：conversation_sessions.summary
  │
  ├── truncateSummaryForQuery(150字符)  ← 新增（在标点处截断）
  │
  ├── isSessionStale(>48h)  ← 新增（陈旧则扩大召回范围）
  │
  └── fallback → 随机 query 池（summary无效时）
```

**新增配置项（config.js proactive）**：

```javascript
proactive: {
  maxSummaryQueryLen: 150,     // summary最大长度
  minSummaryQueryLen: 30,      // summary最小有效长度
  maxSessionAgeHours: 48,      // session陈旧阈值
}
```

**新增函数**：

| 函数 | 文件 | 说明 |
|------|------|------|
| `getLastUserSessionSummary()` | session-context-loader.js | Redis优先 + DB兜底获取上一条用户session summary |
| `loadPreviousContext()` | session-context-loader.js | **直接查 memory_summaries 表**（绕过 Redis summary=null 问题，2026-04-16）|
| `truncateSummaryForQuery()` | session-context-loader.js | 在标点处智能截断summary |
| `isSessionStale()` | session-context-loader.js | 判断session是否陈旧(>48h) |

#### 文档索引

| 文档 | 路径 |
|------|------|
| 召回系统设计 | `docs/RECALL-DESIGN.md` |
| 深度分析报告 | `docs/RECALL-DEEP-ANALYSIS-FINAL.md` |
| 执行方案（Week1-3）| `docs/RECALL-EXECUTION-PLAN.md` |
| 测试报告 | `docs/RECALL-TEST-REPORT.md` |
| 数据链文档 | `docs/RECALL-DATA-CHAIN.md` |
| Session摘要召回方案 | `docs/RECALL-SESSION-SUMMARY-EXEC-PLAN.md` |

#### graph-linker 状态监控
- **触发词**：graph-linker 状态、graph-linker 积压、graph-linker 速度、graph-linker 消费
- **使用**：
  ```bash
  node /home/ai/.openclaw/workspace/custom-skills/graph-linker-monitor/check-graph-linker.js
  ```
- **输出**：Stream 概况 / Consumer 状态 / 积压分析 / 速率分析 / 预估时间
- **状态**：✅ 正常运行

#### graph-linker 状态监控
- **触发词**：graph-linker 状态、graph-linker 积压、graph-linker 速度、graph-linker 消费
- **使用**：
  ```bash
  node /home/ai/.openclaw/workspace/custom-skills/graph-linker-monitor/check-graph-linker.js
  ```
- **输出**：Stream 概况 / Consumer 状态 / 积压分析 / 速率分析 / 预估时间
- **状态**：⚠️ 修复中（xlen方法调用错误）

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

## 天道·系统（Tiandao Microservices）

- **触发词**：天道、系统后台、民宿管理
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
| 记忆系统 | ✅ 运行中（6/6进程）|
| 自我监控 | ✅ 运行中 |
| 邮件系统 | ✅ 正常 |
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

_最后更新：2026-04-17（latest_summaries_cache B2方案上线）_
