# 天道系统 Docker 部署包

**来源**：`/home/ai/tiandao_docker/`（主人 2026-04-21 09:03 完整打包）
**位置**：`/home/ai/tiandao_docker/docker-compose.yml`
**状态**：待设计重做，暂存备用

---

## docker-compose.yml 概览

### 服务清单（9个应用 + 3个基础设施）

| 服务 | 容器名 | 端口 | 依赖 |
|------|--------|------|------|
| postgres | `tiandao-postgres` | 15432 | — |
| redis | `tiandao-redis` | 16379 | — |
| neo4j | `tiandao-neo4j` | 17474/17687 | — |
| auth-service | `tiandao-auth` | 3001 | DB/Redis/Neo4j |
| member-service | `tiandao-member` | 3002 | DB/Redis/Neo4j |
| karma-service | `tiandao-karma` | 3006 | DB/Redis/Neo4j |
| resource-service | `tiandao-resource` | 3008 | DB/Redis/Neo4j |
| world-event-service | `tiandao-world-event` | 3010 | DB/Redis/Neo4j |
| gateway | `tiandao-gateway` | 3100 | 上游服务 |
| admin-app | `tiandao-admin-app` | 3300 | DB/Redis |
| admin-web | `tiandao-admin-web` | 3200 | admin-app |

### Dockerfile 文件

- `Dockerfile.service` — 多阶段构建，通用微服务构建
- `Dockerfile.gateway` — 网关构建
- `Dockerfile.admin-app` — 管理后台构建
- `Dockerfile.web` — 前端静态文件构建

### 构建上下文

所有服务引用 `../projects/tiandao-system/` 作为 build context。

---

## 与当前 PM2 部署的端口对照

| PM2 端口 | Docker 端口 | 服务 |
|---------|------------|------|
| 3002 | 3002 | member-service |
| 3004 | 3001 | auth-service |
| 3006 | 3006 | karma-service |
| 3008 | 3008 | resource-service |
| 3010 | 3010 | world-event-service |
| 3011 | 3100 | gateway |
| 3003/3005 | 3300/3200 | admin-app/admin-web |
| — | 15432 | postgres（独立） |
| — | 16379 | redis（独立） |
| 7687 | 17687 | neo4j（独立） |

---

## 凭证

- Postgres: `tiandao_user / tiandao_pass_2026 / tiandao_db`
- Neo4j: `neo4j / tiandao_neo4j_2026`

---

## 备注

- 主人计划重新设计天道系统，不急，睡醒再说
- 当前 docker-compose.yml 为暂存状态，等待重做
