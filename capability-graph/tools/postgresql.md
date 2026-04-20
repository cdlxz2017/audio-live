# PostgreSQL

## 基本信息
- **类型**：数据库 / 主存储
- **端口**：5432
- **状态**：✅ 正常
- **连接**：localhost:5432 / openclaw_ai / zyxrcy910128

## 核心能力
- 结构化数据存储
- pgvector 向量检索
- JSONB 半结构化数据
- Transaction 支持

## 主要数据库
| 数据库 | 用途 |
|--------|------|
| openclaw_memory | 主脑记忆系统 |
| problem_thread | 副脑问题追踪 |

## 关键表
| 表 | 说明 |
|----|------|
| conversation_messages | 原始对话 |
| memory_summaries | 摘要 |
| personal_memories | 原始内容记忆 |
| memories | 结构化记忆 |
| problem_threads | 问题 Thread |

## 常用命令
```bash
psql -h localhost -p 5432 -U openclaw_ai -d openclaw_memory  # 连接主库
psql -h localhost -p 54320 -U ptuser -d ptdb                   # 连接副脑库
```

## 依赖关系
- 被依赖：OpenClaw Gateway / 记忆系统 / 副脑
