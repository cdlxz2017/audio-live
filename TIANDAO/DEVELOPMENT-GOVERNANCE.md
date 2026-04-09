# 天道·系统 开发治理规范

> 整理自用户需求 2026-04-05

---

## 一、项目定位

**天道·系统（TiānDAO System）** — 神话世界观下的因果业报管理系统，
覆盖成员管理、功德业障、天庭/地府事务、功法资源、通知通讯、现实世界事件接入等功能。

**目标**：一套代码，多环境一键部署，解耦可替换，逻辑严密，可测试，可回滚。

---

## 二、目录结构规范

```
tiandao-system/
├── common/                      # 公共库（所有服务共享）
│   ├── common-auth/             # JWT/权限校验
│   ├── common-event/            # 事件总线封装
│   ├── common-exception/        # 统一异常类
│   └── common-utils/            # 工具函数
│
├── services/                    # 微服务（按字母排序）
│   ├── auth-service/
│   ├── heaven-service/
│   ├── karma-service/
│   ├── member-service/
│   ├── notice-service/
│   ├── resource-service/
│   ├── technique-service/
│   ├── time-service/
│   ├── underworld-service/
│   └── world-event-service/
│
├── gateway/                     # API 网关
├── admin-web/                   # Admin 前端（React）
├── admin-app/                   # Admin 后端（配套 API）
│
├── scripts/                     # 部署/运维脚本
├── tests/                       # 集成测试/压测
├── docs/                        # 开发文档
├── config/                      # 环境配置模板（.env.example）
│
├── docker/
│   ├── docker-compose.yml       # 全量服务编排
│   ├── docker-compose.dev.yml   # 开发环境
│   └── Dockerfile.service      # 多阶段构建模板
│
├── SPEC.md                      # 系统规格说明书（本文档）
├── README.md                    # 项目说明 + 快速启动
└── CHANGELOG.md                 # 每次发版的变更记录
```

**部署时**：`config/` + `.env` 文件单独管理（不上 Git），其余全部可迁移。

---

## 三、角色与职责

| 角色 | 负责范围 | 模型 |
|------|---------|------|
| **架构Owner（我）** | 全权把控开发、测试、上线进度；解决跨模块逻辑问题；代码审核 | — |
| **代码开发** | 按照设计文档实现各模块具体逻辑 | deepseek/deepseek-reasoner |
| **代码审核** | 逻辑正确性、安全性、可维护性 | 4sapi/claude-opus-4-6（首选） |
| **后备审核** | opus 有问题时启用 | qwen-max 或我自己 |
| **界面开发** | admin-web 前端实现 | gemini-3-flash |
| **界面审核** | 前端逻辑、交互、UI 规范 | 我（ai） |

---

## 四、开发流程

```
阶段一：基础设施（common-* + auth + member）
  设计评审 → deepseek 写代码 → opus 审核 → 我复核 → 单元测试 → 集成测试

阶段二：核心业务（time/underworld/heaven/resource）
  设计评审 → deepseek 写代码 → opus 审核 → 我复核 → 单元测试 → 集成测试

阶段三：业务逻辑（technique/karma）
  设计评审 → deepseek 写代码 → opus 审核 → 我复核 → 单元测试 → 集成测试

阶段四：现实接入（world-event-service）
  设计评审 → deepseek 写代码 → opus 审核 → 我复核 → 单元测试 → 集成测试

阶段五：接入层（gateway + admin-web + admin-app）
  deepseek/gemini 开发 → 我审核前端 → 端到端测试

阶段六：测试与上线
  容器化 → docker-compose 验证 → 部署脚本 → 上线
```

---

## 五、模块开发规范

### 5.1 代码规范
- **语言**：TypeScript（Node.js 微服务）+ React（前端）
- **框架**：Fastify（HTTP层）+ Prisma（ORM）+ PostgreSQL + Redis
- **编码**：UTF-8，缩进 2 空格，文件名小写 + 中划线
- **提交格式**：`<type>: <描述>`（type: feature/fix/refactor/docs/test/chore）

### 5.2 每个模块必须包含
```
services/<name>-service/
├── src/
│   ├── index.ts          # 入口，注册路由+事件订阅
│   ├── routes/           # 路由处理
│   ├── services/         # 业务逻辑
│   ├── repositories/     # 数据库操作
│   ├── events/           # 事件发布/订阅
│   └── types/            # 类型定义
├── tests/                # 单元测试（Vitest）
├── prisma/
│   └── schema.prisma     # 数据模型
├── package.json
└── README.md
```

### 5.3 测试要求
- **单元测试**：每个 service 方法必须有测试用例，覆盖率 ≥ 80%
- **集成测试**：每个 API 路由必须有测试用例
- **测试框架**：Vitest（单元）+ Supertest（API）
- **通过标准**：CI 中所有测试必须通过才能合并

---

## 六、审核规范

### 6.1 代码审核清单（opus / 审核者执行）
- [ ] 逻辑与设计文档一致
- [ ] 无安全漏洞（SQL注入/越权/敏感信息泄露）
- [ ] 错误处理完整
- [ ] 事件发布/订阅幂等性正确
- [ ] 数据库事务使用正确
- [ ] 无硬编码配置（必须走 .env）
- [ ] 单元测试覆盖核心逻辑

### 6.2 前端审核清单
- [ ] 页面与设计稿一致
- [ ] 交互逻辑正确
- [ ] 无 XSS / CSRF
- [ ] 响应式布局正常
- [ ] 加载/错误状态处理完整

---

## 七、开发记录规范

**每个模块完成后，必须更新以下文件：**

### 7.1 CHANGELOG.md（每行记录一次变更）
```markdown
## 2026-04-05

### auth-service ✅
- 完成：JWT 签发/验证、权限中间件
- 测试：全部 12 个用例通过
- 审核：opus 审核通过，修复 1 处空指针
```

### 7.2 docs/MODULE-NAME.md（每个模块独立文档）
```markdown
# auth-service 开发记录

## 设计决策
- 为什么用 JWT 而不是 Session：...

## 已知问题
- ...

## API 清单
| Method | Path | 说明 |
|--------|------|------|
```

### 7.3 开发日志（daily）
在 `tiandao-system/docs/logs/YYYY-MM-DD.md` 记录每日进展。

---

## 八、提测与上线流程

```
代码合并 → GitHub Actions CI →
  ├─ Lint + TypeScript 检查
  ├─ 单元测试（vitest）
  ├─ 集成测试（supertest）
  └─ 全部通过 → 构建 Docker 镜像

Docker 镜像推送 → docker-compose pull → 滚动更新
```

---

## 九、当前状态

| 项目 | 状态 |
|------|------|
| 系统设计（TIANDAO-SYSTEM-DESIGN-v1.7.md） | ✅ 完成 |
| 模块逻辑（TIANDAO-MODULE-LOGIC-v13.0.md） | ✅ 完成 |
| 开发规范（本文档） | ⏳ 待确认 |
| 项目初始化（tiandao-system/ 目录结构） | ⏳ 待开始 |
| 基础设施（common-*） | ⏳ 待开始 |

---

## 十、确认清单

- [x] 整理开发规范和项目结构
- [ ] 用户确认后开始初始化项目
- [ ] 用户确认开发流程和角色分工

---

_最后更新：2026-04-05 15:00_
