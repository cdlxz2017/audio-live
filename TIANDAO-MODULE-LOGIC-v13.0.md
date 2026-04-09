# 天道·系统 - 模块逻辑关系 v13.0

## 更新说明

**v13.0 修复：calculateKarmaDeltaWithAccountability 函数签名补 event 参数 + 返回类型修正 Promise<number>**

**v12.0 修复：confidenceScore语法错误 + determineAccountabilityFactor async化 + getMemberOrganizationType函数体**

**v11.0 修复：调用链路闭合 + median函数 + excess消费者 + DLQ + accountability因子**

**v10.0 新增：中优先级问题修复（问题6-10：手动触发/位置更新/无辜保护/resource订阅/多源校验）**

**v9.0 修复：INSERT RETURNING* 原子化幂等消除幻读**

**v8.0 修复：alert真实webhook + DLQ完整failedMembers + FOR UPDATE幂等 + JSONB注释 + 背压说明**

**v6.0 修复：Redis共享状态层 + Saga事务 + UNION ALL索引优化 + karma方向明确 + JSONB关联表化**

**v4.0 新增：现实世界事件接入层（world-event-service）**

将现实世界的天气、自然灾害、战争、瘟疫等事件实时接入天道系统，映射为三界的因果报应、天庭管控、地府记录。

---

## 一、核心设计理念

### 现实事件 → 天道映射关系

| 现实事件 | 天道映射 | 影响 |
|---------|---------|------|
| 大规模自然灾害（地震/洪水） | 天地失常 | 影响区域内成员功德 |
| 战争/冲突 | 三界动荡 | 双方参战者增减功德/业障 |
| 瘟疫/传染病 | 疫病流行 | 相关区域成员触发现世报 |
| 极端天气（暴雨/干旱） | 天象异变 | 天庭气象系统调整 |
| 重大事故 | 因果报应 | 责任人触发极重报 |
| 科技进步/文化繁荣 | 天道昌明 | 全体成员功德微量提升 |

---

## 二、服务架构（新增 world-event-service）

```
tiandao-system/
│
├── common/                    # 公共库
│
├── auth-service/            # 权限域
├── member-service/          # 成员域
├── time-service/           # 时间域
├── underworld-service/     # 地府域
├── heaven-service/        # 天庭域
├── karma-service/         # 现世报域
├── technique-service/      # 功法域
├── resource-service/      # 资源物品域
├── notice-service/       # 通讯域
│
├── 【NEW】world-event-service/  # 现实世界事件接入层
│
├── gateway/
├── admin-web/
└── admin-app/
```

---

## 三、world-event-service 详解

### 3.1 职责

```
现实世界 ←→ 天道系统 的桥梁
1. 实时采集现实世界事件
2. 映射为天道因果（功德/业障/现世报）
3. 触发相应的三界业务逻辑
```

### 3.2 数据来源

| 数据类型 | 来源 | 说明 |
|---------|------|------|
| 天气 | wttr.in / Open-Meteo API | 免费，无需key |
| 自然灾害 | GDACS / USGS地震API | 地震/海啸/火山 |
| 战争/冲突 | News API / Wikipedia | 实时舆情监控 |
| 瘟疫 | WHO API / 卫健委 | 传染病数据 |
| 重大事故 | News API | 交通事故/火灾等 |
| 经济指标 | 世界银行API | 经济波动影响三界气运 |

### 3.3 核心表

```sql
-- 现实事件表
CREATE TABLE real_world_event (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type      VARCHAR(50) NOT NULL COMMENT '自然灾害/战争/瘟疫/天气/事故/科技',
    source          VARCHAR(100) NOT NULL COMMENT '数据来源API',
    source_event_id VARCHAR(100) NOT NULL COMMENT '原始事件ID',
    title           VARCHAR(500) NOT NULL COMMENT '事件标题',
    description     TEXT COMMENT '事件描述',
    severity        INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 10) COMMENT '严重程度 1-10',
    latitude        DECIMAL(10,7) COMMENT '事件纬度',
    longitude       DECIMAL(11,7) COMMENT '事件经度',
    affected_radius_km DECIMAL(10,2) COMMENT '影响半径（公里）',
    affected_region VARCHAR(200) COMMENT '影响区域名称',
    happened_at     TIMESTAMPTZ NOT NULL COMMENT '事件发生时间',
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed      BOOLEAN NOT NULL DEFAULT FALSE,
    processed_at   TIMESTAMPTZ,
    metadata       JSONB COMMENT '原始API响应数据'
);

-- 事件与天道映射规则表
CREATE TABLE event_karma_mapping (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    real_event_type VARCHAR(50) NOT NULL COMMENT '现实事件类型',
    karma_type      VARCHAR(20) NOT NULL COMMENT '功德/业障',
    level           VARCHAR(20) NOT NULL COMMENT '报应级别',
    karma_delta_min INTEGER NOT NULL COMMENT '功德变化下限',
    karma_delta_max INTEGER NOT NULL COMMENT '功德变化上限',
    trigger_radius_km DECIMAL(10,2) NOT NULL DEFAULT 50 COMMENT '触发半径',
    description     TEXT COMMENT '规则说明',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 事件影响记录表
CREATE TABLE event_impact (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID NOT NULL REFERENCES real_world_event(id),
    member_id       UUID NOT NULL REFERENCES member(id),
    karma_delta     INTEGER NOT NULL COMMENT '功德变化量',
    impact_type     VARCHAR(20) NOT NULL COMMENT 'instant_karma/lifebook/heaven',
    status          VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending/processed/failed',
    processed_at    TIMESTAMPTZ,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 3.4 初始映射规则

```sql
INSERT INTO event_karma_mapping (real_event_type, karma_type, level, karma_delta_min, karma_delta_max, trigger_radius_km, description) VALUES
-- 自然灾害
('earthquake', '业障', '重度', -500, -200, 100, '地震：区域内所有成员增加业障'),
('flood', '业障', '中度', -200, -50, 80, '洪水：低洼地区成员增加业障'),
('typhoon', '业障', '中度', -150, -30, 100, '台风：路径区域成员增加业障'),
('drought', '业障', '轻度', -50, -10, 150, '旱灾：区域内成员增加业障'),
('wildfire', '业障', '重度', -400, -100, 50, '山火：附近成员增加业障'),
('tsunami', '业障', '极重', -1000, -500, 150, '海啸：沿海区域极重业障'),
-- 战争/冲突
('war', '业障', '重度', -800, -100, 500, '战争：参战国全体成员影响'),
('terrorist_attack', '业障', '重度', -500, -100, 50, '恐袭：事发地附近成员'),
('riot', '业障', '轻度', -100, -20, 30, '骚乱：参与者增加业障'),
-- 瘟疫
('pandemic', '业障', '重度', -300, -50, 500, '大流行疾病：全球成员受影响'),
('epidemic', '业障', '中度', -100, -20, 200, '区域性疫情'),
-- 天气极端
('extreme_heat', '业障', '轻度', -30, -5, 100, '极端高温'),
('extreme_cold', '业障', '轻度', -30, -5, 100, '极端低温'),
-- 正面事件
('scientific_breakthrough', '功德', '小祥', 10, 50, 500, '科技进步：全体成员微量功德'),
('peace_treaty', '功德', '中祥', 50, 200, 300, '和平条约：签署国成员功德提升'),
('disaster_rescue', '功德', '中祥', 100, 500, 50, '救灾：救援者功德大幅提升');
```

---

## 四、world-event-service 与现有服务的交互

### 4.1 事件订阅矩阵（扩展）

| 服务 | 发布事件 | 订阅事件 |
|------|---------|---------|
| `world-event-service` | `world.event.occurred`, `world.event.processed` | — |
| `member-service` | `member.created`, `member.realm_changed`, `member.deleted` | — |
| `karma-service` | `karma.triggered` | `world.event.occurred`, `merit.changed` |
| `underworld-service` | `merit.changed`, `soul.state_changed` | `world.event.occurred` |
| `heaven-service` | `heaven.promoted` | `world.event.occurred` |
| `notice-service` | `notice.sent` | `world.event.occurred` |

### 4.2 同步依赖（扩展）

| 服务 | 依赖 | 说明 |
|------|------|------|
| `world-event-service` | `member-service` | 查询受影响成员地理位置 |
| `world-event-service` | `karma-service` | 触发业障计算 |
| `world-event-service` | `underworld-service` | 批量创建死亡记录 |
| `world-event-service` | `heaven-service` | 同步天气/灾害预警 |

### 4.3 业务流程

#### 流程A：地震事件处理

```
world-event-service 采集 USGS 地震数据
         ↓
解析震级/震中/影响范围
         ↓
查询受影响区域内的 member 列表
（基于 member.last_known_location 过滤）
         ↓
根据 event_karma_mapping 计算各成员 karma 变化
         ↓
发布 world.event.occurred 事件
         ↓
┌─────────────────┬─────────────────┬─────────────────┐
│ karma-service    │ underworld-service│ heaven-service  │
│ 订阅并触发业障  │ 订阅并创建死亡记录│ 订阅并触发预警  │
└─────────────────┴─────────────────┴─────────────────┘
         ↓
发布 world.event.processed
         ↓
notice-service 全网通报（可配置）
```

#### 流程B：战争事件处理

```
world-event-service 采集 News API 战争新闻
         ↓
识别战争双方国家
         ↓
查询双方国家所有 member
         ↓
计算 karma 影响（攻方业障增加，守方视情况）
         ↓
发布 world.event.occurred
         ↓
karma-service 批量更新功德
         ↓
notice-service 发布三界通报
```

---

## 五、成员地理位置扩展

为了支持现实事件影响，需要 member 表增加位置字段：

```sql
ALTER TABLE member ADD COLUMN last_known_latitude DECIMAL(10,7);
ALTER TABLE member ADD COLUMN last_known_longitude DECIMAL(11,7);
ALTER TABLE member ADD COLUMN last_location_updated_at TIMESTAMPTZ;

CREATE INDEX idx_member_location ON member(last_known_latitude, last_known_longitude);
```

---

## 六、依赖矩阵（v4.0 最终版）

### 6.1 同步依赖（API 调用）

| 服务 | 同步依赖 | 说明 |
|------|---------|------|
| `auth-service` | `member-service` | 登录验证 |
| `member-service` | — | 无外部依赖 |
| `time-service` | — | 无外部依赖 |
| `world-event-service` | `member-service`, `karma-service`, `underworld-service`, `heaven-service` | 事件采集后触发各服务 |
| `underworld-service` | `member-service` | 生死簿归属成员 |
| `heaven-service` | `member-service` | 天神归属成员 |
| `karma-service` | `member-service`, `underworld-service` | 查询成员境界 + 功德值 |
| `technique-service` | `member-service` | 功法归属成员 |
| `resource-service` | `member-service` | 物品归属成员 |
| `notice-service` | `member-service` | 通知归属成员 |

### 6.2 事件订阅 + 发布矩阵（完整版）

| 服务 | 发布事件 | 订阅事件 |
|------|---------|---------|
| `member-service` | `member.created`, `member.updated`, `member.deleted`, `member.realm_changed` | — |
| `underworld-service` | `merit.changed`, `soul.state_changed` | `member.deleted`, `world.event.occurred`, `technique.practiced` |
| `heaven-service` | `heaven.promoted`, `heaven.demoted` | `member.created`, `member.deleted`, `member.realm_changed`, `world.event.occurred` |
| `karma-service` | `karma.triggered`, `karma.resolved` | `merit.changed`, `member.deleted`, `member.realm_changed`, `world.event.occurred` |
| `technique-service` | `technique.practiced`, `technique.mastered`, `technique.learned` | — |
| `resource-service` | `resource.changed`, `resource.insufficient` | `technique.learned`, `karma.triggered`, `member.deleted` |
| `notice-service` | `notice.sent` | **所有事件** |
| `time-service` | `time.tick` | — |
| `world-event-service` | `world.event.occurred`, `world.event.processed` | — |

---

## 七、member.realm_changed 事件（补充定义）

### Payload 结构

```json
{
  "event": "member.realm_changed",
  "version": "1.0",
  "timestamp": "2026-04-05T03:00:00Z",
  "source": "member-service",
  "id": "uuid-v4",
  "idempotencyKey": "member-realm-{memberId}-{timestamp}",
  "correlationId": "uuid-xxx",
  "payload": {
    "memberId": "xxx",
    "oldRealm": "人间散修",
    "newRealm": "天庭",
    "changeReason": "飞升/贬入地府/轮回",
    "karmaCoefficient": 1.5,
    "oldKarmaCoefficient": 1.0,
    "metadata": {
      "flyingDate": "2026-04-05",
      "previousRealm": "金丹期"
    }
  }
}
```

**订阅处理：**
| 服务 | 订阅处理 |
|------|---------|
| `heaven-service` | 更新天神身份记录 |
| `underworld-service` | 更新魂魄归属 |
| `karma-service` | **重新计算 karma 系数**（当前缺失，需补充） |

---

## 八、time.tick 事件（增强）

### Payload 结构（含 sequence）

```json
{
  "event": "time.tick",
  "version": "1.0",
  "timestamp": "2026-04-05T03:00:00Z",
  "source": "time-service",
  "id": "uuid-v4",
  "idempotencyKey": "time-tick-{tick_sequence}",
  "correlationId": "time-tick-{tick_sequence}",
  "payload": {
    "tickSequence": 1234567,
    "tickTimestamp": "2026-04-05T03:00:00Z",
    "realmTimeMapping": {
      "人间": "2026-04-05T03:00:00Z",
      "天庭": "2026-04-05T03:00:00Z",
      "地府": "2026-04-05T03:00:00Z"
    }
  }
}
```

**漂移补偿**：各服务维护 `last_processed_sequence`，收到 tick 时对比，发现跳号则批量追赶。

---

## 九、开发顺序（v4.0）

```
第一阶段（公共基础设施）：
  common-auth → common-event → common-exception → common-utils

第二阶段（核心基础）：
  auth-service → member-service → notice-service

第三阶段（基础业务）：
  time-service
  underworld-service
  heaven-service
  resource-service

第四阶段（业务逻辑）：
  technique-service
  karma-service

第五阶段（现实接入）【新增】：
  world-event-service（依赖 member + karma + underworld + heaven）

第六阶段（接入层）：
  gateway
  admin-web
  admin-app
```

---

## 十、幂等性规范（统一）

**所有事件的幂等处理：**

```sql
-- 各服务必须有此表
-- v7.0 新增 payload 列：支持同一事件对不同 member/操作粒度的幂等追踪
CREATE TABLE consumed_events (
    event_id     UUID NOT NULL,
    service_name VARCHAR(50) NOT NULL,
    payload      JSONB,                              -- v7.0 新增：存储 {memberId} 等额外键
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_id, service_name, payload)   -- v7.0 PK 含 payload（JSONB 可参与 PK）
);

-- 消费前检查（支持按 payload 精确去重）
SELECT 1 FROM consumed_events
WHERE event_id = :event_id
  AND service_name = :my_service
  AND (:payload IS NULL OR payload = :payload)
FOR UPDATE;

-- 消费后写入（payload = JSON 字符串，用于 karma-batch 等需要成员维度的场景）
INSERT INTO consumed_events (event_id, service_name, payload)
VALUES (:event_id, :my_service, :payload)
ON CONFLICT (event_id, service_name, payload) DO NOTHING;
```

---

## 十一、资源消耗双向确认（针对 karma ↔ resource）

**TCC 模式：**

```
Step 1: karma-service 发起资源预留请求
  → resource-service 锁定 karma_trigger_id + 物品数量
  → 返回预留结果

Step 2: 预留成功
  → karma-service 正式触发现世报
  → resource-service 确认扣减

Step 3: 预留失败（物品不足）
  → karma-service 执行降级逻辑（加重处罚或其他）
```

---

## 十二、高优先级问题修复（v9.0）

> v9.0 修复（针对 v8.0 Qwen 评审）：
> - P0：consumed_events schema 统一（Section 10/12 合并，加 payload 列 + PK 含 payload）
> - P0：batch-trigger 串行 → 分批并发（Promise.all 50条/批）+ 失败写死信队列 + 阈值告警
> - P1：karma 取整 Math.floor → Math.trunc（负数向零取整修正）
> - v6.0 原修复（Redis + UNION ALL + 关联表 + Jitter 等）保持不变

---

### 问题 1：外部 API 无熔断/容错机制（v7.0 修复）

**修复：① Retry 加 Jitter 防雷鸣 herd　② Fallback 改 Redis　③ 熔断状态写 Redis 跨实例同步**

```typescript
// Redis Key 规范（全部带 TTL，支持多实例共享）
// circuit_breaker:{apiName}:state     -> 'closed'|'open'|'half-open'
// circuit_breaker:{apiName}:failures  -> int（连续失败计数）
// circuit_breaker:{apiName}:open_until -> timestamp（熔断到期时间）
// fallback:{apiName}                  -> JSON（TTL 1小时）

// 带 Jitter 的 Retry（指数退避 + 随机抖动）
async function callWithRetry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number }
): Promise<T> {
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === options.maxAttempts) throw err;
      const jitter = 0.5 + Math.random();
      const delay = Math.min(
        options.baseDelayMs * Math.pow(2, attempt - 1) * jitter,
        options.maxDelayMs
      );
      await sleep(delay);
    }
  }
  throw new Error('unreachable');
}

// 熔断器（状态写 Redis，各实例共享同一份状态）
async function callWithCircuitBreaker<T>(apiName: string, fn: () => Promise<T>): Promise<T> {
  const state = await redis.get(`circuit_breaker:${apiName}:state`);

  if (state === 'open') {
    const openUntil = await redis.get(`circuit_breaker:${apiName}:open_until`);
    if (openUntil && Date.now() < Number(openUntil)) {
      throw new ServiceUnavailableError(`API ${apiName} circuit breaker is open`);
    }
    await redis.set(`circuit_breaker:${apiName}:state`, 'half-open');
  }

  try {
    const result = await fn();
    await redis.del(`circuit_breaker:${apiName}:failures`);
    await redis.set(`circuit_breaker:${apiName}:state`, 'closed');
    return result;
  } catch (err) {
    const failures = await redis.incr(`circuit_breaker:${apiName}:failures`);
    if (failures >= 5) {
      await redis.set(`circuit_breaker:${apiName}:state`, 'open');
      await redis.set(`circuit_breaker:${apiName}:open_until`, String(Date.now() + 30_000));
    }
    throw err;
  }
}

// Fallback 数据（存 Redis，带 TTL，API 恢复后自动失效）
async function getFallback<T>(apiName: string): Promise<T | null> {
  const raw = await redis.get(`fallback:${apiName}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function setFallback<T>(apiName: string, data: T, ttlSeconds = 3600): Promise<void> {
  await redis.set(`fallback:${apiName}`, JSON.stringify(data), 'EX', ttlSeconds);
}

// 综合调用（三层：Retry -> Circuit Breaker -> Fallback -> Error）
async function callExternalAPI<T>(
  apiName: string,
  fn: () => Promise<T>,
  fallbackFactory: () => T
): Promise<T> {
  try {
    return await callWithRetry(() => callWithCircuitBreaker(apiName, fn), {
      maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 2000
    });
  } catch (err) {
    const cached = await getFallback<T>(apiName);
    if (cached !== null) {
      console.warn(`[Resilience] API ${apiName} failed, using fallback:`, err.message);
      return cached;
    }
    const degraded = fallbackFactory();
    await setFallback(apiName, degraded);
    console.error(`[Resilience] No fallback cached for ${apiName}, using degraded response`);
    return degraded;
  }
}
```

**各 API 降级响应工厂：**

| API | 降级响应 | 说明 |
|-----|---------|------|
| wttr.in | `{ temperature: null, condition: "unknown", source: "fallback" }` | 气温未知，不影响主流程 |
| USGS 地震 | `[]`（空事件数组，source 标记为 fallback） | 空事件，降级日志记录 |
| News API | `[]` | 空事件，降级日志记录 |
| WHO 瘟疫 | `[]` | 空事件 |

---

### 问题 2：地理查询无 PostGIS，批量处理会爆炸（v7.0 修复）

**修复：① UNION ALL 每个 box 独立走索引　② 改用 keyset cursor 分页　③ 碎片数量硬上限 20 个**

```typescript
// 碎片化（硬上限 20 个，防止查询爆炸）
function buildBoundingBoxFragments(
  centerLat: number, centerLon: number, radiusKm: number,
  gridSizeKm: number = 50
): BoundingBox[] {
  const fragments: BoundingBox[] = [];
  for (let dLat = -radiusKm; dLat <= radiusKm; dLat += gridSizeKm) {
    for (let dLon = -radiusKm; dLon <= radiusKm; dLon += gridSizeKm) {
      const box = {
        minLat: centerLat + dLat / 111,
        maxLat: centerLat + (dLat + gridSizeKm) / 111,
        minLon: centerLon + dLon / (111 * Math.cos(toRadians(centerLat))),
        maxLon: centerLon + (dLon + gridSizeKm) / (111 * Math.cos(toRadians(centerLat))),
      };
      if (intersectsCircle(box, centerLat, centerLon, radiusKm)) {
        fragments.push(box);
      }
    }
  }
  if (fragments.length > 20) {
    return buildBoundingBoxFragments(centerLat, centerLon, radiusKm, gridSizeKm * 2);
  }
  return fragments;
}

// UNION ALL 查询（每个 box 独立走 idx_member_location 索引）
async function queryMembersInBoxes(
  boxes: BoundingBox[],
  filters: { realms?: string[]; statuses?: string[] },
  options: { limit: number; cursorId?: string; cursorLat?: number; cursorLon?: number }
): Promise<{ members: Member[]; nextCursor: string | null }> {
  const limitedBoxes = boxes.slice(0, 20);
  if (limitedBoxes.length === 0) return { members: [], nextCursor: null };

  const unionParts = limitedBoxes.map((box, i) => `
    SELECT id, name, realm, karma_coefficient,
           last_known_latitude AS lat, last_known_longitude AS lon
    FROM member
    WHERE last_known_latitude  BETWEEN :minLat${i} AND :maxLat${i}
      AND last_known_longitude BETWEEN :minLon${i} AND :maxLon${i}
  `).join('\n  UNION ALL\n');

  const params: Record<string, any> = {};
  limitedBoxes.forEach((box, i) => {
    params[`minLat${i}`] = box.minLat; params[`maxLat${i}`] = box.maxLat;
    params[`minLon${i}`] = box.minLon; params[`maxLon${i}`] = box.maxLon;
  });

  if (options.cursorId) {
    params.cursorLat = options.cursorLat;
    params.cursorLon = options.cursorLon;
    params.cursorId = options.cursorId;
  }

  const filterRealms   = filters.realms?.length   ? `AND realm   = ANY(:realms)`   : '';
  const filterStatuses = filters.statuses?.length ? `AND status  = ANY(:statuses)` : '';
  const cursorClause   = options.cursorId
    ? `AND (last_known_latitude, last_known_longitude, id) > (:cursorLat, :cursorLon, :cursorId)`
    : '';

  const sql = `
    SELECT * FROM (
      ${unionParts}
    ) AS box_results
    WHERE 1=1 ${filterRealms} ${filterStatuses} ${cursorClause}
    ORDER BY last_known_latitude, last_known_longitude, id
    LIMIT :limit
  `;
  params.limit = options.limit;
  if (filters.realms?.length)   params.realms   = filters.realms;
  if (filters.statuses?.length) params.statuses = filters.statuses;

  const rows: Member[] = await db.query(sql, { params });
  const nextCursor = rows.length === options.limit ? encodeCursor(rows[rows.length - 1]) : null;
  return { members: rows, nextCursor };
}

// 批量处理（keyset cursor 分页，无 OFFSET 性能退化）
async function processEventImpact(event: RealWorldEvent, boxes: BoundingBox[]): Promise<void> {
  let cursor: string | null = null;
  const batchSize = 100;

  while (true) {
    const cur = cursor ? parseCursor(cursor) : null;
    const { members, nextCursor } = await queryMembersInBoxes(boxes, {}, {
      limit: batchSize,
      ...(cur ? { cursorId: cur.id, cursorLat: cur.lat, cursorLon: cur.lon } : {})
    });
    if (members.length === 0) break;
    await processBatch(members, event);
    cursor = nextCursor;
    if (!cursor) break;
    await sleep(10);
  }
}
```

**关键改进：**

| 修复点 | v5.0 问题 | v6.0 修复 |
|--------|----------|----------|
| 多 box 查询 | OR 连接，PostgreSQL 无法同时用两个独立索引 | UNION ALL 每个子查询独立走 idx_member_location |
| 分页方式 | LIMIT/OFFSET 大 offset 时性能退化 | keyset cursor（无 OFFSET）|
| 碎片数量 | 无上限，大灾难产生数百碎片 | 硬上限 20，超出自动递归缩小 gridSize |
| 内存 | queryMembersInBox 返回完整数组 | 流式分批获取，不在内存堆积 |

---

### 问题 3：映射规则太粗，需公式化（v7.0 修复）

**修复：① karma 方向由 karma_type 决定（正负号）　② realm_multipliers JSONB 改关联表（可索引+类型校验）　③ 公式取整规则明确**

```typescript
// 领域系数关联表（取代 JSONB，支持索引 + 类型安全）
// CREATE TABLE event_realm_multiplier (
//   mapping_id  UUID REFERENCES event_karma_mapping(id) ON DELETE CASCADE,
//   realm       VARCHAR(20) NOT NULL,
//   multiplier  DECIMAL(5,3) NOT NULL CHECK (multiplier >= 0 AND multiplier <= 10),
//   PRIMARY KEY (mapping_id, realm)
// );
// CREATE INDEX idx_erm_realm ON event_realm_multiplier(realm);

// 公式实现（v3.0）
function calculateKarmaDelta(
  rule: KarmaMappingRule,
  realmMultipliers: Map<string, number>,
  params: {
    severity: number;
    distanceKm: number;
    memberRealm: string;
    karmaCoefficient: number;
    karmaType: '功德' | '业障';
  }
): number {
  const { severity, distanceKm, memberRealm, karmaCoefficient, karmaType } = params;

  // Step 1: 方向（功德为正，业障为负）
  const direction: -1 | 1 = karmaType === '功德' ? 1 : -1;

  // Step 2: 基础严重度（severity 1-10 -> 0.0-1.0）
  const normalizedSeverity = severity / 10;

  // Step 3: 距离衰减（ratio=1 时为触发半径边界，factor->0）
  const ratio = Math.min(distanceKm / rule.trigger_radius_km, 1.0);
  const distanceFactor = (() => {
    switch (rule.distance_decay) {
      case 'linear':         return 1 - ratio;
      case 'inverse_square': return 1 / (1 + ratio * ratio);
      case 'exponential':    return Math.exp(-3 * ratio);
    }
  })();

  // Step 4: 领域系数（关联表查询，默认 1.0）
  const realmMultiplier = realmMultipliers.get(memberRealm) ?? 1.0;

  // Step 5: 境界系数（cbrt 替代 sqrt，平滑衰减）
  const coefficientFactor = rule.karma_coefficient_factor
    ? 1 / Math.cbrt(karmaCoefficient)
    : 1.0;

  // Step 6: 综合计算（Math.trunc 向零取整，负数 -2.7 -> -2，与数学截断一致）
  // 注意：业障（direction=-1）时，finalDelta 本身为负，trunc 保证负数绝对值不被缩小
  const rawDelta = rule.karma_delta_min +
    (rule.karma_delta_max - rule.karma_delta_min) * normalizedSeverity * rule.severity_weight;

  const finalDelta = Math.trunc(
    direction * rawDelta * distanceFactor * realmMultiplier * coefficientFactor
  );

  return Math.max(rule.karma_delta_min, Math.min(rule.karma_delta_max, finalDelta));
}
```

**event_karma_mapping 表 DDL 变更：**

```sql
-- 新增字段
ALTER TABLE event_karma_mapping
  ADD COLUMN severity_weight          DECIMAL(3,2) NOT NULL DEFAULT 1.0,
  ADD COLUMN distance_decay           VARCHAR(20) NOT NULL DEFAULT 'inverse_square'
    CHECK (distance_decay IN ('linear', 'inverse_square', 'exponential')),
  ADD COLUMN karma_coefficient_factor BOOLEAN NOT NULL DEFAULT FALSE;

-- realm_multipliers JSONB -> 迁移到关联表后删除
CREATE TABLE event_realm_multiplier (
  mapping_id  UUID REFERENCES event_karma_mapping(id) ON DELETE CASCADE,
  realm       VARCHAR(20) NOT NULL,
  multiplier  DECIMAL(5,3) NOT NULL CHECK (multiplier >= 0 AND multiplier <= 10),
  PRIMARY KEY (mapping_id, realm)
);
CREATE INDEX idx_erm_realm ON event_realm_multiplier(realm);

-- 数据迁移
-- INSERT INTO event_realm_multiplier (mapping_id, realm, multiplier)
-- SELECT id, key, (value->>0)::decimal
-- FROM event_karma_mapping, jsonb_each_text(realm_multipliers)
-- WHERE realm_multipliers IS NOT NULL;

ALTER TABLE event_karma_mapping DROP COLUMN realm_multipliers;
```

---

### 问题 4：缺少批量 API（v7.0 修复）

**修复：① batch-trigger 补 Saga 事务补偿　② geo/query 改 UNION ALL　③ 幂等性明确使用 consumed_events 表　④ 批量大小硬上限 1000**

#### 4a. 成员地理位置批量查询（UNION ALL 重写）

```yaml
POST /api/v1/members/geo/query
# Request
{
  "boundingBoxes": [{"minLat": 30.0, "maxLat": 31.0, "minLon": 120.0, "maxLon": 121.0}],
  "realmFilter": ["人间"],
  "statusFilter": ["alive"],
  "cursor": "eyJsYXN0X2lkIjoiLi4uIn0=",
  "limit": 500
}

# Response
{
  "members": [...],
  "total": 3240,
  "nextCursor": "eyJsYXN0X2lkIjoiLi4uIn0=",
  "hasMore": true
}
```

```sql
-- UNION ALL 实现（每个 box 独立走索引）
WITH box_union AS (
  SELECT id, name, realm, karma_coefficient, last_known_latitude, last_known_longitude
  FROM member
  WHERE last_known_latitude  BETWEEN :minLat0 AND :maxLat0
    AND last_known_longitude BETWEEN :minLon0 AND :maxLon0
  UNION ALL
  SELECT id, name, realm, karma_coefficient, last_known_latitude, last_known_longitude
  FROM member
  WHERE last_known_latitude  BETWEEN :minLat1 AND :maxLat1
    AND last_known_longitude BETWEEN :minLon1 AND :maxLon1
)
SELECT * FROM box_union
WHERE realm = ANY(:realmFilter) AND status = ANY(:statusFilter)
ORDER BY last_known_latitude, last_known_longitude, id
LIMIT :limit;
```

#### 4b. Karma 批量触发（Saga 补偿机制）

```yaml
POST /api/v1/karma/batch-trigger
{
  "events": [...],
  "sourceEventId": "uuid",
  "dryRun": false
}
```

```typescript
// 幂等性：依赖 consumed_events 表（第十节已定义）
// 注意：processOneEvent 内部已内联幂等检查（INSERT RETURNING *），无需单独调用此函数

// Saga 补偿事务（batch-trigger 分批并发执行，失败异步告警）
// v9.0 修复：① INSERT RETURNING* 原子化幂等 ② 删除冗余checkIdempotency函数 ③ BATCH_SIZE从环境变量读取

const BATCH_SIZE = Number(process.env.KARMA_BATCH_SIZE ?? 50);  // 每批并发数（可配置）
const DEAD_LETTER_QUEUE = 'karma:batch:dlq';  // Redis key，死信队列
const FAILURE_ALERT_THRESHOLD = 10;             // 失败数超此值触发告警

// ── 告警渠道接口定义（v8.0 修复：接入真实 webhook 占位框架）───────────────
interface AlertChannel {
  send(title: string, body: string, options?: { level: 'info' | 'warn' | 'critical' }): Promise<void>;
}

// 飞书 webhook（示例）
class FeishuAlertChannel implements AlertChannel {
  constructor(private webhookUrl: string) {}
  async send(title: string, body: string, options?: { level: 'info' | 'warn' | 'critical' }): Promise<void> {
    const payload = {
      msg_type: 'text',
      content: { text: `[天道系统] ${title}\n${body}` }
    };
    const resp = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) throw new Error(`Feishu alert failed: ${resp.status}`);
  }
}

// 告警器（可注入多渠道，生产环境替换为真实实例）
const alertChannels: AlertChannel[] = [
  // new FeishuAlertChannel(process.env.FEISHU_WEBHOOK_URL ?? ''),
  // new DingTalkAlertChannel(process.env.DINGTALK_WEBHOOK_URL ?? ''),
];

async function alertFailure(alert: {
  sourceEventId: string;
  failedCount: number;
  failedMembers: { memberId: string; event: KarmaTriggerEvent; error: string }[];
}): Promise<void> {
  const title = `[天道] karma-batch 触发失败 ${alert.failedCount} 条`;
  const body = [
    `sourceEventId: ${alert.sourceEventId}`,
    `失败数: ${alert.failedCount}`,
    `前5条失败:`,
    ...alert.failedMembers.slice(0, 5).map(m => `  - memberId=${m.memberId}: ${m.error}`)
  ].join('\n');

  // 所有渠道并发发送
  await Promise.allSettled(
    alertChannels.map(ch => ch.send(title, body, { level: alert.failedCount >= 10 ? 'critical' : 'warn' }))
  );
  // 死信队列也保留一份（供人工补偿）
  await redis.lpush(DEAD_LETTER_QUEUE, JSON.stringify({ ...alert, alertAt: Date.now() }));
}

async function processOneEvent(
  event: KarmaTriggerEvent,
  sourceEventId: string,
  dryRun: boolean
): Promise<TriggerResult> {
  // payload 必须是规范化 JSON 字符串（JSON.stringify 输出），不可手动拼接
  // PostgreSQL JSONB 主键比较要求 key 顺序一致，JSON.stringify 按插入顺序序列化 key
  const payloadJson: string = JSON.stringify({ memberId: event.memberId });

  const tx = await db.begin();
  try {
    if (dryRun) {
      await tx.query('SELECT 1 FROM member WHERE id = :id FOR UPDATE', { id: event.memberId });
      return { memberId: event.memberId, status: 'dry_run_ok' };
    }

    // 幂等写入：INSERT ON CONFLICT DO NOTHING RETURNING *
    // 若 row 已存在，RETURNING 返回 0 行，判定为重复，跳过
    const consumed = await tx.query(`
      INSERT INTO consumed_events (event_id, service_name, payload)
      VALUES (:eid, 'karma-batch', :payload)
      ON CONFLICT (event_id, service_name, payload) DO NOTHING
      RETURNING *
    `, { eid: sourceEventId, payload: payloadJson });

    if (consumed.rows.length === 0) {
      // 幂等命中：此成员已被本事件处理过
      await tx.rollback();
      return { memberId: event.memberId, status: 'skipped', reason: 'already_processed' };
    }

    const ikr = await tx.query(`
      INSERT INTO instant_karma_record (
        member_id, karma_type, level, trigger_event,
        merit_delta, current_merit, manifestation, status
      ) VALUES (:mId, :kt, :lvl, :evt, :md, :cm, :man, 'active')
      RETURNING id
    `, {
      mId: event.memberId, kt: event.karmaType, lvl: event.level,
      evt: event.triggerEvent, md: event.meritDelta,
      cm: event.currentMerit, man: event.manifestation
    });

    await tx.commit();
    return { memberId: event.memberId, status: 'triggered', instantKarmaId: ikr.rows[0].id };
  } catch (err) {
    await tx.rollback();
    return { memberId: event.memberId, status: 'failed', error: err.message };
  }
}

async function batchTriggerKarma(
  events: KarmaTriggerEvent[],
  sourceEventId: string,
  dryRun: boolean
): Promise<BatchTriggerResult> {
  const results: TriggerResult[] = [];

  // 分批并发执行（每批 50 条 Promise.all）
  // 背压说明：固定批次大小，DB 连接池上限决定最大并发。
  // 若 DB 连接池 = N，建议 BATCH_SIZE <= N/2。若超载，DB 会排队等待，不会雪崩。
  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(event => processOneEvent(event, sourceEventId, dryRun))
    );
    results.push(...batchResults);
  }

  // 失败处理：写死信队列 + 超阈值告警
  const failures = results.filter(r => r.status === 'failed');
  if (failures.length > 0) {
    const errors = failures.map(f => f.error).filter(Boolean) as string[];
    // 写完整死信队列（供人工/自动补偿，包含每个失败成员的详细信息）
    const failedMemberDetails = failures.map(f => ({
      memberId: f.memberId,
      event: events.find(e => e.memberId === f.memberId) ?? null,
      error: f.error
    }));
    await redis.lpush(DEAD_LETTER_QUEUE, JSON.stringify({
      sourceEventId, failedMembers: failedMemberDetails, failedAt: Date.now()
    }));
    // 超阈值立即告警（告警内容含完整 failedMembers）
    if (failures.length >= FAILURE_ALERT_THRESHOLD) {
      await alertFailure({ sourceEventId, failedCount: failures.length, failedMembers: failedMemberDetails });
    }
  }

  return {
    processed: results.filter(r => r.status === 'triggered').length,
    failed:    failures.length,
    skipped:   results.filter(r => r.status === 'skipped').length,
    results
  };
}
```

**幂等性实现要点：**
- 使用 consumed_events 表（第十节已定义），event_id = sourceEventId，service_name = 'karma-batch'
- payload 存 {memberId}，区分同一事件对不同成员的处理
- ON CONFLICT DO NOTHING 保证重复调用安全

---

### 问题 5：notice-service 订阅所有事件会被打爆（v7.0 修复）

**修复：① 聚合 Buffer 改 Redis List　② 限流计数器改 Redis　③ 订阅配置支持热更新　④ critical 事件走零延迟通道**

#### 5a. Redis 聚合缓冲区（服务重启不丢消息）

```typescript
// Redis List 实现：Key = notif:aggregator:{region}:{eventType}:{impactLevel}
// Value = LPUSH JSON 事件对象，TTL = 10 分钟保底
// 延迟发送 = Redis Sorted Set（score = 触发时间戳）

class NotificationAggregator {
  constructor(private redis: Redis) {}

  async add(event: HeavenlyEvent): Promise<void> {
    const key = `notif:aggregator:${event.region}:${event.type}:${event.impactLevel}`;
    await this.redis.lpush(key, JSON.stringify({ event, addedAt: Date.now() }));
    await this.redis.expire(key, 600);
    const sendAt = Date.now() + 5 * 60 * 1000;
    await this.redis.zadd('notif:pending', sendAt, `${key}::${Date.now()}`);
  }

  async flushExpired(): Promise<void> {
    const now = Date.now();
    const keys = await this.redis.zrangebyscore('notif:pending', 0, now, 'LIMIT', 0, 10);
    for (const keyWithTs of keys) {
      const [key] = keyWithTs.split('::');
      const events: any[] = [];
      let item;
      while ((item = await this.redis.rpop(key)) !== null) events.push(JSON.parse(item));
      if (!events.length) continue;
      const desc = events.length > 1
        ? `[汇总] ${events.length}起 ${events[0].event.type}事件`
        : events[0].event.description;
      await this.sendNotification(key, desc);
      await this.redis.zrem('notif:pending', keyWithTs);
    }
  }

  private async sendNotification(key: string, description: string): Promise<void> { /* ... */ }
}
```

#### 5b. Redis 限流计数器（跨实例共享，支持自动过期）

```typescript
const RATE_LIMITS = { local: 60, regional: 10, national: 5, critical: 999 };

async function checkRateLimit(impactLevel: string): Promise<boolean> {
  const limit = RATE_LIMITS[impactLevel as keyof typeof RATE_LIMITS] ?? 999;
  const key = `ratelimit:${impactLevel}:${Math.floor(Date.now() / 60000)}`;
  const current = await this.redis.incr(key);
  if (current === 1) await this.redis.expire(key, 120);
  return current <= limit;
}
```

#### 5c. 订阅配置热更新（取代静态 YAML）

```typescript
async function loadSubscriptions(): Promise<Subscription[]> {
  const cached = await this.redis.get('notif:subscriptions:v1');
  if (cached) return JSON.parse(cached);
  const subs = await db.query('SELECT * FROM notification_subscription WHERE is_active = TRUE');
  await this.redis.set('notif:subscriptions:v1', JSON.stringify(subs.rows), 'EX', 300);
  return subs.rows;
}

async function updateSubscription(sub: Subscription): Promise<void> {
  await db.query('UPDATE notification_subscription SET ... WHERE id = :id', sub);
  await this.redis.set('notif:subscriptions:v1', JSON.stringify(await loadSubscriptions()), 'EX', 300);
}
```

#### 5d. Critical 事件零延迟通道

```typescript
// critical 级别事件跳过聚合，立即发送
if (event.impactLevel === 'critical') {
  await this.sendNotificationImmediately(event);
  return;
}
```

**关键改进：**

| 修复点 | v5.0 问题 | v6.0 修复 |
|--------|----------|----------|
| 聚合 Buffer | Map + setTimeout，进程内存，重启丢消息 | Redis List + Sorted Set，重启可恢复 |
| 限流计数器 | 进程内存 Map，重启归零超发 | Redis INCR + EXPIRE，跨实例共享 |
| 订阅配置 | 静态 YAML，需重新部署 | Redis 缓存 + DB 持久化，支持热更新 |
| Critical 事件 | 与普通事件混排，最长等 5 分钟 | 独立零延迟通道，立即发送 |

## 十三、中优先级问题修复（针对问题 6-10）

---

### 问题 6：缺少"直接触发现世报"规则（中优先级）

**现状：** `instant_karma_trigger_rule` 表只有 `single_drop/single_rise/cumulative` 三种自动触发条件，缺少管理员手动触发的规则类型。`POST /api/v1/instant-karma/trigger` 接口存在，但未定义"手动触发"专属规则。

**修复方案：新增 `manual` 触发条件类型 + 对应规则**

```sql
-- instant_karma_trigger_rule 表新增 trigger_condition 值
-- 原有：single_drop / single_rise / cumulative
-- 新增：manual（管理员直接触发，阈值固定为 0）

ALTER TYPE trigger_condition_type ADD VALUE 'manual';  -- PostgreSQL enum 扩展

-- 手动触发规则示例（管理员可自由配置）
INSERT INTO instant_karma_trigger_rule
(karma_type, level, trigger_condition, threshold_value, time_window_hours, manifestation, duration_days, severity_score)
VALUES
('报应', '轻微',   'manual', 0, NULL, '头疼/失眠/小病',        7,   1),
('报应', '中度',   'manual', 0, NULL, '伤残/破财/失业',       90,  3),
('报应', '重度',   'manual', 0, NULL, '雷劫预警/重病/家破',    180,  5),
('报应', '极重',   'manual', 0, NULL, '雷劫降临/横死/魂魄重伤', NULL, 10),
('福报', '小祥',   'manual', 0, NULL, '运势提升/遇到贵人',     30,  1),
('福报', '中祥',   'manual', 0, NULL, '意外之财/姻缘/子嗣',   180,  3),
('福报', '大祥',   'manual', 0, NULL, '境界突破/灵根觉醒/延寿', NULL,  5);
```

**手动触发 API（已有，补充规则说明）：**

**调用路径说明**：manual 触发不经过规则评估层（`instant_karma_trigger_rule` 的 threshold 条件不适用），直接写入 `instant_karma_record`。幂等性依赖 `sourceEventId` + `consumed_events` 表实现。

```yaml
POST /api/v1/instant-karma/trigger
Content-Type: application/json

{
  "memberId": "uuid",
  "karmaType": "报应",          # 报应 / 福报
  "level": "中度",              # 轻微/中度/重度/极重 或 小祥/中祥/大祥
  "triggerEvent": "天庭巡查发现违规",
  "manifestation": "破财",
  "dryRun": false
}
```

---

### 问题 7：成员位置数据来源/更新机制未定义（中优先级）

**现状：** member 表有 `last_known_latitude/longitude` 字段，但没有定义何时更新、如何获取位置。

**修复方案：三种位置更新机制**

```typescript
// ── member-service：位置更新接口 ─────────────────────────────────

// 1. 主动上报（成员通过APP主动上报位置）
async function updateMemberLocation(
  memberId: string,
  latitude: number,
  longitude: number,
  source: 'gps' | 'ip' | 'manual'
): Promise<void> {
  await this.db.query(`
    UPDATE member
    SET last_known_latitude  = :lat,
        last_known_longitude = :lon,
        last_location_updated_at = NOW()
    WHERE id = :id
  `, { id: memberId, lat: latitude, lon: longitude });

  // 发布位置更新事件（供其他服务订阅）
  await this.eventBus.publish('member.location_updated', {
    version: '1.0',
    timestamp: new Date().toISOString(),
    idempotencyKey: `member-location-${memberId}-${Date.now()}`,
    correlationId: event.correlationId,
    payload: { memberId, latitude, longitude, source, updatedAt: new Date() }
  });
}

// 2. 登录时 GPS 强制刷新（修行者登录时要求位置授权）
async function onMemberLogin(memberId: string, platform: string): Promise<void> {
  if (platform === 'mobile') {
    // 移动端登录：强制要求 GPS 位置
    // GPS 坐标由 APP 端采集后调用 member-service 的 /location 接口上报
    // 此处接收 APP 已上传的坐标，memberId 从登录会话中获取
    const location = await this.getLatestLocationFromMember(memberId);
    if (location) await updateMemberLocation(memberId, location.lat, location.lon, 'gps');
  }
  // Web 端降级为 IP 定位
  const ip = getClientIP();
  const geo = await ipToGeo(ip);
  if (geo) await updateMemberLocation(memberId, geo.lat, geo.lon, 'ip');
}

// 3. 定时批量刷新（每24小时强制刷新一次）
async function refreshStaleLocations(): Promise<void> {
  const staleMembers = await this.db.query(`
    SELECT id FROM member
    WHERE last_location_updated_at < NOW() - INTERVAL '24 hours'
      AND status = 'alive'
    LIMIT 1000
  `);
  for (const row of staleMembers.rows) {
    await queueUpdateLocation(row.id);  // 异步队列，不阻塞
  }
}
```

**触发时机汇总：**

| 更新场景 | 触发时机 | 来源 | 优先级 |
|---------|---------|------|--------|
| 登录刷新 | 成员登录时 | GPS（移动端）/ IP（Web） | 高 |
| 主动上报 | 成员主动触发 | GPS | 高 |
| 定时批量 | 每24小时 | IP 降级 | 低 |
| 境界变更 | member.realm_changed | 自动 | 中 |

---

### 问题 8：公平性质疑（无辜平民受灾却增业障）（中优先级）

**现状：** 所有在影响范围内的成员一律增加业障，无辜 bystander（如恰好路过的凡人）也被惩罚，不公平。

**修复方案：引入 `accountability_factor`（责任系数），按因果参与度分级**

```typescript
// ── 成员责任系数（accountability_factor）───────────────────────────
// 0.0 = 完全无辜（路人、旁观者）
// 0.3 = 间接参与（当地居民、受灾商户）
// 0.6 = 直接参与（救援者 voluntary）、当地官员
// 1.0 = 主动参与（战争参战方、瘟疫传播者）

// 新增字段：member 表
// ALTER TABLE member ADD COLUMN accountability_factor DECIMAL(3,2) NOT NULL DEFAULT 1.0;

// 集成说明：本函数必须在 karma-service 处理 world.event.occurred 时被调用
// 调用点：karma-service 订阅 world.event.occurred → 对每个受影响成员调用此函数
// 重要：本函数在 karma-service 中实现，非 world-event-service
// 返回 Promise<number>，调用方需要 await
async function calculateKarmaDeltaWithAccountability(
  rule: KarmaMappingRule,
  realmMultipliers: Map<string, number>,
  member: { realm: string; karmaCoefficient: number; accountabilityFactor: number },
  event: RealWorldEvent,
  params: { severity: number; distanceKm: number; karmaType: '功德' | '业障' }
): Promise<number> {
  // 异步获取成员责任系数
  const accountabilityFactor = await determineAccountabilityFactor(member, event);

  // 无辜者（accountability_factor = 0）不受影响，但境界保护依然生效
  const finalDelta = Math.trunc(calculateKarmaDelta(rule, realmMultipliers, {
    severity: params.severity,
    distanceKm: params.distanceKm,
    memberRealm: member.realm,
    karmaCoefficient: member.karmaCoefficient,
    karmaType: params.karmaType
  }) * accountabilityFactor);
  return finalDelta;
}
```

**accountability_factor 判定规则：**

```typescript
// 根据成员角色 + 事件类型自动判定 accountability_factor
async function determineAccountabilityFactor(
  member: Member,
  event: RealWorldEvent
): Promise<number> {
  // 正面事件（救灾/科技进步）：所有成员均受益，不打折
  if (['scientific_breakthrough', 'peace_treaty', 'disaster_rescue'].includes(event.eventType)) {
    return 1.0;
  }

  // 自然灾害：本地居民有最低 0.3（非完全无辜，但也不是主动参与）
  if (['earthquake', 'flood', 'typhoon', 'tsunami'].includes(event.eventType)) {
    if (member.realm === '人间') {
      return member.accountabilityFactor ?? 0.3;  // 人间成员默认 0.3
    }
    return member.accountabilityFactor ?? 1.0;
  }

  // 战争/恐袭：区分参战方和无辜平民
  // 注：organization 通过 member_position 表关联，非 member 直接字段
  if (['war', 'terrorist_attack'].includes(event.eventType)) {
    const orgType = await getMemberOrganizationType(member.id);  // 通过 member_position 查询
    const isCombatant = orgType === 'military' || orgType === 'militia';
    return isCombatant ? 1.0 : 0.1;  // 参战方全责，无辜平民 0.1
  }
}

// getMemberOrganizationType：通过 member_position 查询成员的当前组织类型
async function getMemberOrganizationType(memberId: string): Promise<string | null> {
  // 查询成员当前（最新）职位的组织类型
  const row = await db.query(`
    SELECT o.type AS org_type
    FROM member_position mp
    JOIN organization o ON o.id = mp.organization_id
    WHERE mp.member_id = :mid
      AND mp.end_date IS NULL   -- 仅在职职位
    ORDER BY mp.start_date DESC
    LIMIT 1
  `, { mid: memberId });
  return row.rows[0]?.org_type ?? null;
}

  // 默认
  return member.accountabilityFactor ?? 1.0;
}
```

**DDL 变更：**

```sql
ALTER TABLE member
  ADD COLUMN accountability_factor DECIMAL(3,2) NOT NULL DEFAULT 0.0
  CHECK (accountability_factor BETWEEN 0 AND 1);

COMMENT ON COLUMN member.accountability_factor IS
  '责任系数：0.0=完全无辜（默认），0.3=间接参与，0.6=直接参与，1.0=主动参与';
```

---

### 问题 9：resource-service 缺少 member.realm_changed 订阅（中优先级）

**现状：** resource-service 当前订阅 `technique.learned`、`karma.triggered`、`member.deleted`，缺少 `member.realm_changed`。成员飞升或贬入地府时，其资源额度应随境界调整（如天庭神仙的灵石配额 vs 凡人的最低保障）。

**修复方案：在 resource-service 订阅 member.realm_changed，调整资源上限**

```typescript
// ── resource-service 订阅 member.realm_changed ─────────────────────

interface RealmResourceConfig {
  realm: string;
  maxSspiritStones: number;     // 灵石上限
  maxMagicItems: number;        // 法宝上限
  resourceRefreshIntervalDays: number;  // 资源刷新周期（天）
}

const REALM_RESOURCE_CONFIG: Record<string, RealmResourceConfig> = {
  '天庭':  { maxSpiritStones: 999999, maxMagicItems: 99, resourceRefreshIntervalDays: 30  },
  '地府':  { maxSpiritStones: 0,      maxMagicItems: 10, resourceRefreshIntervalDays: 365 },
  '人间':  { maxSpiritStones: 10000,  maxMagicItems: 5,  resourceRefreshIntervalDays: 90  },
};

eventBus.subscribe('member.realm_changed', async (event: HeavenlyEvent) => {
  const { memberId, oldRealm, newRealm } = event.payload;

  const oldConfig = REALM_RESOURCE_CONFIG[oldRealm];
  const newConfig = REALM_RESOURCE_CONFIG[newRealm];

  if (!oldConfig || !newConfig) return;

  // 1. 计算超限资源（成员持有的资源可能超过新 realm 上限）
  // 计算成员持有的超出新realm上限的资源数量
  const excessStones = await calculateExcessResources(memberId, newConfig.maxSpiritStones);
  const excessItems  = await calculateExcessItems(memberId, newConfig.maxMagicItems);

// calculateExcessResources/stones：查询成员持有量，扣减上限后返回超出的数量
async function calculateExcessResources(memberId: string, maxAllowed: number): Promise<number> {
  const row = await db.query(`
    SELECT COALESCE(current_spirit_stones, 0) AS held
    FROM member_resource WHERE member_id = :mid
  `, { mid: memberId });
  const held = Number(row.rows[0]?.held ?? 0);
  return Math.max(0, held - maxAllowed);
}

async function calculateExcessItems(memberId: string, maxAllowed: number): Promise<number> {
  const row = await db.query(`
    SELECT COUNT(*) AS count
    FROM member_resource_item
    WHERE member_id = :mid
  `, { mid: memberId });
  const held = Number(row.rows[0]?.count ?? 0);
  return Math.max(0, held - maxAllowed);
}

  if (excessStones > 0 || excessItems > 0) {
    // 2a. 超过上限：触发资源回收事件（封存/没收）
    await publishEvent('resource.excess_reclaimed', {
      memberId, oldRealm, newRealm,
      reclaimedStones: excessStones,
      reclaimedItems: excessItems,
      reason: `境界变更：${oldRealm} -> ${newRealm}`
    });
  }

  // resource-service 消费 resource.excess_reclaimed 事件，执行实际扣减
  // （在同一 service 内通过内部事件总线消费，无需跨网络）
  eventBus.subscribe('resource.excess_reclaimed', async (event: HeavenlyEvent) => {
    const { memberId, reclaimedStones, reclaimedItems } = event.payload;
    if (reclaimedStones > 0) {
      await db.query(`
        UPDATE member_resource
        SET current_spirit_stones = GREATEST(current_spirit_stones - :qty, 0)
        WHERE member_id = :mid
      `, { mid: memberId, qty: reclaimedStones });
    }
    if (reclaimedItems > 0) {
      await db.query(`
        DELETE FROM member_resource_item
        WHERE member_id = :mid
        ORDER BY created_at ASC
        LIMIT :limit
      `, { mid: memberId, limit: reclaimedItems });
    }
    await publishEvent('notice.sent', { type: 'resource_reclaimed', memberId, ...event.payload });
  });

  // 2b. 更新成员资源上限配置
  await db.query(`
    UPDATE member_resource
    SET max_spirit_stones = :max,
        max_magic_items  = :maxItems,
        realm             = :newRealm
    WHERE member_id = :memberId
  `, {
    memberId,
    max: newConfig.maxSpiritStones,
    maxItems: newConfig.maxMagicItems,
    newRealm
  });

  // 3. 发布资源变更通知
  await publishEvent('resource.changed', { memberId, realm: newRealm, action: 'realm_transfer' });
});
```

**订阅矩阵更新（v9.0 修复）：**

| 服务 | 发布事件 | 订阅事件（新增） |
|------|---------|----------------|
| resource-service | resource.changed, resource.insufficient | technique.learned, karma.triggered, member.deleted, **member.realm_changed** |

---

### 问题 10：缺少多源校验机制（防天道误判）（中优先级）

**现状：** world-event-service 从单一 API（如 USGS）获取事件后直接触发 karma，没有交叉验证。错误数据会导致大量无辜成员被错误惩罚。

**修复方案：三级验证模式 + 置信度阈值**

```typescript
// ── world-event-service：多源校验 ─────────────────────────────────

interface SourceVerification {
  source: string;           // 'USGS' | 'GDACS' | 'EM-DAT'
  sourceEventId: string;    // 该来源的事件 ID
  verified: boolean;        // 该来源是否确认此事件
  severity?: number;        // 该来源报告的严重程度（可选）
  fetchedAt: Date;
}

interface EventVerificationResult {
  eventId: string;
  verifiedSources: string[];         // 确认此事件的来源列表
  rejectedSources: string[];          // 否定此事件的来源列表
  confidenceScore: number;           // 0.0-1.0，置信度
  finalSeverity: number | null;     // 综合严重程度（取中位数）
  shouldTrigger: boolean;
}

// median 辅助函数
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// 多源校验算法
// 调用点：world-event-service 采集外部 API 数据后，在发布 world.event.occurred 之前必须调用此函数
// 未通过校验（shouldTrigger=false）的事件不得发布 world.event.occurred
async function verifyRealWorldEvent(
  event: Partial<RealWorldEvent>,
  verifications: SourceVerification[]
): Promise<EventVerificationResult> {
  const verifiedSources = verifications.filter(v => v.verified).map(v => v.source);
  const rejectedSources = verifications.filter(v => !v.verified).map(v => v.source);

  // 置信度 = 确认来源数 / 总来源数
  let confidenceScore = verifications.length > 0
    ? verifiedSources.length / verifications.length
    : 0;

  // 部分来源肯定、部分否定 → 置信度惩罚应用
  if (rejectedSources.length > 0 && verifiedSources.length > 0) {
    const mixedPenalty = 1 - (rejectedSources.length / verifications.length) * 0.5;
    confidenceScore = Math.round(confidenceScore * mixedPenalty * 100) / 100;
  }

  // 严重程度取确认来源的中位数
  const severities = verifications
    .filter(v => v.verified && v.severity !== undefined)
    .map(v => v.severity!);

  const finalSeverity = severities.length > 0
    ? median(severities)
    : null;

  return {
    eventId: event.id!,
    verifiedSources,
    rejectedSources,
    confidenceScore,
    finalSeverity,
    shouldTrigger: confidenceScore >= 0.5 && finalSeverity !== null
  };
}

// 触发决策
async function shouldTriggerKarma(
  event: Partial<RealWorldEvent>,
  verifications: SourceVerification[]
): Promise<{ trigger: boolean; reason: string }> {
  const result = await verifyRealWorldEvent(event, verifications);

  if (!result.shouldTrigger) {
    return { trigger: false, reason: `置信度不足（${result.confidenceScore} < 0.5）或严重程度未知` };
  }

  if (result.verifiedSources.length === 1) {
    return { trigger: true, reason: `单一来源确认（${result.verifiedSources[0]}），置信度=${result.confidenceScore}` };
  }

  if (result.confidenceScore >= 0.75) {
    return { trigger: true, reason: `多源高置信（${result.verifiedSources.join(', ')}），置信度=${result.confidenceScore}` };
  }

  return { trigger: false, reason: `置信度临界（${result.confidenceScore}），需人工复核` };
}
```

**各事件类型的多源要求：**

| 事件类型 | 必需来源数 | 置信度阈值 | 示例来源组合 |
|---------|-----------|-----------|------------|
| 地震（≥7级） | ≥2 | 0.5 | USGS + GDACS |
| 洪水/台风 | ≥1 | 0.5 | GDACS（高置信） |
| 战争/恐袭 | ≥2 | 0.75 | News API + Wikipedia |
| 瘟疫大流行 | ≥2 | 0.75 | WHO + 卫健委 |
| 小型自然灾害 | ≥1 | 1.0 | 单一高置信来源即可 |

**数据库变更：**

```sql
-- real_world_event 表新增字段
ALTER TABLE real_world_event
  ADD COLUMN verification_sources JSONB,  -- 存储 SourceVerification[]
  ADD COLUMN confidence_score  DECIMAL(3,2),  -- 0.00-1.00
  ADD COLUMN verified         BOOLEAN NOT NULL DEFAULT FALSE;

-- verification_sources 示例值：
-- [{"source":"USGS","sourceEventId":"usb0001","verified":true,"severity":7.2,"fetchedAt":"..."},
--  {"source":"GDACS","sourceEventId":"gdacs0001","verified":true,"severity":7.1,"fetchedAt":"..."}]
```

---

_本方案 v4.0 新增：现实世界事件接入层（world-event-service），将现实事件映射为三界因果。_
本方案 v5.0 新增：高优先级问题修复（API熔断/地理查询/映射公式化/批量API/通知限流）。_
本方案 v6.0 修复：Redis 共享状态层 + Saga 事务 + UNION ALL 索引优化 + karma 方向明确 + JSONB 关联表化。_
本方案 v9.0 修复：INSERT RETURNING* 原子化幂等消除幻读 + 移除冗余checkIdempotency + BATCH_SIZE环境变量。_
本方案 v11.0 修复：中优先级问题实现细节补充（调用链路闭合+函数实现+字段补全）。_
本方案 v13.0 修复：calculateKarmaDeltaWithAccountability 补 event 参数 + 返回类型 Promise<number>。_
本方案 v10.0 新增：中优先级问题修复（问题6-10）。_
