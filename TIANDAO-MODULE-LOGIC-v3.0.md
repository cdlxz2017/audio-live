# 天道·系统 - 模块逻辑关系 v3.0

## 更新说明

**v3.0 综合了 DeepSeek / Qwen / Gemini 3 Flash 的评审意见，修复以下问题：**

| 问题 | 来源 | 修复方式 |
|------|------|---------|
| `technique ↔ karma` 关系未声明 | DeepSeek / Qwen | 新增 technique.practiced 事件订阅 |
| `notice-service` 放最后 | Qwen | 调整为底层支撑服务，member 后即可部署 |
| 缺少完整依赖矩阵 | Qwen | 分"同步依赖"和"事件订阅"两列 |
| `time & member` 并行 | Gemini | 调整开发顺序 |
| 缺少资源/物品域 | Gemini | 新增 resource-service |
| time-service 去中心化 | Qwen | 每个服务维护自己时间计数器，time-service 仅广播 |
| 事件机制缺少幂等性 | DeepSeek | 统一事件格式含 eventId (UUID) |
| 成员删除级联未定义 | Qwen | 新增 member.deleted 事件及订阅处理 |

---

## 一、服务架构（最终版）

```
tiandao-system/
│
├── common/                    # 公共库
│   ├── common-auth/         # 认证授权
│   ├── common-event/        # 事件总线客户端
│   ├── common-exception/   # 统一异常
│   └── common-utils/       # 工具函数
│
├── auth-service/           # 权限域（最先部署）
├── member-service/         # 成员域（核心基础）
├── time-service/          # 时间域（仅广播时间推进事件）
├── underworld-service/    # 地府域
├── heaven-service/       # 天庭域
├── karma-service/        # 现世报域
├── technique-service/     # 功法域
├── resource-service/     # 【新增】资源物品域（灵石/法宝/丹药）
├── notice-service/      # 通讯域（底层支撑，提早部署）
├── gateway/            # API网关
├── admin-web/          # PC管理后台
└── admin-app/          # 手机APP
```

---

## 二、完整依赖矩阵

### 2.1 同步依赖（API 调用）

| 服务 | 同步依赖 | 说明 |
|------|---------|------|
| `auth-service` | `member-service` | 登录验证需查询成员 |
| `member-service` | — | 无外部同步依赖 |
| `time-service` | — | 无外部同步依赖（仅广播事件） |
| `underworld-service` | `member-service` | 生死簿归属成员 |
| `heaven-service` | `member-service` | 天神归属成员 |
| `karma-service` | `member-service`, `underworld-service` | 查询成员 + 功德值 |
| `technique-service` | `member-service` | 功法归属成员 |
| `resource-service` | `member-service` | 物品归属成员 |
| `notice-service` | `member-service` | 通知需知接收者 |
| `gateway` | `auth-service`, 所有业务服务 | 路由 + 鉴权 |

### 2.2 事件订阅 + 发布矩阵

| 服务 | 订阅事件 | 发布事件 |
|------|---------|---------|
| `member-service` | — | `member.created`, `member.updated`, `member.deleted`, `member.realm_changed` |
| `underworld-service` | `member.deleted`（创建生死簿）, `technique.practiced`（更新功德） | `merit.changed`, `soul.state_changed` |
| `heaven-service` | `member.created`, `member.deleted` | `heaven.promoted`, `heaven.demoted` |
| `karma-service` | `merit.changed`（判断是否触发现世报）, `member.deleted` | `karma.triggered`, `karma.resolved` |
| `technique-service` | — | `technique.practiced`, `technique.mastered`, `technique.learned` |
| `resource-service` | `technique.learned`（发放功法物品）, `karma.triggered`（消耗物品） | `resource.changed` |
| `notice-service` | **所有事件**（全局监控） | `notice.sent` |
| `time-service` | — | `time.tick`（定时广播时间推进） |

---

## 三、循环依赖规避

| 循环对 | 解决方案 |
|--------|---------|
| `karma-service ↔ underworld-service` | `underworld-service` 发布 `merit.changed` 事件，`karma-service` 订阅判断 |
| `technique-service ↔ karma-service` | `technique-service` 发布 `technique.practiced` 事件，`karma-service` 订阅并更新功德 |
| `heaven-service ↔ underworld-service` | 通过 `member.realm_changed` 事件解耦，各自更新自己状态 |
| `resource-service ↔ karma-service` | `resource-service` 订阅 `karma.triggered` 消耗物品，发布 `resource.changed` |

---

## 四、time-service 去中心化设计

### 原则

每个服务维护自己的**逻辑时钟**（在数据库中存储），不依赖 time-service 的实时性。

### time-service 职责

```
仅负责：定时广播"时间推进"事件
不负责：各服务的具体计时逻辑
```

### 各服务的逻辑时钟

```sql
-- member-service：维护成员逻辑时间
ALTER TABLE member ADD COLUMN logic_time TIMESTAMPTZ;

-- underworld-service：维护魂魄计时（刑期计算）
ALTER TABLE imprisonment ADD COLUMN remaining_days INTEGER;

-- technique-service：维护修行计时（闭关时间）
ALTER TABLE cultivation_log ADD COLUMN accumulated_hours INTEGER;
```

### 时间推进流程

```
time-service 每分钟广播 time.tick 事件
         ↓
各服务收到后自行+1（解耦，不阻塞）
         ↓
成员寿元到期 → underworld-service 创建生死簿记录
         ↓
修行计时到期 → technique-service 触发考核
```

---

## 五、成员删除级联处理

### 事件：`member.deleted`

```json
{
  "event": "member.deleted",
  "version": "1.0",
  "timestamp": "2026-04-05T03:00:00Z",
  "source": "member-service",
  "id": "uuid-v4",
  "payload": {
    "memberId": "xxx",
    "deletedBy": "admin-xxx",
    "reason": "自然死亡/陨落/除名"
  }
}
```

### 各服务订阅处理

| 服务 | 订阅处理 |
|------|---------|
| `underworld-service` | 创建生死簿记录，状态设为"已死" |
| `karma-service` | 结束所有生效中的现世报 |
| `technique-service` | 标记功法学习记录为"终止" |
| `resource-service` | 物品回归仓库或继承 |
| `notice-service` | 发送通知给相关方 |
| `heaven-service` | 移除天神身份 |

---

## 六、统一事件格式

### HeavenlyEvent 标准结构

```json
{
  "event": "merit.changed",
  "version": "1.0",
  "timestamp": "2026-04-05T03:00:00Z",
  "source": "underworld-service",
  "correlationId": "uuid-xxx",
  "id": "uuid-v4",
  "idempotencyKey": "uuid-v4",
  "payload": {
    "memberId": "xxx",
    "delta": -100,
    "reason": "karma_triggered",
    "currentBalance": 500
  }
}
```

**关键字段：**
- `id`（UUIDv4）：唯一标识，用于去重
- `idempotencyKey`：业务唯一键，防止重复消费
- `correlationId`：关联追踪，用于链路追踪
- `version`：事件版本，向后兼容

### 事件处理保障

| 保障 | 实现方式 |
|------|---------|
| 幂等性 | Consumer 根据 `idempotencyKey` 去重 |
| 重试机制 | RabbitMQ/Kafka 自动重试 3 次，指数退避 |
| 死信队列 | 重试失败投入 DLQ，7 天保留 + 告警 |
| 顺序保证 | 同一 memberId 的事件需有序，通过 partition key 保证 |

---

## 七、resource-service【新增】

### 职责

管理三界通用资源：灵石、法宝、丹药、天材地宝等。

### 核心表

```sql
-- 资源定义表
CREATE TABLE resource (
    id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL, -- 灵石/法宝/丹药/材料
    grade VARCHAR(20) NOT NULL,  -- 凡品/灵品/仙品/神品
    effect TEXT,
    rarity VARCHAR(20) NOT NULL,   -- 常见/稀有/罕见/独一无二
    is_transferable BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 成员持有资源表
CREATE TABLE member_resource (
    id UUID PRIMARY KEY,
    member_id UUID NOT NULL REFERENCES member(id),
    resource_id UUID NOT NULL REFERENCES resource(id),
    quantity INTEGER NOT NULL DEFAULT 1,
    acquired_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    is_bound BOOLEAN DEFAULT FALSE,
    UNIQUE(member_id, resource_id)
);
```

### 事件订阅

| 触发 | 动作 |
|------|------|
| `technique.learned` | 发放对应功法材料 |
| `karma.triggered` | 消耗物品（道具抵消部分惩罚） |
| `member.deleted` | 物品回归仓库 |

---

## 八、开发顺序（调整后）

```
第一阶段（公共基础设施）：
  common-auth → common-event → common-exception → common-utils

第二阶段（核心基础）：
  auth-service → member-service
            ↓ 并行
  notice-service（全局通知，依赖最少）

第三阶段（基础业务）：
  time-service（仅广播，无需其他依赖）
  underworld-service（依赖 member + notice）
  heaven-service（依赖 member + notice）
  resource-service（依赖 member + underworld）

第四阶段（业务逻辑）：
  technique-service（依赖 member + resource）
  karma-service（依赖 member + underworld + technique）

第五阶段（接入层）：
  gateway
  admin-web
  admin-app
```

---

## 九、服务 SLA 与健康检查

| 服务 | SLA | 健康检查端点 |
|------|-----|------------|
| `auth-service` | 99.9% | GET /health |
| `member-service` | 99.9% | GET /health |
| `time-service` | 99.5% | GET /health |
| `underworld-service` | 99.9% | GET /health |
| `heaven-service` | 99.9% | GET /health |
| `karma-service` | 99.5% | GET /health |
| `technique-service` | 99.5% | GET /health |
| `resource-service` | 99.5% | GET /health |
| `notice-service` | 99.9% | GET /health |
| `gateway` | 99.99% | GET /health |

---

## 十、部署约束

| 约束 | 说明 |
|------|------|
| 每个服务必须有 `/health` 端点 | 用于 K8s liveness/readiness |
| 所有跨服务调用必须设置 timeout | 默认 5s，超时重试 2 次 |
| 所有事件发布必须带 eventId | 用于幂等去重 |
| 生产环境禁止硬编码服务地址 | 使用服务发现（Consul/K8s DNS） |
| 敏感操作必须记录 audit_log | member.delete / role.assign 等 |
