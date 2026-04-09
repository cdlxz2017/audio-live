# 天道·系统 - 模块逻辑关系分析 v2.0

## 一、核心依赖关系图

```
                        ┌─────────────────────────────────────┐
                        │            common 层（基础）              │
                        │  common-auth │ common-event │ common-utils │
                        └──────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    ▼                  ▼                  ▼
            ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
            │  auth-* 权限域 │  │  member-* 成员域 │  │  time-* 时间域 │
            └───────┬───────┘  └───────┬───────┘  └──────────────┘
                    │                    │
    ┌───────────────┼───────────────────┼───────────────────────┐
    ▼               ▼                   ▼                       ▼
┌────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ heaven │    │underworld│    │ technique │    │   karma  │    │  notice  │
│ 天庭域 │    │  地府域   │    │  功法域   │    │ 现世报域  │    │  通讯域  │
└────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
```

---

## 二、依赖关系矩阵

| 被依赖方 → | common-auth | common-event | auth-* | member-core | member-identity | member-realm | member-relationship | member-position | heaven-* | underworld-* | karma-* | technique-* | notice-* | time-* |
|-----------|------------|-------------|--------|------------|---------------|------------|-------------------|---------------|---------|-------------|---------|------------|---------|--------|
| **auth-role** | ✅ | ✅ | — | | | | | | | | | | | |
| **auth-permission** | ✅ | ✅ | ✅ | | | | | | | | | | | |
| **auth-department** | ✅ | ✅ | ✅ | | | | | | | | | | | |
| **auth-audit** | ✅ | ✅ | ✅ | | | | | | | | | | | |
| **member-identity** | ✅ | ✅ | ✅ | ✅ | — | | | | | | | | | |
| **member-realm** | ✅ | ✅ | ✅ | ✅ | | — | | | | | | | | |
| **member-relationship** | ✅ | ✅ | ✅ | ✅ | | | — | | | | | | | |
| **member-position** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | | | | | | |
| **member-core** | ✅ | ✅ | ✅ | — | | | | | | | | | | |
| **heaven-*** | ✅ | ✅ | ✅ | ✅ | | | | ✅ | — | | | | | |
| **underworld-*** | ✅ | ✅ | ✅ | ✅ | | | | | ✅ | — | | | | |
| **karma-trigger** | ✅ | ✅ | ✅ | ✅ | | | | | | ✅ | — | | | |
| **karma-record** | ✅ | ✅ | ✅ | ✅ | | | | | | ✅ | ✅ | — | | |
| **technique-catalog** | ✅ | ✅ | ✅ | ✅ | | | | | | | | — | | |
| **technique-content** | ✅ | ✅ | ✅ | ✅ | | | | | | | | ✅ | — | |
| **technique-cultivation** | ✅ | ✅ | ✅ | ✅ | | ✅ | | | | | | ✅ | — | |
| **technique-master** | ✅ | ✅ | ✅ | ✅ | | | ✅ | | | | | ✅ | ✅ | — |
| **notice-system** | ✅ | ✅ | ✅ | ✅ | | | | | ✅ | ✅ | | | | — |
| **notice-wanted** | ✅ | ✅ | ✅ | ✅ | | | | | ✅ | ✅ | | | | ✅ |
| **time-zone** | ✅ | ✅ | | | | | | | | | | | | ✅ |
| **time-convert** | ✅ | ✅ | | | | | | | | | | | | ✅ |

---

## 三、模块开发顺序（按依赖排序）

### 第一梯队：公共基础设施（无外部依赖）

| 顺序 | 模块 | 理由 |
|------|------|------|
| 1 | `common-auth` | 所有模块的认证基础 |
| 2 | `common-event` | 所有模块的事件通信基础 |
| 3 | `common-utils` | 工具函数，无依赖 |
| 4 | `common-exception` | 统一异常处理，无依赖 |

### 第二梯队：权限域（依赖 common-*）

| 顺序 | 模块 | 理由 |
|------|------|------|
| 5 | `auth-role` | 权限系统核心，其他 auth 模块依赖 role |
| 6 | `auth-permission` | 依赖 role |
| 7 | `auth-department` | 依赖 role |
| 8 | `auth-audit` | 依赖 permission |

### 第三梯队：成员域（依赖 common-* + auth-*）

| 顺序 | 模块 | 理由 |
|------|------|------|
| 9 | `member-core` | 成员基础，所有 member-* 依赖 |
| 10 | `member-identity` | 依赖 member-core |
| 11 | `member-realm` | 依赖 member-core |
| 12 | `member-relationship` | 依赖 member-core |
| 13 | `member-position` | 依赖 member-core + member-realm + member-identity + member-relationship |

### 第四梯队：基础业务域（依赖 common-* + auth-* + member-*）

| 顺序 | 模块 | 理由 |
|------|------|------|
| 14 | `time-zone` | 独立模块，最先完成 |
| 15 | `time-convert` | 依赖 time-zone |
| 16 | `underworld-lifebook` | 生死簿是地府核心 |
| 17 | `underworld-merit` | 功德业障依赖 lifebook |
| 18 | `underworld-trial` | 审判依赖 lifebook + merit |
| 19 | `underworld-prison` | 关押依赖 trial + lifebook |
| 20 | `heaven-territory` | 区域是天庭核心 |
| 21 | `heaven-weather` | 依赖 territory |
| 22 | `heaven-lightning` | 依赖 territory |
| 23 | `heaven-disaster` | 依赖 territory + weather |
| 24 | `technique-catalog` | 功法目录是功法核心 |
| 25 | `technique-content` | 依赖 catalog |
| 26 | `technique-cultivation` | 依赖 catalog + member-realm |
| 27 | `technique-master` | 依赖 catalog + member-relationship |

### 第五梯队：跨域业务（依赖多个域）

| 顺序 | 模块 | 理由 |
|------|------|------|
| 28 | `karma-trigger` | 依赖 member-core + underworld-merit（功德核算） |
| 29 | `karma-record` | 依赖 karma-trigger |
| 30 | `notice-system` | 依赖 member-core + heaven-* + underworld-* |
| 31 | `notice-wanted` | 依赖 notice-system |

---

## 四、逻辑合并建议（减少服务数量）

以下模块建议**合并开发**，因为它们依赖关系紧密：

### 1. member-* 合并为一个服务：`member-service`

```
member-core + member-identity + member-realm + member-relationship + member-position
         ↓
原因：都是成员档案的一部分，分开反而增加 API 调用复杂度
```

### 2. underworld-* 合并为一个服务：`underworld-service`

```
underworld-lifebook + underworld-merit + underworld-trial + underworld-prison
         ↓
原因：生死簿、审判、关押是地府的一体流程，分开会有事务问题
```

### 3. heaven-* 合并为一个服务：`heaven-service`

```
heaven-territory + heaven-weather + heaven-lightning + heaven-disaster
         ↓
原因：天气/雷电/灾害都是天庭气象的不同侧面
```

### 4. karma-* 合并为一个服务：`karma-service`

```
karma-trigger + karma-record
         ↓
原因：触发和记录本就是因果关系
```

### 5. technique-* 合并为一个服务：`technique-service`

```
technique-catalog + technique-content + technique-cultivation + technique-master
         ↓
原因：功法内容和学习记录天然绑定
```

### 6. notice-* 合并为一个服务：`notice-service`

```
notice-system + notice-wanted
         ↓
原因：通报和通缉都是通知类业务
```

---

## 五、合并后的服务架构

```
tiandao-system/
│
├── common/                    # 公共库（3个）
│   ├── common-auth/
│   ├── common-event/
│   └── common-utils/
│
├── auth-service/            # 权限域（1个服务，4个模块）
│   └── auth-*
│
├── member-service/          # 成员域（1个服务，5个模块）
│   └── member-*
│
├── time-service/            # 时间域（1个服务，2个模块）
│   └── time-*
│
├── heaven-service/          # 天庭域（1个服务，4个模块）
│   └── heaven-*
│
├── underworld-service/       # 地府域（1个服务，4个模块）
│   └── underworld-*
│
├── karma-service/           # 现世报域（1个服务，2个模块）
│   └── karma-*
│
├── technique-service/        # 功法域（1个服务，4个模块）
│   └── technique-*
│
├── notice-service/          # 通讯域（1个服务，2个模块）
│   └── notice-*
│
├── gateway/                 # API网关
│
├── admin-web/               # PC管理后台
└── admin-app/               # 手机APP
```

**最终服务数量：9个业务服务 + 1个网关 + 2个前端**

---

## 六、模块间通信规则

### 规则1：同级服务禁止直接调用数据库
```
❌ underworld-service 不能直接读写 member-service 的数据库
✅ 通过 API 调用或事件总线
```

### 规则2：跨服务操作必须通过事件总线
```
案例：成员死亡（member-service）
  1. member-service 更新成员状态 → 发布事件 member.died
  2. underworld-service 订阅 member.died → 自动创建生死簿记录
  3. karma-service 订阅 member.died → 检查是否触发极重报
```

### 规则3：事件驱动解耦
```
┌─────────────────┐     事件总线      ┌─────────────────┐
│ member-service  │ ──────────────→ │ underworld-svc  │
└─────────────────┘                  └─────────────────┘
       │                                      │
       │ member.died 事件                    │ 订阅 member.died
       ▼                                      ▼
┌─────────────────┐                  ┌─────────────────┐
│  karma-service  │                  │ underworld-lb  │
└─────────────────┘                  └─────────────────┘
```

### 规则4：查询类用 API，命令类用事件
```
查询：成员信息 → GET /api/v1/members/{id}
命令：成员死亡 → 发布 member.died 事件（不直接调用 underworld API）
```

---

## 七、循环依赖检测与规避

### 潜在循环（需避免）：

```
karma-trigger ←→ underworld-merit
  karma-trigger 需要查询功德值变化
  underworld-merit 变化需要触发 karma-trigger

规避方案：
  功德值变化 → 发布 merit.changed 事件 → karma-trigger 订阅并判断是否触发现世报
```

```
member-position ←→ auth-role
  member-position 需要验证职位合法性
  auth-role 变更需要通知 member-position

规避方案：
  member-position 验证通过本地缓存或 auth-role 的只读 API
```

---

## 八、数据库 Schema 归属

| 服务 | Schema | 说明 |
|------|---------|------|
| `auth-service` | `auth` | role / permission / department / audit |
| `member-service` | `member` | member / member_identity / member_cultivation / member_relationship / member_position |
| `time-service` | `time` | time_zone_config / time_conversion_log |
| `heaven-service` | `heaven` | territory / weather_control / lightning_event / disaster_warning |
| `underworld-service` | `underworld` | lifebook / underworld_zone / underworld_hall / imprisonment / sentence / merit_record |
| `karma-service` | `karma` | instant_karma_record / instant_karma_trigger_rule / member_abnormal_record |
| `technique-service` | `technique` | technique / technique_version / technique_chapter / technique_video / technique_audio / cultivation_log / cultivation_assessment / master_apprentice |
| `notice-service` | `notice` | system_notice / notice_read_record / wanted_order |

**Schema 隔离原则**：每个服务只能操作自己 Schema 下的表，跨 Schema 必须通过 API。

---

## 九、最终开发顺序（合并后）

| 顺序 | 服务 | 模块数 | 理由 |
|------|------|--------|------|
| 1 | `common-*` | 3 | 无依赖，最底层 |
| 2 | `auth-service` | 4 | 所有服务依赖认证 |
| 3 | `member-service` | 5 | 成员是一切的基础 |
| 4 | `time-service` | 2 | 独立模块 |
| 5 | `underworld-service` | 4 | 地府核心业务 |
| 6 | `heaven-service` | 4 | 天庭核心业务 |
| 7 | `technique-service` | 4 | 功法核心业务 |
| 8 | `karma-service` | 2 | 现世报（依赖 underworld 功德） |
| 9 | `notice-service` | 2 | 通讯（依赖多个域） |
| 10 | `gateway` | 1 | API 聚合层 |
| 11 | `admin-web` | 1 | PC 管理后台 |
| 12 | `admin-app` | 1 | 手机 APP |

---

## 十、关键逻辑约束

### 约束1：member-service 必须最先完成
```
所有业务服务都依赖成员信息，member-service 是基石。
```

### 约束2：underworld-service 先于 karma-service
```
现世报依赖功德值，功德值在地府核算。
```

### 约束3：notice-service 最后完成
```
通报系统需要知道所有域的事件，才能发布全局通报。
```

### 约束4：同一域内模块用事务，不同域用事件
```
underworld-trial 创建判决 + 更新 lifebook 状态 → 同一 underworld-service 内事务
member.died → underworld-service 创建生死簿 → 跨服务事件
```
