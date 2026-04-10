# Workspace 核心文件重新规划方案

> 制定日期：2026-04-10
> 状态：已确认方案，等待用户同意后执行
> 制定者：MiniMax-M2.7 + Claude Opus 4-6 联合分析

---

## 核心问题

**每次 session 注入 ~5,150 tokens，其中大部分是无效内容：**
- 6/7 文件是未改的默认模板
- MEMORY.md（~12,000字符）混杂了不该每次注入的内容
- AGENTS.md 要求"手动读文件"，但这些文件已被 OpenClaw 自动注入，等于读了两次

---

## 各文件处置方案

### MEMORY.md（最严重）

| | 当前 | 目标 |
|---|---|---|
| 大小 | ~12,000 字符 | < 3,000 字符 |
| Token/次 | ~3,000 | ~750 |

**只保留：**
- 重要原则（禁区、SOP规范）
- 项目索引（名称 + 一句话状态 + 文档路径）
- 系统配置摘要（端口/版本，**不含密码**）

**迁出到 `memory/` 目录：**
- 数据库密码/API Key → 严禁写入，改用环境变量
- 记忆系统完整数据流 → `memory/memory-system-architecture.md`
- PM2 进程列表 → 按需 `pm2 list`
- 天道系统详细架构 → `projects/tiandao-system/docs/`
- 摄像头/录音参数 → `memory/hardware-systems.md`

---

### AGENTS.md

| | 当前 | 目标 |
|---|---|---|
| 大小 | ~5,500 字符 | ~600 字符 |
| Token/次 | ~1,375 | ~150 |

**删除：**
- Session Startup 里"手动读 SOUL.md/USER.md"（已自动注入）
- Heartbeat 完整指南（HEARTBEAT.md 已独立）
- Memory Maintenance 详细流程
- 与 SOUL.md 重复的 Boundaries 说明

**只保留：**
- 记忆规范（写文件，不做心理笔记）
- 安全红线（不外泄、破坏性先问）
- 外部操作规则（发消息/邮件先问）
- 群聊行为（一句话总结）
- 工具使用约定

---

### SOUL.md

| | 当前 | 目标 |
|---|---|---|
| 大小 | ~1,200 字符 | ~400 字符 |
| 问题 | 默认模板 + 与AGENTS.md重复 | 纯人格定义 |

**删除：** Continuity 段落（AGENTS.md 已定义）

**补充：** 中文为主的技术语气风格；直接、有主见、不废话的行为准则

---

### IDENTITY.md

空白模板 → 填入名字/风格/emoji（5分钟）

---

### USER.md

空白 → 从 MEMORY.md 提取用户信息重建

---

### HEARTBEAT.md

- 不用 heartbeat → 删除文件
- 用 → 写2-3条实际检查任务，不要注释模板

---

### TOOLS.md

- 删除示例模板
- 填入实际配置（端口/服务/数据库/邮件）
- **密码和 API Key 不写入此文件**

---

## 节省估算

| | 优化前 | 优化后 |
|---|---|---|
| 每次 session token | ~5,150 | ~1,280 |
| **节省** | — | **~3,870 tokens（75%）** |

---

## 额外建议

1. 启用 `heartbeat.isolatedSession: true` — 心跳独立 session
2. `memory_search` 已有 embedding provider，确保 `memory/` 文档可按需检索
3. 数据库密码/API Key 移出所有注入文件，改用环境变量

---

## 待用户确认后执行

用户要求先出方案，确认后再操作，不擅自修改任何文件。
