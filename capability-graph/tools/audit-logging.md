# 审计日志工具

## 基本信息

| 项目 | 值 |
|------|-----|
| 名称 | 独立操作审计日志系统 |
| 类型 | 工具 / 审计 |
| 路径 | `audit-scripts/` |
| 存储 | `/home/ai/.openclaw/audit/YYYY-MM-DD.jsonl` |
| 状态 | Phase 1 完成 |

## 工具清单

| 文件 | 说明 |
|------|------|
| `append-audit.js` | 核心写入模块（append-only + 批量合并 + fallback） |
| `audit-redact.js` | 敏感信息脱敏（P0完全隐藏 / P1部分隐藏） |
| `audit-query.js` | CLI查询工具（支持按类别/操作/时间过滤） |
| `audit-monitor.js` | 健康监控脚本 |

## 使用方式

```bash
# 查询今日统计
node audit-scripts/audit-query.js --stats

# 按类别查询
node audit-scripts/audit-query.js --category DATABASE

# 手动监控
node audit-scripts/audit-monitor.js
```

## 触发词

- 审计日志、查审计、操作记录、谁改的、什么时候改的

## 关联系统

- **SYSTEMS.md** — 操作审计日志系统
- **SOP-DOCUMENTATION-UPDATE.md** — 文档更新 SOP
- **memory/AUDIT-SYSTEM-DESIGN.md** — 完整设计文档
