# AGI 进化方案 v2.0

> 创建时间：2026-04-11 06:15
> 评审模型：MiniMax-M2.7-highspeed
> 系统快照：2026-04-11

---

## 零、系统现状深度分析

### 0.1 核心数据一览

| 维度 | 数值 | 备注 |
|------|------|------|
| memories | 1761 条 | entity/attr/value 结构化记忆 |
| personal_memories | 3928 条 | 原文内容记忆 |
| memory_summaries | 481 条 | 会话摘要 |
| conversation_messages | 2425 条 | 原始对话存档 |
| recall_logs | 191 条 | 召回历史（含 intent） |
| error_patterns | 16 条 | 已记录的 error pattern |
| dialogue_decisions | 1077 条 | 对话决策记录 |
| knowledge_chunks | 74770 条 | Graphify 知识块 |
| graphify_code_embeddings | 79132 条 | 代码向量 |
| task_status | 28 条 | 活跃任务 |

### 0.2 已有 AGI 方案（v1，2026-04-04）

| 方案 | 状态 | 依赖 |
|------|------|------|
| 方案一：目标追踪 | 未实现 | Neo4j |
| 方案二：元认知反思 | 未实现 | cron + 每日总结 |
| 方案三：主动学习 | 未实现 | 置信度检测 |
| 方案四：记忆遗忘 | 未实现 | personal_memories 改造 |
| 方案五：推理模式库 | 未实现 | Neo4j |

### 0.3 已验证可用的召回方案

- `memory-system/docs/RECALL-DESIGN.md` — 完整设计了意图8分类 + Graphify并行 + 精排 + Tier分级注入
- 已实现：recall-hook/handler.js (Week1部分)，session-recall.js (双表并行)
- 待实现：意图8分类配置化、Graphify对齐加权、Proactive三场景

---

## 一、九大模块子系统分析

### 模块1：记忆系统模块

**当前状态：**
- 写入管道：Redis Stream → memory-daily-extractor (PM2) → memories + personal_memories
- 召回管道：session-recall.js 双表 HNSW 并行 → 动态加权排序 → prompt注入
- Session管道：session-extractor-loop (PM2, 30秒) → conversation_messages
- Neo4j同步：graph-linker (systemd) 消费 Redis Stream → Neo4j PersonalMemory (927节点)
- 向量模型：BGE-m3 (Ollama, <30ms)

**识别瓶颈：**
1. `memories` 表有 CHECK 约束 `memory_type IN ('factual','event')`，technical/preference 类记忆无法写入
2. `memory_graph_sync` 表为空（架构未实际运行）
3. recall 未接入 Graphify 对齐（RECALL-DESIGN.md 已设计但未落地）
4. 无 Proactive 召回机制（新session/话题切换/长沉默）
5. 意图分类仅 4 类（factual/preference/event/default），RECALL-DESIGN 设计的 8 类未实现

**改进空间：**
1. 移除/放宽 memories CHECK 约束，或增加 `memory_type_extended` 字段
2. 实现 RECALL-DESIGN v2 的意图8分类 + Graphify 对齐 + Proactive
3. 完善 Neo4j 同步管道

**关键文件：**
- `memory-system/scripts/session-recall.js` — 召回核心
- `memory-system/hooks/recall-hook/handler.js` — hook 入口
- `memory-system/scripts/graphify-fetch.js` — Graphify 查询封装（已建但未集成）
- `memory-system/scripts/config.js` — INTENT_CONFIG 配置

---

### 模块2：推理/规划模块

**当前状态：**
- 主模型：MiniMax-M2.7-highspeed（800ms，文字对话）
- 代码/分析：4sapi/claude-opus-4-6（~1.5s）
- 深度推理：deepseek/deepseek-reasoner（~1.5s，含思考链）
- 本地模型：gemma4:26b（39 tok/s，隐私任务）
- 无独立元认知模块

**识别瓶颈：**
1. 无推理过程记录 — 每次都是黑盒，无思维过程积累
2. 无反思机制 — 被纠正后只在本轮生效，下轮遗忘
3. 复杂任务无分步规划 — 直接输出结果，无 Mermaid/步骤分解
4. 无自我验证 — 答案不经验证直接输出
5. dialogue_decisions 表有 1077 条记录，但未被用于推理优化

**改进空间：**
1. 增加推理轨迹记录（dialogue_decisions 已有基础设施）
2. 实现方案二（元认知反思）的三级反思机制
3. 增加结构化输出能力（thinking/plan/verify 三段式）
4. 利用 error_patterns 表（16条）做预防性校验

**关键文件：**
- `memory-system/scripts/task-crud.js` — 任务管理
- `memory-system/scripts/circuit-breaker.js` — 熔断逻辑（可用于推理失败记录）

---

### 模块3：工具/Skill模块

**当前状态：**
- 系统 Skills（~/.npm-global/lib/node_modules/openclaw/skills/）：
  - clawhub / coding-agent / healthcheck / node-connect / openai-whisper / skill-creator / tmux / video-frames / weather
- 自定义 Skills（~/.openclaw/workspace/skills/）：
  - clawteam（多agent协作）/ web-search-ex-skill（网络搜索）
- 自定义工具（custom-skills/）：
  - audio-stream（远程录音）
  - camera-recorder（OBSBOT录制 + Whisper）
  - graphify-manager（Graphify图谱管理，79k节点）
  - send-email（QQ邮箱）
  - task-router（任务路由）
  - tech-knowledge（技术知识库，30文档）
  - youdao-asr / youdao-tts

**识别瓶颈：**
1. skill 调用是手工的 — 无自动 skill 选择机制，每次靠人工判断用哪个
2. task-router skill 有误用风险 — 模型可能选错路由
3. 无 skill 成功率追踪 — 不知道哪个 skill 效果好
4. 复合任务无 skill 组合机制 — 需多个 skill 时无编排

**改进空间：**
1. 增加 skill 选择 LLM（小模型，<5ms），根据任务描述自动推荐
2. 建立 skill 执行日志（记录每次 skill 调用成功率）
3. 实现 skill 组合链（类似 Zapier 的多步编排）

**关键文件：**
- `custom-skills/task-router/SKILL.md` — 任务路由（需加强）
- `custom-skills/tech-knowledge/SKILL.md` — 技术知识库（需接 recall）

---

### 模块4：目标追踪模块

**当前状态：**
- task_status 表：28条活跃任务，有优先级/状态/记忆上下文
- task-crud.js：增删改查基础功能
- 无 Neo4j Goal 图谱（方案一只停留在设计文档）

**识别瓶颈：**
1. 目标创建是手工的 — 用户说目标时不会自动创建 Goal 节点
2. 无目标分解 — 大目标不会自动拆成 SubGoal
3. 无目标漂移检测 — 目标版本无快照
4. 无跨 session 追踪 — 关机/重启后目标状态丢失（除非查表）
5. cron 未实现 — 无定期检查目标进展机制

**改进空间：**
1. 实现 AGI-EVOLUTION-PLAN.md 方案一的 Neo4j Goal 图谱
2. 增加目标自动创建（NLU 检测 "我要..." "目标是..."）
3. 增加目标分解 + 冲突检测
4. cron 每4小时检查 + HEARTBEAT.md 集成

**关键文件：**
- `memory-system/scripts/task-crud.js` — 任务 CRUD
- `memory-system/crontab.entries` — 定时任务配置

---

### 模块5：学习/适应模块

**当前状态：**
- error_patterns 表：16条已记录错误模式
- dialogue_decisions 表：1077条决策记录（未用于学习）
- 无自适应机制 — 系统不从历史错误中学习
- 无置信度反馈 — 答案不标记置信度

**识别瓶颈：**
1. error_patterns 仅存储，无主动预防机制
2. 对话决策不关联到具体任务结果（成功/失败）
3. 无学习反馈循环 — 正确的决策不会提升权重
4. 无用户纠正记录 — 被纠正后不持久化
5. distillation_queue/distillation_log 为空（未启用）

**改进空间：**
1. 实现方案二（元认知反思）+ 每日 cron
2. 建立"决策→结果"反馈闭环
3. 增加置信度标注 + 低置信触发主动询问
4. 启用 distillation 管道（从对话中提取有效模式）

**关键文件：**
- `memory-system/scripts/tech-extractor.js` — 技术文档提取
- `memory-system/scripts/summary-extractor.js` — 摘要提取

---

### 模块6：通信/协作模块

**当前状态：**
- clawteam skill：多agent协作（git worktree + tmux + 文件系统消息）
- sessions_spawn：子agent生成能力
- subagent_log 表：17条子agent记录
- 支持：webchat / weixin / telegram / feishu

**识别瓶颈：**
1. clawteam 使用率低 — 无标准团队模板
2. 子agent 无标准化接口 — 每个任务单独写 prompt
3. 无 agent 状态共享 — 子agent之间无消息总线
4. 多渠道消息聚合能力弱 — 微信/飞书等渠道消息未统一处理

**改进空间：**
1. 预建团队模板（code-review-team / research-team / analysis-team）
2. 建立 agent 间通信协议（文件系统 + Redis Pub/Sub）
3. 实现 agent 状态协调器（类似 Orchestrator）

**关键文件：**
- `~/.openclaw/workspace/skills/clawteam/SKILL.md` — 多agent协作

---

### 模块7：长期知识模块

**当前状态：**
- tech-knowledge：30个技术文档（已索引）
- knowledge_chunks：74770条（Graphify）
- graphify_code_embeddings：79132条（代码向量）
- memory_summaries：481条（会话摘要）
- MEMORY.md / memory/*.md：文件系统知识

**识别瓶颈：**
1. tech-knowledge 与 recall 系统隔离 — 需手动查询
2. knowledge_chunks 无召回机制 — 79k 块从未被召回
3. Graphify（31234端口）独立运行，与 recall 完全隔离
4. 无知识冲突检测 — 同一概念有矛盾说法时无感知
5. 无知识来源追踪 — 无法判断知识可信度

**改进空间：**
1. 将 tech-knowledge 接入 recall 管道（8分类的 TECHNICAL intent）
2. 实现 RECALL-DESIGN 的 Graphify 对齐加权
3. 增加知识可信度评分（L1-L4来源分级）
4. 建立知识冲突仲裁机制

**关键文件：**
- `custom-skills/tech-knowledge/scripts/tech-recall.js` — 技术知识查询
- `custom-skills/graphify-manager/` — Graphify 管理

---

### 模块8：自我监控模块

**当前状态：**
- healthcheck skill：安全审计 + 防火墙检查
- memory-system/scripts/health-check.js：记忆系统健康检查
- circuit-breaker.js：LLM 调用熔断
- daily_log 表：12条日志
- security-check.sh：安全系统检查

**识别瓶颈：**
1. 健康检查是被动的 — 需人工触发，无自动告警
2. 无主动巡检 cron — 安全问题发现滞后
3. circuit-breaker 只管 LLM，不监控数据库/Redis/Neo4j
4. 无自我修复机制 — 发现问题只能告警，不能自动恢复
5. daily_log 利用率低（仅12条）

**改进空间：**
1. 增加 cron 自动巡检（每4小时健康检查 + 异常告警）
2. 扩展 circuit-breaker 到基础设施（DB/Redis/Neo4j）
3. 增加自我修复动作（如 extractor 失败自动重启 PM2）
4. 完善 daily_log 用法（记录关键系统事件）

**关键文件：**
- `memory-system/scripts/health-check.js`
- `memory-system/scripts/circuit-breaker.js`
- `scripts/security-check.sh`

---

### 模块9：输入输出模块

**当前状态：**
- 语音输入：youdao-asr（中文）+ Whisper（英文）
- 语音输出：youdao-tts（中文）+ Edge-TTS（英文/免费）
- 视频处理：video-frames skill（ffmpeg）
- 图片处理：image skill（GPT-4o / Gemini）
- 文字：MiniMax-M2.7-highspeed

**识别瓶颈：**
1. 语音链路延迟高 — ASR → LLM → TTS，总延迟 >5s
2. 多模态融合能力弱 — 视频/图片/文字分开处理，无联合理解
3. 无情感识别 — 语音/文字情感不感知
4. 语音输出单调 — 无情感/风格变化
5. 视频处理依赖 ffmpeg，无智能分析

**改进空间：**
1. 优化语音链路（并行化 ASR/LLM 阶段）
2. 增加情感识别模块（语音 + 文字）
3. 实现多模态联合召回（图片+文字关联记忆）
4. 增加 TTS 情感/风格参数控制

**关键文件：**
- `custom-skills/youdao-tts/scripts/tts.js`
- `custom-skills/youdao-asr/scripts/asr.js`
- `skills/video-frames/SKILL.md`

---

## 二、全新 AGI 进化方案 v2.0

### 原则：模块化 + 数据链

- 每个模块独立升级，不影响其他模块
- 模块间通过标准化数据接口通信
- 数据流可追溯、可监控
- 优先实现 RECALL-DESIGN v2（已设计完整）

---

## 模块 A：记忆系统 v6（召回增强）

### A.1 当前状态
- recall-hook 已实现双表并行 HNSW
- RECALL-DESIGN.md 有完整设计但未全部落地
- Graphify（79k 节点）与 recall 完全隔离

### A.2 目标状态
```
意图8分类 + Graphify 对齐 + Proactive 三场景 + Tier 分级注入
P99 < 150ms，Graphify 触发率 > 60%
```

### A.3 数据流
```
用户消息
    ↓
意图分类（8类关键词匹配，<1ms）
    ↓
Embedding（BGE-m3，Ollama，<30ms）
    ↓
Redis 缓存（TTL 5min，>60%命中）
    ↓
三表并行 HNSW（topK=30，<40ms）
    ↓
Graphify 并行触发（TECHNICAL/PROJECT 类，80ms timeout）
    ↓
精排 + Graphify 对齐加权（<60ms）
    ↓
Tier 分级注入（Tier1:top3,60字 / Tier2:top5,全文）
    ↓
Prompt
```

### A.4 关键技术选型
- 意图分类：关键词正则匹配（<1ms），后续可升级 Qwen3-1.7B
- 缓存：Redis GET/SETEX，simhash 降维 64bit
- 精排：内存排序，Graphify 对齐 +0.1 分

### A.5 实施步骤

**Week 1：快速见效**

| 步骤 | 改动 | 文件 | 工期 |
|------|------|------|------|
| A.1.1 | INTENT_CONFIG 配置化（4→8类） | `config.js` 新增 INTENT_CONFIG | 1h |
| A.1.2 | 扩展 classifyIntent() 支持 TECHNICAL/PROJECT/REASONING/PERSON | `session-recall.js` | 2h |
| A.1.3 | graphify-fetch.js 并行触发（TECHNICAL/PROJECT） | `recall-hook/handler.js` | 2h |
| A.1.4 | Redis 缓存 query 结果（TTL 5min）| `session-recall.js` 新增 cache 方法 | 1h |
| A.1.5 | Tier 分级注入（Tier1/Tier2）| `recall-hook/handler.js` | 2h |

**Week 2：质量提升**

| 步骤 | 改动 | 文件 | 工期 |
|------|------|------|------|
| A.2.1 | 精排函数 rerank() + Graphify 对齐加权 | `session-recall.js` | 3h |
| A.2.2 | 上下文窗口扩展（1→4条消息）| `recall-hook/handler.js` | 2h |
| A.2.3 | Proactive 三场景（新session/话题切换/长沉默）| `session-context-loader.js` | 4h |
| A.2.4 | recall_logs 增加 intent 字段（已有），离线分析 | `session-recall.js` | 1h |
| A.2.5 | memories CHECK 约束改造（新增 memory_type_extended）| DB migration | 2h |

**Week 3：测试调优**

| 步骤 | 改动 | 文件 | 工期 |
|------|------|------|------|
| A.3.1 | recall_logs 分析 + 权重调优 | SQL 分析 | 3h |
| A.3.2 | 端到端测试（技术查询 + 项目查询 + 闲聊）| 人工测试 | 2h |
| A.3.3 | Graphify 熔断 + 降级测试 | `graphify-fetch.js` | 1h |
| A.3.4 | 文档更新 + 监控告警 | ARCHITECTURE.md 更新 | 2h |

### A.6 依赖模块
- 模块 D（自我监控）：健康检查发现 Graphify 服务异常时告警
- 模块 F（长期知识）：tech-knowledge 接入 recall

### A.7 风险识别
| 风险 | 影响 | 缓解 |
|------|------|------|
| Graphify 超时 | P99 退化 | 80ms timeout + Promise.all 并行 + 熔断降级 |
| 意图分类不准 | 召回偏差 | 收集 recall_logs 做 offline 分析，迭代关键词 |
| Redis 缓存穿透 | 恶意 query | query 长度限制 + 限流 |
| memories CHECK 约束 | technical 类写入报错 | 改用 memory_type_extended 字段 |

### A.8 验证指标
- recall_logs intent 分布（目标：TECHNICAL > 15%）
- P99 延迟 < 150ms
- Redis 缓存命中率 > 60%
- Graphify 触发率 > 60%（TECHNICAL 类查询）

---

## 模块 B：元认知反思系统 v2

### B.1 当前状态
- 无元认知反思机制
- 被纠正后只在本轮生效，下轮遗忘
- error_patterns 表有 16 条记录但未主动使用

### B.2 目标状态
```
三级反思：单轮纠错 → 会话级复盘 → 周级模式发现
每晚 23:00 cron 触发，输出 action_items 供后续执行
```

### B.3 数据流
```
每晚 23:00 cron
    ↓
读取 memory/YYYY-MM-DD.md（当日所有对话）
    ↓
LLM 三级分析：
  Level 1（单轮纠错）：被纠正的回合 × 纠正内容
  Level 2（会话级）：本次对话整体策略评估
  Level 3（周级）：跨7天模式提取
    ↓
反思质量评分（过滤 LLM 幻觉归因）
    ↓
输出：
  - memory/reflection/YYYY-MM-DD.md
  - error_patterns 表更新
  - action_items 队列
    ↓
action_items 执行（次日生效）
```

### B.4 关键技术选型
- 三级反思：DeepSeek-Reasoner（思考链强）
- 质量评分：简单启发式（归因是否具体/是否有可执行项）
- 存储：memory/reflection/ + error_patterns 表

### B.5 实施步骤

**Phase 1：基础设施（1-2天）**

| 步骤 | 改动 | 文件 | 工期 |
|------|------|------|------|
| B.1.1 | 创建 memory/reflection/ 目录 | 文件系统 | 0.5h |
| B.1.2 | 创建反思提取脚本 | `scripts/daily-reflection.js` | 3h |
| B.1.3 | cron 配置（每晚 23:00）| `crontab.entries` | 0.5h |
| B.1.4 | error_patterns 表扩展（增加 week_pattern 字段）| DB migration | 1h |

**Phase 2：三级反思实现（3-4天）**

| 步骤 | 改动 | 文件 | 工期 |
|------|------|------|------|
| B.2.1 | Level 1 单轮纠错提取 | `daily-reflection.js` | 4h |
| B.2.2 | Level 2 会话级复盘 | `daily-reflection.js` | 4h |
| B.2.3 | Level 3 周级模式发现（跨7天）| `daily-reflection.js` | 4h |
| B.2.4 | 反思质量评分 + 过滤 | `daily-reflection.js` | 3h |
| B.2.5 | action_items 生成 + 执行接口 | `daily-reflection.js` | 3h |

**Phase 3：集成测试（2天）**

| 步骤 | 改动 | 文件 | 工期 |
|------|------|------|------|
| B.3.1 | 集成 recall（action_items 触发主动预防）| `daily-reflection.js` | 3h |
| B.3.2 | 端到端测试（连续7天运行）| 人工验证 | 4h |
| B.3.3 | 反思质量人工评估 + 迭代 | 分析报告 | 3h |

### B.6 依赖模块
- 模块 A（记忆系统）：读取 memory/YYYY-MM-DD.md
- 模块 E（学习适应）：action_items 执行后反馈到学习系统

### B.7 风险识别
| 风险 | 影响 | 缓解 |
|------|------|------|
| LLM 虚假归因 | 反思质量低，误导后续 | 质量评分过滤，无具体归因的直接丢弃 |
| 成本高 | 每日 7k token | 只对有纠错/异常的日子触发深度反思 |
| 反思不执行 | action_items 积压 | 集成到 HEARTBEAT.md，次日优先执行 |

### B.8 验证指标
- 反思生成率：> 80% 的日子有反思输出
- 质量评分分布：> 60% 达到 "good" 级别
- action_items 执行率：> 50% 被采纳执行
- 同类错误复现率下降（对比上月）

---

## 模块 C：长期目标追踪系统 v2

### C.1 当前状态
- task_status 表有 28 条任务，有优先级/状态
- 无 Neo4j Goal 图谱（方案一只停留在设计文档）
- 无目标分解/漂移检测

### C.2 目标状态
```
Neo4j Goal 图谱：Goal → SubGoal → Milestone → GoalSnapshot
目标自动创建 + 分解 + 冲突检测 + 漂移检测
cron 每4小时检查 → HEARTBEAT.md 输出目标卡片
```

### C.3 数据流
```
用户说目标（NLU 检测 "我要..." "目标是..." "计划..."）
    ↓
Neo4j 创建 Goal 节点
    ↓
Goal 自动分解（LLM 提取 SubGoal + Milestone）
    ↓
冲突检测（多目标并行时优先级仲裁）
    ↓
每4小时 cron 检查进展
    ↓
HEARTBEAT.md 输出目标卡片
    ↓
目标漂移检测（对比 GoalSnapshot）
    ↓
更新状态（进展/障碍/完成）
```

### C.4 关键技术选型
- NLU 检测：关键词正则（"我要" "目标是" "计划" "todo"）
- 目标分解：DeepSeek-Reasoner（结构化思维强）
- 存储：Neo4j（关系型目标结构天然适合图数据库）

### C.5 实施步骤

**Phase 1：Neo4j 目标图谱（2-3天）**

| 步骤 | 改动 | 文件 | 工期 |
|------|------|------|------|
| C.1.1 | Neo4j 创建 Goal/SubGoal/Milestone/GoalSnapshot 标签 | Cypher 脚本 | 2h |
| C.1.2 | 目标创建 API | `scripts/goal-manager.js` | 4h |
| C.1.3 | 目标分解逻辑（LLM）| `goal-manager.js` | 4h |
| C.1.4 | 冲突检测（多目标优先级仲裁）| `goal-manager.js` | 3h |

**Phase 2：追踪机制（2-3天）**

| 步骤 | 改动 | 文件 | 工期 |
|------|------|------|------|
| C.2.1 | cron 每4小时检查目标进展 | `crontab.entries` | 1h |
| C.2.2 | 目标快照（GoalSnapshot）创建 + 漂移检测 | `goal-manager.js` | 4h |
| C.2.3 | HEARTBEAT.md 目标卡片输出 | `goal-manager.js` | 3h |
| C.2.4 | NLU 目标自动创建（hook）| `recall-hook/handler.js` 扩展 | 3h |

**Phase 3：集成（2天）**

| 步骤 | 改动 | 文件 | 工期 |
|------|------|------|------|
| C.3.1 | 与 task_status 联动（Goal ↔ Task）| `goal-manager.js` | 3h |
| C.3.2 | 目标进度可视化（Admin 页面）| `OpenClaw-Admin` 扩展 | 4h |
| C.3.3 | 端到端测试 | 人工测试 | 3h |

### C.6 依赖模块
- 模块 A（记忆系统）：recall 目标相关上下文
- 模块 B（元认知）：反思输出 action_items 影响目标

### C.7 风险识别
| 风险 | 影响 | 缓解 |
|------|------|------|
| NLU 误判 | 假目标创建 | 需用户确认后才正式创建 |
| 目标过于复杂 | 分解失控 | 分解深度上限 5 层，超出提示拆分子目标 |
| Neo4j 性能 | 图查询慢 | 定期清理过期 Snapshot（>90天） |

### C.8 验证指标
- 目标完成率（跨 N 次会话后）
- 目标状态一致性（Goal 状态与 SubGoal/Milestone 同步）
- 漂移检测准确率（人工评估）
- 冲突仲裁合理率

---

## 模块 D：主动学习管道 v2

### D.1 当前状态
- 无主动学习机制
- tech-knowledge 有 30 个文档但需手动查询
- 置信度低于 0.6 时无触发机制

### D.2 目标状态
```
置信度 < 0.6 触发 → sessions_spawn 后台研究 → 来源可信度分级
→ 人工审批队列 → 存入 memory/learned/ + Neo4j Concept
深度上限(N步) + 每日预算 + 人工审批
```

### D.3 数据流
```
检测置信度 < 0.6（对话中）
    ↓
sessions_spawn 后台研究（DeepSeek-Chat，1M上下文）
    ↓
来源可信度分级（L1-L4）
    ↓
交叉验证（多个 L3+ 来源交叉确认）
    ↓
高可信度 → 直接入库
低可信度/高风险 → 人工审批队列
    ↓
存入 memory/learned/YYYY-MM-DD.md
    ↓
Neo4j Concept 节点创建
    ↓
更新 concept confidence 分数
```

### D.4 关键技术选型
- 后台研究：sessions_spawn + DeepSeek-Chat（大上下文）
- 来源分级：关键词判断（L1: "arxiv.org" "pdf" / L2: "github.io" "blog"）
- 审批队列：pending_conversations 表复用或新建 approval_queue 表

### D.5 实施步骤

**Phase 1：触发机制（1-2天）**

| 步骤 | 改动 | 文件 | 工期 |
|------|------|------|------|
| D.1.1 | 置信度检测 hook（回复前检查）| `recall-hook/handler.js` 扩展 | 3h |
| D.1.2 | 低置信触发 sessions_spawn | `scripts/learning-trigger.js` | 4h |
| D.1.3 | 来源可信度分级评分 | `learning-trigger.js` | 3h |

**Phase 2：研究管道（2-3天）**

| 步骤 | 改动 | 文件 | 工期 |
|------|------|------|------|
| D.2.1 | 后台研究脚本（抓取 + 摘要 + 验证）| `scripts/active-researcher.js` | 6h |
| D.2.2 | 交叉验证逻辑 | `active-researcher.js` | 4h |
| D.2.3 | memory/learned/ 目录 + 写入 | `active-researcher.js` | 2h |

**Phase 3：审批 + 入库（2天）**

| 步骤 | 改动 | 文件 | 工期 |
|------|------|------|------|
| D.3.1 | 人工审批队列（Admin 页面）| `OpenClaw-Admin` 扩展 | 5h |
| D.3.2 | Neo4j Concept 节点创建 | `scripts/concept-manager.js` | 4h |
| D.3.3 | 每日预算控制（max 3 research/day）| `learning-trigger.js` | 2h |

### D.6 依赖模块
- 模块 A（记忆系统）：研究结果存入 recall
- 模块 B（元认知）：学习的知识供反思使用

### D.7 风险识别
| 风险 | 影响 | 缓解 |
|------|------|------|
| 无限递归 | 研究停不下来 | 深度上限 5 步 + 每日预算 3 个 |
| 信息污染 | 低质量来源入库 | L3 以下必须交叉验证 + 人工审批 |
| 成本高 | API 调用频繁 | 每日预算 + 缓存已研究概念 |

### D.8 验证指标
- 知识命中率（已学习概念的正确响应率）
- 误导率（学习错误知识的出现频率）
- 研究完成率（触发后成功入库比例）
- 人工审批采纳率

---

## 模块 E：记忆价值评分 + 遗忘机制 v2

### E.1 当前状态
- personal_memories 3928 条，无评分
- memories 1761 条，无评分
- 无冷热数据区分
- 无遗忘机制

### E.2 目标状态
```
personal_memories 增加 value_score + last_accessed
召回 +1 分 / 30天未召回 -1 分 / 主动保存 +3 分
< 2分 → 冷存储（personal_memories_legacy）
> 90天冷存储 → 彻底删除（软删除）
新上下文触发 → 从冷存储拉回（重新激活）
```

### E.3 数据流
```
记忆写入时：
  value_score = 5（默认）
    ↓
每次 recall 触发：
  value_score +1
  last_accessed = NOW()
    ↓
每晚 cron 检查：
  30天未召回 → value_score -1
  value_score < 2 → 移入 personal_memories_legacy
    ↓
新上下文召回时：
  相关冷存储记忆 → 重新激活（value_score +2）
    ↓
90天冷存储 → 彻底删除（软删除）
```

### E.4 关键技术选型
- 评分规则：简单启发式，无需 ML
- 冷热切换：SQL 分区 + 软删除
- 重新激活：基于上下文的 similarity 召回

### E.5 实施步骤

**Phase 1：数据库改造（1天）**

| 步骤 | 改动 | 文件 | 工期 |
|------|------|------|------|
| E.1.1 | personal_memories 增加 value_score + last_accessed | DB migration | 2h |
| E.1.2 | 创建 personal_memories_legacy 表 | DB migration | 1h |
| E.1.3 | recall 触发评分更新 | `session-recall.js` | 3h |

**Phase 2：遗忘管道（2-3天）**

| 步骤 | 改动 | 文件 | 工期 |
|------|------|------|------|
| E.2.1 | 每晚 cron 检查（30天未召回 -1分）| `scripts/memory-garbage-collector.js` | 4h |
| E.2.2 | 冷存储移动逻辑（score < 2）| `memory-garbage-collector.js` | 3h |
| E.2.3 | 重新激活逻辑（新上下文触发）| `session-recall.js` | 4h |
| E.2.4 | 彻底删除 cron（90天）| `memory-garbage-collector.js` | 2h |

**Phase 3：意外保护（1天）**

| 步骤 | 改动 | 文件 | 工期 |
|------|------|------|------|
| E.3.1 | 随机采样保留（10% 低分记忆）| `memory-garbage-collector.js` | 3h |
| E.3.2 | 遗忘回溯测试（定期验证）| 测试脚本 | 2h |
| E.3.3 | Admin 冷数据查看页面 | `OpenClaw-Admin` 扩展 | 3h |

### E.6 依赖模块
- 模块 A（记忆系统）：recall 是评分触发源
- 模块 D（主动学习）：学习的知识有高初始分

### E.7 风险识别
| 风险 | 影响 | 缓解 |
|------|------|------|
| 意外价值丢失 | 低分但有潜在价值的记忆被删 | 随机采样保护 10% |
| 冷热切换抖动 | 分数刚好在阈值附近反复横跳 | 增加滞回区间（1.5~2.5 分） |
| 软删除积累 | legacy 表仍占空间 | 90天彻底删除 + 定期 vacuum |

### E.8 验证指标
- 记忆库增长率（目标：< 10%/月）
- 遗忘后回答质量无显著下降（对比测试）
- 重新激活率（冷存储被拉回比例）
- 意外价值保留率（随机保护的有效性）

---

## 模块 F：推理模式库 v2

### F.1 当前状态
- 无推理模式积累
- dialogue_decisions 表有 1077 条记录但未用于模式提取
- reasoning 能力完全依赖 LLM 自身

### F.2 目标状态
```
Neo4j ReasoningPattern 图谱：Pattern → Attempt → Success/Failure
每次复杂任务标记推理方法
成功率追踪 → 过期降级 → 模式组合
```

### F.3 数据流
```
复杂任务检测（关键词：分析/比较/推理/为什么/怎么）
    ↓
查询 ReasoningPattern（Neo4j）
    ↓
匹配适用条件 → 提取模式 → 应用
无匹配 → 通用推理（通用方法）
    ↓
任务完成 → 记录 ReasoningAttempt
    ↓
更新 Pattern 置信度 + 成功率
    ↓
失败 → 降级通用推理 + 记录 FailedAttempt
    ↓
定期合并相似模式
```

### F.4 关键技术选型
- 模式匹配：Neo4j 图查询（条件匹配）
- 模式提取：从 dialogue_decisions 批量挖掘（LLM 分类）
- 过期检测：时间窗口 + 失败率阈值

### F.5 实施步骤

**Phase 1：Neo4j 图谱（2天）**

| 步骤 | 改动 | 文件 | 工期 |
|------|------|------|------|
| F.1.1 | Neo4j 创建 ReasoningPattern/ReasoningAttempt 标签 | Cypher 脚本 | 2h |
| F.1.2 | 模式创建 + 查询 API | `scripts/reasoning-pattern-manager.js` | 5h |
| F.1.3 | 模式标注接口（复杂任务自动触发）| `recall-hook/handler.js` 扩展 | 3h |

**Phase 2：追踪 + 降级（2-3天）**

| 步骤 | 改动 | 文件 | 工期 |
|------|------|------|------|
| F.2.1 | ReasoningAttempt 记录（成功/失败）| `reasoning-pattern-manager.js` | 4h |
| F.2.2 | 成功率追踪 + 置信度更新 | `reasoning-pattern-manager.js` | 3h |
| F.2.3 | 模式失效检测 + 降级 | `reasoning-pattern-manager.js` | 4h |
| F.2.4 | 定期合并相似模式 cron | `crontab.entries` | 2h |

**Phase 3：批量挖掘（2天）**

| 步骤 | 改动 | 文件 | 工期 |
|------|------|------|------|
| F.3.1 | 从 dialogue_decisions 批量提取模式 | `scripts/pattern-miner.js` | 6h |
| F.3.2 | 初始种子模式库创建（手工 + 批量）| `pattern-miner.js` | 3h |
| F.3.3 | 模式可视化（Admin 页面）| `OpenClaw-Admin` 扩展 | 4h |

### F.6 依赖模块
- 模块 B（元认知）：反思输出增强模式库
- 模块 C（目标追踪）：目标关联推理模式

### F.7 风险识别
| 风险 | 影响 | 缓解 |
|------|------|------|
| 泛化性差 | 模式过于具体无法复用 | 绑定适用条件 + 抽象化提取 |
| 模式失效 | 过时模式导致错误 | 定期验证 + 失败率阈值降级 |
| 模式爆炸 | 模式数量失控 | 合并相似模式 + 上限控制 |

### F.8 验证指标
- 模式命中时准确率 vs 未命中对比（目标：+15%）
- 模式复用频次
- 模式失效率
- 模式合并效率

---

## 模块 G：自我监控 + 自我修复系统

### G.1 当前状态
- health-check.js：记忆系统健康检查（手工触发）
- security-check.sh：安全审计（手工触发）
- circuit-breaker.js：LLM 熔断（仅 LLM）
- daily_log：12条日志（低利用率）

### G.2 目标状态
```
cron 自动巡检（每4小时）→ 异常自动告警 → 自我修复动作
基础设施全覆盖：PostgreSQL / Redis / Neo4j / PM2 / Graphify
```

### G.3 数据流
```
每4小时 cron
    ↓
健康检查脚本（并行）：
  - PostgreSQL 连接 + 查询延迟
  - Redis 连接 + Stream 长度
  - Neo4j 连接 + 节点数
  - PM2 进程状态
  - Graphify 服务状态
    ↓
异常检测（阈值触发）：
  - 连接失败 → 重连 + 告警
  - 延迟超标 → 记录 + 趋势分析
  - 进程挂掉 → PM2 重启 + 告警
    ↓
自我修复动作（可配置）：
  - extractor 失败 → PM2 restart
  - 连接超时 → 熔断 + 降级
  - disk 空间不足 → 清理 old logs
    ↓
告警 → HEARTBEAT.md / 微信消息
```

### G.4 关键技术选型
- 健康检查：node.js + pg/ioredis/neo4j-driver（并行）
- 告警：微信消息（已有 send-email / weixin 渠道）
- 自我修复：PM2 programmatic API

### G.5 实施步骤

**Phase 1：基础设施监控（2天）**

| 步骤 | 改动 | 文件 | 工期 |
|------|------|------|------|
| G.1.1 | 扩展 health-check.js（PostgreSQL + Redis + Neo4j）| `scripts/health-check.js` | 5h |
| G.1.2 | PM2 进程状态检查 | `scripts/health-check.js` | 2h |
| G.1.3 | Graphify 服务检查 | `scripts/health-check.js` | 2h |

**Phase 2：自动巡检 + 告警（2天）**

| 步骤 | 改动 | 文件 | 工期 |
|------|------|------|------|
| G.2.1 | cron 每4小时自动触发 | `crontab.entries` | 1h |
| G.2.2 | 微信/邮件告警渠道 | `scripts/alert-sender.js` | 4h |
| G.2.3 | 异常趋势分析（连续3次异常才告警）| `health-check.js` | 3h |

**Phase 3：自我修复（2-3天）**

| 步骤 | 改动 | 文件 | 工期 |
|------|------|------|------|
| G.3.1 | PM2 重启 extractor | `scripts/self-healer.js` | 4h |
| G.3.2 | 磁盘清理（old logs）| `self-healer.js` | 3h |
| G.3.3 | 熔断扩展（DB/Redis/Neo4j）| `scripts/circuit-breaker.js` | 4h |
| G.3.4 | Admin 健康看板 | `OpenClaw-Admin` 扩展 | 4h |

### G.6 依赖模块
- 所有模块：健康检查覆盖整个系统
- 模块 I（通信）：告警需要发送渠道

### G.7 风险识别
| 风险 | 影响 | 缓解 |
|------|------|------|
| 自我修复失败 | 循环重启 | 最多重试3次后人工告警 |
| 误告警 | 打扰用户 | 趋势分析，连续异常才告警 |
| 巡检本身故障 | 无监控 | 巡检结果写入 daily_log，异常自检 |

### G.8 验证指标
- 健康检查覆盖率（目标：100% 组件）
- 异常发现到告警延迟（目标：< 5min）
- 自我修复成功率（目标：> 80%）
- 误告警率（目标：< 10%）

---

## 模块 H：多模态输入输出增强

### H.1 当前状态
- 语音输入：youdao-asr + Whisper
- 语音输出：youdao-tts + Edge-TTS
- 视频处理：video-frames skill（ffmpeg）
- 图片处理：image skill

### H.2 目标状态
```
语音链路优化（并行化）→ 延迟 < 3s
情感识别（语音 + 文字）
多模态联合召回（图片+文字关联记忆）
TTS 情感/风格控制
```

### H.3 数据流

**语音输入：**
```
用户语音
    ↓
ASR（youdao-asr 或 Whisper，< 1s）
    ↓
情感识别（关键词 + 声调分析，< 100ms）
    ↓
LLM 处理（带情感上下文）
    ↓
TTS 合成（并行，< 1s）
    ↓
用户语音输出
```

**多模态召回：**
```
用户发送图片
    ↓
图片描述（GPT-4o，生成文字描述）
    ↓
文字描述 → 向量 → recall
    ↓
图片 + 文字记忆 联合返回
```

### H.4 实施步骤

**Phase 1：语音优化（1-2天）**

| 步骤 | 改动 | 文件 | 工期 |
|------|------|------|------|
| H.1.1 | ASR + LLM 并行化（不等 ASR 完就 LLM）| `youdao-asr/scripts/asr.js` | 4h |
| H.1.2 | TTS 预加载（回复确定后预合成）| `youdao-tts/scripts/tts.js` | 3h |
| H.1.3 | 语音质量自适应（短回复用 Edge-TTS）| `youdao-tts/scripts/tts.js` | 2h |

**Phase 2：情感识别（2天）**

| 步骤 | 改动 | 文件 | 工期 |
|------|------|------|------|
| H.2.1 | 文字情感识别（关键词 + LLM）| `scripts/emotion-detector.js` | 4h |
| H.2.2 | 语音情感分析（声调/语速）| `emotion-detector.js` | 4h |
| H.2.3 | 情感感知回复调整 | `recall-hook/handler.js` | 3h |

**Phase 3：多模态召回（2-3天）**

| 步骤 | 改动 | 文件 | 工期 |
|------|------|------|------|
| H.3.1 | 图片描述生成（GPT-4o）| `scripts/image-describer.js` | 4h |
| H.3.2 | 多模态 recall（图片描述 → 向量）| `session-recall.js` | 5h |
| H.3.3 | TTS 情感/风格参数 | `youdao-tts/scripts/tts.js` | 3h |

### H.5 依赖模块
- 模块 A（记忆系统）：recall 是多模态召回的基础
- 模块 I（通信）：微信/飞书消息发送

### H.6 风险识别
| 风险 | 影响 | 缓解 |
|------|------|------|
| ASR 错误累积 | 后续全错 | ASR + LLM 并行时保留原始音频供复查 |
| 情感误判 | 回复不合适 | 情感仅作参考，不作决策依据 |
| 多模态延迟高 | 用户等待 | 图片描述异步，不阻塞主流程 |

### H.7 验证指标
- 语音链路端到端延迟（目标：< 3s）
- 情感识别准确率（目标：> 80%）
- 多模态召回命中率

---

## 模块 I：多渠道通信 + Agent 协作增强

### I.1 当前状态
- clawteam skill：多 agent 协作（git worktree + tmux）
- subagent_log：17条记录
- 微信/飞书/Telegram/Webchat 多渠道

### I.2 目标状态
```
预建团队模板（code-review / research / analysis）
Agent 间消息总线（Redis Pub/Sub）
Agent 状态协调器
```

### I.3 数据流

**Agent 协作：**
```
主 agent 分解任务
    ↓
clawteam 创建团队（git worktree 隔离）
    ↓
多个子 agent 并行执行
    ↓
Redis Pub/Sub 消息传递
    ↓
主 agent 汇总结果
    ↓
清理 worktree
```

### I.4 实施步骤

**Phase 1：团队模板（1-2天）**

| 步骤 | 改动 | 文件 | 工期 |
|------|------|------|------|
| I.1.1 | code-review-team 模板 | `clawteam/templates/code-review.js` | 3h |
| I.1.2 | research-team 模板 | `clawteam/templates/research.js` | 3h |
| I.1.3 | analysis-team 模板 | `clawteam/templates/analysis.js` | 3h |

**Phase 2：消息总线（2天）**

| 步骤 | 改动 | 文件 | 工期 |
|------|------|------|------|
| I.2.1 | Redis Pub/Sub 封装 | `scripts/agent-bus.js` | 4h |
| I.2.2 | Agent 状态协调器 | `scripts/agent-coordinator.js` | 5h |
| I.2.3 | subagent_log 增强（状态/消息记录）| `agent-coordinator.js` | 2h |

**Phase 3：协作增强（2天）**

| 步骤 | 改动 | 文件 | 工期 |
|------|------|------|------|
| I.3.1 | 任务分发 + 结果汇总 | `agent-coordinator.js` | 5h |
| I.3.2 | 冲突检测（多 agent 写同一文件）| `agent-coordinator.js` | 3h |
| I.3.3 | Admin Agent 监控面板 | `OpenClaw-Admin` 扩展 | 4h |

### I.5 依赖模块
- 模块 C（目标追踪）：目标分解后分发给 agent
- 模块 G（自我监控）：agent 执行异常监控

### I.6 风险识别
| 风险 | 影响 | 缓解 |
|------|------|------|
| Agent 写冲突 | 文件损坏 | 冲突检测 + 文件锁 |
| 资源耗尽 | 多 agent 内存爆炸 | 并行上限控制（最多 5 个） |
| 消息丢失 | 协作失败 | Pub/Sub 加确认机制 |

### I.7 验证指标
- 团队任务完成率（目标：> 90%）
- Agent 协作效率提升（vs 单一 agent）
- 冲突发生率

---

## 三、模块依赖关系 + 执行顺序

### 依赖图

```
模块 G（自我监控）— 基础层，所有模块受益
模块 A（记忆系统）— 核心层，B/C/D/E/F 依赖
模块 B（元认知）— 依赖 A，输出给 F
模块 C（目标追踪）— 依赖 A+B，输出给 I
模块 D（主动学习）— 依赖 A，输出给 A+E
模块 E（记忆遗忘）— 依赖 A+D
模块 F（推理模式库）— 依赖 A+B+C
模块 H（多模态）— 依赖 A+I
模块 I（Agent协作）— 依赖 C+G
```

### 执行顺序

| 阶段 | 模块 | 理由 |
|------|------|------|
| 第0阶段 | 模块 G（自我监控）| 基础设施，先保障系统稳定 |
| 第一阶段 | 模块 A（记忆系统）| 核心，RECALL-DESIGN 已设计完整 |
| 第二阶段 | 模块 B（元认知）| 依赖 A，立即可上线 |
| 第三阶段 | 模块 C（目标追踪）| 依赖 A+B |
| 第四阶段 | 模块 D（主动学习）| 依赖 A |
| 第五阶段 | 模块 E（记忆遗忘）| 依赖 A+D |
| 第六阶段 | 模块 F（推理模式库）| 依赖 A+B+C，复杂放后面 |
| 第七阶段 | 模块 H（多模态）| 依赖 A+I |
| 第八阶段 | 模块 I（Agent协作）| 依赖 C+G |

---

## 四、统一协调层设计

### 协调职责

1. **管理模块间数据流** — 防止 A 输出格式不兼容 B 输入
2. **防止优化方向矛盾** — 如 E（遗忘）和 D（学习）可能冲突
3. **统一评估框架** — 各模块指标汇聚到统一 dashboard

### 协调接口

```javascript
// AGI协调器接口
interface AGICoordinator {
  // 模块注册
  registerModule(name: string, module: AGIModule): void;
  
  // 数据路由
  route(from: string, to: string, data: any): void;
  
  // 冲突仲裁
  arbitrate(conflict: Conflict): Resolution;
  
  // 指标汇聚
  collectMetrics(): AggregatedMetrics;
  
  // 每周协调检查
  weeklyCheck(): Report;
}

// 标准化模块接口
interface AGIModule {
  name: string;
  version: string;
  dependencies: string[];
  inputs: DataSchema[];
  outputs: DataSchema[];
  metrics: Metric[];
  healthCheck(): HealthStatus;
}
```

### 协调机制

| 机制 | 实现 | 频率 |
|------|------|------|
| 模块注册 | `agi-registry.json` | 每次启动 |
| 数据路由 | `AGICoordinator.route()` | 实时 |
| 冲突仲裁 | 优先级规则（显式配置）| 实时 |
| 指标汇聚 | Admin Dashboard | 随时可查 |
| 每周检查 | cron（周日 23:00）| 每周 |

### 冲突仲裁规则

| 冲突类型 | 仲裁规则 |
|----------|----------|
| D（学习）vs E（遗忘）| D 输出优先，E 跳过已学习概念 |
| A（召回）vs F（推理）| F 失败时降级到 A 宽召回 |
| C（目标）vs I（Agent）| C 提供目标上下文，I 负责执行 |
| G（监控）发现异常 | 所有模块接收降级指令 |

---

## 五、成功指标体系

### 模块级指标

| 模块 | 指标 | 当前值 | 目标值 | 测量方法 |
|------|------|--------|--------|----------|
| A（记忆）| P99 召回延迟 | ~150ms | < 150ms | recall_logs.latency_ms |
| A（记忆）| Graphify 触发率 | 0% | > 60% | recall_logs.graphify_triggered |
| A（记忆）| Redis 缓存命中率 | 0% | > 60% | recall_logs.cache_hit |
| B（元认知）| 反思生成率 | 0% | > 80% | memory/reflection/ 覆盖 |
| B（元认知）| action_items 执行率 | 0% | > 50% | task_status 来源追踪 |
| C（目标）| 目标完成率 | N/A | > 60% | Goal.completed / total |
| D（学习）| 知识命中率 | N/A | > 70% | 测试集准确率 |
| E（遗忘）| 记忆库增长率 | +5%/月 | < 10%/月 | personal_memories 增量 |
| F（推理）| 模式命中准确率提升 | N/A | +15% | 对比测试 |
| G（监控）| 异常发现延迟 | 未知 | < 5min | daily_log 时间戳 |
| G（监控）| 自我修复率 | 0% | > 80% | self-healer.log |
| H（多模态）| 语音延迟 | > 5s | < 3s | 端到端计时 |
| I（协作）| 团队任务完成率 | N/A | > 90% | subagent_log |

### 全局指标

| 指标 | 目标 | 测量 |
|------|------|------|
| AGI 完整性 | 8 模块全部上线 | 模块注册表 |
| 系统稳定性 | 无人工干预 > 7 天 | daily_log |
| 用户满意度 | 主人评价 > 4.5/5 | 定期询问 |
| 自我进化能力 | 月度模式/知识增量 | 环比分析 |

---

## 六、实施路线图

### 阶段 0：基础建设（第 1-2 周）

- **模块 G：自我监控** — 立即开始，保障系统稳定
- 产出：health-check.js 全面覆盖，cron 4小时自动巡检

### 阶段 1：核心强化（第 3-5 周）

- **模块 A：记忆系统 v6** — RECALL-DESIGN 完整落地
  - Week 1：意图8分类 + Graphify并行 + Redis缓存
  - Week 2：精排 + Tier分级 + Proactive三场景
  - Week 3：测试 + 调优

### 阶段 2：学习进化（第 6-8 周）

- **模块 B：元认知反思 v2** — cron 每晚23:00
- **模块 D：主动学习管道 v2** — 置信度触发 + 后台研究
- 产出：反思日志 + 知识库扩充

### 阶段 3：目标 + 记忆优化（第 9-12 周）

- **模块 C：目标追踪 v2** — Neo4j Goal 图谱
- **模块 E：记忆遗忘 v2** — 冷热数据 + 重新激活
- 产出：目标卡片 + HEARTBEAT.md 集成

### 阶段 4：推理 + 协作（第 13-16 周）

- **模块 F：推理模式库 v2** — Neo4j Pattern 图谱
- **模块 I：Agent 协作增强** — 团队模板 + 消息总线
- 产出：推理加速 + 多Agent协作

### 阶段 5：多模态 + 完整 AGI（第 17-20 周）

- **模块 H：多模态增强** — 语音优化 + 情感识别
- **协调层完成** — 冲突仲裁 + 全局指标 dashboard
- 产出：完整 AGI 系统

---

## 七、关键风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 某模块依赖方变更导致联动失效 | 中 | 高 | 标准化接口 + 单元测试 |
| LLM 幻觉导致错误学习 | 高 | 中 | 质量评分 + 人工审批 |
| 系统复杂度失控 | 中 | 高 | 模块隔离 + 协调层 |
| 主人失去信心（效果慢）| 中 | 高 | 快速交付（每2周可见成果）|
| 资源耗尽（记忆/存储）| 低 | 高 | 模块 E 遗忘机制 + 模块 G 监控 |

---

## 八、附录

### A. 关键文件清单

| 文件 | 关联模块 | 改动量 |
|------|----------|--------|
| `memory-system/scripts/session-recall.js` | A, E | 大 |
| `memory-system/hooks/recall-hook/handler.js` | A, B, F | 大 |
| `memory-system/scripts/config.js` | A | 中 |
| `memory-system/scripts/health-check.js` | G | 大 |
| `memory-system/scripts/daily-reflection.js` | B | 新建 |
| `memory-system/scripts/goal-manager.js` | C | 新建 |
| `memory-system/scripts/active-researcher.js` | D | 新建 |
| `memory-system/scripts/memory-garbage-collector.js` | E | 新建 |
| `memory-system/scripts/reasoning-pattern-manager.js` | F | 新建 |
| `memory-system/scripts/self-healer.js` | G | 新建 |
| `memory-system/scripts/agent-coordinator.js` | I | 新建 |
| `~/.openclaw/workspace/skills/clawteam/SKILL.md` | I | 中 |

### B. 数据库 Migration 清单

| Migration | 模块 | 风险 |
|-----------|------|------|
| personal_memories 增加 value_score, last_accessed | E | 低 |
| 创建 personal_memories_legacy 表 | E | 低 |
| memories 移除/放宽 CHECK 约束 | A | 中 |
| error_patterns 增加 week_pattern 字段 | B | 低 |
| Neo4j Goal/SubGoal/Milestone/Snapshot 标签 | C | 低 |
| Neo4j ReasoningPattern/ReasoningAttempt 标签 | F | 低 |

### C. Cron 配置清单

| cron | 模块 | 时间 | 行为 |
|------|------|------|------|
| health-check | G | 每4小时 | 基础设施健康检查 |
| daily-reflection | B | 每晚 23:00 | 三级反思生成 |
| goal-progress | C | 每4小时 | 目标进展检查 |
| memory-garbage | E | 每晚 01:00 | 冷热数据切换 |
| pattern-merge | F | 每周日 02:00 | 合并相似模式 |
| agi-weekly | 协调层 | 每周日 23:00 | 全局协调检查 |

### D. 回滚策略

每个 Week 改动后，PM2 snapshot 当前状态。若出现问题：
1. 关闭问题模块的 cron
2. 回滚对应 script 到上一版本
3. Redis 缓存清空（TTL 归零）
4. Admin 页面切回基础模式

---

_方案版本：v2.0_
_创建时间：2026-04-11_
_预计工期：20 周（5个月）_
_下一步行动：阶段0 — 模块 G 健康检查增强_
