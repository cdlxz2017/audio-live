# session-summary-extractor.js 修复方案（终版）

> 日期：2026-04-18 | 审查：玄枢、qwen3.6-plus、Claude Opus 4-6
> 状态：**已三方确认，实施中**

---

## 修复清单

### P0-1：retryFailedSessions() 死代码
**位置**：`scanAndProcess()` 末尾
**问题**：if/else 两个分支都有 return，末尾的 retryFailedSessions 永不可达
**修复**：将 `await retryFailedSessions()` 移入两个分支 return 之前

### P0-2：Outbox payload 字段名不匹配
**位置**：`saveSummaries()` 中 outbox INSERT
**问题**：`s.summary` → undefined（LLM 返回的是 `s.content`）；`s.key_points` → undefined
**修复**：`summary: s.content`，`key_points: []`

### P0-3：GREATEST(last_msg_id, NULL) = NULL 游标损坏
**位置**：`updateSessionCursor()` SQL
**问题**：失败时传 null，导致 `GREATEST(x, NULL) = NULL`，游标被清空
**修复**：
```sql
last_msg_id = CASE
  WHEN EXCLUDED.status = 'failed'
  THEN session_summary_cursor.last_msg_id
  ELSE COALESCE(EXCLUDED.last_msg_id, session_summary_cursor.last_msg_id)
END,
```

### P1-1：并发无锁 + 新 session bug + failed 无法重试 + 僵尸 processing
**位置**：`backfillSession()` 入口
**问题**：
1. 新 session 从无 cursor 记录，UPDATE 抢不到被错误跳过
2. `status = 'failed'` 不在抢占条件里，retry 永远失败
3. processing 状态无超时清理机制

**修复**（四步原子操作）：
```javascript
async function backfillSession(sessionId) {
  // 步骤1：确保游标记录存在
  await db.query(`
    INSERT INTO session_summary_cursor (session_id, status)
    VALUES ($1, 'pending')
    ON CONFLICT (session_id) DO NOTHING
  `, [sessionId]);

  // 步骤2：原子抢占（包含 failed，允许重试抢锁）
  const lock = await db.query(`
    UPDATE session_summary_cursor
    SET status = 'processing'
    WHERE session_id = $1
      AND status IN ('pending', 'summarized', 'failed')
    RETURNING session_id
  `, [sessionId]);

  if (lock.rows.length === 0) {
    return { sessionId, status: 'skipped', reason: 'already_processing' };
  }

  // 步骤3：正常业务逻辑...

  // 步骤4（新增）：调用处添加僵尸清理
}
```

**僵尸清理**（在 daemon 循环或 retry 开头）：
```sql
UPDATE session_summary_cursor
SET status = 'failed', error_msg = 'processing_timeout'
WHERE status = 'processing'
  AND summarized_at < NOW() - INTERVAL '10 minutes'
```

### P1-2：callLLM 双次发送（3处遗漏）
**位置**：分段 LLM 调用、合并 LLM 调用、单次 LLM 调用
**问题**：prompt 已含对话内容，userText 又传一遍，token 翻倍
**修复**：三处 userText 均改为空字符串

| 调用位置 | 修复 |
|---------|------|
| 分段 LLM | `callLLM(prompt, '', PRIMARY_LLM)` |
| 合并 LLM | `callLLM(mergePrompt, '', PRIMARY_LLM)` |
| 单次 LLM | `callLLM(prompt, '', PRIMARY_LLM)` |

### P1-3：Daemon 优雅退出缺 exit
**位置**：`runDaemon()` while 循环末尾
**修复**：while 退出后补充 `process.exit(0)`

---

## 实施记录

| 时间 | 操作 |
|------|------|
| 2026-04-18 04:08 | 开始实施 |
