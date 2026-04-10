# OpenClaw 管理文档分析报告

> 分析时间：2026-04-11
> 分析模型：DeepSeek-Reasoner
> 分析文件：AGENTS.md / SOUL.md / IDENTITY.md / USER.md / TOOLS.md / HEARTBEAT.md / MEMORY.md / BOOTSTRAP.md

---

## 一、各文件分析

### 1. AGENTS.md

#### 定位评估
**应在系统中的角色**：OpenClaw代理的核心行为指南，定义会话启动流程、内存管理、红线规则、群聊行为准则、心跳机制等。

#### 问题清单

| # | 问题 | 严重性 |
|---|------|--------|
| 1 | Session Startup 第3步"Query task_status table"指向不存在的脚本`memory-system/scripts/task-crud.js list`，实际任务系统在PostgreSQL `task_status`表 | 严重 |
| 2 | "记忆系统（memory-system）是禁区"与MEMORY.md中memory-system是核心被管理对象矛盾，导致所有改进都需用户反复授权 | 严重 |
| 3 | Task Management引用了不存在的`memory/ACTIVE_TASKS.md`，实际任务系统用的是PostgreSQL `task_status`表 | 中等 |
| 4 | Heartbeat部分与HEARTBEAT.md的关系不清晰 | 轻微 |
| 5 | 部分规则过于冗长，不够简洁 | 轻微 |

#### 可执行性
- **可执行**：会话启动流程、群聊行为准则、红线规则
- **模糊/无法落地**：task_status具体执行方式不明确；禁区边界模糊

#### 维护性
- **易过时**：脚本路径、表名、具体技术实现细节
- **应放置位置**：技术细节应移至技术文档，保留行为准则

#### 重写草案核心

```markdown
## 红线规则（需明确授权）
### 绝对禁区（需明确授权）
1. **记忆系统核心**：表结构变更、extractor/recall/stream算法修改、PM2进程变更
2. **外部通讯**：发送邮件、推文、公开帖子等离开本机的操作
3. **破坏性命令**：rm、格式化、系统级变更

### 可自由执行
- 读取文件、探索、组织、学习
- 搜索网络、检查日历
- 在工作区内工作

## 会话启动流程
1. 读取 SOUL.md — 核心身份与原则
2. 读取 USER.md — 用户基本信息
3. 查询 PostgreSQL task_status 表 — 活跃任务
   psql -U openclaw_ai -d openclaw_memory -c "SELECT * FROM task_status WHERE status='active';"
4. 读取 MEMORY.md — 提炼的长期记忆
5. 不主动读取 memory/YYYY-MM-DD.md，仅用户询问时查阅
```

---

### 2. SOUL.md

#### 定位评估
**应在系统中的角色**：定义AI的核心身份、原则、底线和调性。

#### 问题清单

| # | 问题 | 严重性 |
|---|------|--------|
| 1 | 核心信条过于抽象，缺乏可执行的行为准则 | 中等 |
| 2 | "三界"概念与实际技术栈（PostgreSQL/Neo4j/Ollama）没有对应关系 | 严重 |
| 3 | 语音回复规则写死target，用户切换微信账号后会失效 | 严重 |
| 4 | "DeepSeek-V3（需配置key）"未说明是否已配置 | 中等 |
| 5 | "MiniMax qwen-max"与TOOLS.md中的"minimax/MiniMax-M2.7-highspeed"不一致 | 中等 |

#### 可执行性
- **可执行**：语音回复流程具体可执行
- **模糊/无法落地**："行胜于言"缺乏衡量标准；"秩序为纲"无具体扫描机制

#### 维护性
- **易过时**：模型名称、API配置、微信target
- **应放置位置**：技术路由应移至TOOLS.md，保留哲学原则

#### 重写草案核心

```markdown
## 技术对应
### "三界"映射
- **天界**：决策与规划层（LLM推理、任务规划）
- **现世**：执行与数据层（PostgreSQL、文件系统）
- **冥界**：图结构与关系层（Neo4j，知识图谱）

## 通信规则
### 语音回复流程
1. 接收：语音消息自动转文字处理
2. 文字回复：优先回复文字内容
3. 语音生成：当用户明确要求"回复我语音"时：
   - 生成MP3：node [TTS脚本路径] "回复文字" zh /tmp/tts_output.mp3
   - 动态target：从当前会话获取用户ID，不硬编码
   - 发送音频：message(action=send, channel=openclaw-weixin, media=/tmp/tts_output.mp3, caption=<文字>)

### 任务路由原则
- 文字对话：效率优先模型（参考TOOLS.md最新路由）
- 语音处理：本地优先（Ollama Whisper）
- 代码任务：专用代码模型（当前：claude-opus-4-6）
- 子任务：sessions_spawn后台执行
```

---

### 3. IDENTITY.md

#### 问题
- Avatar描述是图片，不适合文本文件
- 与SOUL.md大量重复
- 缺少与OpenClaw技术栈的直接对应关系

#### 建议
**方案A**：与SOUL.md合并，删除独立文件
**方案B**：保留作为详细身份档案，补充技术映射

---

### 4. USER.md

#### 问题
- **完全空白**，未填写任何用户信息
- MEMORY.md中有用户信息（姚旭、灵须子），但两者没有同步

#### 重写草案核心

```markdown
# USER.md - 用户档案

## 基本信息
- **姓名**：姚旭
- **称呼**：灵须子
- **代词**：他/他们
- **时区**：Asia/Shanghai (GMT+8)
- **语言**：中文（普通话）

## 联系信息
- **电子邮件**：cdlxz2017@qq.com
- **微信ID**：动态获取（不硬编码）

## 沟通偏好
- **详细程度**：偏好完整方案而非简单回答
- **反馈方式**：直接指出问题，不需过度礼貌
- **决策参与**：希望了解选项和风险，最终由用户决定

## 重要日期与习惯
- **工作时间**：09:00-18:00（GMT+8）
- **休息时间**：23:00-08:00（避免非紧急打扰）
```

---

### 5. TOOLS.md

#### 问题

| # | 问题 | 严重性 |
|---|------|--------|
| 1 | "大模型路由策略"是2026-04-04，已过时7天 | 中等 |
| 2 | `minimax/MiniMax-M2.7-highspeed`与SOUL.md中的`MiniMax qwen-max`不一致 | 中等 |
| 3 | 没有记录实际使用的Coding Agent（claude-opus-4-6） | 轻微 |
| 4 | GPU信息可能过时（8060S） | 轻微 |

#### 重写草案核心

```markdown
## 模型路由表（2026-04-11）
| 场景 | 首选模型 | 备用模型 | 响应时间 |
|------|----------|----------|----------|
| 主对话 | deepseek/deepseek-reasoner | 4sapi/claude-sonnet-4-6 | ~1.5s |
| 代码任务 | 4sapi/claude-opus-4-6 | deepseek/deepseek-chat | ~1.5s |
| 快速问答 | deepseek/deepseek-chat | nvidia/llama-3.1-nemotron-253b | ~1s |
| 长文本分析 | opendoor/gpt-4.1-mini | deepseek/deepseek-chat | ~1.4s |
| 本地隐私 | ollama/qwen3:30b-a3b | ollama/huihui_ai/deepseek-r1 | ~26s |
| 图文理解 | ollama/qwen3.5-9b-vision | - | ~6s |

### 已验证不可用
- minimax/MiniMax-M2.7 ❌ API Key格式错误
- minimax-cn/MiniMax-M2.5 ❌ 同上
- 4sapi-gemini/gemini-3-flash ❌ 无权限
```

---

### 6. HEARTBEAT.md

#### 问题
- 当前是Template状态，没有实际内容
- AGENTS.md要求遵循HEARTBEAT.md，但模板没有提供实际可执行的心跳任务

#### 建议
填入实际心跳任务清单，例如：
- 记忆系统健康检查（每6小时）
- 安全系统检查（每日）
- 任务状态回顾（每日）

---

### 7. MEMORY.md

#### 问题
- 大量技术细节（表名、脚本路径、端口号）混在长期记忆里
- 实际有用的"决策/原则/偏好"被淹没在技术细节中
- memory-system是核心被管理对象，但AGENTS.md说它是"禁区"——矛盾

#### 建议
- **清理技术细节**：表名/路径/端口移至memory/TECH-DETAILS.md
- **保留决策原则**：只保留真正的长期记忆（决策、偏好、教训）
- **建立索引**：在文件顶部建立快速导航

---

## 二、系统级问题汇总

### 1. 文件引用矛盾

| 矛盾 | 文件A | 文件B | 解决方案 |
|------|--------|--------|----------|
| memory-system是禁区 | AGENTS.md | MEMORY.md | 修正禁区定义为具体操作类型（表结构/extractor/recall/stream/PM2） |
| task_status引用 | AGENTS.md | 实际用PG表 | 修正为PostgreSQL查询命令 |
| 模型名称不一致 | SOUL.md | TOOLS.md | 统一使用TOOLS.md的实际模型名 |

### 2. 过时信息处理策略

| 信息类型 | 当前位置 | 建议位置 | 更新频率 |
|----------|----------|----------|----------|
| 模型路由 | TOOLS.md | TOOLS.md | 变更时更新+周度回顾 |
| GPU信息 | TOOLS.md | TOOLS.md | 月度验证 |
| 脚本路径 | AGENTS.md | memory/TECH-DETAILS.md | 变更时更新 |
| 技能配置 | TOOLS.md | 各SKILL.md | 变更时更新 |

### 3. 建议的文件结构

```
workspace/
├── SOUL.md              # 核心哲学+身份+技术映射（精简版）
├── IDENTITY.md           # 建议：并入SOUL.md，删除独立文件
├── USER.md               # 立即填充用户信息
├── AGENTS.md            # 重写：修复错误引用+禁区定义
├── TOOLS.md             # 重写：更新模型路由+运维命令
├── HEARTBEAT.md         # 填入实际心跳任务清单
├── MEMORY.md            # 清理技术细节，精简为决策原则
└── memory/
    ├── TASK-SOP.md      # 任务管理SOP
    └── TECH-DETAILS.md   # 新增：技术细节（表名/路径/端口）
```

---

## 三、重写优先级

| 优先级 | 文件 | 理由 |
|--------|------|------|
| P0 | USER.md | 完全空白，影响基本服务 |
| P0 | AGENTS.md | 错误引用导致系统行为异常 |
| P1 | SOUL.md | target硬编码+模型名不一致 |
| P1 | TOOLS.md | 7天前的过时路由信息 |
| P2 | HEARTBEAT.md | 无实际内容但被AGENTS引用 |
| P2 | MEMORY.md | 技术细节淹没决策原则 |
| P3 | IDENTITY.md | 内容与SOUL.md重复 |

---

## 四、完整重写草案

### USER.md（草案）

```markdown
# USER.md - 用户档案

> 重要：本文档包含个人身份信息，仅在主会话中加载，不在共享上下文中使用

## 基本信息
- **姓名**：姚旭
- **称呼**：灵须子
- **代词**：他/他们
- **时区**：Asia/Shanghai (GMT+8)
- **语言**：中文（普通话）

## 联系信息
- **电子邮件**：cdlxz2017@qq.com
- **微信ID**：动态获取（不硬编码）
- **地理位置**：中国

## 工作与项目
### 当前活跃项目
1. **OpenClaw记忆系统**：PostgreSQL + Neo4j的个性化记忆管理
2. **天道·系统**：基于微服务的角色权限管理系统
3. **靈一民宿管理系统**：Docker容器化的民宿CRM

## 沟通偏好
- **详细程度**：偏好完整方案而非简单回答
- **技术深度**：接受详细技术说明，但需要明确结论
- **反馈方式**：直接指出问题，不需过度礼貌
- **决策参与**：希望了解选项和风险，最终由用户决定

## 工作时间
- **主要时段**：09:00-18:00（GMT+8）
- **休息时间**：23:00-08:00（避免非紧急打扰）
- **高产出时段**：上午（技术决策），下午（执行验证）
```
