# 副脑（Problem Thread）

## 基本信息
- **类型**：独立问题追踪系统
- **端口**：API 54321 / PostgreSQL 54320 / Neo4j 7688
- **状态**：✅ 运行中
- **路径**：/home/ai/problem-thread/

## 架构概述
独立于主脑的问题追踪系统，每个 Thread 记录一个问题从发现到解决的全过程。

```
OpenClaw → problem-thread-plugin → Problem Thread API (54321)
                                              ↓
                              ┌───────────────┴───────────────┐
                              pt-postgres (54320)              pt-neo4j (7688)
                              Thread 核心数据                  关系图谱
```

## 关键配置
| 配置项 | 值 |
|--------|-----|
| API URL | http://localhost:54321 |
| PostgreSQL | ptdb / ptuser / ptpass |
| Neo4j | neo4j / ptneo4j2026 |
| Plugin | problem-thread-plugin |

## Thread 状态
| 状态 | 说明 |
|------|------|
| new | 刚创建 |
| in_progress | 进行中 |
| blocked | 阻塞 |
| completed | 已完成 |
| cancelled | 已取消 |

## 常用 API
```bash
GET  /threads?status=active           # 获取活跃 Thread
POST /threads                         # 新建 Thread
PATCH /threads/:id/stage              # 更新 Stage 内容
PATCH /threads/:id/status             # 更新状态
POST /sessions/:id/summary            # 推送 session 摘要
```

## 依赖关系
- 依赖：Docker (pt-api, pt-postgres, pt-neo4j)
- 被依赖：卓越执行框架（存储成功案例）
