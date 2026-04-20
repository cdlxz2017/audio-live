# Session 新建时自动 Recall 机制对比分析报告

> 日期：2026-04-18 | 执行人：玄枢

---

## 一、OpenClaw 官方 Session Recall 机制

OpenClaw 在每次 `/new` 或 `/reset` 新建 session 时，通过**两层机制**实现自动上下文召回：

### 层一：session-memory hook（会话存档）

**文件**：`dist/bundled/session-memory/HOOK.md`

**触发时机**：`command:new` / `command:reset`

**行为**：
1. 找到前一个 session 的 transcript
2. 提取最后 N 条消息（默认 15 条，可配置）
3. **用 LLM 生成描述性文件名 slug**（如 `2026-01-16-api-design.md`）
4. 将内容写入 `<workspace>/memory/YYYY-MM-DD-slug.md`

**输出格式**：
```markdown
# Session: 2026-01-16 14:30:00 UTC
- **Session Key**: agent:main:main
- **Session ID**: abc123def456
- **Source**: telegram
[对话内容...]
```

### 层二：startupContext prelude（新 session 启动预加载）

**配置路径**：`agents.defaults.startupContext`

**触发时机**：每次 bare `/new` 或 `/reset` 的第一轮 prompt

**行为**：在模型收到第一条消息**之前**，Runtime 自动将近期每日记忆文件预加载到 prompt 中。

| 参数 | 默认值 | 含义 |
|------|--------|------|
| `enabled` | `true` | 是否启用 prelude |
| `dailyMemoryDays` | `7` | 加载最近几天 |
| `maxFileBytes` | `16384` | 单文件最大字节 |
| `maxFileChars` | `1200` | 单文件最大字符数 |
| `maxTotalChars` | `2800` | 所有文件总字符上限 |

**特点**：
- 完全由 Runtime 执行，**模型自动获得**近期记忆上下文
- 是 "prelude"（序幕），在首轮 prompt 构建时就注入
- 不需要模型主动调用 recall 工具

### 完整数据流

```
/new 或 /reset
      ↓
session-memory hook 触发
      ↓
将上一 session 的最后 15 条消息
写入 memory/YYYY-MM-DD-slug.md
      ↓
新 session 启动
      ↓
startupContext prelude 生效
      ↓
Runtime 自动加载近 7 天所有 memory/YYYY-MM-DD-*.md
每个文件最多 1200 字，总共最多 2800 字
      ↓
模型在第一条消息到来前已具备近期上下文
```

---

## 二、我们当前系统的实现情况

### 已有的等效组件

| 官方机制 | 我们系统的对应实现 | 状态 |
|----------|-------------------|------|
| session-memory hook | `session-capture-hook` → 写入 `conversation_messages` 表 | ✅ 启用中 |
| session-summary-extractor | `session-summary-extractor-loop.js` PM2#2 → 提取 session 摘要 | ✅ 运行中 |
| startupContext prelude | **已隐式启用**（config 无 `startupContext` 字段，默认 true） | ✅ 理论上生效 |
| dailyMemoryDays | 由 Runtime 读取 `memory/YYYY-MM-DD-*.md` | ⚠️ 仅读取，未写入 |
| latest_summaries_cache | `latest_summaries_cache` 表（刚实现）| ✅ 刚完成 |

### 关键差距

#### 差距 1：session-memory hook 未使用

我们没有启用 OpenClaw 内置的 `session-memory` hook（写入 `memory/YYYY-MM-DD-slug.md`），而是用 `session-capture-hook` 写入 PostgreSQL 的 `conversation_messages` 表。这两者是**不同的存档路径**：

- **官方**：session 结束 → 写入 `memory/YYYY-MM-DD-slug.md`（文件系统）
- **我们**：session 结束 → 写入 `conversation_messages`（数据库）

**后果**：OpenClaw 的 `startupContext` prelude 读取的是 `memory/YYYY-MM-DD-*.md` 文件，但我们系统**从未向这些文件写入 session 内容**，所以 prelude 加载的是**旧的每日日记文件**（由人工或 session-extractor 在 session 结束后写入的摘要），而不是刚结束的 session 上下文。

#### 差距 2：dailyMemoryDays 预加载的内容不完整

`startupContext` 加载的是 `memory/YYYY-MM-DD-*.md` 文件。我们的日记文件内容来源是：
- 每日日记（`memory/YYYY-MM-DD.md`）— 人工/自动记录
- **不包含**刚结束的 session 对话摘要（session-summary-extractor 是后台异步运行的，有延迟）

所以新建 session 时，模型拿到的是**前一天或更早**的日记，而不是上一个 session 的精炼摘要。

#### 差距 3：latest_summaries_cache 与 startupContext 不衔接

我们刚实现的 `latest_summaries_cache` 表（维护最新 5 条摘要）**并不被 startupContext prelude 使用**。startupContext 只读取文件系统中的 `memory/YYYY-MM-DD-*.md`，不读 PostgreSQL 的摘要表。

#### 差距 4：文件名 slug 智能化缺失

官方 session-memory hook 使用 **LLM 生成描述性 slug**（如 `2026-01-16-api-design.md`），我们直接使用日期 slug（如 `2026-04-17.md`），无法从文件名判断 session 内容。

---

## 三、当前配置确认

从 `openclaw.json` 确认：

```json
// agents.defaults 中没有 startupContext 字段
// → 走默认值 enabled: true, dailyMemoryDays: 7, maxFileChars: 1200, maxTotalChars: 2800

// hooks.internal.entries 中没有 session-memory hook
"session-memory": { "enabled": false } // 未安装
```

---

## 四、结论与建议

### 结论

| 维度 | OpenClaw 官方设计 | 我们系统 | 差距 |
|------|------------------|---------|------|
| Session 存档 | `memory/YYYY-MM-DD-slug.md` | `conversation_messages`（数据库）| ⚠️ 路径不同 |
| Startup Prelude | 自动加载近 7 天 `memory/*.md` | 理论生效，但文件内容非最新 session | ⚠️ 内容陈旧 |
| Session 摘要异步提取 | 无（直接存档） | `session-summary-extractor` 异步运行 | ✅ 已实现 |
| 摘要预热新 session | 无直接机制 | `latest_summaries_cache` 表（但 prelude 不读它）| ⚠️ 未衔接 |
| 文件命名 | LLM 生成描述性 slug | 日期 slug | ⚠️ 可改进 |

**核心问题**：我们的 session 存档（conversation_messages → session-summary-extractor → memory_summaries）**没有与 startupContext prelude 衔接**。新建 session 时，startupContext 加载的是旧日记，而非最新 session 摘要。

### 建议

1. **短期**：让 `session-summary-extractor` 在完成摘要后，同步写入 `memory/YYYY-MM-DD-<slug>.md`，使 startupContext prelude 能加载到最新摘要。

2. **中期**：在 `latest_summaries_cache` 表写成功后，通过轻量 hook 在首轮 prompt 注入最新 5 条摘要内容（绕过 startupContext 的文件限制）。

3. **长期**：考虑启用 OpenClaw 内置 `session-memory` hook 作为辅助存档路径，与现有 PostgreSQL 方案并存。
