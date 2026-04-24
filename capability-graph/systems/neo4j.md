# Neo4j

## 基本信息
- **类型**：图数据库
- **端口**：7687（记忆链路）/ 7688（问题追踪）
- **状态**：✅ 正常
- **规模**：170 万+ 节点

## 记忆链路图数据（7687）

| 节点类型 | 数量 |
|---------|------|
| Person/Work/Place 等 | 170 万+ |
| PersonalMemory | 463 |
| GraphifyCode | 28 |
| Memory_summary | 318+ |

## 问题追踪图数据（7688）

| 节点类型 | 说明 |
|---------|------|
| Thread | 问题 Thread |
| Session | Session 节点 |

## 同步机制

| 机制 | 路径 |
|------|------|
| 实时同步 | summary-extractor.js 内嵌 |
| 增量 cron | cron-incremental-neo4j-sync.js（每 5 分钟） |
| graph-linker | Redis Stream → Neo4j |

## 常用操作

```bash
# 查询 PersonalMemory 节点
MATCH (p:PersonalMemory) RETURN count(p)

# 查询 Thread 节点
MATCH (t:Thread) RETURN t
```
