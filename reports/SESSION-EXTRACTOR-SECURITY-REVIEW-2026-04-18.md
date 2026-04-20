# Session Summary Extractor 安全审查：三方对比报告

> 日期：2026-04-18 | 审查者：玄枢、qwen3.6-plus、Claude Opus 4-6
> 文件：`session-summary-extractor.js`（约 800 行）

---

## 一、三方一致确认的危险问题

### 🔴 问题 1：retryFailedSessions() 死代码（最高优先级）

| 审查者 | 确认 |
|--------|------|
| **玄枢** | ✅ 发现并修复（return [] 后永不执行） |
| **qwen3.6-plus** | ✅ "永远不被调用，整个函数成了摆设" |
| **Opus** | ✅ "不可达代码，永久停留在 failed 状态" |

**位置**：`scanAndProcess()` 末尾，`return []` 或 `return results` 之后

**根因**：两个分支都有 return，retryFailedSessions 永不可达

**后果**：所有因 LLM 临时故障失败的 session 永久无法自动重试

**状态**：玄枢已在本次修复（return []），但需确认 retryFailedSessions 的调用是否真的会被执行到

---

### 🔴 问题 2：Outbox payload 字段名不匹配

| 审查者 | 确认 |
|--------|------|
| **玄枢** | ✅ 发现（s.summary → 应为 s.content） |
| **qwen3.6-plus** | ✅ 详细分析下游影响 |
| **Opus** | ✅ 字段映射错误 |

**位置**：`saveSummaries()` 中的 outbox INSERT

**根因**：LLM 返回 `{ section, content, type }`，outbox payload 写的是 `s.summary` 和 `s.key_points`

**后果**：
- memory_outbox 中 summary/key_points 永远为 undefined
- 同步到 personal_memories 和 Neo4j 的流程丢失关键数据
- 下游处理器可能因空值抛异常

---

### 🔴 问题 3：API Key 硬编码

| 审查者 | 确认 |
|--------|------|
| **玄枢** | ✅ 在 config.js 中 |
| **qwen3.6-plus** | ✅ PRIMARY_LLM.fallback 硬编码 |
| **Opus** | ✅ 第 27 行明文密钥 |

**位置**：`config.js` 或 `session-summary-extractor.js` 中的 fallback key

**后果**：密钥泄露风险

---

## 二、两方确认的危险问题

### 🟠 问题 4：GREATEST(last_msg_id, NULL) = NULL 导致游标永久损坏

| 审查者 | 确认 |
|--------|------|
| **qwen3.6-plus** | ✅ 详细分析 |
| **Opus** | ✅ 详细分析 |
| **玄枢** | ❌ 未明确识别此问题 |

**位置**：`updateSessionCursor()` 的 SQL

```sql
last_msg_id = GREATEST(session_summary_cursor.last_msg_id, EXCLUDED.last_msg_id)
```

**根因**：当 `EXCLUDED.last_msg_id = NULL` 时，`GREATEST(existing, NULL) = NULL`

**后果**：
- 增量摘要失败时 `last_msg_id` 被覆盖为 NULL
- 下次增量摘要 `id > NULL` 永远为 false
- 该 session 增量链路永久断裂，变为全量重跑

**修复**：失败时不更新 last_msg_id，或改为：
```sql
last_msg_id = COALESCE(EXCLUDED.last_msg_id, session_summary_cursor.last_msg_id)
```

---

### 🟠 问题 5：并发无锁导致重复摘要

| 审查者 | 确认 |
|--------|------|
| **qwen3.6-plus** | ✅ |
| **Opus** | ✅ |
| **玄枢** | ❌ 未明确提出（关注点不同） |

**场景**：两个进程同时扫描，同时拿到同一 session，同时处理，同时写入

**后果**：同一 session 的相同摘要被写入 memory_summaries 两次，无唯一约束检测

---

### 🟠 问题 6：callLLM 双次发送问题（对话内容发两次）

| 审查者 | 确认 |
|--------|------|
| **Opus** | ✅ 详细分析 |
| **qwen3.6-plus** | ❌ 未明确提出 |
| **玄枢** | ❌ 未明确提出 |

**位置**：`callLLM()` 中

```javascript
const prompt = SESSION_SUMMARY_PROMPT.replace('{conversation}', segments[i]);
const segResult = await callLLM(prompt, segments[i], ...);
```

**根因**：`callSingleLLM(systemPrompt, userText, ...)` 中：
- `prompt`（包含对话内容的完整提示词）作为 systemPrompt
- `segments[i]`（原始对话）又作为 userText

**后果**：对话内容被发送两次，token 翻倍，摘要质量可能受影响

---

## 三、单独发现的问题

### 玄枢额外发现

| 问题 | 严重度 |
|------|--------|
| merge 后 SIGKILL 导致部分摘要写入但 cursor 未更新 | 🔴 高 |
| saveSummaries + updateSessionCursor 无事务包装 | 🟡 中 |

### qwen3.6-plus 额外发现

| 问题 | 严重度 |
|------|--------|
| FALLBACK_LLM 定义但从未使用（死代码） | 🟢 低 |
| 硬编码 API Key | 🔴 已三方确认 |

### Opus 额外发现

| 问题 | 严重度 |
|------|--------|
| buildConversationText 1500 字符截断过低 | 🟡 中 |
| splitText 单行超长时无法分段 | 🟡 中 |
| runDaemon 无优雅退出 | 🟡 中 |

---

## 三、问题优先级排序

| 优先级 | 问题 | 三方确认 | 建议 |
|--------|------|---------|------|
| **P0** | retryFailedSessions 死代码 | ✅✅✅ | 立即修复（玄枢已修复） |
| **P0** | Outbox payload 字段不匹配 | ✅✅✅ | 立即修复 |
| **P0** | GREATEST(last_msg_id, NULL) = NULL | ✅✅ | 立即修复 |
| **P1** | 并发无锁重复摘要 | ✅✅ | 尽快修复 |
| **P1** | callLLM 双次发送 | ✅ | 检查修复 |
| **P2** | 1500 字符截断过低 | ✅ | 评估后修复 |
| **P2** | runDaemon 无优雅退出 | ✅ | 建议修复 |
| **P3** | API Key 硬编码 | ✅✅✅ | 迁移到环境变量 |

---

## 四、结论

三方分析高度一致：最严重的两个问题是 **retryFailedSessions 死代码**（玄枢已修复）和 **Outbox payload 字段不匹配**（未修复）。

此外，`GREATEST(last_msg_id, NULL) = NULL` 是一个隐藏极深的数据损坏 bug，两个模型都独立发现了它，玄枢未识别出来。这个问题会导致增量摘要链路永久断裂，需要优先修复。
