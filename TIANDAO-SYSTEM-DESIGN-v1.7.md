# 天道·系统 - 设计方案 v1.7

## 更新说明（相比 v1.6）

**版本定位：** 角色体系重构 v2.0——支持动态角色创建 + 部门归属体系（含循环依赖修复）

---

## v1.7 修复内容（相比 v1.6）

### 循环依赖修复 + 部门路径优化

| 问题 | 修复方式 |
|------|---------|
| department.manager_role_id ↔ role.department_id 循环外键 | manager_role_id 改为逻辑字段，不做物理 FK 约束 |
| ALTER TABLE 迁移脚本不完整 | 先 NULL 再填充最后 NOT NULL，分步执行 |
| 部门路径查询效率低 | 新增 dept_path 字段，支持前缀匹配 |
| 部门多级子部门支持 | parent_id 自关联已支持，无需修改 |

### Gemini 评审意见修复

| 变更 | 旧设计 | 新设计 |
|------|--------|--------|
| 角色创建 | 仅系统内置，不可新增 | 支持管理员动态创建角色 |
| 角色归属 | 无归属 | 所有角色必须归属一个部门 |
| 部门管理 | 无 | 新增部门表，支持层级结构 |

### 新增表：department（部门表）

```sql
CREATE TABLE department (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL COMMENT '部门名称',
    code            VARCHAR(50) NOT NULL UNIQUE COMMENT '部门编码',
    parent_id       UUID REFERENCES department(id) ON DELETE SET NULL COMMENT '上级部门（支持多级）',
    realm           VARCHAR(20) NOT NULL COMMENT '所属领域：天庭/地府/人间/跨三界',
    description     TEXT,
    -- manager_role_id 为逻辑字段，不做物理外键约束（避免与 role.department_id 循环依赖）
    manager_role_id UUID COMMENT '部门负责人角色ID（逻辑关联，仅供参考）',
    dept_path       VARCHAR(500) NOT NULL COMMENT '部门路径，如"/TIANDAO_ADMIN/TIANHEAVEN_01"，支持前缀查询',
    sort_order      INTEGER NOT NULL DEFAULT 0 COMMENT '同级排序顺序',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dept_parent ON department(parent_id);
CREATE INDEX idx_dept_realm ON department(realm);
CREATE INDEX idx_dept_path ON department(dept_path varchar_pattern_ops);
CREATE INDEX idx_dept_code ON department(code);
COMMENT ON TABLE department IS '部门表，支持天庭/地府/人间三级部门体系，支持多级子部门';
### 部门路径查询优化

**path 字段设计**：每级部门之间用 `/` 分隔，根部门不带前导 `/`。

```sql
-- 查询某部门及其所有子部门（LIKE 前缀匹配，高效）
SELECT * FROM department
WHERE dept_path LIKE '/TIANDAO_ADMIN/TIANHEAVEN_01%';

-- 查询某部门下所有角色
SELECT r.* FROM role r
JOIN department d ON r.department_id = d.id
WHERE d.dept_path LIKE '/TIANDAO_ADMIN/TIANHEAVEN_01%';

-- 路径切割获取层级深度
SELECT name, dept_path, array_length(string_to_array(dept_path, '/'), 1) - 1 AS depth
FROM department;
```

```

### role 表新增 department_id（安全迁移脚本）

```sql
-- Step 1: 允许 NULL（兼容已有数据）
ALTER TABLE role ADD COLUMN department_id UUID;

-- Step 2: 填充默认部门（天道秘书处）
UPDATE role SET department_id = (SELECT id FROM department WHERE code = 'TIANDAO_ADMIN')
WHERE department_id IS NULL;

-- Step 3: 设为 NOT NULL
ALTER TABLE role ALTER COLUMN department_id SET NOT NULL;

-- Step 4: 添加外键（部门删除时角色自动归到父部门）
ALTER TABLE role ADD CONSTRAINT fk_role_dept
FOREIGN KEY (department_id) REFERENCES department(id) ON DELETE SET NULL;

-- 索引
CREATE INDEX idx_role_dept ON role(department_id);
```

### 部门初始数据

```sql
INSERT INTO department (name, code, realm, description, dept_path, sort_order) VALUES
-- 跨三界
('天道秘书处', 'TIANDAO_ADMIN', '跨三界', '天道最高秘书机构', '/TIANDAO_ADMIN', 0),
-- 天庭部门
('天枢部', 'TIANHEAVEN_01', '天庭', '星辰运转与天机管理', '/TIANDAO_ADMIN/TIANHEAVEN_01', 1),
('雷部', 'TIANHEAVEN_02', '天庭', '雷电风雨气象事务', '/TIANDAO_ADMIN/TIANHEAVEN_01/TIANHEAVEN_02', 2),
('水部', 'TIANHEAVEN_03', '天庭', '江河湖海水系管理', '/TIANDAO_ADMIN/TIANHEAVEN_01/TIANHEAVEN_03', 3),
('功德司', 'TIANHEAVEN_04', '天庭', '记录三界功德业障', '/TIANDAO_ADMIN/TIANHEAVEN_01/TIANHEAVEN_04', 4),
('考功司', 'TIANHEAVEN_05', '天庭', '考核神明政绩', '/TIANDAO_ADMIN/TIANHEAVEN_01/TIANHEAVEN_05', 5),
-- 地府部门
('地府中枢', 'UNDERWORLD_00', '地府', '地府总管理机构', '/TIANDAO_ADMIN/UNDERWORLD_00', 1),
('第一殿', 'UNDERWORLD_01', '地府', '秦广王殿', '/TIANDAO_ADMIN/UNDERWORLD_00/UNDERWORLD_01', 2),
('轮回司', 'UNDERWORLD_06', '地府', '轮回投胎事务', '/TIANDAO_ADMIN/UNDERWORLD_00/UNDERWORLD_06', 3),
-- 人间部门
('人间道', 'MORTAL_00', '人间', '凡人修行管理', '/TIANDAO_ADMIN/MORTAL_00', 1);
```

### role 表改造：支持动态创建

| 字段 | 旧设计 | 新设计 |
|------|--------|--------|
| `is_system` | 仅标识内置不可删除 | 保留，并新增 `is_active` 标识角色是否启用 |
| `department_id` | 无 | 新增，必填，每个角色归属一个部门 |
| 动态角色 | 不支持 | `is_system=FALSE` 时管理员可创建/编辑/删除 |

```sql
-- 角色新增字段
ALTER TABLE role ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE role ADD COLUMN department_id UUID REFERENCES department(id);

-- 动态角色示例（管理员可创建）
INSERT INTO role (code, name, description, is_system, department_id, is_active)
VALUES ('CUSTOM_DEPT_ROLE', '自定义角色', '管理员自定义角色', FALSE,
        (SELECT id FROM department WHERE code = 'MORTAL_00'), TRUE);
```

---

## v1.5 修复内容（相比 v1.4）

### 角色体系重构（用户需求）

| 变更 | 旧设计 | 新设计 |
|------|--------|--------|
| 天帝 | 主管天庭一切事务 | 主管**天界事务**（诸神/天庭机构） |
| 新增：北极紫微大帝 | 无 | 主管**人间和冥界**事务 |
| 雷部天神 | 主管雷电/劫难 | 主管**雷电+天气+灾害+降雨**（四合一） |
| 水部天神 | 主管降雨/水患 | 角色保留，权限改为**默认空**，由管理员自定义 |
| 权限自定义 | 无 | 所有角色权限均支持**管理员自定义**，不受硬编码限制 |

### DeepSeek 评审意见修复

| 问题 | 严重性 | 修复方式 |
|------|---------|---------|
| 通配符 heaven:* 过度授权 | 🟡 中 | 改为显式权限列举 |
| 权限继承机制未定义 | 🟡 中 | 新增 3.5 节权限继承规范 |
| 迁移说明缺失 | 🟡 低 | 新增 3.6 节迁移指南 |

### LIGHTNING_GOD 权限修正

```sql
-- v1.3（通配符，过度授权）：
AND p.code LIKE 'heaven:%'

-- v1.4（显式列举，安全可控）：
AND p.code IN (
  'heaven:lightning:*',
  'heaven:weather:*',
  'heaven:disaster:*',
  'heaven:territory:*',
  'member:read'
);
```

### Bug 修复

| Bug | 严重性 | 问题 | 修复 |
|-----|--------|------|------|
| Bug-1 | 🔴 致命 | DELETE trigger 函数名写错 → 创建失败 | `prevent_audit_log_no_delete()` → `prevent_audit_log_modification()` |
| Bug-2 | 🔴 高危 | CULTIVATOR 权限 SQL 运算符优先级错误 | 加括号明确 `AND ( ... OR ...)` 优先级 |

### 角色权限补全

| 角色 | 修复前 | 修复后 |
|------|--------|--------|
| LIGHTNING_GOD | 无权限 | ✅ `heaven:*` 全权限 |
| WATER_GOD | 无权限 | ✅ 降雨+天气+灾害权限 |
| REINCARNATION_MASTER | 无权限 | ✅ 轮回+生死簿+功德权限 |
| AUDITOR | 无权限 | ✅ 仅审计日志读取 |
| HEAVEN_EMPEROR | 缺少 member:kill | ✅ 补充 `member:kill` 权限 |

---

## 新增核心功能

### 🕐 新增一：时间体系统一（以人间时间为准）

**设计原则：**
- 所有数据以**人间时间**（GMT+8）为唯一基准时间戳存储
- 天庭、地府使用"显示层换算"，不改变存储格式
- 系统日志、审计记录、考核记录等**全部使用人间时间**

**换算规则（仅用于展示层）：**

| 领域 | 时间流速 | 与人间换算 | 说明 |
|------|---------|-----------|------|
| 人间 | 1x | 基准 | 凡人寿命、阳寿核算基准 |
| 天庭 | 365x | 1天 = 1年 | 天上1日 = 地上1年 |
| 地府 | 1x | 等速 | 地府时间与人间同步（魂魄无时间感知） |

**存储策略：**
```sql
-- 所有 TIMESTAMPTZ 字段均存储人间时间
-- 示例：某修行者2026年4月5日飞升
-- 存储值：2026-04-05 10:00:00+08（人间时间）
-- 天庭展示：天历某年某月某日（乘365换算）
-- 地府展示：同年同月同日（直接复用）
```

**新增表：**
- `time_zone_config` - 三界时区配置
- `time_conversion_log` - 时间换算历史（追溯用）

---

### ⚡ 新增二：人间现世报系统

**设计背景：**
- 传统地府系统在人物死亡后才进行审判
- **现世报**补充了这一空白：凡人在世时，作恶或行善会**即时触发因果报应**
- 天道系统自动监测功德值异动，触发不同级别的现世报

**报应类型与触发规则：**

| 报应级别 | 触发条件（功德值骤降） | 报应形式 | 持续时间 |
|---------|---------------------|---------|---------|
| 轻微报 | 1次骤降 ≥ 50点 | 头疼/失眠/小病 | 3-7天 |
| 中度报 | 1次骤降 ≥ 100点 | 伤残/破财/失业 | 1-3月 |
| 重度报 | 1次骤降 ≥ 300点 | 雷劫预警/重病/家破 | 半年以上 |
| 极重报 | 1次骤降 ≥ 500点 或 累计 ≥ 800点/年 | 雷劫降临/横死/魂魄重伤 | 即时触发 |

**行善即时福报：**

| 福报级别 | 触发条件（功德值骤升） | 福报形式 | 持续时间 |
|---------|---------------------|---------|---------|
| 小祥 | 1次骤升 30-99点 | 运势提升/遇到贵人 | 7-30天 |
| 中祥 | 1次骤升 100-299点 | 意外之财/姻缘/子嗣 | 1-6月 |
| 大祥 | 1次骤升 ≥ 300点 | 境界突破/灵根觉醒/延寿 | 长期/永久 |

**现世报业务流程：**

```
功德值骤降检测（定时任务每分钟扫描）
         ↓
触发现世报评估（根据降幅判定级别）
         ↓
生成现世报记录 → 通知当事人（系统通报）
         ↓
执行报应（根据类型调用不同服务）
  ├─ 轻微：写入 member_cultivation.abnormal_records
  ├─ 中度：写入 lifebook.abnormal_records + 推送通知
  ├─ 重度：触发 weather/lightning 预警 + 强制考核
  └─ 极重：触发雷劫任务 + 通知地府记录在案
         ↓
报应结束 → 更新 records → 归档
```

---

# 第一部分：系统架构

## 1.1 整体架构图

```
┌─────────────────────────────────────────────────────┐
│                    接入层（API Gateway）               │
│  REST API / GraphQL / WebSocket                      │
└────────────────┬────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│                 业务逻辑层（Service Layer）              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│  │ 成员服务  │ │ 天庭服务  │ │ 地府服务  │ │功法服务│ │
│  │ 时间服务  │ │ 现世报   │ │          │ │        │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └───┬────┘ │
└───────┼────────────┼────────────┼────────────┼──────┘
        │            │            │            │
┌───────▼────────────▼────────────▼────────────▼──────┐
│                  事件总线（Event Bus）                 │
│  RabbitMQ / Kafka  ──→  事件驱动解耦                  │
└───────┬────────────┬────────────┬────────────┬──────┘
        │            │            │            │
┌───────▼──┐  ┌─────▼───┐ ┌────▼────┐ ┌───▼─────┐
│ PostgreSQL│  │  Neo4j  │ │  Redis  │ │ OSS/MinIO│
│ 主数据存储│  │ 关系图谱 │ │ 缓存/队列│ │ 文件存储 │
└──────────┘  └─────────┘ └─────────┘ └─────────┘
```

---

# 第二部分：完整 ER 图与数据字典

## 2.1 P0 修复 - 新增缺失表 DDL

### 表：organization（组织表）

```sql
CREATE TABLE organization (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL UNIQUE COMMENT '组织名称',
    org_type       VARCHAR(50) NOT NULL COMMENT '天庭机构/地府机构/门派/妖族/散修',
    parent_id       UUID REFERENCES organization(id) COMMENT '上级组织',
    realm          VARCHAR(20) NOT NULL COMMENT '所属领域：天庭/地府/人间',
    description     TEXT,
    max_members    INTEGER COMMENT '最大成员数，NULL表示无限制',
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_org_type ON organization(org_type);
CREATE INDEX idx_org_realm ON organization(realm);
CREATE INDEX idx_org_parent ON organization(parent_id);
COMMENT ON TABLE organization IS '天庭/地府/门派等组织表';
```

### 表：location（地理位置表）

```sql
CREATE TABLE location (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(200) NOT NULL COMMENT '地点名称',
    location_type   VARCHAR(50) NOT NULL COMMENT '洞府/寺庙/福地/禁地/凡间',
    realm          VARCHAR(20) NOT NULL COMMENT '所属领域：天庭/地府/人间',
    mana_density   DECIMAL(5,2) COMMENT '灵气浓度 0-100',
    capacity       INTEGER COMMENT '容纳人数，NULL表示无限制',
    territory_id   UUID REFERENCES territory(id) COMMENT '所属天庭区域',
    underworld_zone_id UUID REFERENCES underworld_zone(id) COMMENT '所属地府分区',
    latitude       DECIMAL(10,7) COMMENT '纬度',
    longitude      DECIMAL(11,7) COMMENT '经度',
    description    TEXT,
    is_accessible  BOOLEAN NOT NULL DEFAULT TRUE COMMENT '是否对凡人开放',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_loc_type ON location(location_type);
CREATE INDEX idx_loc_realm ON location(realm);
CREATE INDEX idx_loc_territory ON location(territory_id);
COMMENT ON TABLE location IS '洞府/寺庙/福地等地理位置表';
```

### 表：system_event（系统重大事件表）

```sql
CREATE TABLE system_event (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type      VARCHAR(50) NOT NULL COMMENT '成员飞升/成员陨落/天庭大典/地府改元/等',
    event_name      VARCHAR(200) NOT NULL COMMENT '事件名称',
    description     TEXT NOT NULL,
    occurred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    realm          VARCHAR(20) NOT NULL COMMENT '发生领域：天庭/地府/人间',
    related_member_ids UUID[] COMMENT '关联成员ID数组',
    related_org_ids UUID[] COMMENT '关联组织ID数组',
    impact_level   VARCHAR(20) NOT NULL DEFAULT 'normal' COMMENT '影响级别：minor/normal/major/critical',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_se_type ON system_event(event_type);
CREATE INDEX idx_se_occurred ON system_event(occurred_at);
CREATE INDEX idx_se_realm ON system_event(realm);
COMMENT ON TABLE system_event IS '系统重大事件表';
```

### 表：time_zone_config（时间区域配置表）

```sql
CREATE TABLE time_zone_config (
    id              SERIAL PRIMARY KEY,
    realm           VARCHAR(20) NOT NULL UNIQUE COMMENT '天庭/地府/人间',
    time_multiplier DECIMAL(10,4) NOT NULL DEFAULT 1.0 COMMENT '时间流速倍数（相对人间）',
    description     TEXT COMMENT '时间说明',
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO time_zone_config (realm, time_multiplier, description) VALUES
('人间', 1.0, '基准时间，人间时间 GMT+8，所有数据存储以此为准'),
('天庭', 365.0, '天上一日，地上一年，天庭时间流速为人类的365倍'),
('地府', 1.0, '地府时间流速与人间同步，魂魄无时间感知');
COMMENT ON TABLE time_zone_config IS '三界时间区域配置表';
```

### 表：time_conversion_log（时间换算记录表）

```sql
CREATE TABLE time_conversion_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_realm    VARCHAR(20) NOT NULL COMMENT '源时间领域',
    target_realm    VARCHAR(20) NOT NULL COMMENT '目标时间领域',
    source_time     TIMESTAMPTZ NOT NULL COMMENT '原始时间值',
    converted_time  TIMESTAMPTZ NOT NULL COMMENT '换算后时间值',
    multiplier_used DECIMAL(10,4) NOT NULL COMMENT '使用的换算倍率',
    purpose         VARCHAR(100) COMMENT '换算用途',
    operator_id    UUID REFERENCES member(id) COMMENT '操作人',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tcl_source ON time_conversion_log(source_realm, source_time);
COMMENT ON TABLE time_conversion_log IS '时间换算历史记录表';
```

### 表：instant_karma_record（即时现世报记录表）

```sql
CREATE TABLE instant_karma_record (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id       UUID NOT NULL REFERENCES member(id),
    karma_type      VARCHAR(20) NOT NULL COMMENT '报应/福报',
    level           VARCHAR(20) NOT NULL COMMENT '轻微/中度/重度/极重（报）；小祥/中祥/大祥（福）',
    trigger_event   TEXT NOT NULL COMMENT '触发事件描述',
    merit_delta     INTEGER NOT NULL COMMENT '功德变化量（负数为骤降，正数为骤升）',
    current_merit   INTEGER NOT NULL COMMENT '触发时功德余额',
    manifestation   TEXT NOT NULL COMMENT '报应/福报表现形式',
    start_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expected_end_at TIMESTAMPTZ COMMENT '预计结束时间',
    actual_end_at   TIMESTAMPTZ COMMENT '实际结束时间',
    status          VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT 'active/resolved/cancelled',
    resolved_by     UUID REFERENCES member(id) COMMENT '解除人（报应被上天或法官免除）',
    resolution_note TEXT COMMENT '解除说明',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ikr_member ON instant_karma_record(member_id);
CREATE INDEX idx_ikr_type ON instant_karma_record(karma_type);
CREATE INDEX idx_ikr_status ON instant_karma_record(status) WHERE status = 'active';
CREATE INDEX idx_ikr_active ON instant_karma_record(start_at) WHERE status = 'active';
COMMENT ON TABLE instant_karma_record IS '即时现世报记录表';
```

### 表：instant_karma_trigger_rule（即时现世报触发规则表）

```sql
CREATE TABLE instant_karma_trigger_rule (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    karma_type      VARCHAR(20) NOT NULL COMMENT '报应/福报',
    level           VARCHAR(20) NOT NULL COMMENT '级别',
    trigger_condition VARCHAR(50) NOT NULL COMMENT '触发条件类型：single_drop/single_rise/cumulative',
    threshold_value INTEGER NOT NULL COMMENT '阈值',
    time_window_hours INTEGER COMMENT '时间窗口（小时），用于累计触发',
    manifestation   TEXT NOT NULL COMMENT '表现形式',
    duration_days   INTEGER COMMENT '持续天数，NULL表示永久',
    severity_score  INTEGER NOT NULL DEFAULT 1 COMMENT '严重程度积分',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO instant_karma_trigger_rule
(karma_type, level, trigger_condition, threshold_value, time_window_hours, manifestation, duration_days, severity_score) VALUES
-- 报应规则
('报应', '轻微', 'single_drop', 50, NULL, '头疼/失眠/小病', 7, 1),
('报应', '中度', 'single_drop', 100, NULL, '伤残/破财/失业', 90, 3),
('报应', '重度', 'single_drop', 300, NULL, '雷劫预警/重病/家破', 180, 5),
('报应', '极重', 'single_drop', 500, NULL, '雷劫降临/横死/魂魄重伤', NULL, 10),
('报应', '极重', 'cumulative', 800, 8760, '累积业力爆发', NULL, 10),
-- 福报规则
('福报', '小祥', 'single_rise', 30, NULL, '运势提升/遇到贵人', 30, 1),
('福报', '中祥', 'single_rise', 100, NULL, '意外之财/姻缘/子嗣', 180, 3),
('福报', '大祥', 'single_rise', 300, NULL, '境界突破/灵根觉醒/延寿', NULL, 5);

COMMENT ON TABLE instant_karma_trigger_rule IS '现世报触发规则表';
```

### 表：member_abnormal_record（成员异常状态记录表）

```sql
CREATE TABLE member_abnormal_record (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id       UUID NOT NULL REFERENCES member(id),
    abnormal_type   VARCHAR(50) NOT NULL COMMENT '现世报/心魔/走火入魔/灵气紊乱',
    level           VARCHAR(20) NOT NULL COMMENT '轻微/中度/重度/极重',
    source_id       UUID COMMENT '关联来源（如现世报记录ID）',
    source_type     VARCHAR(30) COMMENT '关联来源类型：instant_karma/cultivation/disaster',
    description     TEXT NOT NULL,
    symptoms        TEXT[] COMMENT '症状表现数组',
    start_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expected_end_at TIMESTAMPTZ,
    actual_end_at   TIMESTAMPTZ,
    status          VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT 'active/under_treatment/recovered/chronical',
    treatment_method VARCHAR(100) COMMENT '治疗方法',
    treatment_result TEXT COMMENT '治疗结果',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mar_member ON member_abnormal_record(member_id);
CREATE INDEX idx_mar_status ON member_abnormal_record(status) WHERE status = 'active';
COMMENT ON TABLE member_abnormal_record IS '成员异常状态记录表';
```

### 表：assessment（考核主表）

```sql
CREATE TABLE assessment (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_type VARCHAR(50) NOT NULL COMMENT '年度考核/境界考核/师门考核/现世报考核',
    assessed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assessor_id     UUID NOT NULL REFERENCES member(id) COMMENT '主考人',
    location_id    UUID REFERENCES location(id) COMMENT '考核地点',
    description     TEXT COMMENT '考核说明',
    status         VARCHAR(20) NOT NULL DEFAULT 'scheduled' COMMENT 'scheduled/in_progress/completed/cancelled',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ass_type ON assessment(assessment_type);
CREATE INDEX idx_ass_status ON assessment(status);
CREATE INDEX idx_ass_assessed ON assessment(assessed_at);
COMMENT ON TABLE assessment IS '考核主表';
```

## 2.2 修复 member_position FK 断裂

```sql
-- member_position.organization_id → organization(id) 已连通
-- 确认 organization 表已创建（见 2.1 节）
```

## 2.3 修复 SQL 语法错误

```sql
-- v1.1 错误写法：
-- REFERENCES member(id) ON NULL CASCADE

-- v1.2 修正为：
-- REFERENCES member(id) ON DELETE CASCADE
-- （cultivation_log.member_id 的 FK 约束已修正）
```

## 2.4 修正 member_position_history.event_id

```sql
-- system_event 表已创建（见 2.1 节）
-- member_position_history.event_id → system_event(id) 连通
```

## 2.5 修正 disaster_warning.assessment_id

```sql
-- assessment 表已创建（见 2.1 节）
-- disaster_warning.assessment_id → assessment(id) 连通
```

## 2.6 修正 cultivation_log.location_id

```sql
-- location 表已创建（见 2.1 节）
-- cultivation_log.location_id → location(id) 连通
```

---

# 第三部分：权限体系设计（RBAC + ABAC）

## 3.1 权限表初始数据

### permission 表完整 INSERT

```sql
-- 成员管理权限
INSERT INTO permission (code, name, category, description, risk_level) VALUES
('member:create', '创建成员', 'member', '在系统中新增成员档案', 'high'),
('member:read', '查看成员', 'member', '查看任意成员档案', 'medium'),
('member:read_self', '查看本人', 'member', '查看本人档案', 'low'),
('member:update', '更新成员', 'member', '修改任意成员信息', 'high'),
('member:update_self', '更新本人', 'member', '修改本人信息', 'low'),
('member:delete', '删除成员', 'member', '软删除成员档案', 'critical'),
('member:kill', '判定死亡', 'member', '将成员状态改为死亡（即时现世报极重报）', 'critical'),
('member:read_relationship', '查看关系', 'member', '查看成员社会关系', 'medium'),
('member:update_relationship', '管理关系', 'member', '管理成员社会关系', 'high'),

-- 天庭管理权限
('heaven:territory:*', '区域全管理', 'heaven', '天庭区域全管理', 'high'),
('heaven:weather:*', '天气全管理', 'heaven', '天气控制全管理', 'high'),
('heaven:lightning:*', '雷电全管理', 'heaven', '雷电事务全管理', 'critical'),
('heaven:disaster:*', '灾害全管理', 'heaven', '自然灾害全管理', 'high'),

-- 地府管理权限
('underworld:zone:*', '分区全管理', 'underworld', '地府分区全管理', 'high'),
('underworld:zone:read', '查看分区', 'underworld', '查看地府分区信息', 'low'),
('lifebook:read', '查看生死簿', 'underworld', '查看生死簿记录', 'medium'),
('lifebook:update', '更新生死簿', 'underworld', '修改生死簿记录', 'critical'),
('sentence:*', '判决全管理', 'underworld', '判决事务全管理', 'critical'),
('sentence:create', '创建判决', 'underworld', '新增判决记录', 'critical'),
('sentence:read', '查看判决', 'underworld', '查看判决记录', 'medium'),
('imprisonment:*', '关押全管理', 'underworld', '关押事务全管理', 'high'),
('merit:*', '功德全管理', 'underworld', '功德业障全管理', 'high'),
('merit:create', '记录功德', 'underworld', '新增功德业障记录', 'medium'),
('merit:read', '查看功德', 'underworld', '查看功德业障记录', 'medium'),

-- 轮回管理权限
('reincarnation:*', '轮回全管理', 'reincarnation', '轮回事务全管理', 'critical'),

-- 功法管理权限
('technique:read', '查看功法', 'technique', '查看功法列表和内容', 'low'),
('technique:create', '创建功法', 'technique', '新增功法', 'high'),
('technique:update', '更新功法', 'technique', '修改功法内容', 'high'),
('technique:delete', '删除功法', 'technique', '删除功法', 'critical'),
('technique:learn', '申请学习', 'technique', '申请学习功法', 'low'),
('cultivation:create', '记录修行', 'cultivation', '新增修行日志', 'low'),
('cultivation:read', '查看修行', 'cultivation', '查看修行记录', 'medium'),
('cultivation:assess', '考核评定', 'cultivation', '进行修行考核评定', 'high'),

-- 师徒权限
('master_apprentice:*', '师徒全管理', 'master', '师徒关系全管理', 'medium'),
('master_apprentice:create', '建立师徒', 'master', '建立师徒关系', 'medium'),
('master_apprentice:read', '查看师徒', 'master', '查看师徒关系', 'low'),
('master_apprentice:break', '解除师徒', 'master', '解除师徒关系', 'high'),

-- 现世报权限
('instant_karma:*', '现世报全管理', 'karma', '现世报事务全管理', 'critical'),
('instant_karma:trigger', '触发现世报', 'karma', '手动触发现世报', 'critical'),
('instant_karma:resolve', '解除现世报', 'karma', '解除生效中的现世报', 'high'),
('instant_karma:read', '查看现世报', 'karma', '查看现世报记录', 'medium'),

-- 通报权限
('notice:*', '通报全管理', 'notice', '天机通报全管理', 'high'),
('notice:create', '发布通报', 'notice', '发布系统通报', 'high'),
('notice:read', '查看通报', 'notice', '查看通报', 'low'),
('notice:revoke', '撤销通报', 'notice', '撤销已发布通报', 'high'),
('wanted:*', '通缉全管理', 'notice', '通缉事务全管理', 'critical'),
('wanted:create', '发布通缉', 'notice', '发布通缉令', 'critical'),
('wanted:capture', '标记抓获', 'notice', '标记通缉犯被抓', 'high'),

-- 审计权限
('audit:read', '查看审计', 'system', '查看审计日志', 'high'),
('audit:read_own', '查看本人审计', 'system', '查看本人的操作审计', 'low'),

-- 角色权限
('role:assign', '分配角色', 'system', '为成员分配角色', 'critical'),
('role:read', '查看角色', 'system', '查看角色定义', 'low'),

-- 时间系统权限
('time:read', '查看时间', 'system', '查看时间配置', 'low'),
('time:update', '更新时间', 'system', '修改时间配置', 'critical');
```

### role 表完整 INSERT

```sql
INSERT INTO role (code, name, description, is_system) VALUES
('TIANDAO_ADMIN', '天道超级管理员', '拥有系统所有权限，可管理所有角色和配置', TRUE),
('HEAVEN_EMPEROR', '昊天金阙玉皇上帝', '主管天界事务（诸神/天庭机构/星辰运转）', TRUE),
('POLAR_PURPLE_GOD', '北极紫微大帝', '主管人间与冥界事务（山河大地/幽冥轮回/生死因果）', TRUE),
('HALL_MASTER', '殿主', '地府十殿殿主，管理本殿一切事务', TRUE),
('JUDGE', '判官', '负责判决魂魄、记录功德业障', TRUE),
('REINCARNATION_MASTER', '轮回司主', '负责轮回投胎事务', TRUE),
('LIGHTNING_GOD', '九天应元雷声普化天尊', '主管天界气象（雷电/风雨/霜雪/灾害/天庭降水）', TRUE),
('WATER_GOD', '水部天神', '主管水系事务（江河湖海/水患防治），权限由管理员自定义', TRUE),
('CULTIVATOR', '修行者', '已入道的修行者，可修行功法、记录修行', TRUE),
('MORTAL', '凡人', '普通凡人，仅可查看公开信息和本人档案', TRUE),
('AUDITOR', '审计官', '专职审计人员，仅可查看审计日志', TRUE);
```

### role_permission 初始授权

```sql
-- 天帝：主管天界事务（诸神/星辰/天庭机构）
INSERT INTO role_permission (role_id, permission_code, granted_by)
SELECT r.id, p.code, (SELECT id FROM member WHERE name = '系统初始化')
FROM role r, permission p
WHERE r.code = 'HEAVEN_EMPEROR'
  AND p.category IN ('heaven')
  AND p.code NOT LIKE '%:delete';
INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, p.code
FROM role r, permission p
WHERE r.code = 'HEAVEN_EMPEROR'
  AND p.code IN ('member:read','notice:read','time:read','audit:read_own');

-- 殿主：本殿范围内全权限
INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, p.code
FROM role r, permission p
WHERE r.code = 'HALL_MASTER'
  AND p.category IN ('underworld', 'member')
  AND p.code NOT LIKE '%:delete';

-- 判官：生死簿+判决+功德
INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, p.code
FROM role r, permission p
WHERE r.code = 'JUDGE'
  AND p.code IN ('lifebook:read','sentence:*','merit:*','member:read');

-- 修行者：功法+修行
INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, p.code
FROM role r, permission p
WHERE r.code = 'CULTIVATOR'
  AND (
    (p.category IN ('technique', 'cultivation', 'master') AND p.code LIKE '%:read')
    OR p.code IN ('technique:learn','cultivation:create','master_apprentice:create','master_apprentice:read')
  );

-- 凡人：仅查看本人+公开通报
INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, p.code
FROM role r, permission p
WHERE r.code = 'MORTAL'
  AND p.code IN ('member:read_self','member:update_self','notice:read');

-- 雷部天神：雷电+天气+灾害+降雨全权限
INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, p.code
FROM role r, permission p
WHERE r.code = 'LIGHTNING_GOD'
  AND p.code IN (
    'heaven:lightning:*',
    'heaven:weather:*',
    'heaven:disaster:*',
    'heaven:territory:*',
    'member:read'
  );

-- 水部天神：权限默认空，由管理员根据实际业务分配
-- INSERT INTO role_permission (role_id, permission_code)
-- SELECT r.id, p.code
-- FROM role r, permission p
-- WHERE r.code = 'WATER_GOD'
--   AND p.code IN (...);  -- 管理员自定义

-- 轮回司主：轮回+生死簿+功德+分区查看
INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, p.code
FROM role r, permission p
WHERE r.code = 'REINCARNATION_MASTER'
  AND p.code IN ('reincarnation:*','lifebook:read','merit:read',
                 'underworld:zone:read','member:read','notice:read');

-- 审计官：仅审计日志全读取
INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, p.code
FROM role r, permission p
WHERE r.code = 'AUDITOR'
  AND p.code IN ('audit:read','time:read');

-- 北极紫微大帝：主管人间与冥界（member类别中除去天界专属操作）
INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, p.code
FROM role r, permission p
WHERE r.code = 'POLAR_PURPLE_GOD'
  AND p.code IN (
    'member:create','member:read','member:update',
    'underworld:zone:*','lifebook:*','sentence:*',
    'merit:*','reincarnation:*',
    'notice:*','wanted:*','time:read'
  );

-- 补充 member:kill 权限给天帝
INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, p.code
FROM role r, permission p
WHERE r.code = 'HEAVEN_EMPEROR'
  AND p.code = 'member:kill';
```

---

## 3.2 audit_log 防篡改机制

```sql
-- 追加ONLY约束：禁止更新和删除
ALTER TABLE audit_log
ADD CONSTRAINT chk_audit_log_immutable
CHECK (TRUE); -- 占位，后续通过Trigger实现

-- 创建PreventUpdateDelete trigger
CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_log 表禁止 UPDATE/DELETE 操作，记录ID: %', OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_audit_log_no_update
    BEFORE UPDATE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_modification();

CREATE TRIGGER trigger_audit_log_no_delete
    BEFORE DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_modification();

-- 为新增记录自动写入操作人
CREATE OR REPLACE FUNCTION audit_log_set_operator()
RETURNS TRIGGER AS $$
BEGIN
    -- 从上下文获取当前用户（由应用层设置）
    NEW.operator_id = COALESCE(NEW.operator_id, current_setting('app.current_user_id', TRUE));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_audit_log_set_operator
    BEFORE INSERT ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_set_operator();
```

---

## 3.3 成员"死亡"操作权限控制

**新增权限：** `member:kill`（判定死亡）

| 角色 | 是否有 member:kill |
|------|-------------------|
| TIANDAO_ADMIN | ✅ |
| HEAVEN_EMPEROR | ✅ |
| HALL_MASTER | ❌（仅能管理本殿成员） |
| JUDGE | ❌ |
| MORTAL | ❌ |
| CULTIVATOR | ❌ |

**ABAC补充规则：**
```sql
-- 殿主仅能对"已死亡状态但未入地府"的本殿成员执行死亡判定
-- 条件：member.status = 'dead' AND member.realm = user.assigned_hall
```

---

## 3.4 判决范围 DB 层 CHECK 约束

```sql
-- 在 sentence 表增加 CHECK 约束（由应用层 + DB 双重保证）
-- 判官只能判决本殿魂魄
-- 此约束通过应用层强制，DB 层作为最后防线
ALTER TABLE sentence
ADD CONSTRAINT chk_sentence_zone_match
CHECK (
    -- 判官角色的zone_id必须与魂魄所在zone匹配
    -- 此约束通过ABAC在API层保证
    TRUE
);
```

---

## 3.5 权限继承、通配符与自定义规范

### 权限继承规则

**本系统不启用自动权限继承。** 每个角色拥有独立权限集，不继承其他角色的权限。

| 规则 | 说明 |
|------|------|
| 独立权限集 | 每个角色的权限独立计算，不叠加 |
| 最小权限原则 | 仅授予完成职责所需的最小权限集 |
| 高权限不含低权限 | 天帝不自动拥有判官的判决权限 |
| 职责分离 | 敏感操作需多角色协作 |

### 角色自定义规范

**所有角色的默认权限仅为初始模板，管理员可在后台自由调整；每个角色必须归属一个部门：**

| 规则 | 说明 |
|------|------|
| 默认模板 | 系统内置角色提供默认权限集 |
| 管理员自定义 | 通过 role_permission 表由 DBA/管理员增删权限 |
| WATER_GOD 示例 | 默认权限为空，实际权限由管理员按需分配 |
| 最小权限仍适用 | 自定义时仍应遵循最小权限原则 |

### 通配符使用规范

| 通配符模式 | 可用范围 | 禁止场景 |
|-----------|---------|---------|
| `domain:*` | 仅限低风险操作分类（heaven/technique） | 禁止用于 member/underworld/reincarnation |
| `*:read` | 仅限已定义的标准读取操作 | 禁止用于 write/delete/kill |
| `domain:delete` | 仅限 TIANDAO_ADMIN | 禁止其他任何角色 |

### 高危权限清单（禁止通配符）

```
member:delete    — 删除成员档案
member:kill      — 判定死亡
sentence:create  — 创建判决
reincarnation:*  — 轮回全操作
role:assign      — 分配角色
```

---

## 3.6 v1.2 → v1.4 迁移说明

**LIGHTNING_GOD 权限变更：**

```sql
-- v1.2/v1.3（使用通配符）：
AND p.code LIKE 'heaven:%'  -- 过度授权，有安全风险

-- v1.4（显式列举）：
AND p.code IN (
  'heaven:lightning:*',
  'heaven:weather:*',
  'heaven:disaster:*',
  'heaven:territory:*',
  'member:read'
);
```

**audit_log trigger 函数名变更：**

```sql
-- v1.2/v1.3（旧）：
CREATE TRIGGER trigger_audit_log_no_delete
    BEFORE DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_no_delete(); -- 不存在！

-- v1.4（正确）：
CREATE TRIGGER trigger_audit_log_no_delete
    BEFORE DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_modification();
```

**CULTIVATOR 权限 SQL 优先级修复：**

```sql
-- v1.2/v1.3（旧）：
AND p.code LIKE '%:read' OR p.code IN (...)

-- v1.4（正确）：
AND (
  (p.category IN ('technique','cultivation','master') AND p.code LIKE '%:read')
  OR p.code IN ('technique:learn','cultivation:create','master_apprentice:create','master_apprentice:read')
);
```

---

# 第四部分：跨模块事务边界设计

## 4.1 事件总线设计（补充）

### 新增现世报相关事件

| 事件名 | 来源模块 | 目标模块 | 说明 |
|--------|---------|---------|------|
| `instant_karma.triggered` | 现世报 | 成员/地府 | 触发现世报 |
| `instant_karma.resolved` | 现世报 | 成员 | 现世报解除 |
| `member.abnormal` | 成员 | 天庭/地府 | 成员异常状态 |
| `time.conversion` | 时间服务 | 各模块 | 时间换算记录 |

---

# 第五部分：API 契约设计

## 5.1 新增 API

### 现世报管理

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | /api/v1/instant-karma | instant_karma:read | 查询现世报记录 |
| GET | /api/v1/instant-karma/rules | authenticated | 查询触发规则 |
| POST | /api/v1/instant-karma/trigger | instant_karma:trigger | 手动触发现世报 |
| PUT | /api/v1/instant-karma/{id}/resolve | instant_karma:resolve | 解除现世报 |
| GET | /api/v1/members/{id}/abnormal-records | instant_karma:read | 成员异常记录 |

### 时间管理

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | /api/v1/time/zones | authenticated | 三界时区配置 |
| GET | /api/v1/time/convert | authenticated | 时间换算 |
| POST | /api/v1/time/convert | time:update | 记录换算历史 |

---

# 第六部分：扩展功能（保留）

以下功能在本版本 v1.2 中预留接口，后续分期实现：

1. ~~**洞府福地管理**~~ - 已补充 location 表
2. ~~**法器登记**~~ - 预留
3. ~~**天道历法**~~ - 已实现（时间体系统一）
4. **三界贸易** - 功德值交易平台
5. **AI 辅助** - 雷劫预测、功德自动核算

---

# 第七部分：系统分期

## 第一期（核心基础）v1.2
- [x] 成员基础档案（含 DDL）
- [x] 权限体系（RBAC + ABAC）含初始数据
- [x] 审计日志（防篡改）
- [x] 领域事件总线设计
- [x] API 契约 v1
- [x] **时间体系统一（以人间为准）**
- [x] **人间现世报系统**
- [x] P0 问题全部修复（organization/location/system_event/assessment 表 + SQL语法 + 权限数据）
- [x] v1.3 Bug 修复（trigger 函数名 + CULTIVATOR SQL 优先级）
- [x] v1.4 权限规范完善（显式列举 + 继承规则 + 迁移指南）
- [x] v1.5 角色体系重构（天帝主管天界/紫微大帝主管人间冥界/雷部四合一/管理员自定义）
- [x] v1.6 角色动态化+部门归属体系（新增department表+角色可自由创建）
- [x] v1.7 循环依赖修复（manager_role_id改逻辑字段）+部门路径优化（dept_path字段）+安全迁移脚本

## 第二期（地府核心）
- [ ] 生死簿查询
- [ ] 判决管理
- [ ] 关押管理
- [ ] 功德业障记录
- [ ] 地府十殿管理

## 第三期（天庭自然）
- [ ] 天气控制
- [ ] 雷电管理
- [ ] 降雨管理
- [ ] 灾害预警

## 第四期（功法修行）
- [ ] 功法目录
- [ ] 修行日志
- [ ] 师徒关系
- [ ] 功法考核
- [ ] 视频/音频教程

---

_本方案 v1.7：循环依赖修复（manager_role_id改逻辑字段）+部门路径优化（dept_path）+安全迁移脚本+9个初始部门数据。_
