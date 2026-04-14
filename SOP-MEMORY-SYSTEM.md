# SOP-记忆系统工作流（强制执行）

> **触发条件**：任何涉及记忆系统（memory-system）的修复、改造、问题排查，均按此 SOP 执行。
> 本 SOP 要求所有协作方（主人/玄枢/子程序）均知晓并遵守。

---

## 核心规则

**记忆系统问题 → 必须使用 Claude Opus 4-6 子程序**

---

## 标准流程

### 第一步：启动 Claude Opus 4-6 子程序

使用 `sessions_spawn` 启动子程序：

```
runtime: "subagent"
model: "4sapi/claude-opus-4-6"
mode: "run"
runTimeoutSeconds: 300
```

### 第二步：传递任务描述

向子程序说明：
- 要修复/排查的问题
- 相关文件路径
- 当前系统状态
- 约束条件（只验证/只修复/先验证后修复）

### 第三步：监控执行

- 子程序执行中，持续监控
- 每次操作前先备份（如涉及文件修改）
- 验证修复效果

### 第四步：失败重试机制

| 失败次数 | 处理方式 |
|----------|----------|
| 第1次失败 | 立即重新调用 Claude Opus 4-6 子程序，重试相同任务 |
| 第2次失败 | 再次重新调用，说明前一次失败情况 |
| 第3次失败 | **停止行动**，向主人报告问题详情，由主人决定下一步 |

---

## 子程序调用模板

```javascript
sessions_spawn({
  task: `你是记忆系统工程师。请执行以下任务：[任务描述]

## 当前状态
- 相关文件：xxx
- 当前指标：xxx
- 最近日志：xxx

## 约束
- [只验证不修改 / 先验证后修复 / 直接修复]
- 涉及文件修改前先备份
- 完成后汇报结果`,
  runtime: "subagent",
  model: "4sapi/claude-opus-4-6",
  runTimeoutSeconds: 300,
  mode: "run"
})
```

---

## 适用场景

| 场景 | 示例 |
|------|------|
| Bug 修复 | session-reader.js offset 双重累加 |
| 性能问题 | extractor 处理速度慢/卡住 |
| 数据问题 | memories 表不增长 |
| 代码改造 | 修改 indexer/filter/触发逻辑 |
| 问题诊断 | 分析 varchar(64) 错误来源 |
| 验证修复 | 确认某修复是否正确 |

---

## 禁止事项

- **禁止**在记忆系统问题上跳过子程序，直接用 exec/apt/pip 等手动修复
- **禁止**在未备份的情况下修改记忆系统核心脚本
- **禁止**在 3 次重试失败后继续自行尝试

---

## 报告模板（3次失败后）

向主人报告：

```
记忆系统问题无法解决（已重试3次）

问题描述：xxx
已尝试的修复：xxx
失败原因：xxx
当前状态：xxx

建议：xxx（主人决定下一步）
```

---

## 相关文件路径

| 组件 | 路径 |
|------|------|
| 核心脚本 | `/home/ai/.openclaw/workspace/memory-system/scripts/` |
| session-reader | `session-reader.js` |
| session-indexer | `session-indexer.js` |
| extractor | `extractor-file-based.js` |
| memory-writer | `memory-writer.js` |
| summary-extractor | `summary-extractor-loop.js` |
| graph-linker | `graph-linker.js` |
| 配置文件 | `memory-system/scripts/config.js` |
| PM2 日志 | `~/.pm2/logs/` |
| 数据库 | `openclaw_memory` (PostgreSQL) |

---

## 最近修复记录（2026-04-14）

| 修复 | 文件 | 问题 |
|------|------|------|
| 删除 `offset += bytesRead` | session-reader.js | offset 双重累加 |
| `b.size - a.size` → `a.size - b.size` | session-indexer.js:173 | 降序改升序，小文件先处理 |
| IGNORE_PATTERNS 确认 | session-indexer.js | `.checkpoint.` 文件过滤 |

---

_本 SOP 由主人授权建立，玄枢及所有子程序均须遵守。_
