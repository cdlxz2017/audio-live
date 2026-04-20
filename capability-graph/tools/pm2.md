# PM2 进程管理

## 基本信息
- **类型**：CLI / 进程管理器
- **状态**：✅ 正常

## 核心能力
- Node.js 进程守护
- 自动重启
- 日志管理
- 进程监控

## 关键进程（记忆系统）
| # | 进程名 | 脚本 | 状态 |
|---|--------|------|------|
| 0 | session-extractor | session-file-extractor-loop.js | ✅ |
| 1 | graph-linker | graph-linker.js | ✅ |
| 2 | summary-extractor | summary-extractor-loop.js | ✅ |
| 19 | bge-m3-keepalive | keepalive-bge-m3.js | ✅ |

## 常用命令
```bash
pm2 list           # 列出所有进程
pm2 logs <name>    # 查看日志
pm2 restart <name> # 重启
pm2 stop <name>    # 停止
```

## 避坑
- 重启后 bge-m3-keepalive 必须恢复（PM2 保活）
- 不要随意 stop memory 相关进程
