# OpenClaw Gateway

## 基本信息
- **类型**：服务 / 核心网关
- **端口**：18789
- **状态**：✅ 正常
- **路径**：PM2 管理

## 核心能力
- 消息路由（Telegram/微信/Discord 等）
- Plugin 加载与管理
- Hook 系统（before_prompt_build, command:new/reset 等）
- Session 管理

## 常用命令
```bash
openclaw gateway status    # 查看状态
openclaw gateway restart   # 重启
openclaw plugins list      # 列出插件
openclaw plugins install <name>  # 安装插件
```

## 已知限制
- before_message_write hook 对 webchat assistant 消息无效
- assistant 消息依赖 extractor 从 JSONL 文件读取（有 30s 延迟）

## 关联服务
- 依赖：PostgreSQL (localhost:5432)
- 依赖：Redis (localhost:6379)
- 依赖：Neo4j (localhost:7687)

## 历史使用记录
| 日期 | 任务 | 结果 |
|------|------|------|
| 2026-04-19 | Problem Thread Plugin 热注册 | ✅ 成功 |
