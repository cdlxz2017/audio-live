# Docker

## 基本信息
- **类型**：容器运行时
- **状态**：✅ 正常

## 运行的容器
| 容器 | 端口 | 用途 |
|------|------|------|
| lingyi-cms 前端 | 3001 | 民宿前端 |
| lingyi-cms 后端 | 8001 | 民宿后端 API |
| pt-api | 54321 | 副脑 API |
| pt-postgres | 54320 | 副脑数据库 |
| pt-neo4j | 7688/7474 | 副脑知识图谱 |

## 常用命令
```bash
docker ps                    # 查看运行中的容器
docker compose ps            # 查看 compose 服务状态
docker compose up -d         # 启动所有服务
docker compose down          # 停止所有服务
docker compose down -v       # 停止并删除数据卷
```

## 避坑
- 重建容器后需要重新注册插件
- 数据卷不要随意删除
