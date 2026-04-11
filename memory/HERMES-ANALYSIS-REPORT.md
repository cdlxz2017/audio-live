# Hermes Agent 深度分析报告

> 分析时间：2026-04-12  
> 分析模型：MiniMax-M2.7-highspeed → Claude Opus 4-6（子任务）  
> 数据来源：Hermes 官方文档 12 个页面 + OpenClaw 本地文档

---

## 一、架构全景对比

### 8 维度对比总表

| 维度 | Hermes Agent | OpenClaw | 差距评估 |
|------|-------------|----------|----------|
| **1. 架构设计** | AIAgent 单核心（run_agent.py ~9200行）+ 模块化子系统，Python | Gateway + Hooks + Skills + Node.js | 中等 — Hermes 更紧凑，OpenClaw 更松散但扩展性强 |
| **2. 记忆系统** | MEMORY.md(2200字) + USER.md(1375字) 纯文件，FTS5 会话搜索，frozen snapshot 注入 | PostgreSQL + pgvector + Neo4j + recall hook，三表并行 HNSW | OpenClaw 更复杂但精度更高；Hermes 简洁但容量受限 |
| **3. Skills 系统** | 渐进加载(L0/L1/L2) + 条件激活 + Agent 自创建 + Skills Hub 市场 | SKILL.md + skills/ 目录，无分级加载 | Hermes 领先一个代际 |
| **4. 工具系统** | 47 工具 + 40 工具集 + 6 终端后端，自我注册 + check_fn 可用性检测 | Skills + Tools + Hooks，无统一注册表 | Hermes 更完善，OpenClaw 工具定义分散 |
| **5. 消息网关** | 15 平台适配器，Gateway daemon，Session 路由 | 多渠道支持（webchat/weixin/telegram/feishu） | Hermes 平台覆盖更广 |
| **6. 自我进化** | Agent 自创建 Skills + Skills 自改进 + 模式发现 | 模块 B 元认知 + 模块 D 主动学习 + 模块 E 遗忘 | Hermes 有端到端实现，OpenClaw 有设计但未落地 |
| **7. 安全与隔离** | 记忆安全扫描 + per-profile 隔离 + DANGEROUS_PATTERNS 审批 + 容器隔离 | 记忆禁区 + 多租户 + circuit-breaker | Hermes 更精细，OpenClaw 缺命令级审批 |
| **8. Cron 与定时** | 原生 cron + delivery 到任意平台 + skill-backed cron jobs | cron + 邮件/微信通知 | Hermes delivery 机制更灵活 |
| **9. 上下文压缩** | 双压缩层（50% + 85%）+ LLM 生成摘要 + 迭代压缩 | 无上下文压缩（依赖模型上下文窗口） | Hermes 遥遥领先 |
| **10. Prompt 缓存** | Anthropic prompt caching + cache breakpoints | 无 | Hermes 领先 |
| **11. 工具执行** | ThreadPoolExecutor 并行 + interactive 工具顺序强制 | 顺序执行，无并行 | Hermes 更高效 |
| **12. 中断机制** |  interruptible API calls，底层 thread 中断 | 无 | Hermes 领先 |

---

## 二、最值得借鉴的 10 项设计

### 借鉴项 1：渐进式 Skills 加载（L0/L1/L2）

**Hermes 实现：**
```
Level 0: skills_list() → [{name, description, category}, ...] (~3k tokens)
Level 1: skill_view(name) → Full content + metadata
Level 2: skill_view(name, path) → Specific reference file
```
模型只在需要时加载完整技能内容，大幅节省 token。Skills 还有条件激活机制：
- `fallback_for_toolsets: [web]` — 当 web 工具集可用时隐藏（备用技能）
- `requires_toolsets: [terminal]` — 只有 terminal 可用时才显示

**现状：** OpenClaw 的 skills/ 目录下所有 SKILL.md 全文注入，无分级。

**差距：** token 浪费，skill 越多 prompt 越长；无法实现"备用 skill"机制。

**借鉴方案：**
1. 修改 `skill-registry.js`，新增三级加载接口：
   - `skills_list()`：只返回 name/description/category
   - `skill_view(name)`：返回完整 SKILL.md
   - `skill_view(name, refPath)`：返回 references/ 下特定文件
2. SKILL.md frontmatter 新增 `activation.conditions` 字段
3. 修改 prompt 注入逻辑：默认只注入 L0 index，需要时 L1 加载
4. 实现 `fallback_for_tools` / `requires_toolsets` 条件判断

**工作量：** 中（涉及 prompt builder 重构，约 8-10 小时）

**风险：** 分级加载后模型可能忘记已加载 skill 的上下文；需要确保 skill 内部状态一致

---

### 借鉴项 2：双层上下文压缩系统

**Hermes 实现：**
```
Gateway Session Hygiene: 85% 阈值（粗糙估计，防止 API 失败）
Agent ContextCompressor: 50% 阈值（精确 token 计数）
    ↓
Phase 1: 修剪旧工具结果（>200字符）— 无 LLM 调用
Phase 2: 确定边界（保护 first_n + tail_n）
Phase 3: LLM 生成结构化摘要（Goal/Constraints/Progress/Done/NextSteps）
Phase 4: 组装压缩消息
    ↓
迭代压缩时，previous summary 传入，增量更新而非重新生成
```

结构化摘要模板：
```markdown
## Goal
[What the user is trying to accomplish]
## Constraints & Preferences
[User preferences, coding style, constraints]
## Progress
### Done
[Completed work — specific file paths, commands run]
### In Progress
[Work currently underway]
### Blocked
[Any blockers or issues encountered]
## Key Decisions
[Important technical decisions and why]
## Relevant Files
[Files read, modified, or created]
## Next Steps
[What needs to happen next]
```

**现状：** OpenClaw 无上下文压缩，长对话会撑爆 prompt。

**差距：** 长对话场景（如代码调试持续 50+ 轮）会因 context 过长导致响应变慢甚至超限。

**借鉴方案：**
1. 新建 `context-compressor.js`（`memory-system/scripts/`）
2. 实现两级压缩：preflight（85%，粗糙字符估计）+ agent（50%，精确 token）
3. 压缩算法：Phase 1 工具结果修剪（无 LLM）+ Phase 2 LLM 摘要（结构化模板）
4. 修改 `before_prompt_build` hook，集成压缩逻辑
5. 迭代压缩：previous summary 增量更新

**工作量：** 大（需要 LLM 调用 + token 估算，约 15-20 小时）

**风险：** 压缩摘要丢失关键上下文；LLM 成本累积；压缩触发时机需精细调参

---

### 借鉴项 3：Agent 自创建 Skills（Procedural Memory）

**Hermes 实现：**
```python
# 触发条件（来自文档）：
- After completing a complex task (5+ tool calls) successfully
- When it hit errors or dead ends and found the working path
- When the user corrected its approach
- When it discovers a non-trivial workflow
```
Agent 用 `skill_manage` tool 创建/修改/删除 skills，存入 `~/.hermes/skills/`。这是"程序性记忆"——学会了一个 workflow 就固化成可复用 skill。

**现状：** OpenClaw 无此机制，complex task 每次重新摸索。

**差距：** 重复任务无积累，每次都从零开始；tech-knowledge 有 30 个文档但与 recall 系统隔离。

**借鉴方案：**
1. 新建 `procedural-memory.js`（`memory-system/scripts/`）
2. 在 `after_tool_execution` hook 中检测"复杂任务完成"信号：
   - 工具调用 ≥ 5 次
   - 包含 error → recovery 路径
   - 用户纠正（检测 "错了" "不对" 等关键词）
3. skill_manage tool 新增 `create_from_session(session_id, task_description)` 接口
4. 将成功路径序列化为 SKILL.md 格式（包含 Procedure / Pitfalls / Verification）
5. 新 skill 存入 `~/.openclaw/workspace/skills/autonomous/`

**工作量：** 中（涉及 hook 扩展 + skill 生成逻辑，约 10 小时）

**风险：** 生成低质量 skill；skill 数量膨胀；占用 token 预算

---

### 借鉴项 4：FTS5 会话历史搜索

**Hermes 实现：**
```sql
-- SQLite FTS5 虚拟表，自动同步 messages 表
CREATE VIRTUAL TABLE messages_fts USING fts5(content, content=messages);
-- 触发器保持同步
-- 搜索语法支持：AND/OR/NOT/前缀/短语
results = db.search_messages("docker deployment", 
  source_filter=["cli"], 
  role_filter=["user"])
```

**现状：** OpenClaw 的 `memory_summaries` 只有 481 条，无全量会话存档搜索。

**差距：** 无法搜索"上次我们讨论过什么"；recall_logs 只有 191 条。

**借鉴方案：**
1. 在 `conversation_messages` 表上加 FTS5 索引：
   ```sql
   CREATE VIRTUAL TABLE conversation_messages_fts USING fts5(
     content, content=conversation_messages
   );
   CREATE TRIGGER ... -- 同步触发器
   ```
2. 新建 `session-search.js`（`memory-system/scripts/`）
3. `before_prompt_build` hook 支持 `session_search(query)` 调用
4. 搜索结果用 LLM 摘要（避免返回原始消息）

**工作量：** 小-中（DB 迁移 + 封装脚本，约 5-6 小时）

**风险：** 搜索质量依赖 LLM 摘要；FTS5 对中文支持需测试

---

### 借鉴项 5：Tools 自我注册 + check_fn 可用性检测

**Hermes 实现：**
```python
# 每个工具文件在 import 时自我注册
registry.register(
  name="terminal",
  toolset="terminal",
  schema={...},
  handler=handle_terminal,
  check_fn=lambda: bool(os.environ.get("TERMINAL_BACKEND")),
  requires_env=["SOME_VAR"],
  is_async=False,
)
# model_tools.py 发现所有工具，构建 schema 列表
# get_definitions() 过滤掉 check_fn() == False 的工具
```

**现状：** OpenClaw 工具定义分散在各处，无统一注册表；check_fn 机制不存在。

**差距：** 工具发现困难；无法动态感知工具可用性（如 API key 缺失时工具仍暴露给模型）

**借鉴方案：**
1. 新建 `tool-registry.js`（`memory-system/scripts/`）：
   ```javascript
   const registry = new Map();
   function register({ name, toolset, schema, handler, checkFn, requiresEnv }) {
     registry.set(name, { name, toolset, schema, handler, checkFn, requiresEnv });
   }
   function getAvailableTools() {
     return [...registry.values()].filter(t => !t.checkFn || t.checkFn());
   }
   ```
2. 各工具模块调用 `register()` 自我注册
3. prompt 注入前调用 `getAvailableTools()` 过滤
4. 缺失 API key 的工具在 schema 中标记 `available: false` 并说明原因

**工作量：** 中（需要改造各工具模块，约 8 小时）

**风险：** 现有工具改造工作量大；注册时机需精确（避免 circular dependency）

---

### 借鉴项 6：DANGEROUS_PATTERNS 命令审批 + YOLO 模式

**Hermes 实现：**
```python
DANGEROUS_PATTERNS = [
  (r"rm -rf", "recursive delete"),
  (r"DROP TABLE", "SQL DROP"),
  (r"curl.*\|sh", "pipe remote to shell"),
  ...
]
# 三种模式：manual / smart / off
# YOLO 模式：一键 bypass 所有审批
```

审批流程：CLI 交互式 `[o]nce | [s]ession | [a]lways | [d]eny`  
Gateway：发送消息等待回复  
Permanent allowlist：写入 config.yaml

**现状：** OpenClaw 无命令级审批，circuit-breaker 只管 LLM 调用。

**差距：** destructive command 无保护；误执行 rm -rf 等高危命令无法防范。

**借鉴方案：**
1. 新建 `dangerous-checker.js`（`memory-system/scripts/`）
2. 定义 DANGEROUS_PATTERNS（rm -rf / DROP TABLE / mkfs / curl\|sh 等）
3. 在 `exec` 工具前增加检查：
   ```javascript
   if (isDangerous(command) && !yoloMode) {
     return { requiresApproval: true, pattern: "...", command };
   }
   ```
4. 审批结果通过回调传递（支持 session 级别 allow / permanent allowlist）
5. YOLO 模式：`openclaw exec --yolo` flag

**工作量：** 小（独立模块，不改核心，约 4-5 小时）

**风险：** 误拦截正常命令；YOLO 模式安全性

---

### 借鉴项 7：Cron delivery 到任意平台 + skill-backed cron

**Hermes 实现：**
```bash
/cron add "every 1h" "Summarize new feed items" --skill blogwatcher
# delivery 支持：
# "origin" / "local" / "telegram" / "discord:#engineering" / "email" / "weixin" / ...
```

Cron agent 自动加载 attached skills，然后执行 prompt，结果自动 delivery 到目标平台。  
响应可标记 `[SILENT]` 抑制正常输出（仅在异常时告警）。  
Cron 内禁用 cron 管理工具（防止循环嵌套）。

**现状：** OpenClaw cron 只有基础定时，执行结果需手工查看。

**差距：** 无法将 cron 结果自动推到微信/飞书；无法让 cron 自动加载 skill 上下文。

**借鉴方案：**
1. 扩展 `crontab.entries` 支持 `delivery` 和 `skills` 字段：
   ```javascript
   {
     schedule: "every 1h",
     prompt: "Summarize new feed items",
     delivery: "weixin",
     skills: ["blogwatcher"],
     silent: true  // 仅异常时推送
   }
   ```
2. 新建 `cron-delivery.js`（`memory-system/scripts/`）
3. cron 执行时动态加载 skill 上下文（调用 `skill_view()`）
4. delivery 支持 wechat/feishu/email/telegram

**工作量：** 中（涉及 cron 改造 + delivery 渠道对接，约 8 小时）

**风险：** 跨平台 delivery 安全性；cron 嵌套（需禁用 cron 自我管理）

---

### 借鉴项 8：中断型 API 调用（Interruptible API Calls）

**Hermes 实现：**
```
Main thread: wait on response_ready / interrupt_event / timeout
API thread: HTTP POST in background
    ↓
用户发送新消息 / /stop / signal → interrupt event fires
    → API thread abandoned（不等待返回）
    → agent 处理新输入，干净中断
```

**现状：** OpenClaw 无中断机制，长时间运行的 agent 无法被用户打断。

**差距：** agent 处理慢时用户只能等待，无法主动中断；/stop 命令无效。

**借鉴方案：**
1. 在 `sessions_spawn` 中实现底层：
   ```javascript
   const controller = new AbortController();
   const apiPromise = fetch(url, { signal: controller.signal });
   // 用户中断 → controller.abort()
   ```
2. 增加 `/stop` 命令：设置 interrupt flag，丢弃当前 API 响应
3. 中断后保留已完成工具调用的状态，只丢失最后未完成 API call
4. `before_prompt_build` hook 检测 interrupt flag，清除 pending 状态

**工作量：** 中（需要修改 sessions 管理，约 6-8 小时）

**风险：** 中断时状态不一致；API 已提交但响应丢弃（需幂等设计）

---

### 借鉴项 9：Per-Platform Session Reset 策略

**Hermes 实现：**
```javascript
reset_by_platform: {
  telegram: { mode: "idle", idle_minutes: 240 },
  discord: { mode: "idle", idle_minutes: 60 },
  whatsapp: { mode: "daily", hour: 4 }
}
```

不同平台可配置不同 reset 策略：idle 超时 reset 或每日固定时间 reset。

**现状：** OpenClaw session 管理较为简单，无 per-platform 差异化策略。

**差距：** 即时通讯平台（微信）适合 idle reset；邮件场景适合 daily reset。

**借鉴方案：**
1. 在 `gateway.json` 或 `config.js` 中增加 `reset_by_platform` 配置
2. 修改 session 管理逻辑：根据 channel 应用对应 reset 策略
3. 支持 `mode: "idle" | "daily" | "both"`

**工作量：** 小（配置 + session manager 改造，约 3-4 小时）

**风险：** 策略配置复杂化；用户理解成本

---

### 借鉴项 10：Memory 安全扫描（Prompt Injection 防御）

**Hermes 实现：**
```python
# 记忆内容在注入 prompt 前扫描：
content = _scan_context_content(content, "MEMORY.md")
# 检测：prompt injection / credential exfiltration / invisible unicode / SSH backdoors
# 匹配威胁模式的内容被 blocking
```

**现状：** OpenClaw recall 召回的记忆无安全扫描，直接注入 prompt。

**差距：** 用户可控的记忆内容可能被污染注入；Recall 设计中虽有思路但未实现。

**借鉴方案：**
1. 新建 `security-scanner.js`（`memory-system/scripts/`）：
   ```javascript
   const DANGEROUS_PATTERNS = [
     /ignore previous instructions/i,
     /\[ignore.*\]/i,
     /\x00/,  // invisible unicode
     // credential exfiltration patterns
     // SSH backdoor patterns
   ];
   
   function scanMemoryContent(content) {
     for (const pattern of DANGEROUS_PATTERNS) {
       if (pattern.test(content)) {
         return { safe: false, pattern: pattern.toString() };
       }
     }
     return { safe: true };
   }
   ```
2. 在 `memory_tool` 的 add/replace 动作时调用 scan
3. 在 recall 注入前也调用 scan（防止注入后绕过）
4. 拦截日志写入 recall_logs（pattern match 时标记 flagged: true）

**工作量：** 小（独立 scanner 模块，约 3-4 小时）

**风险：** 误拦截正常记忆内容；模式库需持续更新

---

## 三、具体落地建议（按优先级排序）

### 立即可做（1-2 小时）

| 优先级 | 借鉴项 | 原因 |
|--------|--------|------|
| P0 | **借鉴项 6**：DANGEROUS_PATTERNS 命令审批 | 安全性最高，破坏性命令无保护 |
| P0 | **借鉴项 10**：Memory 安全扫描 | recall 召回内容直接注 prompt，有注入风险 |
| P1 | **借鉴项 9**：Per-Platform Session Reset | 配置简单，立即改善多渠道体验 |
| P1 | **借鉴项 4**：FTS5 会话历史搜索 | 已有 conversation_messages 表，加索引即可 |

### 本周可做（3-8 小时）

| 优先级 | 借鉴项 | 原因 |
|--------|--------|------|
| P1 | **借鉴项 7**：Cron delivery 到任意平台 | 实用性强，支撑主动巡检 |
| P2 | **借鉴项 5**：Tools 自我注册 + check_fn | 改善工具可用性检测 |
| P2 | **借鉴项 8**：中断型 API 调用 | 改善 UX，agent 可被打断 |

### 长期（8+ 小时）

| 优先级 | 借鉴项 | 原因 |
|--------|--------|------|
| P2 | **借鉴项 1**：渐进式 Skills 加载 | token 优化，长期收益大 |
| P3 | **借鉴项 2**：双层上下文压缩 | 复杂度高，长对话场景才需要 |
| P3 | **借鉴项 3**：Agent 自创建 Skills | 进化能力，需其他基础设施配合 |

---

## 四、我们的差距矩阵（对照 AGI-EVOLUTION-PLAN v2）

| AGI v2 模块 | Hermes 对应 | 差距 | 可借鉴项 |
|-------------|-----------|------|----------|
| **模块 A：记忆系统 v6** | Memory（MEMORY.md + FTS5 + external providers）| 召回精度低；Graphify 未整合 | 借鉴项 4（FTS5） |
| **模块 B：元认知反思** | 无直接对应 | 每日反思未实现 | 借鉴项 3（自创 skill）可辅助 |
| **模块 C：目标追踪** | 无直接对应 | Neo4j Goal 图谱未建 | 无直接可借鉴 |
| **模块 D：主动学习** | 无直接对应 | 置信度触发未实现 | 借鉴项 3（procedural memory）|
| **模块 E：记忆遗忘** | 无直接对应 | 冷热数据未区分 | 无直接可借鉴 |
| **模块 F：推理模式库** | 无直接对应 | reasoning pattern 未积累 | 借鉴项 4（FTS5）可辅助搜索历史 reasoning |
| **模块 G：自我监控** | 无直接对应 | 无自动巡检 | 借鉴项 7（Cron delivery）|
| **模块 H：多模态** | 无直接对应 | 无语音优化 | 无直接可借鉴 |
| **模块 I：Agent 协作** | Subagent delegation tool | clawteam 功能弱 | 借鉴项 7（skill-backed cron）|

### 最大差距：上下文压缩（Hermes 无此功能，OpenClaw 更弱）

Hermes 有完整的双层压缩系统，OpenClaw 完全缺失。这直接影响长对话场景的可用性。

### 第二差距：渐进式 Skills 加载

Hermes 的 L0/L1/L2 分级 + 条件激活是成熟的工程实践，OpenClaw 需要追赶。

---

## 五、结论与行动项

### 核心结论

1. **Hermes 的优势在于**：架构紧凑（Python 单语言）+ prompt 工程极致（frozen snapshot + 分级注入）+ 安全设计精细（dangerous patterns + memory scan）
2. **OpenClaw 的优势在于**：记忆基础设施更复杂（向量搜索 + 图数据库 + PostgreSQL），但未充分整合
3. **最大机会点**：将 OpenClaw 的复杂记忆基础设施（Graphify/pgvector/Neo4j）接入 Hermes 式的精细 prompt 控制机制

### 下一步具体行动（本周）

- [ ] **今天**：新建 `security-scanner.js`，保护 recall 注入安全
- [ ] **今天**：FTS5 索引加到 `conversation_messages` 表
- [ ] **本周**：DANGEROUS_PATTERNS 审批模块 + Per-Platform Session Reset
- [ ] **本周**：Cron delivery 扩展（支持 wechat/feishu）

### 中期行动（本月）

- [ ] 实现渐进式 Skills 加载（重构 prompt builder）
- [ ] 实现 Agent 自创建 Skills（procedural memory）
- [ ] 实现 Tools 自我注册 + check_fn 机制

### 长期（季度）

- [ ] 实现双层上下文压缩（需要 LLM 调用 + token 估算）
- [ ] 实现 interruptible API calls
- [ ] 将 AGI v2 模块逐步落地

---

## 附录：关键文件位置

| 改动 | 文件路径 |
|------|----------|
| Security Scanner | `memory-system/scripts/security-scanner.js`（新建）|
| FTS5 迁移 | `memory-system/scripts/` SQL migration |
| Dangerous Checker | `memory-system/scripts/dangerous-checker.js`（新建）|
| Cron Delivery | `memory-system/scripts/cron-delivery.js`（新建）|
| Tool Registry | `memory-system/scripts/tool-registry.js`（新建）|
| Procedural Memory | `memory-system/scripts/procedural-memory.js`（新建）|
| Context Compressor | `memory-system/scripts/context-compressor.js`（新建）|
| Prompt Builder 重构 | `memory-system/hooks/recall-hook/handler.js` |

---

_报告完成_  
_下次更新：按优先级逐步实现"本周可做"清单_
