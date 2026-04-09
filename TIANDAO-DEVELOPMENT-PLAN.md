# 天道·系统 - 开发实施计划 v1.0

## 一、模块细分（原子化）

每个子模块 = 最小可独立部署单元（独立仓库/独立服务）

```
tiandao-system/
│
├── common/                        # 公共库
│   ├── common-auth/              # 认证授权（JWT/Token）
│   ├── common-event/             # 事件总线客户端
│   ├── common-exception/         # 统一异常处理
│   └── common-utils/             # 工具函数
│
├── member/                       # 成员域
│   ├── member-core/              # 成员基础 CRUD
│   ├── member-identity/          # 身份证明（照片/证件）
│   ├── member-realm/             # 境界管理
│   ├── member-relationship/      # 社会关系
│   └── member-position/          # 职位履历
│
├── auth-access/                  # 权限域
│   ├── auth-role/                # 角色管理
│   ├── auth-permission/          # 权限管理
│   ├── auth-department/          # 部门管理
│   └── auth-audit/              # 审计日志
│
├── heaven/                       # 天庭域
│   ├── heaven-territory/          # 区域管理
│   ├── heaven-weather/           # 天气控制
│   ├── heaven-lightning/         # 雷电管理
│   └── heaven-disaster/          # 灾害预警
│
├── underworld/                   # 地府域
│   ├── underworld-lifebook/      # 生死簿
│   ├── underworld-trial/          # 审判判决
│   ├── underworld-prison/         # 关押管理
│   └── underworld-merit/          # 功德业障
│
├── karma/                        # 现世报域
│   ├── karma-trigger/           # 触发规则引擎
│   └── karma-record/             # 报应记录
│
├── technique/                   # 功法域
│   ├── technique-catalog/        # 功法目录
│   ├── technique-content/        # 功法内容
│   ├── technique-cultivation/    # 修行日志
│   └── technique-master/         # 师徒关系
│
├── notice/                      # 通讯域
│   ├── notice-system/            # 天机通报
│   └── notice-wanted/           # 通缉令
│
├── time/                        # 时间域
│   ├── time-zone/               # 时区配置
│   └── time-convert/            # 时间换算
│
├── gateway/                      # API网关
│
├── admin-web/                   # PC管理后台（Gemini 3 Flash）
│   ├── member-console/
│   ├── auth-console/
│   ├── heaven-console/
│   ├── underworld-console/
│   ├── karma-console/
│   ├── technique-console/
│   └── notice-console/
│
└── admin-app/                  # 手机APP（Gemini 3 Flash）
    ├── member-app/
    ├── heaven-app/
    ├── underworld-app/
    ├── karma-app/
    └── notice-app/
```

---

## 二、代码谁写

| 工作内容 | 代码生成 | 代码审查 |
|---------|---------|---------|
| 数据库 DDL | **Claude Opus** | DeepSeek Reasoner |
| 后端 API（Python FastAPI） | **Claude Opus** | DeepSeek Reasoner |
| 前端页面框架（React） | **Gemini 3 Flash** | 人类前端工程师 |
| 手机APP框架（React Native） | **Gemini 3 Flash** | 人类移动端工程师 |
| 工具脚本/数据迁移 | **Claude Opus** | DeepSeek Reasoner |
| 测试用例 | **Claude Opus** | 人类 QA |
| 部署脚本 | **Claude Opus** | 人类运维 |

**原则**：
- **Gemini 3 Flash**：生成页面框架、组件模板、样式结构（速度快，适合重复性UI）
- **Claude Opus**：生成业务逻辑、复杂算法、DDL（能力强，适合核心代码）
- **人类**：填充细节、调整样式、平台适配、业务确认

---

## 三、界面谁做

### PC管理后台（Gemini 3 Flash）

| 阶段 | 执行者 | 输入 | 输出 |
|------|--------|------|------|
| 页面框架生成 | Gemini 3 Flash | 页面需求描述 | React组件结构、路由配置、Ant Design布局 |
| 细节填充 | 人类前端 | Gemini产出 | 填充业务逻辑、调整样式、处理边界 |
| 审查验收 | 人类产品经理 | 完成页面 | 验收交互、确认功能 |

**Gemini 3 Flash 适合生成**：
- 列表页、详情页、表单页的骨架
- CRUD 操作的标准按钮/搜索/分页
- 布局结构（侧边栏/头部/内容区）
- 基础样式和主题配置

### 手机APP（Gemini 3 Flash）

| 阶段 | 执行者 | 输入 | 输出 |
|------|--------|------|------|
| 跨平台组件框架 | Gemini 3 Flash | 页面需求描述 | React Native组件、页面导航 |
| 原生适配 | 人类移动端 | Gemini产出 | iOS/Android原生适配 |
| 审查验收 | 人类测试 | 完成APP | 功能测试、用户体验确认 |

---

## 四、开发步骤

### 第一阶段：基础设施（1-2周）

```
1. 人类：确定技术栈
   - 后端：Python FastAPI + PostgreSQL + Redis + RabbitMQ
   - 前端：React + Ant Design Pro（PC）
   - 移动端：React Native
   - 部署：Docker + K8s

2. Claude Opus：生成项目脚手架
   - 目录结构、依赖管理、docker-compose
   - Git仓库初始化

3. Claude Opus：生成 common 模块
   - 认证授权（JWT）
   - 事件总线客户端
   - 统一异常处理
   - 工具函数库

4. DeepSeek Reasoner：审查架构

5. 人类：确认后，部署开发环境
```

### 第二阶段：权限域（2-3周）⭐ 先开发

```
理由：所有模块都依赖权限系统，权限域完成后其他模块开发更快

Day 1-3:
  Claude Opus → auth-department（部门管理）
  Claude Opus → auth-role（角色管理）
  Claude Opus → auth-permission（权限管理）
  Claude Opus → auth-audit（审计日志）

Day 4-5:
  DeepSeek Reasoner 审查 4个模块

Day 6-7:
  Claude Opus 修复审查问题
  人类确认 → 合并

Day 8-10:
  Gemini 3 Flash → auth-console（权限管理后台页面）
  人类前端填充细节

Day 11-14:
  Gemini 3 Flash → auth-console 继续
  人类产品经理验收
```

### 第三阶段：成员域（2-3周）

```
理由：成员是系统核心，后续天庭/地府都需要

Day 1-4:
  Claude Opus → member-core（成员CRUD）
  Claude Opus → member-identity（身份证明）
  Claude Opus → member-realm（境界管理）

Day 5-7:
  Claude Opus → member-relationship（社会关系）
  Claude Opus → member-position（职位履历）
  DeepSeek 审查

Day 8-10:
  Gemini 3 Flash → member-console（成员管理后台）
  人类填充细节

Day 11-14:
  Gemini 3 Flash → member-console 继续
  人类验收
```

### 第四阶段：天庭域（2-3周）

```
Day 1-3:
  Claude Opus → heaven-territory（区域管理）
  Claude Opus → heaven-weather（天气控制）

Day 4-5:
  Claude Opus → heaven-lightning（雷电管理）
  Claude Opus → heaven-disaster（灾害预警）
  DeepSeek 审查

Day 6-8:
  Gemini 3 Flash → heaven-console（天庭管理后台）

Day 9-14:
  人类填充细节 + 验收
```

### 第五阶段：地府域（2-3周）

```
Day 1-4:
  Claude Opus → underworld-lifebook（生死簿）
  Claude Opus → underworld-trial（审判判决）

Day 5-7:
  Claude Opus → underworld-prison（关押管理）
  Claude Opus → underworld-merit（功德业障）
  DeepSeek 审查

Day 8-14:
  Gemini 3 Flash → underworld-console（地府管理后台）
  人类填充 + 验收
```

### 第六阶段：功法域（2-3周）

```
Day 1-4:
  Claude Opus → technique-catalog（功法目录）
  Claude Opus → technique-content（功法内容）
  Claude Opus → technique-cultivation（修行日志）

Day 5-7:
  Claude Opus → technique-master（师徒关系）
  DeepSeek 审查

Day 8-14:
  Gemini 3 Flash → technique-console（功法管理后台）
  人类填充 + 验收
```

### 第七阶段：现世报域（2周）

```
Day 1-3:
  Claude Opus → karma-trigger（触发规则引擎）
  Claude Opus → karma-record（报应记录）

Day 4-5:
  DeepSeek 审查

Day 6-10:
  Gemini 3 Flash → karma-console（现世报管理后台）
  人类填充 + 验收
```

### 第八阶段：通讯域 + 时间域（1-2周）

```
Day 1-3:
  Claude Opus → notice-system（天机通报）
  Claude Opus → notice-wanted（通缉令）

Day 4:
  Claude Opus → time-zone（时区配置）
  Claude Opus → time-convert（时间换算）

Day 5-7:
  Gemini 3 Flash → notice-console（通讯管理后台）
  人类填充 + 验收
```

### 第九阶段：手机APP（与PC后台并行）

```
说明：PC管理后台开发同时，移动端可以开始

Day 1-3:
  Gemini 3 Flash → admin-app 项目初始化
  生成基础导航、登录页、首页框架

Day 4-7:
  Gemini 3 Flash → member-app（成员模块）
  人类移动端适配

Day 8-14:
  Gemini 3 Flash → heaven-app / underworld-app
  人类移动端适配

Day 15-21:
  Gemini 3 Flash → notice-app / karma-app
  人类移动端适配
```

### 第十阶段：联调 + 部署

```
Day 1-3:
  Claude Opus：编写API对接文档
  人类后端：API联调

Day 4-5:
  Claude Opus：生成部署脚本（Docker/K8s）
  DeepSeek：安全扫描

Day 6-7:
  人类运维：上线部署
  人类QA：集成测试
```

---

## 五、审查流程

```
代码生成
   ↓
Claude Opus 自我检查（逻辑）
   ↓
提交 PR
   ↓
DeepSeek Reasoner 自动审查（找漏洞/性能/安全）
   ↓
Claude Opus 修复问题
   ↓
人类代码owner 人工审核（业务逻辑确认）
   ↓
合并主分支
```

```
界面生成
   ↓
Gemini 3 Flash 生成框架
   ↓
人类前端填充细节
   ↓
人类产品经理验收功能
   ↓
合并
```

---

## 六、时间估算

| 阶段 | 时长 | 累计 |
|------|------|------|
| 第一阶段：基础设施 | 1-2周 | 2周 |
| 第二阶段：权限域 | 2-3周 | 4-5周 |
| 第三阶段：成员域 | 2-3周 | 6-8周 |
| 第四阶段：天庭域 | 2-3周 | 8-11周 |
| 第五阶段：地府域 | 2-3周 | 10-14周 |
| 第六阶段：功法域 | 2-3周 | 12-17周 |
| 第七阶段：现世报域 | 2周 | 14-19周 |
| 第八阶段：通讯+时间域 | 1-2周 | 15-21周 |
| 第九阶段：手机APP（并行） | 与PC后台同步 | — |
| 第十阶段：联调+部署 | 1周 | 16-22周 |

**总计**：约 4-5 个月（按最小模块并行可压缩到 3-4 个月）

---

## 七、优先级排序（先开发哪些）

```
第一优先（基础依赖）：
1. common-auth          ← 所有模块依赖
2. common-event        ← 所有模块依赖
3. auth-*              ← 所有模块依赖

第二优先（核心数据）：
4. member-*             ← 成员是一切的基础
5. time-*              ← 现世报需要时间基准

第三优先（业务核心）：
6. underworld-*        ← 地府核心业务
7. heaven-*             ← 天庭核心业务
8. technique-*          ← 功法核心业务

第四优先（扩展功能）：
9. karma-*             ← 现世报
10. notice-*           ← 通讯通缉

第十优先（界面）：
11. admin-web          ← PC管理后台（全程并行）
12. admin-app          ← 手机APP（全程并行）
```

---

## 八、关键原则

| 原则 | 说明 |
|------|------|
| 权限域最先 | 所有模块依赖权限，不完成权限其他模块无法正常鉴权 |
| 模块独立部署 | 每个子模块独立Git仓库，独立部署，不影响其他模块 |
| 最小接口通信 | 模块间通过API/事件总线，不直接读写对方数据库 |
| 并行开发 | PC后台和手机APP与后端开发并行，不等待 |
| 人类确认点 | DDL变更/权限变更/业务流程变更必须人类确认 |
| 代码谁来写 | 逻辑复杂→Claude Opus，UI框架→Gemini 3 Flash |
