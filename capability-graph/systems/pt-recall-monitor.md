# 副脑召回监控系统（pt-recall-monitor）

## 基本信息

| 项目 | 内容 |
|------|------|
| **类型** | 独立监控 · 完全不涉及主脑 |
| **审计数据库** | `/home/ai/.openclaw/audit/pt_recall_audit.db` |
| **报告脚本** | `audit-scripts/pt-recall-monitor/pt-recall-report.js` |
| **Cron** | 每 5 分钟执行一次 |
| **日志** | `/home/ai/.openclaw/logs/pt-recall-report.log` |

## 架构

```
副脑 API (54321)
    │
    ├─ 中间件（src/api/index.js 插入）
    │   ├─ 拦截 GET  /threads?status=active  → source: plugin
    │   ├─ 拦截 GET  /threads?q=xxx        → source: semantic
    │   ├─ 拦截 PATCH /threads/:id/stage   → source: error_append
    │   └─ 拦截 POST /sessions/.../summary → source: session_push
    │            ↓
    └─ 独立 SQLite 审计数据库（600权限）
              ↓（每5分钟）
         pt-recall-report.js → 控制台输出 + 日志
```

## 监控指标

| 指标 | 说明 |
|------|------|
| 各店召回次数 | 按 source 分类统计 |
| 平均延迟 / P99 | 毫秒级延迟分布 |
| 具体召回线程ID | 每条召回对应的 thread UUID |
| 告警阈值 | P99 > 500ms 自动输出 ⚠️ |
| 数据保留 | 7 天自动清理（无 trigger，纯 cron） |

## 启动命令

```bash
# 手动生成报告
node /home/ai/.openclaw/workspace/audit-scripts/pt-recall-monitor/pt-recall-report.js

# 指定时间窗口
node /home/ai/.openclaw/workspace/audit-scripts/pt-recall-monitor/pt-recall-report.js "1 hour"

# 初始化数据库
node /home/ai/.openclaw/workspace/audit-scripts/pt-recall-monitor/init-db.js
```

## 源码位置

| 文件 | 说明 |
|------|------|
| `problem-thread/src/api/index.js` | 中间件（约 70 行）|
| `audit-scripts/pt-recall-monitor/pt-recall-report.js` | 报告生成器 |
| `audit-scripts/pt-recall-monitor/init-db.js` | 数据库初始化 |

## 状态

✅ 已实施（2026-04-21 04:35）
