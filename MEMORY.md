# MEMORY.md - 长期记忆

> Curated memory - distilled from daily notes

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

### 数据流（2026-04-09 确认）

```
对话消息 → OpenClaw Gateway
              ├─→ hook: session-capture-hook → PostgreSQL conversation_messages ✅
              │                                      ↓
              │                           30秒轮询: session-file-extractor-loop.js (PM2 #0)
              │                                      ↓
              │                           extractor-file-based.js
              │                           └─→ memories (LLM提取) ✅ 正常
              │
              ├─→ summary-extractor (PM2 #2) → memory_summaries (实时产出)
              │                                      ↓
              │               ┌─→ graph:sync:events → graph-linker (Memory_tenantId 节点)
              │               │
              │               └─→ 实时同步 → Neo4j PersonalMemory (实时写入) ✅
              │                                       ↓
              │                           cron增量同步 (每5分钟兜底) ✅
              │
              └─→ graph-linker.js (PM2 #1) → Redis Stream: graph:sync:events → Neo4j ✅

personal_memories: 3927条 (4月3日后停止写入，用于 backfill 回填)
memory_summaries: 318条+ (4月9日起 summary-extractor 实时产出)
Neo4j PersonalMemory: 927节点, 318有content (2026-04-09 20:06)
```

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
| #2 | summary-extractor | `summary-extractor-loop.js` | ✅ 正常，含 Neo4j 实时同步 |
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
| `personal_memories` | 3927 条 | 原始内容记忆（4月3日后停止写入）|
| `memory_summaries` | 318 条+ | summary-extractor 实时产出（4月9日起）|
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

_最后更新：2026-04-06 01:20_

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
`~/workspace/SOP-VIDEO-RECORDING.md`

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

