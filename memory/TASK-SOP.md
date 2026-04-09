# 任务管理系统技术手册 v3.0

> 建立日期：2026-04-06
> 版本：v3.0（三源合一刷新）
> 评审：Opus + DeepSeek 评审修订

---

## 1. 背景与目标

### 1.1 问题

每天的 `memory/YYYY-MM-DD.md` 混杂已完成/进行中/待处理任务，新 session 启动时翻出过时内容，分不清真实待办。

### 1.2 目标

新 session 启动时只看到**真实待办**，每个任务自带三源上下文：当前系统状态 + 历史记忆 + 任务元数据。

### 1.3 约束

- ❌ 不修改现有记忆系统表结构（memories / personal_memories / conversation_messages 等）
- ❌ 不修改 extractor 进程
- ✅ 复用 `openclaw_memory` 数据库基础设施
- ✅ 复用 pgvector 向量检索能力
- ✅ 复用 BGE-m3 嵌入模型

---

## 2. 核心原则

### 2.1 三源合一

每个任务的上下文来自三个来源，缺一不可：

```
┌─────────────────┐
│  源1: 系统探查   │  PM2状态 / Health / Error日志 / 进程数
└────────┬────────┘
         │
┌────────┴────────┐
│  源2: 记忆系统   │  entity/attribute/value 结构化记录
└────────┬────────┘
         │
┌────────┴────────┐
│  源3: 任务元数据  │  blocked_reason / waiting_for / verify_cmd
└────────┬────────┘
         │
         ▼
    任务上下文
```

### 2.2 真实优先原则

系统探查 > 记忆系统记录 > 任务元数据

当三者矛盾时，以系统探查的真实状态为准。

### 2.3 文档一体化原则

所有任务相关文档统一管理：

```
任务系统（task_status 表）
    │
    ├── 任务上下文 ← task-refresh-context.cjs（三源刷新）
    ├── 迭代方案   ← 设计文档在 projects/，任务关联 project_key
    ├── 操作手册   ← 任务系统自身 SOP
    └── 历史归档   ← task_completed_history 表
```

---

## 3. 系统架构

### 3.1 数据库结构

```
PostgreSQL (openclaw_memory)
├── task_status              ← 任务主表
├── task_memories            ← 任务-记忆反馈表（刷新时写入，完成/取消时更新状态）
└── task_completed_history  ← 历史归档表

现有记忆系统（只读，不修改）：
├── memories                 ← 记忆系统主表（entity/attribute/value）
├── personal_memories       ← 个人记忆
└── conversation_messages   ← 原始对话
```

### 3.2 核心脚本

```
memory-system/scripts/
├── task-crud.js             ← 任务增删改查（基础）
├── task-recall.js           ← 记忆上下文查询（记忆系统）
├── task-refresh-context.cjs ← 三源合一刷新（核心）
└── task-cleanup-old.js     ← 历史任务归档
```

### 3.3 文件结构

```
memory/
├── TASK-SOP.md              ← 本手册（任务管理系统规范）
├── ACTIVE_TASKS.md          ← 备份（可选，数据库为主）
└── completed/              ← 归档文件（可选，数据库为主）

projects/
├── tiandao-system/
│   ├── SPEC.md              ← 需求规格
│   ├── TIANDAO-MODULE-LOGIC-v13.0.md ← 迭代方案
│   └── docs/logs/          ← 开发日志
└── lingyi-crm/
    └── SYSTEM-REVIEW.md    ← 系统梳理文档
```

---

## 4. 数据格式

### 4.1 task_status 表核心字段

| 字段 | 说明 |
|------|------|
| task_key | 唯一标识，格式 TASK-YYYYMMDD-NNN |
| task_name | 任务名称 |
| status | backlog / in_progress / blocked / waiting_confirm / done / cancelled |
| priority | P0 / P1 / P2 |
| context_path | 关联项目路径（用于系统探查 + 记忆系统查询） |
| memory_keywords | 记忆系统查询关键词 |
| memory_context | 三源合一刷新后的上下文 |
| blocked_reason | 阻塞原因 |
| waiting_for | 等待什么 |
| verify_cmd | 验证命令 |
| depends_on | 依赖任务 |
| created_at | 创建时间 |
| updated_at | 更新时间 |

### 4.2 task_memories 表（任务-记忆反馈）

| 字段 | 说明 |
|------|------|
| task_key | 关联任务 |
| memory_id | 关联的具体记忆 ID（memories 表） |
| task_outcome | pending / done / cancelled |
| created_at | 何时写入 |
| updated_at | 最后更新时间 |

**用途**：静默记录任务与记忆的关联，为未来记忆质量分析提供反馈数据。
刷新时写入（pending），任务完成时改为 done，取消时改为 cancelled。

### 4.3 memory_context 格式

```
【当前系统】
· [系统] PM2: online | 重启: 853次 | 运行: 447分钟
· [系统] Health: ✅ 正常
· [系统] 最新错误: karma_batch_job 表不存在

【历史记忆】
· 重启原因: 业力触发逻辑循环调用
· API端点: POST /karma/trigger, POST /karma/batch-trigger...

【任务状态】
· 阻塞: 业力触发逻辑循环调用
· 等待: PM2日志定位，检查业务逻辑
· 验证: pm2 monit
· 依赖: 无
```

---

## 5. Session 启动流程

### 5.1 标准流程

```
1. 读 SOUL.md
2. 读 USER.md
3. 查数据库: SELECT * FROM task_status WHERE status NOT IN ('done','cancelled')
4. 每条任务展示 memory_context（三源已刷新）
5. 读 MEMORY.md
6. 输出：任务列表 + 三源上下文
```

### 5.2 启动输出示例

```
当前有 4 个活跃任务：

🔴 [P0] TASK-20260405-001 | gateway 统一入口源码补全
  【当前系统】
  · [系统] Health: ⚠️ 路由不存在 (404)
  【历史记忆】
  · 状态: 空壳，需要填源码
  · 问题: 上次因fastify版本问题卡住
  【任务状态】
  · 验证: curl localhost:3011/health

🟡 [P1] TASK-20260405-002 | admin-app 前端界面开发
  【历史记忆】
  · 技术栈: TypeScript + Fastify + Prisma + PostgreSQL
  · 待办: 安装依赖/prisma generate/实现客户端
  【任务状态】
  · 依赖: TASK-20260405-001（gateway完成后）
```

---

## 6. 任务生命周期

### 6.1 状态机

```
backlog → in_progress → waiting_confirm → done
    ↓           ↓              ↓
  blocked   （任意状态可）→ cancelled
```

| 状态 | 含义 | 触发 |
|------|------|------|
| backlog | 待处理 | 新建任务 |
| in_progress | 进行中 | 开始执行 |
| blocked | 阻塞 | 遇阻碍 |
| waiting_confirm | 等待确认 | AI自检通过 |
| done | 已完成 | 用户确认 |
| cancelled | 已取消 | 用户取消 |

### 6.2 关键规则

- **新建任务**：添加到 task_status，写入 context_path + memory_keywords
- **开始执行**：更新状态为 in_progress
- **阻塞时**：写 blocked_reason + waiting_for
- **AI 自检**：执行 verify_cmd，全部通过 → waiting_confirm
- **用户确认**：done + 写 done_summary → 归档到 task_completed_history
- **取消**：cancelled + cancelled_reason → 不归档

### 6.3 刷新时机

| 时机 | 动作 |
|------|------|
| Session 启动前 | 对所有活跃任务执行三源刷新 |
| 任务状态变更时 | 对该任务执行三源刷新 |
| 用户要求刷新 | 对指定任务执行三源刷新 |
| 每小时 | cron 自动刷新所有活跃任务 |

---

## 7. 三源合一刷新详解

### 7.1 源1：系统状态探查

```javascript
// 对每个任务，根据 context_path 映射到 PM2 进程
const serviceMap = {
  'tiandao-system/services/karma-service': { name: 'tiandao-karma', port: 3007, healthPath: '/karma/health' },
  'tiandao-system/services/technique-service': { name: 'tiandao-technique', port: 3008, healthPath: '/health' },
  // ...
};

// 探查内容：
// 1. PM2 状态、重启次数、运行时间
// 2. Health endpoint (curl)
// 3. 最新错误日志（pm2 logs）
```

### 7.2 源2：记忆系统查询

```sql
-- 根据 context_path 推断 entity，精确查询
SELECT entity, attribute, value, updated_at
FROM memories
WHERE is_active = true
  AND category != 'ancient-books'
  AND entity = 'karma-service'  -- 从路径推断
ORDER BY updated_at DESC
LIMIT 12
```

**注意**：
- ❌ 不查 conversation_messages（原始对话太散乱）
- ✅ 只查 memories 表的 entity/attribute/value（结构化记忆）
- ✅ 不修改任何记忆系统表

### 7.3 源3：任务元数据

直接读 task_status 表已有字段：
- blocked_reason
- waiting_for
- verify_cmd
- depends_on

### 7.4 综合输出

按优先级拼接：
1. 【当前系统】（最优先）
2. 【历史记忆】
3. 【任务状态】

---

## 8. 任务与项目文档的关联

### 8.1 关联方式

每个任务通过 `context_path` 关联项目，项目的迭代方案、设计文档独立存放：

```
TASK-20260405-001
  context_path: /projects/tiandao-system/services/gateway/
  memory_keywords: "gateway 路由分发 JWT"
  
项目文档（独立存放）：
  projects/tiandao-system/TIANDAO-MODULE-LOGIC-v13.0.md
  projects/tiandao-system/SPEC.md
  projects/tiandao-system/docs/logs/2026-04-05.md
```

### 8.2 迭代方案归属

| 项目 | 迭代方案 | 位置 |
|------|---------|------|
| TianDAO 系统 | TIANDAO-MODULE-LOGIC-v*.md | projects/tiandao-system/ |
| lingyi-crm | SYSTEM-REVIEW.md | projects/lingyi-crm/ |
| 记忆系统 | memory-system/ 目录 | projects/memory-system/ |
| TianDAO admin-app | admin/ | projects/tiandao-system/admin/ |

### 8.3 文档更新规则

- 迭代方案文档由 AI 在设计/开发过程中更新
- 任务系统只记录"当前在做什么"和"上下文是什么"
- 不重复存储设计决策（引用文档路径即可）

---

## 9. 文档管理规则

### 9.1 所有文档统一在任务系统管理

```
任务系统是所有任务相关文档的单一入口
    │
    ├── 任务清单        ← task_status 表（主表）
    ├── 任务上下文      ← memory_context（三源刷新）
    ├── 迭代方案       ← projects/*/TIANDAO-MODULE-LOGIC-v*.md
    ├── 开发手册       ← projects/*/docs/
    ├── 操作 SOP       ← memory/TASK-SOP.md
    └── 历史归档       ← task_completed_history 表
```

### 9.2 更新时机

| 文档 | 更新时机 |
|------|---------|
| task_status | 任务创建/状态变更/三源刷新 |
| memory/TASK-SOP.md | 系统设计变更时 |
| 迭代方案文档 | 设计评审后 |
| 开发日志 | 每天开发结束时 |
| 归档记录 | 任务完成时 |

---

## 10. AGENTS.md 更新

```markdown
## Session Startup

1. 读 `SOUL.md` — AI人格
2. 读 `USER.md` — 用户信息
3. 查数据库获取活跃任务：
   ```sql
   SELECT task_key, task_name, status, priority, memory_context
   FROM task_status
   WHERE status NOT IN ('done', 'cancelled')
   ORDER BY CASE priority WHEN 'P0' THEN 1 WHEN 'P1' THEN 2 ELSE 3 END
   ```
4. 展示每条任务的 memory_context（三源上下文）
5. 读 `MEMORY.md`

## 任务管理

- 所有活跃任务在 `task_status` 表
- 使用 `task-refresh-context.cjs` 刷新任务上下文
- 使用 `task-crud.js` 管理任务（创建/更新/完成/取消）
- 状态机：backlog → in_progress → blocked/waiting_confirm → done
- 任务上下文 = 当前系统状态 + 历史记忆 + 任务元数据
- 迭代方案文档在各项目目录下，任务系统引用路径
```

---

## 11. 实施步骤

### Phase 1 ✅（已完成）
- [x] task-crud.js 基础 CRUD
- [x] task-recall.js 记忆查询
- [x] task-refresh-context.cjs 三源刷新
- [x] 数据库迁移
- [x] 历史任务清理归档
- [x] AGENTS.md 更新

### Phase 2 ✅（完成）
- [x] cron 定时刷新（每小时一次，仅活跃任务）
- [x] AGENTS.md Session 启动流程更新（直接读缓存，不再启动时刷新）
- [x] task-refresh-context.cjs 系统探查完善（PM2 + Health + Error日志）

### Phase 3 ✅（完成）
- [x] task-context-refresh cron（每小时自动刷新活跃任务）
- [x] task-blocked-check cron（每天9点检查阻塞超3天，写入 HEARTBEAT.md）
- [x] 任务依赖可视化（`node task-crud.js tree` 命令）
- [x] Session 启动优化（直接读 memory_context 缓存，不跑刷新脚本）
- [x] task_memories 反馈机制（刷新时记录 memory_id，完成/取消时更新 task_outcome）

### Phase 4 ✅（完成）
- [x] design_doc 字段（手动指定 + 自动推断双模式）
- [x] tree 命令显示设计文档
- [x] 依赖树根节点/子节点逻辑修复
- [x] task-refresh-context.cjs 刷新时自动推断 design_doc

---

## 12. 命令速查

```bash
# 刷新所有任务上下文
node memory-system/scripts/task-refresh-context.cjs

# 刷新单个任务
node memory-system/scripts/task-refresh-context.cjs TASK-20260405-001

# 列出活跃任务
node memory-system/scripts/task-crud.js list

# 完成任务
node memory-system/scripts/task-crud.js done TASK-20260405-001 --summary "结论"

# 取消任务
node memory-system/scripts/task-crud.js cancel TASK-20260405-001 --reason "不要了"

# 查询记忆上下文
node memory-system/scripts/task-recall.js --project karma-service
```

---

## 13. 数据库速查

```sql
-- 活跃任务
SELECT task_key, task_name, status, priority, memory_context
FROM task_status
WHERE status NOT IN ('done', 'cancelled')
ORDER BY CASE priority WHEN 'P0' THEN 1 WHEN 'P1' THEN 2 ELSE 3 END;

-- 历史归档
SELECT * FROM task_completed_history ORDER BY completed_at DESC;

-- 任务详情
SELECT * FROM task_status WHERE task_key = 'TASK-20260405-001';
```

---

_最后更新：2026-04-06_
