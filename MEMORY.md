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

## 🗺️ 能力索引总表

> 主人说一句话，我查下表就知道该读哪个文件。

### 系统 → `capability-graph/systems/`

gateway→openclaw-gateway.md | 主脑/记忆系统→memory-system.md | 副脑/Thread→problem-thread.md | 安全/防火墙→security-system.md | 民宿/lingyi→lingyi-cms.md | 天道系统→tiandao-system.md | Neo4j→neo4j.md

### 工具 → `capability-graph/tools/`

clawteam/团队→clawteam.md | 数据库/PG→postgresql.md | PM2→pm2.md | 模型/LLM→llm-routing.md | Redis→redis.md | Docker→docker.md | 凭证→memory/API-KEY-MANAGEMENT.md | 审计→memory/AUDIT-SYSTEM-DESIGN.md

### 技能 → `capability-graph/skills/`

邮件→skills/custom/send-email.md | 语音/TTS→skills/custom/voice-tools.md | 摄像头→skills/custom/camera-recorder.md | 记忆追溯→skills/custom/three-layer-memory-lookup.md | 追溯链→trace-chain-audit.js | 召回监控→recall-live-monitor.js | 自学习→learning-engine-monitor.js | Hermes→skills/custom/hermes-router.md | 技术知识库→skills/custom/tech-knowledge.md | graph-linker→skills/custom/graph-linker-monitor.md | 工作区skill→skills/workspace/workspace-skills.md | 系统skill→skills/builtin/builtin-index.md

### 框架 → `capability-graph/`

SOP/卓越框架→frameworks/excellence-sop.md | 危险点→risk-patterns/model-unavailability.md | 避坑→pitfalls/design-lessons.md | 总导航→capability-graph/NAVIGATION.md

---

## 📧 邮件收发

- **Skill**：`custom-skills/send-email/`（QQ邮箱，收发/多附件/HTML/纯文本，天道AI落款）
- **配置**：cdlxz2017@qq.com / SMTP: smtp.qq.com:587 / IMAP: imap.qq.com:993

---

## 🔧 技术 SOP

| SOP | 说明 |
|-----|------|
| `SOP-GATEWAY-RESTART.md` | Gateway 重启标准流程 |
| `SOP-CLEAN-SYSTEM.md` | 系统清洁与软件安装规范 |
| `SOP-MEMORY-SYSTEM.md` | 记忆系统问题必须用 Claude Opus 4-6 子程序，失败重试3次 |
| `SOP-EMAIL.md` | QQ邮箱标准收发流程 |
| `SOP-VIDEO-RECORDING.md` | OBSBOT 摄像头录制系统 |

### 目录结构规范

```
~/ai/
├── projects/    # 自主开发项目（Git 托管）
├── apps/        # 第三方应用/工具
├── services/    # 长期运行服务（PM2/systemd/Docker）
├── scripts/     # 运维工具脚本
├── backups/     # 数据备份
├── logs/        # 日志输出
├── venvs/       # Python 虚拟环境
└── .config/     # 配置文件 Git 仓库 ✅ 已初始化
```

---

## 🔒 系统安全档案

| 软件 | 版本 | 纳入日期 |
|------|------|----------|
| OSSEC HIDS | 4.0.0 | 2026-04-10 |
| fail2ban | Ubuntu 0.7.10-2 | 2026-04-10 |
| UFW | 0.36.2 | 2026-04-10 |

**档案路径**：`~/.config/security/`（每次安装安全软件后必须将配置复制到此并 Git 提交）

---

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
| OpenClaw-Admin | 3031/3030 | `/home/ai/projects/OpenClaw-Admin` | OpenClaw Web 管理界面 |
| lingyi-cms（前后端） | 3001/8001 | Docker 容器 | 靈一民宿综合管理系统 |
| tiandao-admin-frontend | 3003/3005 | `/home/ai/projects/tiandao-system/admin-frontend` | 天道·系统管理后台（Vue） |

### LLM 配置

- **提取模型**：Qwen-max（DashScope API）
- **向量模型**：BGE-m3（Ollama localhost:11434）
- **API Key**：sk-50c8c0524a8244ffbdcb9131545dfa56

---

## ☸ 天道·系统

**阶段**：运行稳定

### 服务端口

3002:member / 3003:admin-frontend / 3004:auth / 3005:admin-frontend(2) / 3007:karma / 3011:worldevent / 3013:admin-app

### 数据库

- **tiandao_db**（3002/3004/3011）：成员/部门/天罚/新闻
- **tiandao_krama**（3007）：现世报记录/规则

### 关键路径

- 代码：`/home/ai/projects/tiandao-system/`
- 运维手册：`docs/TIANDAO-OPERATION-MANUAL.md`
- PM2：`ecosystem.all.json`
- karma-service：`services/karma-service/src/routes/karma.routes.ts`
- 设计：`TIANDAO-SYSTEM-DESIGN-v1.7.md` / 架构：`TIANDAO-MODULE-LOGIC-v13.0.md`

---

## 📦 灵一民宿（lingyi-cms）

- **Git仓库**：`projects/lingyi-cms/`（本地）
- **修改日志**：`projects/lingyi-cms/CHANGELOG.md`
- **完整梳理**：`projects/lingyi-cms/SYSTEM-REVIEW.md`
- **数据库**：linyi_db / linyi_user / E4jZRKt3xN8qLp2v / lingyi-db:5432
- **核心修改**：`backend/bills.py`（次卡/月包营收）、`backend/reports.py`（报表营收）

---

## 🤖 Hermes（玄一）

**别名**：玄一（Xuan Yi）

**核心原则**：玄枢是唯一人格，玄一是隐藏执行引擎，按需调用，不常驻。

**调用时机**：代码分析/研究调研/代码生成/复杂规划/深度研究/代码审查 → 必须调用 Hermes

**路由模块**：`custom-skills/hermes-router/hermes-router.js`

**7个工具**：recall_memories / search_memories / write_memory / get_recall_stats / graph_query / neo4j_query / write_procedural_memory

**项目路径**：`/home/ai/apps/hermes-agent/` | PM2 Server：`/home/ai/projects/hermes-server/`

---

## 🚀 落地页生成

- **项目**：`~/ai/projects/benchmark-skill-ui-ux-pro-max/`
- **脚本**：`generate-openai.ts`（OpenAI SDK 版本）
- **模型**：阿里云百炼 Qwen3.6-Plus（按量付费）
- **验证**：ai-chatbot 页面生成成功（27350字符）

---

## 🎙️ 远程录音 + 🎥 摄像头

**录音**：手机访问 `https://192.168.31.200:18792/audio-live.html` | PM2: `audio-stream`

**摄像头**：OBSBOT Tiny 2，命令：`python3 custom-skills/camera-recorder/scripts/camera.py start/stop/status/open`

---

## 子任务超时重试规则（2026-04-23）

**子任务（sessions_spawn）超时不返回 → 自动重试，最多 5 次。**

---

## ⚠️ 重要原则

### Session 结束前必须更新任务系统（2026-04-06）
每次结束 session 或用户说新建 session 前，必须先更新任务系统（task-crud.js）。新建/更新/完成任务，确保下次 session 启动时能看到最新进度。

### 记忆系统禁区原则（2026-04-05）
**记忆系统（memory-system）是绝对禁区。** 任何涉及表结构/extractor/recall/stream/PM2 进程的操作，必须用户明确授权才能执行。tech-knowledge 是在记忆系统外部独立建立的，不属于禁区范围。

### 古籍知识库与记忆系统完全无关
`memories_legacy`（62.7万条古籍摘要）与记忆系统**无任何关系**。Neo4j 中的 Person/Work/Place 等节点与记忆系统**完全隔离**。

---

## ⚠️ 铁律（绝对禁止）

### bge-m3:latest 永久驻留内存 — 禁止任何操作

**PM2 进程**：`bge-m3-keepalive`（ID 19），每 30 秒调用 `keep_alive: -1`
**脚本**：`/home/ai/.openclaw/workspace/scripts/keepalive-bge-m3.js`

**绝对禁止**：删除 bge-m3:latest / 删除 keepalive 进程 / 修改 keep_alive 参数 / 重启后不重新启动保活进程

---

### 主脑保护铁律（2026-04-21 铭刻）

**没有主人灵须子（姚旭）的明确确认，任何操作都不能触碰主脑任何组件。**

**主脑范围**：
- `/home/ai/.openclaw/workspace/memory-system/` + `memory-system-rebuild/`
- PostgreSQL: openclaw_memory 数据库所有表
- Redis: memory:messages / graph:sync:events Stream
- PM2: graph-linker / session-summary-extractor 等进程
- BGE-m3 Ollama 向量模型
- **Docker 卷/容器/镜像**：openclaw-postgres / openclaw-redis / openclaw-neo4j 相关所有组件

**绝对禁止**（无需确认，直接拒绝）：
- `docker rm/rmi/volume rm` 作用于主脑相关
- `docker-compose down/up -d` 重建主脑服务
- OpenClaw 内部 Docker 管理系统的任何自动重建操作
- 修改容器镜像版本（如 postgres:16-alpine → pgvector/pgvector:pg16）除非主人明确授权

**⚠️ 2026-04-21 事故教训**：Docker 容器重建时若镜像/卷挂载配置不一致，数据会立即清空且不可恢复。

---

_最后更新：2026-04-23_
