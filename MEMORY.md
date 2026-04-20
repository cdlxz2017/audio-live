# MEMORY.md - 长期记忆

> Curated memory - distilled from daily notes

---

## ⚡ 卓越架构模式（永久生效）

**规则**：主人下达的任何任务，默认必须使用「卓越架构模式」执行，除非是直接命令（查数据/发文件/简单操作）。

**卓越架构模式 =**：
1. **已知** → 查历史方案，复用已有经验
2. **未知** → 多方案对比，动手前识别危险点
3. **读手册** → 动手前读技术文档，理解系统架构
4. **文档闭环** → 完成后更新文档，沉淀经验

**详细 SOP**：`capability-graph/SOP-EXCELLENCE-FRAMEWORK.md`（v2.1）

**判断标准**：
- ✅ 需要思考、规划、设计、调研、对比 → **必须走卓越架构**
- ✅ 主人问「你怎么看」「方案是什么」「帮我研究」 → **必须走卓越架构**
- ⚡ 主人说「查一下XX」「发个文件」「重启XX」 → **直接执行，不走**

---

## 🏷️ 系统触发词

**触发条件**：主人说「系统」「调用系统」「触发系统」「所有系统」「系统清单」时，立即读取 `workspace/SYSTEMS.md` 并完整输出。

---

## 🗺️ 能力索引总表（session 启动加载）

> 主人说一句话，我查下表就知道该读哪个文件。不需要记路径，自然语言说就行。

### 系统（读 `capability-graph/systems/`）

| 关键词 | 文件 | 说明 |
|--------|------|------|
| gateway/网关 | `openclaw-gateway.md` | OpenClaw 网关，端口 18789 |
| 主脑/记忆系统 | `memory-system.md` | 三层记忆 + Neo4j 同步 |
| 副脑/problem thread | `problem-thread.md` | 问题追踪系统，API 54321 |
| 安全/防火墙 | `security-system.md` | OSSEC + fail2ban + UFW |
| 民宿/lingyi | `lingyi-cms.md` | 靈一民宿系统，Docker 部署 |
| 天道系统 | `tiandao-system.md` | 天道微服务，PM2 管理 |
| Neo4j/图数据库 | `neo4j.md` | 170万+ 节点，主脑+副脑 |

### 工具（读 `capability-graph/tools/`）

| 关键词 | 文件 | 说明 |
|--------|------|------|
| clawteam/团队/多人协作 | `clawteam.md` | 多智能体协同，tmux+git |
| 数据库/PostgreSQL/pg | `postgresql.md` | 主库 + 副脑库 |
| PM2/进程 | `pm2.md` | Node.js 进程管理 |
| 模型/LLM/路由 | `llm-routing.md` | 大模型可用性与路由策略 |
| Redis/缓存 | `redis.md` | 缓存 + graph:sync:events Stream |
| Docker/容器 | `docker.md` | 容器运行时，lingyi/副脑 |
| **凭证/API Key** | `memory/API-KEY-MANAGEMENT.md` | 中央凭证管理系统（Phase 0-5完成） |
| **操作审计系统** | `memory/AUDIT-SYSTEM-DESIGN.md` | 审计日志（Phase 1 实施中） |

### 技能（读 `capability-graph/skills/`）

| 关键词 | 文件 | 说明 |
|--------|------|------|
| 邮件/email | `skills/custom/send-email.md` | QQ邮箱收发，天道AI落款 |
| 语音/TTS/ASR | `skills/custom/voice-tools.md` | 有道TTS + 阿里云Fun-ASR |
| 摄像头/录制 | `skills/custom/camera-recorder.md` | 视频录制+转写+发邮件 |
| 记忆追溯/摘要查找 | `skills/custom/three-layer-memory-lookup.md` | 三层记忆追溯 |
| 追溯链/trace_chain | `memory-system/scripts/trace-chain-audit.js` | 端到端写入验证（2026-04-20） |
| 召回实时监控 | `memory-system/scripts/recall-live-monitor.js` | 召回延迟/意图/P99实时监控（2026-04-20） |
| 自学习记忆引擎 | `memory-system/scripts/learning-engine-monitor.js` | 四条数据链监控（2026-04-20） |
| Hermes/玄一 | `skills/custom/hermes-router.md` | 复杂任务路由 |
| 技术知识库 | `skills/custom/tech-knowledge.md` | 21文档向量检索 |
| graph-linker监控 | `skills/custom/graph-linker-monitor.md` | Stream积压分析 |
| 其他自制 | `skills/custom/other-custom.md` | audio-stream/graphify/task-router（开发中） |
| 工作区skill | `skills/workspace/workspace-skills.md` | defuddle/json-canvas/obsidian等8个 |
| 系统skill | `skills/builtin/builtin-index.md` | 53个系统自带skill索引 |

### 框架/风险/避坑

| 关键词 | 文件 | 说明 |
|--------|------|------|
| SOP/卓越框架 | `frameworks/excellence-sop.md` | 三级通道 + 团队模式 |
| 危险点/风险 | `risk-patterns/model-unavailability.md` | 模型不可用/Session中断/hook缺陷 |
| 避坑/教训 | `pitfalls/design-lessons.md` | 4条设计教训 |
| 完整SOP | `SOP-EXCELLENCE-FRAMEWORK.md` | SOP v2.1 完整文件 |
| **总导航仪表盘** | `capability-graph/NAVIGATION.md` | 主人可随时查看的全景状态报告 |

---

## 📧 邮件收发 Skill

| Skill | 路径 | 说明 |
|-------|------|------|
| send-email | `custom-skills/send-email/` | QQ邮箱，支持收发/多附件/HTML/纯文本，天道Ai落款 |
| SOP | `SOP-EMAIL.md` | 标准邮件收发流程模板 |

**配置**：cdlxz2017@qq.com / SMTP: smtp.qq.com:587 / IMAP: imap.qq.com:993 / 授权码已配置

## 🔧 技术知识库（tech-knowledge）

| 项目 | 内容 |
|------|------|
| 数据库 | `openclaw_memory.tech_docs`（14文档）/ `tech_params`（4参数） |
| 脚本 | `memory-system/scripts/tech-extractor.js` / `tech-recall.js` |
| Skill | `custom-skills/tech-knowledge/SKILL.md` |
| 向量模型 | BGE-m3（1024维，Ollama） |
| 检索方式 | pgvector IVFFlat 向量索引 |
| 索引范围 | SOP-*.md / memory-system 架构文档 / a2a-gateway / lingyi-cms |
| 特点 | **完全独立**，不动现有记忆系统任何表和进程 |

## 🔧 技术 SOP

| SOP | 内容 |
|-----|------|
| `SOP-GATEWAY-RESTART.md` | Gateway 重启标准流程 |
| `SOP-CLEAN-SYSTEM.md` | 系统清洁与软件安装规范（目录/环境隔离/安装流程/Git规范） |

### 目录结构规范（2026-04-05）

```
~/ai/
├── projects/    # 自主开发项目（Git 托管）
├── apps/       # 第三方应用/工具
├── services/   # 长期运行服务（PM2/systemd/Docker）
├── scripts/     # 运维工具脚本
├── backups/     # 数据备份
├── logs/        # 日志输出
├── venvs/      # Python 虚拟环境
└── .config/    # 配置文件 Git 仓库 ✅ 已初始化
```

### 配置 Git 仓库
- `~/.config/` — 已初始化为 Git 仓库（main 分支）
- 记录所有系统配置变更（install/config/remove/update/patch）

---

## 🔒 系统安全档案 SOP（2026-04-10）

### 安全软件安装流程（强制）

**每次安装安全类软件后，必须执行以下流程：**

1. **安装并配置完成**
2. **将配置复制到** `~/.config/security/<软件名>/`
3. **提交 Git**
   ```bash
   cd ~/.config && git add security/<软件名>/
   git commit -m "安全: <软件名> <版本> <简要说明>"
   ```

### 安全档案目录结构

```
~/.config/security/
├── README.md              ← 安全档案总手册
├── INSTALLED-APPS.md      ← 已安装安全软件清单
├── ossec/                 ← OSSEC HIDS 配置
│   ├── ossec.conf
│   └── local_internal_options.conf
├── fail2ban/              ← fail2ban 配置
│   └── jail.local
├── ufw/                   ← 防火墙规则快照
│   ├── ufw-status.txt
│   └── iptables-rules.txt
└── notes/
    └── operation-log.md   ← 操作记录
```

### 已纳入档案的安全软件

| 软件 | 版本 | 纳入日期 |
|------|------|----------|
| OSSEC HIDS | 4.0.0 | 2026-04-10 |
| fail2ban | Ubuntu 0.7.10-2 | 2026-04-10 |
| UFW | 0.36.2 | 2026-04-10 |

---

## 📦 lingyi-crm 系统文档
- Git仓库：`/home/ai/.openclaw/workspace/projects/lingyi-cms/`（本地）
- 修改日志：`projects/lingyi-cms/CHANGELOG.md`
- 完整梳理：`projects/lingyi-cms/SYSTEM-REVIEW.md`
- 数据库备份表：`system_docs`（id=1, type=system_review）
- 所有代码已从容器导出并提交到本地git仓库
- 核心修改文件：`backend/bills.py`（次卡/月包营收修复）、`backend/reports.py`（报表营收修复）
- 数据库连接：linyi_db / linyi_user / E4jZRKt3xN8qLp2v / lingyi-db:5432

## 📊 系统配置

| 项目 | 状态 |
|------|------|
| OpenClaw | 2026.4.1 |
| lossless-claw | ✅ 已安装 (v0.5.3) |
| Telegram | ❌ 已关闭 |
| Feishu | ✅ 开启 |
| Gateway 端口 | 18789 |

### 数据库连接

| 服务 | Host | Port | 用户 | 密码 |
|------|------|------|------|------|
| PostgreSQL | localhost | 5432 | openclaw_ai | zyxrcy910128 |
| Redis | localhost | 6379 | - | - |
| Neo4j | localhost | 7687 | neo4j | openclaw_neo4j_2026 |

### 已安装第三方应用

| 应用 | 端口 | 路径 | 用途 |
|------|------|------|------|
| OpenClaw-Admin | 3031（前端）/ 3030（后端） | `/home/ai/projects/OpenClaw-Admin` | OpenClaw Web 管理界面 |
| lingyi-cms（前端） | 3001 | Docker 容器 | 靈一民宿综合管理系统 |
| lingyi-cms（后端） | 8001 | Docker 容器 | 靈一民宿后端 API |
| tiandao-admin-frontend | 3003/3005 | `/home/ai/projects/tiandao-system/admin-frontend` | 天道·系统管理后台（Vue） |

### LLM 配置
- **提取模型**：Qwen-max（DashScope API）
- **向量模型**：BGE-m3（Ollama localhost:11434）
- **API Key**：sk-50c8c0524a8244ffbdcb9131545dfa56

---

## ⚠️ 重要原则

### Session 结束前必须更新任务系统（2026-04-06）
**每次结束 session 或用户说新建 session 前，必须先更新任务系统（task-crud.js）。** 新建/更新/完成任务，确保下次 session 启动时能看到最新进度。这是标准流程，不要忘。

### 记忆系统禁区原则（2026-04-05）
**记忆系统（memory-system）是绝对禁区。** 任何涉及表结构/ extractor / recall / stream / PM2 进程的操作，必须用户明确授权才能执行。tech-knowledge 是在记忆系统外部独立建立的，不属于禁区范围。

### 古籍知识库与记忆系统完全无关

- `memories_legacy` 中的古籍知识（62.3 万条古籍摘要）与记忆系统**无任何关系**
- Neo4j 中的 Person/Work/Place 等 170 万知识库节点与记忆系统**完全隔离**
- 处理任何数据时，**未明确告知则不涉及古籍/知识库**

---

## 🎯 记忆系统项目

### 项目状态

**阶段**：已部署运行
**检测脚本**：`memory-system/scripts/health-check.js`（只检查4个在运行的 PM2 进程）

### 数据流（2026-04-18 修正）

```
对话消息 → OpenClaw Gateway
              ├─→ hook: session-capture-hook → PostgreSQL conversation_messages ✅
              │    ⚠️ 只捕获 user 消息（before_message_write 对 assistant 无效）
              │                                      ↓
              │                           30秒轮询: session-file-extractor-loop.js (PM2 #0)
              │                           --no-llm 跳过LLM提取，只做归档
              │                                      ↓
              │                           extractor-file-based.js → A表 ✅
              │
              ├─→ summary-extractor (PM2 #2) → memory_summaries (实时产出) ❌ **已停止（2026-04-20）：入口文件从未git commit，文件系统丢失，565,879次crash重启后停止，由session-summary-extractor替代**
              │                                      ↓
              │               ┌─→ graph:sync:events → graph-linker (Memory_tenantId 节点)
              │               │
              │               └─→ 实时同步 → Neo4j PersonalMemory (实时写入) ✅
              │                                       ↓
              │                           cron增量同步 (每5分钟兜底) ✅
              │
              └─→ graph-linker.js (PM2 #1) → Redis Stream: graph:sync:events → Neo4j ✅

**A表记录（2026-04-18）:**
- conversation_messages: user=5341, assistant=1213
- 主session (121b7b7c): user=3496, assistant=460
- 记忆摘要: 1745条
- recall_logs: 393条

**已知问题:**
- before_message_write hook 对 webchat assistant 无效（SessionManager.appendInjectedAssistantMessageToTranscript 绕过了hook）
- assistant 消息完全依赖 extractor 从 JSONL 文件读取（batch，有30s延迟）
- 详见: memory-system/docs/SESSION-CAPTURE-ANALYSIS-2026-04-18.md
```

### Graphify 实体对齐 + 查询路由（2026-04-09 完成）

**query-layer.js**（统一查询层）：
- Neo4j Graphify 查询 + PostgreSQL memories/memory_summaries 并行查询
- 174 个代码关键词 + 记忆关键词 + 项目关键词，中英文混合路由
- 结果合并按 score 排序，去重
- Graphify 结果附加 alignedMemories（PostgreSQL memory_summaries 对齐信息）
- API: `POST http://localhost:31234/query`

**bridge-layer.js**（对齐逻辑升级）：
- 对齐目标改为 memory_summaries（不再用 PersonalMemory/Memory_default）
- 评分策略：文本重叠 + 节点名匹配(+5) + 文件名匹配(+3) + 路径关键词交叉匹配(+2)
- 写入 Neo4j: `GraphifyCode -[ALIGNED_TO]-> Memory_summary`

**backfill-alignments.js**（一次性回填）：
- 28 个现有 GraphifyCode 节点，6 条对齐关系已建立
- 运行命令：`node /home/ai/.openclaw/workspace/custom-skills/graphify-manager/backfill-alignments.js`

### 持续同步机制（2026-04-09 建立）

| 机制 | 路径 | 说明 |
|------|------|------|
| 实时同步 | `summary-extractor.js` 内嵌 | 每次摘要创建后直接写入 Neo4j |
| 增量 cron | `cron-incremental-neo4j-sync.js` | 每5分钟增量同步 memory_summaries → Neo4j |
| 一次性回填 | `backfill-personal-memories.js` | personal_memories → Neo4j（已完成609条）|
| 一次性同步 | `sync-summaries-to-neo4j.js` | memory_summaries → Neo4j（已完成306条）|

### PM2 进程（实际运行）

| PM2 | 进程名 | 脚本 | 状态 |
|-----|--------|------|------|
| #0 | session-extractor | `session-file-extractor-loop.js` | ✅ 正常，文件扫描 |
| #1 | graph-linker | `graph-linker.js` | ✅ 正常 |
| #2 | summary-extractor | `summary-extractor-loop.js` | ❌ **已停止（2026-04-20）：入口文件从未git commit，文件系统丢失，565k次crash重启后停止，session-summary-extractor替代** |
| #3 | tiandao-member | `dist/index.js` | ✅ 运行中 |
| #4 | tiandao-auth | `dist/index.js` | ✅ 运行中 |
| #5 | tiandao-karma | `dist/index.js` | ✅ 运行中 |
| #6 | tiandao-worldevent | `dist/index.js` | ✅ 运行中 |
| #7 | tiandao-admin-app | `dist/index.js` | ✅ 运行中 |
| #8 | graphify-opus-manager | `start-opus-manager.js` | ✅ 运行中 |

### 数据库表

| 表 | 数量 | 说明 |
|----|------|------|
| `memories` | 1705 条 | 结构化记忆（entity/attr/value），来自文件扫描路径 |
| `personal_memories` | 36,772 条 | 原始内容记忆（dialogue占32689条来自session提取，其余各类技术/决策/事件等）|
| `memory_summaries` | 1874 条+ | session-summary-extractor 实时产出（summary-extractor已于2026-04-20停止）|
| `conversation_messages` | 1593 条 | 原始对话存档 |
| `recall_logs` | 21 条 | 召回历史 |

### 同步游标
- `last_sync_meta` 表记录 cron 增量同步进度（last_synced_id）

### 技术栈

| 组件 | 技术 |
|------|------|
| 消息队列 | Redis Streams（仅 graph:sync:events 供 graph-linker 消费，memory:messages Stream 已废弃） |
| 主数据库 | PostgreSQL + pgvector |
| 图数据库 | Neo4j |
| 嵌入模型 | BGE-m3 (Ollama)，接口用 `prompt` 而非 `input` |
| LLM | Qwen-max (DashScope)，BASE_URL: https://dashscope.aliyuncs.com/compatible-mode/v1 |

---

## 📊 数据资产说明

### memories_legacy 表
- **数量**：62.7 万条
- **古籍部分**：62.3 万条（`category = 'ancient-books'`）
- **用户记忆部分**：3631 条（系统事件日志，非真实个人记忆）
- **处理原则**：❌ 禁止迁移/回填到记忆系统，除非用户明确要求

### memories 表
- **用途**：用户结构化记忆（entity/attribute/value/type）
- **当前状态**：274 条（来自文件扫描路径）

### personal_memories 表
- **数量**：3927 条（含古籍摘要 62.3 万条在 memories_legacy）
- **有价值部分**：463 条（decision/plan/pending/fact/technical 等）
- **Neo4j 同步**：✅ 已同步 PersonalMemory 节点 463 个

---

## 📝 用户信息

- **时区**：Asia/Shanghai (GMT+8)
- **偏好**：严格遵守 SOP，使用中文交流

## ☸ 天道·系统（TIANDAO）

### 项目状态（2026-04-09 核实）

**PM2 在运行5个实际有代码的服务**（ecosystem.all.json 已清理空壳服务）

| 服务 | 端口 | 路径 | 状态 |
|------|------|------|------|
| tiandao-member | 3002 | `/members` | ✅ 运行中 |
| tiandao-auth | 3004 | `/auth/login` | ✅ 运行中 |
| tiandao-karma | 3007 | `/karma/rules` | ✅ 运行中 |
| tiandao-worldevent | 3011 | — | ✅ 运行中 |
| tiandao-admin-app | 3013 | — | ✅ 运行中 |

**未开发（仅有设计文档）**：time-service、underworld-service、heaven-service、notice-service（2026-04-09 已从 ecosystem 移除）

**数据库**：PostgreSQL `tiandao_db`（复用 OpenClaw，端口 5432）
**管理界面**：`http://localhost:3003`（admin-frontend，Vue 开发服务器）

### 关键技术问题（已解决）
- Fastify v5 → v4 降级（@fastify/cors v9 → v8）
- pino-pretty 移除（logger: false）
- common-event RedisEventBus 重写
- common-exception AppError abstract 移除
- Zod schema → 手动验证（Fastify v4 不兼容）

### 待完成（P0）
1. **gateway 统一入口**（空壳，需写路由分发 + JWT 中间件）
2. **admin-app 前端**（admin-frontend 3003 为开发模式，生产需编译）
3. **karma 高 restart 数**（853次/小时，需排查）

### 项目文件
- 代码：`/home/ai/projects/tiandao-system/`
- PM2：`ecosystem.all.json`（已清理）
- 架构：`TIANDAO-MODULE-LOGIC-v13.0.md`
- 设计：`TIANDAO-SYSTEM-DESIGN-v1.7.md`

---

## 🤖 Hermes Agent 研究与融合计划（2026-04-12）

### 研究报告
- **Hermes 深度分析**：`memory/HERMES-ANALYSIS-REPORT.md`
- **融合可行性报告**：`memory/OPENCLAW-HERMES-FUSION-REPORT.md`
- **Phase 0 状态**：`memory/HERMES-PHASE0-STATUS.md`

### 核心结论
- **推荐方案**：方案A（串行分工）+ C元素（Memory Provider Plugin）
- **架构**：玄枢唯一入口 → Hermes 隐藏执行引擎 → OpenClaw 记忆基础设施
- **6大危险全部有解**（人格冲突/记忆分裂/资源竞争/Skills冲突/安全冲突/体验碎片）
- **资源评估**：充足（124GB RAM，新增~2-3GB）

### Hermes 10项可借鉴设计（优先级）
| 优先级 | 借鉴项 | 工作量 |
|--------|--------|--------|
| P0 | Memory 安全扫描（security-scanner.js）| 小 |
| P0 | 危险命令审批（DANGEROUS_PATTERNS）| 小 |
| P1 | FTS5 会话搜索（conversation_messages）| 小-中 |
| P1 | Per-Platform Session Reset | 小 |
| P2 | 渐进式 Skills 加载（L0/L1/L2）| 中 |
| P3 | 双层上下文压缩（50%+85%）| 大 |

### Phase 0 任务（当前优先）
**目标**：验证 Hermes Memory Provider Plugin 能否接入 OpenClaw pgvector
**待确认执行**：
1. `git clone https://github.com/NousResearch/hermes-agent /home/ai/apps/hermes-agent`
2. 分析 `memory_provider.py` ABC 接口
3. 实现 OpenClaw provider 骨架
4. 测试 Python → pgvector 连通性（目标 < 150ms）

**注意**：每步需用户确认后执行（AGI其他模块暂缓）

### 目标追踪系统（Goal Tracker / 模块C）
- **功能**：Neo4j Goal/SubGoal/Milestone 节点追踪长期任务进度，4h cron 检查 + 漂移检测
- **当前状态**：已部署，测试目标已清理，漂移检测正常运行
- **子模块数量**：Goal×1 + SubGoal×8 + Milestone×16
- **主人需要时**：告诉我项目/任务名称，我自动创建 Goal + SubGoal + Milestone，后续自动追踪进度和漂移

### 推理模式管理器（模块F）激活方法
- 脚本：`memory-system/scripts/reasoning-pattern-manager.js`
- 激活方式：在 recall hook 或 agent 入口加入 `isReasoningTask()` 前置判断 → `findApplicablePatterns()` → `recordAttempt()`
- **当前状态**：已初始化（Neo4j schema + 5个内置模式），主对话流程未集成
- **激活条件**：主人明确授权后才能改主对话流程（属记忆系统禁区边缘）
- **快速验证**：`node memory-system/scripts/reasoning-pattern-manager.js init`

---

_最后更新：2026-04-14 06:13_

---

## 天道·系统 项目（2026-04-05）

### 项目状态
- **阶段**：方案设计完成，待进入开发
- **最终设计**：TIANDAO-SYSTEM-DESIGN-v1.7.md（角色+部门+权限）
- **微服务架构**：TIANDAO-MODULE-LOGIC-v4.0.md（11服务+2前端）
- **项目总结**：TIANDAO-PROJECT-SUMMARY.md

### 核心决策
- 昊天金阙玉皇上帝 → 主管天界
- 北极紫微大帝（新增）→ 主管人间+冥界
- 九天应元雷声普化天尊 → 雷电+天气+灾害+降雨四合一
- 11个微服务 + world-event-service（现实世界事件接入）
- 数据库驱动权限，管理员可自定义

### 已解决问题 ✅（v5.0）
1. API 熔断 → Circuit Breaker + Retry + Fallback
2. 地理查询 → 碎片化 bounding box（无需 PostGIS）
3. 映射规则 → 公式化 karma_delta = f(severity, distance, realm, karma_coefficient)
4. 批量 API → 成员地理批量查询 + karma 批量触发
5. notice 限流 → 分级过滤 + 聚合通知 + 限流

### 待解决问题
6. 缺少"直接触发现世报"规则
7. 成员位置数据来源/更新机制未定义
8. 公平性质疑（无辜平民受灾却增业障）
9. resource-service 缺少 member.realm_changed 订阅
10. 缺少多源校验机制（防天道误判）

### 文件路径
- 设计：/home/ai/.openclaw/workspace/TIANDAO-SYSTEM-DESIGN-v1.7.md
- 架构：/home/ai/.openclaw/workspace/TIANDAO-MODULE-LOGIC-v13.0.md
- 总结：/home/ai/.openclaw/workspace/TIANDAO-PROJECT-SUMMARY.md

---

## 🎙️ 远程录音系统（audio-stream）
- SOP：`SOP-AUDIO-STREAM.md`
- 手机访问：`https://192.168.31.200:18792/audio-live.html`
- PM2：`pm2 list audio-stream`
- 全流程：手机录音 → WebSocket传输 → 服务器保存.webm → ffmpeg转MP3 → Whisper转写 → LLM摘要 → 写入video_records表 → 邮件发送

## 🎥 摄像头录制系统（2026-04-06）

**OBSBOT Tiny 2 录制系统，可随时调用**

### 快速命令
```bash
# 开始录制
python3 custom-skills/camera-recorder/scripts/camera.py start

# 停止录制（自动保存+转写）
python3 custom-skills/camera-recorder/scripts/camera.py stop

# 查看状态
python3 custom-skills/camera-recorder/scripts/camera.py status

# 打开预览
python3 custom-skills/camera-recorder/scripts/camera.py open
```

### 技术参数
- 视频：H.265 (libx265)，CRF23，max 2Mbps，~540MB/h
- 音频：AAC 128kbps，OBSBOT Tiny 2 麦克风（ALSA card 2）
- 分辨率：1920×1080@30fps
- 存储：~/videos/YYYY-MM-DD_HHMMSS.mp4
- 转写：Whisper large-v3-turbo，普通话识别
- 邮件：cdlxz2017@qq.com（自动发送转写结果）
- 运动检测：每 10 秒文件增长率 < 50KB/s 持续 3 分钟 → 自动停止
- 数据库：openclaw_memory.video_records

### SOP 文档
| SOP | 路径 | 用途 |
|-----|------|------|
| 记忆系统工作流 | `SOP-MEMORY-SYSTEM.md` | **强制**：记忆系统问题必须用 Claude Opus 4-6 子程序，失败重试3次 |
| 邮件收发 | `SOP-EMAIL.md` | QQ邮箱标准收发流程 |
| 视频录制 | `SOP-VIDEO-RECORDING.md` | OBSBOT 摄像头录制系统 |

**记忆系统问题处理规则**：
- 任何 memory-system 相关问题 → 使用 `4sapi/claude-opus-4-6` 子程序处理
- 子程序失败 → 立即重试，循环最多3次
- 3次均失败 → 停止行动，向主人报告

---

## ☸ 天道·系统（TIANDAO）

### 项目状态
- **阶段**：运行稳定
- **微服务**：11个（已删除 technique-service）
- **前端**：admin-frontend（Vue，3015）
- **后端**：admin-app（3013）→ 各微服务

### 运维手册
- **路径**：`/home/ai/projects/tiandao-system/docs/TIANDAO-OPERATION-MANUAL.md`
- **CHANGELOG**：`/home/ai/projects/tiandao-system/CHANGELOG.md`

### 关键文件
- PM2 配置：`ecosystem.all.json`
- karma-service：`services/karma-service/src/routes/karma.routes.ts`
- karma 前端：`admin-frontend/src/views/karma/KarmaView.vue`
- karma schema：`services/karma-service/src/types/karma.types.ts`

### 数据库
- **tiandao_db**（3002/3004/3011）：成员/部门/天罚/新闻
- **tiandao_karma**（3007）：现世报记录/规则

### 服务端口
3002:member / 3003:admin-frontend / 3004:auth / 3005:admin-frontend / 3007:karma / 3011:worldevent / 3013:admin-app

---

## ⚠️ 安全审计忽略项（2026-04-11）

以下 OpenClaw 安全审计警告**已知悉且决定不管**：
- `allowedOrigins: *` — 仅本地/内网使用，风险可控
- `dangerouslyDisableDeviceAuth: true` — 仅内网/单设备，风险可控
- `allowInsecureAuth: true` — 仅本地测试使用

**不修复，不纠结，不重复报告。**

---

## 🤖 Hermes Agent 集成（2026-04-12）

### 名字
**别名：玄一（Xuan Yi）**
主人叫"玄一"即指 Hermes，收到即执行。

### 核心原则
**玄枢是唯一人格，玄一是隐藏执行引擎。** 玄一按需调用，不常驻（省资源）。

### 调用时机（每次对话都必须判断）

**必须调用 Hermes：**
- 代码分析：分析、设计、架构、重构、调试
- 研究调研：研究、调研、比较、评估、比较方案
- 代码生成：生成、编写、实现、开发（完整功能）
- 复杂规划：规划、优化、多步骤任务
- 深度研究：深入研究、调研报告、详细分析
- 代码审查：code review、review code、explain why

**OpenClaw 直接处理：**
- 简单查询：什么、谁、什么时候、在哪里
- 记忆存取：记住、查一下、告诉我、status
- 日常对话：问候、闲聊、天气
- 任务管理：增删改查任务、状态更新

### 调用方式

**路由模块**：`custom-skills/hermes-router/hermes-router.js`
- `shouldInvokeHermes(message)` → 返回 `{invoke: bool, score: number}`
- `invokeHermes(prompt)` → 执行 Hermes CLI，返回结果
- `route(message)` → 判断 handler

**直接调用**（主人明确要求）：
```javascript
const { invokeHermes } = require('custom-skills/hermes-router/hermes-router.js');
const result = invokeHermes("分析这个问题");
```

**命令行**（测试用）：
```bash
cd /home/ai/apps/hermes-agent && source ~/.hermes/.env && python3 -m hermes_cli --print --prompt "你的问题"
```

### Hermes 工具（7个）

| 工具 | 功能 | 来源 |
|------|------|------|
| recall_memories | 向量语义搜索 | OpenClaw pgvector |
| search_memories | 全文检索 | PostgreSQL |
| write_memory | 写入记忆 | PostgreSQL |
| get_recall_stats | 记忆统计 | PostgreSQL |
| graph_query | Graphify 代码图谱 | 79k 节点 |
| neo4j_query | 关系推理查询 | Neo4j 180万节点 |
| write_procedural_memory | 程序记忆 | PostgreSQL + Neo4j |

### 安全网关
DANGEROUS_PATTERNS 检测：rm -rf、DROP TABLE、shutdown 等危险命令拦截。

### 项目路径
- Hermes 源码：`/home/ai/apps/hermes-agent/`
- Plugin：`/home/ai/apps/hermes-agent/plugins/memory/openclaw/`
- Router：`/home/ai/.openclaw/workspace/custom-skills/hermes-router/`
- PM2 Server：`/home/ai/projects/hermes-server/`（持久化实现中）

### 状态
- Phase 1 ✅：基础集成完成
- Phase 2 ✅：Graphify + Neo4j + 安全网关
- Phase 3 ✅：生产验证通过
- 持久化 + 预热上下文：实现中

---

## ⚠️ 铁律（绝对禁止）

### bge-m3:latest 永久驻留内存 — 禁止任何操作

**规则**：`bge-m3:latest` 模型文件、Ollama 配置、PM2 保活进程，**严禁任何删除、移动、重装、修改操作**。

**当前配置**：
- PM2 进程：`bge-m3-keepalive`（ID 19），每 30 秒调用一次 `keep_alive: -1`
- 脚本路径：`/home/ai/.openclaw/workspace/scripts/keepalive-bge-m3.js`
- 触发方式：`Ollama POST /api/embeddings`，参数 `keep_alive: -1`
- Crontab：**已移除**（改用 PM2 持久进程）

**绝对禁止**：
- ❌ 删除 `keepalive-bge-m3.js`
- ❌ 删除 `bge-m3-keepalive` PM2 进程
- ❌ `ollama rm bge-m3:latest`
- ❌ 修改 `keep_alive` 参数为其他值
- ❌ 重启后不重新启动保活进程

**违反视为最高级事故，立即恢复。**

_最后更新：2026-04-18 10:08_

