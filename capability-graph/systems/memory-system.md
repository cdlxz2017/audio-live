# 记忆系统（主脑）

## 基本信息
- **类型**：数据库集群 / 记忆召回系统
- **数据库**：PostgreSQL (openclaw_memory) + Neo4j
- **状态**：✅ 正常

## 架构概述
三层记忆存储 + 召回系统：
```
conversation_messages（原始对话）
       ↓
memory_summaries（摘要）
       ↓
personal_memories / memories（结构化记忆）
       ↓
Neo4j（知识图谱关联）
```

## 数据流
```
用户消息 → hook: session-capture-hook → conversation_messages
                                        ↓
                        session-file-extractor-loop (PM2 #0)
                                        ↓
                              extractor-file-based → 归档
                                        ↓
                        summary-extractor (PM2 #2) → memory_summaries
                                        ↓
                        ├─ graph:sync:events → graph-linker (PM2 #1) → Neo4j
                        └─ 实时同步 → Neo4j PersonalMemory
```

## 关键配置
| 配置项 | 值 | 说明 |
|--------|-----|------|
| 提取模型 | Qwen-max (DashScope) | API Key: sk-50c8c052... |
| 向量模型 | BGE-m3 (Ollama) | 1024维，localhost:11434 |
| DEFAULT tier | 2 | 不截断，最多5条 |
| recall 召回 | 向量检索 + Graphify + memories | 三路并行 |

## PM2 进程
| # | 进程名 | 状态 |
|---|--------|------|
| 0 | session-extractor | ✅ |
| 1 | graph-linker | ✅ |
| 2 | summary-extractor | ✅ |

## 常见故障排查
| 现象 | 原因 | 解决 |
|------|------|------|
| 召回不是最新摘要 | latest_summaries_cache 无消费方 | 已修复，改用 time-order 注入 |
| Neo4j 连接失败 | 服务未启动 | `docker start openclaw-neo4j` |
| extractor 崩溃 | SyntaxError | 检查日志 `pm2 logs summary-extractor` |

## 依赖关系
- 依赖：PostgreSQL + Neo4j + Redis + Ollama
- 被依赖：memory-recall-plugin（主脑召回）
