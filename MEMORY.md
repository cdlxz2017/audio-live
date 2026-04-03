# MEMORY.md - 长期记忆

> Curated memory - distilled from daily notes

---

## 🔧 技术 SOP

### Gateway 重启 SOP

**文件位置**：`SOP-GATEWAY-RESTART.md`

**核心流程**：阅读手册 → 备份 → 语法检查 → edit 修改 → 验证 → 重启

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

### LLM 配置
- **提取模型**：Qwen-max（DashScope API）
- **向量模型**：BGE-m3（Ollama localhost:11434）
- **API Key**：sk-50c8c0524a8244ffbdcb9131545dfa56

---

## ⚠️ 重要原则：古籍知识库与记忆系统完全无关

- `memories_legacy` 中的古籍知识（62.3 万条古籍摘要）与记忆系统**无任何关系**
- Neo4j 中的 Person/Work/Place 等 170 万知识库节点与记忆系统**完全隔离**
- 处理任何数据时，**未明确告知则不涉及古籍/知识库**

---

## 🎯 记忆系统项目

### 项目状态

**版本**：v4.1
**阶段**：已部署运行
**评分**：9/10

### 项目文件

- `memory-system/MEMORY-SYSTEM-DESIGN.md` - 完整方案
- `memory-system/SESSION-STORAGE-PLAN.md` - 会话存储改造方案
- `memory-system/TASKS.md` - 开发任务清单

### 核心模块

1. **session-reader** - 安全读取 JSONL 会话文件（断点续传）
2. **conversation-archiver** - 原始对话存档到 conversation_messages 表
3. **extractor-file-based** - Qwen-max 提取结构化记忆
4. **graph-linker** - Neo4j 图关联同步（systemd 服务）
5. **session-recall** - 召回引擎（向量+意图分类+动态权重）
6. **session-context-loader** - 新 session 加载上一 session 对话上下文

### 技术栈

| 组件 | 技术 |
|------|------|
| 消息队列 | Redis Streams |
| 主数据库 | PostgreSQL + pgvector |
| 图数据库 | Neo4j |
| 嵌入模型 | BGE-m3 (Ollama) |
| LLM | Qwen-max (DashScope) |

---

## 📊 数据资产说明

### memories_legacy 表
- **数量**：62.7 万条
- **古籍部分**：62.3 万条（`category = 'ancient-books'`）
- **用户记忆部分**：3631 条（系统事件日志，非真实个人记忆）
- **处理原则**：❌ 禁止迁移/回填到记忆系统，除非用户明确要求

### memories 表（v4.1）
- **用途**：用户结构化记忆（entity/attribute/value/type）
- **当前状态**：已有 1 条真实记忆

### personal_memories 表 ✅ 已回填到 Neo4j
- **数量**：3776 条
- **有价值部分**：463 条（decision/plan/pending/fact/technical 等）
- **性质**：用户真实个人记忆（决策、计划、待办、技术笔记等）
- **回填状态**：✅ 已同步到 Neo4j（PersonalMemory 节点 + PersonalEntity 关系）
- **tech-doc 部分**：3317 条技术文档摘要，**不**同步（无个人记忆价值）
- **Neo4j label**：`PersonalMemory` + `PersonalEntity` + `RECORDS` 关系

---

## 📝 用户信息

- **时区**：Asia/Shanghai (GMT+8)
- **偏好**：严格遵守 SOP，使用中文交流

---

_最后更新：2026-04-04 02:48_
