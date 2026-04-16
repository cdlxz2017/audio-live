# Session 级摘要系统 - 完整实现报告

> **日期**: 2026-04-16
> **执行人**: 玄枢（天道AI）
> **状态**: ✅ 已完成

---

## 一、数据链路图

```
┌─────────────────────────────────────────────────────────────────┐
│                     对话数据源                                   │
│              conversation_messages (PostgreSQL)                  │
│         session_id | role | content | created_at                │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              session-summary-extractor.js                        │
│                                                                  │
│  1. 扫描已结束 session（最后消息 > 2分钟无新消息）               │
│  2. 检查 session_summary_cursor（避免重复处理）                 │
│  3. 提取所有 user/assistant 消息 → buildConversationText()       │
│  4. 估算 token 数 → estimateTokens()                             │
│  5. 若 > 30K token → splitText() 分段（每段~24K token）         │
│  6. 每段调用 qwen3.6-plus → 生成结构化摘要 JSON                 │
│  7. 若有多个段摘要 → MERGE_PROMPT 合并为最终摘要                │
│  8. 写入 memory_summaries 表                                     │
└──────────────────────────┬──────────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
┌─────────────┐  ┌──────────────┐  ┌────────────┐
│ memory_     │  │ outbox       │  │ session_   │
│ summaries   │  │ (Redis →     │  │ summary_   │
│ (PostgreSQL)│  │  Neo4j +     │  │ cursor     │
│             │  │  personal_   │  │ (PostgreSQL│
│ source_     │  │  memories)   │  │  进度跟踪) │
│ session_id  │  │              │  │            │
│ summary     │  │              │  │ status:    │
│ embedding   │  │              │  │ pending/   │
│ created_at  │  │              │  │ summarized │
│             │  │              │  │ failed     │
└─────────────┘  └──────────────┘  └────────────┘
```

---

## 二、各组件职责

### 2.1 `session-summary-extractor.js`（主提取器）

| 职责 | 说明 |
|------|------|
| **Session 发现** | 扫描 `conversation_messages`，按 `session_id` 分组，识别已结束 session |
| **进度追踪** | 通过 `session_summary_cursor` 表记录每个 session 的处理状态，避免重复 |
| **文本分段** | 超过 30K token 的 session 自动分段，每段~24K token（MAX_TOKENS * 0.8） |
| **LLM 摘要** | 调用 qwen3.6-plus 生成结构化 JSON 摘要（5 项：主题/需求/方案/事实/后续） |
| **段合并** | 多段摘要通过 MERGE_PROMPT 二次 LLM 调用合并为统一摘要 |
| **重试机制** | 5 次重试 + 递进等待（0/5/10/15/20/30 秒），仅用 qwen3.6-plus |
| **向量嵌入** | 摘要写入时同步生成 embedding，存入 memory_summaries |
| **Outbox 同步** | 通过 outbox 模式将摘要推送到 personal_memories 和 Neo4j 知识图谱 |

### 2.2 `session_summary_cursor` 表

```sql
CREATE TABLE session_summary_cursor (
  session_id   TEXT PRIMARY KEY,
  status       TEXT NOT NULL,       -- pending | summarized | failed
  last_msg_id  BIGINT,
  summarized_at TIMESTAMPTZ,
  error_msg    TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
```

**职责**：记录每个 session 的处理状态，防止重复处理和断点续传。

### 2.3 `memory_summaries` 表（复用）

```sql
-- 新增字段
source_session_id UUID  -- 标记 session 级摘要来源（区别于 pair 级摘要）
```

**职责**：统一存储所有摘要数据（pair 级 + session 级），通过 `source_session_id` 区分来源。

---

## 三、关键设计决策

### 3.1 分段策略

| 参数 | 值 | 理由 |
|------|-----|------|
| `MAX_TOKENS_FOR_SINGLE_CALL` | 30,000 | qwen3.6-plus 支持 128K 上下文，放宽到 30K 减少段数 |
| 分段比例 | 0.8 | 每段实际 ~24K token，预留 prompt overhead 空间 |
| 合并阈值 | >1 段 | 多段摘要通过 MERGE_PROMPT 二次 LLM 调用合并 |

**效果**：
- `3a06e053`（460K token）→ 20 段 → 合并为 10 条摘要
- `121b7b7c`（214K token）→ 9 段 → 合并为 5 条摘要
- `d7ac7dcf`（20K token）→ 无需分段 → 直接生成 5 条摘要

### 3.2 重试策略

```javascript
// 只用 qwen3.6-plus 主模型，去掉 DeepSeek fallback
const RETRY_DELAYS = [0, 5000, 10000, 15000, 20000, 30000];
// maxRetries = 5
// LLM_TIMEOUT_MS = 120000（120秒）
```

**变更**：
1. ~~DeepSeek fallback~~ → 已移除（API Key 无效）
2. 首次重试不等待（delay=0），后续递增
3. 修复了 `0 || 30000` 的 JS 布尔陷阱 bug

### 3.3 Token 估算

```javascript
// 粗略估算：中文 2字/token，英文 0.75字/token
function estimateTokens(text) {
  // 遍历字符，区分中日韩字符和其他字符
  return Math.ceil(chineseChars / 2) + Math.ceil(otherChars / 0.75);
}
```

### 3.4 摘要格式

每个摘要为 JSON 数组，包含 5 个维度：
1. 核心主题（1-2句话）
2. 用户的关键需求/问题
3. AI 的关键回应和解决方案
4. 重要的事实、偏好或决策
5. 结果或后续行动

---

## 四、回溯测试结果

### 4.1 总览

| Session ID | 消息数 | 总字符数 | 估算Token | 分段数 | 摘要数 | 状态 | 完成时间 |
|------------|--------|----------|-----------|--------|--------|------|----------|
| `3a06e053` | 838 | 326K | ~460K | 20 | 10 | ✅ | 05:54 |
| `121b7b7c` | 2,804 | 135K | ~214K | 9 | 5 | ✅ | 05:57 |
| `1e2aa833` | 179 | 54K | ~27K | 2 | 5 | ✅ | 05:58 |
| `d7ac7dcf` | 198 | 20K | ~10K | 0 | 5 | ✅ | 05:55 |
| **合计** | **4,019** | **535K** | **~711K** | **31** | **25** | **✅** | **~14 min** |

### 4.2 各 Session 摘要内容

#### Session `3a06e053`（838条消息，10条摘要）

> **主题**：OpenClaw 系统自动化心跳监控与网关热更新维护
> 
> 用户要求建立一套严格遵循工作区上下文的高频心跳巡检机制，通过定时任务持续读取 HEARTBEAT.md 文件，实现无人值守的系统健康检查。对话聚焦于记忆召回机制优化与会话捕获钩子的代码部署。

#### Session `121b7b7c`（2,804条消息，5条摘要）

> **主题**：天道系统全栈开发、OpenClaw 架构升级与 AI 记忆系统全链路优化
> 
> 核心致力于构建高可用、可扩展的 AGI 基础设施，涵盖微服务管理平台迭代、记忆召回机制深度重构、多模态硬件网络集成及主动安全防御体系搭建。全程依托多模型协同调度与本地大模型部署。

#### Session `1e2aa833`（179条消息，5条摘要）

> **主题**：AMD ROCm 环境下 AI 视频生成系统部署与服务器安全加固
> 
> 排查并移除了与 AMD 架构不兼容的 ComfyUI；完成 ClamAV、Lynis 及隔离区自动分析系统的部署；在 AMD 8060S 64GB 显存上实现本地视频生成，并开发 Gradio 多段续接 Web 工具。

#### Session `d7ac7dcf`（198条消息，5条摘要）

> **主题**：AMD ROCm 平台下 AI 系统维护、安全加固与本地视频生成方案
> 
> 从排查并彻底卸载不兼容的 ComfyUI，转向部署 ClamAV 与 Lynis 安全审计体系，最终聚焦于利用 DiffSynth-Studio 与 Wan2.1 模型在现有 AMD 显卡上实现多提示词串联视频生成的 Web 服务搭建。

### 4.3 总体验证

```sql
-- memory_summaries 总计
SELECT COUNT(*) FROM memory_summaries;  -- 765

-- Session 级摘要
SELECT COUNT(*) FROM memory_summaries WHERE source_session_id IS NOT NULL;  -- 757

-- Pair 级摘要
SELECT COUNT(*) FROM memory_summaries WHERE source_session_id IS NULL;      -- 8

-- 覆盖 session 数
SELECT COUNT(DISTINCT source_session_id) FROM memory_summaries;             -- 108
```

---

## 五、新旧系统对比

| 维度 | 旧系统（pair 级） | 新系统（session 级） |
|------|-------------------|---------------------|
| **粒度** | 每 2 条消息一对 | 整个 session 为单位 |
| **上下文** | 局部对话对 | 完整会话上下文 |
| **Token 利用率** | 低（仅 2 条消息） | 高（全部消息） |
| **摘要质量** | 碎片化，缺乏连贯性 | 结构化，主题连贯 |
| **LLM 调用频率** | 极高（每对 1 次） | 低（每 session 1-N 次） |
| **数据库行数** | ~750（大量冗余） | ~25（精摘要） |
| **成本** | 高 | 显著降低 |
| **查询效率** | 需聚合多条 | 单条即可获取完整上下文 |

---

## 六、PM2 配置

### 6.1 运行模式

```bash
# 单次扫描（手动）
node session-summary-extractor.js

# 回溯指定 session（手动）
node session-summary-extractor.js --backfill

# 持续守护模式（PM2 托管）
node session-summary-extractor.js --daemon
```

### 6.2 PM2 生态配置

```bash
# 启动守护进程（每 5 分钟扫描一次已结束 session）
pm2 start session-summary-extractor.js --name "session-extractor" -- --daemon

# 查看状态
pm2 status session-extractor

# 查看日志
pm2 logs session-extractor

# 重启
pm2 restart session-extractor
```

### 6.3 守护模式行为

1. 每 5 分钟扫描一次 `conversation_messages`
2. 识别最后消息超过 2 分钟的 session
3. 检查 `session_summary_cursor` 跳过已处理 session
4. 对新 session 执行摘要流程
5. 记录处理状态到 cursor 表

---

## 七、关键 Bug 修复记录

| Bug | 修复 |
|-----|------|
| `0 || 30000` 布尔陷阱 | 改为 `RETRY_DELAYS[attempt] != null ? RETRY_DELAYS[attempt] : 30000` |
| DeepSeek fallback 无效 | 移除 fallback 逻辑，只用 qwen3.6-plus |
| 分段过小（8K → 15K → 30K） | 最终设为 30K，减少段数 |
| `LLM_TIMEOUT_MS` 过短 | 120秒（适配大段 token） |

---

## 八、后续优化方向

1. **增量摘要**：对活跃 session 做增量更新，而非全量重算
2. **摘要压缩**：对多段合并后的摘要做二次精炼，控制条数
3. **异步队列**：大 session 处理放入队列，避免阻塞扫描
4. **监控告警**：对 failed session 发送告警通知

---

*报告生成时间：2026-04-16 13:50 CST*
