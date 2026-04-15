# LinkMem v2.0 - Outbox Pattern 改造报告

**日期**: 2026-04-16 06:43 CST
**任务**: T1.2 summary-extractor.js Outbox Pattern 改造
**状态**: ✅ 完成

## 改造内容

### 1. saveSummary() 事务化 + Outbox 写入

**文件**: `memory-system/scripts/summary-extractor.js`

**改造前**（直接三写，无事务保障）：
- INSERT memory_summaries（无事务）
- INSERT personal_memories（无事务，可能部分失败）
- syncSummaryToNeo4j（fire-and-forget，可能丢失）

**改造后**（单事务 + Outbox）：
```
BEGIN
  → INSERT memory_summaries（主表）
  → INSERT memory_outbox（event_type='summary_created', status='pending'）
COMMIT
```

- 使用 `db.getClient()` 获取连接，手动管理事务
- 幂等判重逻辑保留（事务外，只读查询）
- embedding 生成保留（事务外，CPU 密集操作）
- 事务内仅包含两个 INSERT，最小化锁持有时间
- ROLLBACK on error + client.release() in finally

### 2. 移除 syncSummaryToNeo4j 调用

**改造前**（runOnce 第 7 步）：
```javascript
if (summaryId) {
  this.syncSummaryToNeo4j(summaryId, summary, {...})
    .catch(err => console.warn(...));
  totalSummaries++;
}
```

**改造后**：
```javascript
// T1.2 Outbox Pattern: personal_memories 和 Neo4j 同步已移至 outbox-writer 异步消费
if (summaryId) {
  totalSummaries++;
}
```

- `syncSummaryToNeo4j()` 方法定义保留（dead code），未来可清理
- `publishGraphEvent()` 方法保留（已被之前注释禁用）

### 3. 新建 outbox-writer.js 消费者

**文件**: `memory-system/scripts/outbox-writer.js`

**功能**：
- 每 10 秒轮询 `memory_outbox` 表，处理 `status='pending'` 的事件
- 每批最多处理 50 条
- 对每条 `summary_created` 事件：
  1. 写入 `personal_memories`（仅 VALUABLE_TYPES，幂等判重）
  2. 同步 Neo4j `PersonalMemory` 节点（MERGE 幂等）
  3. 标记 `status='processed'`
- 失败事件标记 `status='failed'`，不无限重试

**PM2 进程**: `outbox-writer` (id=32, online)

## 验证结果

| 检查项 | 结果 |
|--------|------|
| summary-extractor.js 语法检查 | ✅ `require()` 成功 |
| outbox-writer.js 语法检查 | ✅ `require()` 成功 |
| outbox-writer processOutbox() 执行 | ✅ Processed: 0（无 pending 事件） |
| summary-extractor PM2 重启 | ✅ online, pid=2459724 |
| outbox-writer PM2 启动 | ✅ online, pid=2459818 |
| PM2 配置保存 | ✅ dump.pm2 已更新 |
| summary-extractor 日志 | ✅ 无错误，正常运行 |
| outbox-writer 日志 | ✅ "Starting continuous mode (poll every 10s)" |

## 数据流变更

```
改造前:
  summary-extractor → memory_summaries (直接写)
                    → personal_memories (直接写, 无事务)
                    → Neo4j PersonalMemory (fire-and-forget, 可能丢失)

改造后:
  summary-extractor → [BEGIN]
                       → memory_summaries (事务内)
                       → memory_outbox (事务内, pending)
                      [COMMIT]

  outbox-writer     → memory_outbox (poll pending)
                    → personal_memories (幂等写入)
                    → Neo4j PersonalMemory (MERGE 幂等)
                    → memory_outbox (标记 processed/failed)
```

## 风险评估

- **数据一致性**: memory_summaries 和 memory_outbox 在同一事务内，保证原子性
- **最终一致性**: personal_memories 和 Neo4j 通过 outbox-writer 异步写入，最终一致
- **故障恢复**: outbox-writer 重启后自动处理所有 pending 事件
- **幂等性**: personal_memories 通过 source_ids 判重，Neo4j 通过 MERGE 幂等
