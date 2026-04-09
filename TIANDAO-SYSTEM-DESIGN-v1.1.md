# 天道·系统 - 设计方案 v1.1

## 更新说明（相比 v1.0）

**重点补足三个方面：**
1. ✅ 完整 ER 图 + 可执行 DDL 数据字典
2. ✅ 权限体系设计（RBAC + ABAC）
3. ✅ 跨模块事务边界设计 + 审计日志

**移除内容：**
- ❌ 飞升管理流程
- ❌ 轮回投胎系统

**核心改进：**
- 所有表结构转为标准化 DDL 格式
- 每个模块独立 ER 图描述
- 新增权限角色体系（天帝/殿主/判官/司主/凡人）
- 新增审计日志表（所有敏感操作）
- 新增领域事件总线设计
- 新增 API 契约设计

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
│                 业务逻辑层（Service Layer）            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│  │ 成员服务  │ │ 天庭服务  │ │ 地府服务  │ │功法服务│ │
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

## 1.2 数据库选型说明

| 数据库 | 用途 | 选型理由 |
|--------|------|---------|
| PostgreSQL | 主数据存储 | 强事务、JSON 支持、递归 CTE |
| Neo4j | 社会关系、师承网络 | 图遍历查询最优 |
| Redis | 缓存、实时状态、消息队列 | 高性能、原子操作 |
| OSS/MinIO | 文件（图/音/视频） | 海量非结构化数据 |

**不再使用 Neo4j 的替代方案：**
- 师承关系用 PostgreSQL 邻接表 + 递归 CTE 查询
- 师承关系图谱展示用 Neo4j 专用于可视化
- 结论：Neo4j 降级为"关系可视化插件"，主数据走 PostgreSQL

---

# 第二部分：完整 ER 图与数据字典

## 2.1 核心实体关系总览

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│   member    │──────│ member_role │──────│    role     │
│  (成员档案) │       │ (成员角色)  │       │   (角色)    │
└──────┬──────┘       └─────────────┘       └──────┬──────┘
       │                                            │
       │ 1:N                                 1:N   │
       ▼                                           │
┌─────────────┐                            ┌────────▼──────┐
│member_photo │                            │ role_permission│
│  (照片)    │                            │  (角色权限)   │
└─────────────┘                            └───────┬──────┘
                                                   │
                                          ┌────────▼──────┐
                                          │  permission   │
                                          │   (权限)      │
                                          └───────┬──────┘
                                                  │
                                         ┌────────▼──────┐
                                         │  audit_log    │
                                         │  (审计日志)   │
                                         └───────────────┘

┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│  territory  │──────│  weather    │──────│  lightning   │
│  (天庭区域)  │       │  (天气)    │       │  (雷电)     │
└─────────────┘       └─────────────┘       └─────────────┘

┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│  lifebook   │──────│  sentence   │──────│    prison    │
│  (生死簿)   │       │  (判决)    │       │  (关押)     │
└─────────────┘       └─────────────┘       └─────────────┘

┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│   chapter   │──────│    video   │──────│    audio    │
│  (功法章节)  │       │  (视频)    │       │  (音频)     │
└─────────────┘       └─────────────┘       └─────────────┘
        │
        │ N:1
        ▼
┌─────────────┐       ┌─────────────┐
│   technique │──────│cultivation │
│   (功法)   │       │ (修行记录) │
└─────────────┘       └─────────────┘
```

---

## 2.2 表结构详细设计（DDL）

### 2.2.1 成员管理模块

#### 表：member（成员主表）

```sql
CREATE TABLE member (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- 基础信息
    name            VARCHAR(100) NOT NULL COMMENT '姓名/仙名',
    name_type       VARCHAR(20) NOT NULL DEFAULT '俗名' COMMENT '名称类型：俗名/仙名/法号',
    gender          VARCHAR(20) NOT NULL COMMENT '性别：男/女/无相/阴阳人',
    birth_date_solar DATE COMMENT '阳历出生日期',
    birth_date_lunar DATE COMMENT '阴历出生日期',
    four_pillars    VARCHAR(50) COMMENT '四柱八字',
    five_elements   VARCHAR(100) COMMENT '五行属性JSON：["金","木"]',
    realm           VARCHAR(50) NOT NULL COMMENT '阵营：天庭/地府/人间散修/妖族/鬼道',
    status          VARCHAR(20) NOT NULL DEFAULT 'alive' COMMENT '状态：alive/dead/reincarnating/immortal',
    is_deleted      BOOLEAN NOT NULL DEFAULT FALSE COMMENT '软删除标记',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by      UUID COMMENT '最后修改人',
    version         INTEGER NOT NULL DEFAULT 1 COMMENT '乐观锁版本号'
);

CREATE INDEX idx_member_realm ON member(realm);
CREATE INDEX idx_member_status ON member(status);
CREATE INDEX idx_member_name ON member(name);
CREATE INDEX idx_member_is_deleted ON member(is_deleted) WHERE is_deleted = FALSE;
COMMENT ON TABLE member IS '天道成员主表';
```

#### 表：member_identity（身份证明）

```sql
CREATE TABLE member_identity (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id       UUID NOT NULL REFERENCES member(id) ON DELETE CASCADE,
    id_card_number  VARCHAR(50) COMMENT '身份证号（凡人有真实身份证，神仙有天道编号）',
    id_photo_id     UUID COMMENT '身份证照片文件ID',
    full_body_photo_id UUID COMMENT '全身照文件ID',
    dharma_photo_id UUID COMMENT '法相庄严照文件ID',
    soul_photo_id   UUID COMMENT '魂魄照文件ID（地府用）',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mi_member ON member_identity(member_id);
COMMENT ON TABLE member_identity IS '成员身份证明附件表';
```

#### 表：member_cultivation（修行状态）

```sql
CREATE TABLE member_cultivation (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id       UUID NOT NULL UNIQUE REFERENCES member(id) ON DELETE CASCADE,
    realm_id        INTEGER NOT NULL REFERENCES realm(id) COMMENT '当前境界ID',
    cultivation_years INTEGER NOT NULL DEFAULT 0 COMMENT '修行年限',
    current_location UUID REFERENCES location(id) COMMENT '当前位置（洞府/寺庙）',
    teacher_id      UUID REFERENCES member(id) COMMENT '师父ID（邻接表自关联）',
    flying_date     DATE COMMENT '飞升日期（若已飞升）',
    death_date      DATE COMMENT '陨落日期（若已陨落）',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mc_member ON member_cultivation(member_id);
CREATE INDEX idx_mc_teacher ON member_cultivation(teacher_id);
COMMENT ON TABLE member_cultivation IS '成员修行状态表';
```

#### 表：realm（境界表）

```sql
CREATE TABLE realm (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(50) NOT NULL UNIQUE COMMENT '境界名称',
    stage           VARCHAR(50) NOT NULL COMMENT '阶段：世俗/入门/小成/大成/蜕变/圆满/关键/仙界',
    mana_feature    TEXT COMMENT '法力特征描述',
    lifespan_limit  INTEGER COMMENT '寿元上限（岁），NULL表示永恒',
    fly_up_required TEXT COMMENT '飞升要求',
    sort_order      INTEGER NOT NULL DEFAULT 0 COMMENT '排序顺序',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO realm (name, stage, mana_feature, lifespan_limit, fly_up_required, sort_order) VALUES
('凡人','世俗','无',100,NULL,1),
('筑基期','入门','真气初成',200,'体健',2),
('金丹期','小成','金丹凝实',500,'功德>500',3),
('元婴期','大成','元婴出窍',1000,'功德>1000, 心性过关',4),
('化神期','蜕变','神识化形',3000,'功德>3000',5),
('大乘期','圆满','法力滔天',10000,'功德>8000, 渡劫考核',6),
('渡劫期','关键','雷劫洗礼',NULL,'雷劫9重',7),
('真仙','仙界','长生不死',NULL,'天庭认证',8),
('金仙','仙界','大神通',NULL,'功德圆满',9),
('大罗金仙','仙界','法则领悟',NULL,'开宗立派',10),
('混元大罗','巅峰','宇宙同寿',NULL,'无人知晓',11);
COMMENT ON TABLE realm IS '修行境界等级表';
```

#### 表：member_position（成员职位-当前）

```sql
CREATE TABLE member_position (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id       UUID NOT NULL REFERENCES member(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organization(id),
    position_name   VARCHAR(100) NOT NULL COMMENT '职位名称',
    position_level  VARCHAR(20) NOT NULL DEFAULT '正职' COMMENT '职级：正职/副职/代理/临时',
    position_type   VARCHAR(20) NOT NULL COMMENT '职位类型：官职/封号/俗家',
    assume_date     DATE NOT NULL COMMENT '任职日期',
    vacate_date     DATE COMMENT '卸任日期，NULL表示在任',
    assessment_score DECIMAL(5,2) COMMENT '政绩考核分 0-100',
    is_current      BOOLEAN NOT NULL DEFAULT TRUE COMMENT '是否当前职位',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mp_member ON member_position(member_id);
CREATE INDEX idx_mp_is_current ON member_position(member_id, is_current) WHERE is_current = TRUE;
COMMENT ON TABLE member_position IS '成员当前职位表';
```

#### 表：member_position_history（成员历史职位）

```sql
CREATE TABLE member_position_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id       UUID NOT NULL REFERENCES member(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organization(id),
    position_name   VARCHAR(100) NOT NULL,
    position_type   VARCHAR(20) NOT NULL,
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    event_id        UUID REFERENCES system_event(id) COMMENT '关联重大事件',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mph_member ON member_position_history(member_id);
COMMENT ON TABLE member_position_history IS '成员历史职位表';
```

#### 表：member_relationship（社会关系）

```sql
CREATE TABLE member_relationship (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_a_id     UUID NOT NULL REFERENCES member(id) ON DELETE CASCADE,
    member_b_id     UUID NOT NULL REFERENCES member(id) ON DELETE CASCADE,
    relationship_type VARCHAR(20) NOT NULL COMMENT '师徒/父子/兄弟/夫妻/主仆/仇敌/知己',
    intensity       INTEGER NOT NULL CHECK (intensity BETWEEN 1 AND 10) COMMENT '关系紧密程度 1-10',
    notes           TEXT,
    established_at  DATE NOT NULL,
    ended_at        DATE COMMENT '关系结束日期，NULL表示存续',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_no_self_relation CHECK (member_a_id != member_b_id)
);

CREATE INDEX idx_mr_a ON member_relationship(member_a_id);
CREATE INDEX idx_mr_b ON member_relationship(member_b_id);
CREATE INDEX idx_mr_type ON member_relationship(relationship_type);
CREATE INDEX idx_mr_active ON member_relationship(is_active) WHERE is_active = TRUE;
COMMENT ON TABLE member_relationship IS '成员社会关系表';
```

### 2.2.2 天庭自然管理模块

#### 表：territory（天庭管辖区域）

```sql
CREATE TABLE territory (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL UNIQUE COMMENT '区域名称',
    parent_id       UUID REFERENCES territory(id) COMMENT '父区域（层级结构）',
    climate_type    VARCHAR(20) NOT NULL COMMENT '气候：热带/亚热带/温带/寒带/极寒',
    mana_density    DECIMAL(5,2) COMMENT '灵气浓度 0-100',
    total_area      DECIMAL(10,2) COMMENT '区域面积（平方公里）',
    manager_god_id  UUID REFERENCES member(id) COMMENT '管辖天神',
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_t_parent ON territory(parent_id);
CREATE INDEX idx_t_manager ON territory(manager_god_id);
COMMENT ON TABLE territory IS '天庭管辖区域表';
```

#### 表：weather_control（天气调控记录）

```sql
CREATE TABLE weather_control (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    territory_id    UUID NOT NULL REFERENCES territory(id),
    operator_god_id UUID NOT NULL REFERENCES member(id),
    weather_type    VARCHAR(50) NOT NULL COMMENT '晴/多云/阴/雾/雨/暴雨/雷暴/台风/雪/暴雪/冰雹/霜冻/沙尘暴/龙卷风',
    operation_type  VARCHAR(20) NOT NULL COMMENT '发起/增强/减弱/终止',
    intensity       INTEGER NOT NULL CHECK (intensity BETWEEN 1 AND 10) COMMENT '强度',
    duration_hours  DECIMAL(6,2) COMMENT '预计持续小时数',
    reason          TEXT COMMENT '操作原因',
    side_effect    TEXT COMMENT '对周边区域副作用',
    executed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at        TIMESTAMPTZ COMMENT '实际结束时间'
);

CREATE INDEX idx_wc_territory ON weather_control(territory_id);
CREATE INDEX idx_wc_executed ON weather_control(executed_at);
COMMENT ON TABLE weather_control IS '天气调控操作记录表';
```

#### 表：current_weather（当前天气状态）

```sql
CREATE TABLE current_weather (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    territory_id    UUID NOT NULL UNIQUE REFERENCES territory(id),
    weather_type    VARCHAR(50) NOT NULL,
    intensity       INTEGER NOT NULL CHECK (intensity BETWEEN 1 AND 10),
    duration_hours  DECIMAL(6,2),
    warning_level   VARCHAR(20) DEFAULT 'normal' COMMENT 'normal/蓝色/黄色/橙色/红色',
    last_updated    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by      UUID NOT NULL REFERENCES member(id)
);

CREATE INDEX idx_cw_territory ON current_weather(territory_id);
COMMENT ON TABLE current_weather IS '区域当前天气状态表';
```

#### 表：lightning_event（雷电事件）

```sql
CREATE TABLE lightning_event (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    territory_id    UUID NOT NULL REFERENCES territory(id),
    lightning_type  VARCHAR(20) NOT NULL COMMENT '雷劫/天雷/常规',
    member_id       UUID REFERENCES member(id) COMMENT '雷劫对象（修行者）',
    intensity       INTEGER NOT NULL CHECK (intensity BETWEEN 1 AND 12) COMMENT '1-12重',
    happened_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    location        GEOGRAPHY(POINT, 4326) COMMENT '发生地点地理坐标',
    hit_status      BOOLEAN COMMENT '是否命中',
    result          VARCHAR(20) COMMENT '成功/失败/重伤/陨落',
    witness_ids     UUID[] COMMENT '见证天神ID数组'
);

CREATE INDEX idx_le_territory ON lightning_event(territory_id);
CREATE INDEX idx_le_member ON lightning_event(member_id);
CREATE INDEX idx_le_happened ON lightning_event(happened_at);
COMMENT ON TABLE lightning_event IS '雷电事件记录表';
```

#### 表：disaster_warning（自然灾害预警）

```sql
CREATE TABLE disaster_warning (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    territory_id    UUID NOT NULL REFERENCES territory(id),
    disaster_type   VARCHAR(50) NOT NULL COMMENT '洪水/地震/火山/海啸/瘟疫/蝗灾',
    warning_level   VARCHAR(20) NOT NULL COMMENT '蓝色/黄色/橙色/红色',
    warning_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expected_at     TIMESTAMPTZ NOT NULL COMMENT '预计发生时间',
    casuality_estimate JSONB COMMENT '{"death":1000, "injured":5000}',
    responsible_god_id UUID REFERENCES member(id),
    handling_plan   TEXT NOT NULL COMMENT '处置方案',
    assessment_id   UUID REFERENCES assessment(id) COMMENT '关联考核记录',
    status          VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending/handling/resolved/cancelled',
    resolved_at     TIMESTAMPTZ,
    resolution_note TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dw_territory ON disaster_warning(territory_id);
CREATE INDEX idx_dw_status ON disaster_warning(status);
COMMENT ON TABLE disaster_warning IS '自然灾害预警表';
```

### 2.2.3 地府管理模块

#### 表：lifebook（生死簿）

```sql
CREATE TABLE lifebook (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id       UUID NOT NULL UNIQUE REFERENCES member(id) ON DELETE CASCADE,
    creature_type   VARCHAR(20) NOT NULL COMMENT '人/妖/鬼/仙/神/魔/动物/植物',
    lifespan_days   INTEGER NOT NULL COMMENT '阳寿年限（天）',
    life_start      TIMESTAMPTZ NOT NULL COMMENT '阳寿起始',
    life_end        TIMESTAMPTZ NOT NULL COMMENT '阳寿终结',
    current_state   VARCHAR(20) NOT NULL DEFAULT 'alive' COMMENT 'alive/dying/dead/reincarnating',
    cause_of_death TEXT COMMENT '死因',
    soul_state      VARCHAR(20) COMMENT '自由/囚禁/reincarnated',
    underworld_zone UUID REFERENCES underworld_zone(id) COMMENT '所属地府分区',
    trial_result    VARCHAR(20) COMMENT '善终/恶死/reincarnate/永堕',
    is_overdue      BOOLEAN NOT NULL DEFAULT FALSE COMMENT '是否阳寿透支',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by      UUID,
    version         INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_lb_member ON lifebook(member_id);
CREATE INDEX idx_lb_state ON lifebook(current_state);
CREATE INDEX idx_lb_life_end ON lifebook(life_end);
COMMENT ON TABLE lifebook IS '生死簿核心表';
```

#### 表：underworld_zone（地府分区）

```sql
CREATE TABLE underworld_zone (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hall_id         INTEGER NOT NULL REFERENCES underworld_hall(id),
    hall_name       VARCHAR(50) NOT NULL COMMENT '殿名：第一殿~第十殿',
    hall_master_id  UUID REFERENCES member(id) COMMENT '殿主',
    function_desc   TEXT NOT NULL COMMENT '本殿职责',
    soul_types      VARCHAR(100)[] COMMENT '管辖罪魂类型数组',
    current_count   INTEGER NOT NULL DEFAULT 0 COMMENT '当前在押数',
    max_capacity    INTEGER COMMENT '最大容量，NULL表示无限制',
    temperature     DECIMAL(5,2) COMMENT '殿内温度（摄氏度）',
    special_env     JSONB COMMENT '{"torture_tools":[],"features":[]}',
    annual_score    DECIMAL(5,2) COMMENT '年度考核评分',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_uz_hall ON underworld_zone(hall_id);
COMMENT ON TABLE underworld_zone IS '地府分区表';
```

#### 表：underworld_hall（地府十殿）

```sql
CREATE TABLE underworld_hall (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(50) NOT NULL UNIQUE COMMENT '殿名',
    function_desc   TEXT NOT NULL,
    sort_order      INTEGER NOT NULL DEFAULT 0
);

INSERT INTO underworld_hall (name, function_desc, sort_order) VALUES
('第一殿 秦广王','孽镜台前照分明',1),
('第二殿 楚江王','寒冰殿中受苦刑',2),
('第三殿 宋帝王','黑绳地狱压罪人',3),
('第四殿 五官王','血池之中洗罪孽',4),
('第五殿 阎罗王','枉死城中审判台',5),
('第六殿 卞城王','尖叫大地狱',6),
('第七殿 泰山王','火翳地狱焚罪业',7),
('第八殿 都市王','热恼大地狱',8),
('第九殿 平等王','阿鼻大地狱',9),
('第十殿 转轮王','轮回投胎终审',10);
COMMENT ON TABLE underworld_hall IS '地府十殿主表';
```

#### 表：imprisonment（魂魄关押）

```sql
CREATE TABLE imprisonment (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    soul_id         UUID NOT NULL REFERENCES lifebook(id),
    zone_id         UUID NOT NULL REFERENCES underworld_zone(id),
    cell_location   VARCHAR(100) COMMENT '关押区域具体位置',
    admitted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    released_at     TIMESTAMPTZ COMMENT '出狱时间，NULL表示在押',
    sentence_years  INTEGER COMMENT '刑期年限，NULL表示永世',
    guard_id       UUID REFERENCES member(id) COMMENT '负责狱卒',
    current_tortures VARCHAR(50)[] COMMENT '正在执行的刑罚数组',
    health_status   VARCHAR(20) DEFAULT '元神完整' COMMENT '元神完整/受损/微弱/消散',
    is_permanent    BOOLEAN NOT NULL DEFAULT FALSE COMMENT '是否永世关押'
);

CREATE INDEX idx_imp_soul ON imprisonment(soul_id);
CREATE INDEX idx_imp_zone ON imprisonment(zone_id);
CREATE INDEX idx_imp_released ON imprisonment(released_at) WHERE released_at IS NULL;
COMMENT ON TABLE imprisonment IS '魂魄关押记录表';
```

#### 表：sentence（判决记录）

```sql
CREATE TABLE sentence (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    soul_id         UUID NOT NULL REFERENCES lifebook(id),
    zone_id         UUID NOT NULL REFERENCES underworld_zone(id),
    judge_id        UUID NOT NULL REFERENCES member(id) COMMENT '判官',
    sentenced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    crime_type      VARCHAR(100) NOT NULL COMMENT '罪责类型',
    crime_detail    TEXT NOT NULL COMMENT '罪行详情',
    merit_score     INTEGER NOT NULL DEFAULT 0 COMMENT '功德值（负数为业障）',
    tortures        VARCHAR(50)[] NOT NULL COMMENT '量定刑罚数组',
    sentence_years  INTEGER COMMENT '刑期年限',
    is_permanent    BOOLEAN NOT NULL DEFAULT FALSE,
    appeal_result   VARCHAR(20) COMMENT '申诉结果：维持/改判/发回重审',
    appeal_judge_id UUID REFERENCES member(id),
    status          VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT 'active/completed/appealed/revised',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sentence_soul ON sentence(soul_id);
CREATE INDEX idx_sentence_judge ON sentence(judge_id);
CREATE INDEX idx_sentence_status ON sentence(status);
COMMENT ON TABLE sentence IS '判决记录表';
```

#### 表：merit_record（功德业障记录）

```sql
CREATE TABLE merit_record (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id       UUID NOT NULL REFERENCES member(id),
    record_type     VARCHAR(20) NOT NULL COMMENT '功德/业障',
    event_name      VARCHAR(200) NOT NULL COMMENT '事件名称',
    event_detail    TEXT COMMENT '事件详情',
    value_change    INTEGER NOT NULL COMMENT '数值变化，正数为功德，负数为业障',
    happened_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    location        GEOGRAPHY(POINT, 4326) COMMENT '发生地点',
    witnesses       UUID[] COMMENT '目击者ID数组',
    recorded_by     UUID NOT NULL REFERENCES member(id) COMMENT '记录判官',
    verified_status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending/verified/disputed',
    evidence_files  UUID[] COMMENT '证据文件ID数组',
    verified_at     TIMESTAMPTZ,
    verified_by     UUID REFERENCES member(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mr_member ON merit_record(member_id);
CREATE INDEX idx_mr_type ON merit_record(record_type);
CREATE INDEX idx_mr_happened ON merit_record(happened_at);
CREATE INDEX idx_mr_verified ON merit_record(verified_status) WHERE verified_status = 'pending';
COMMENT ON TABLE merit_record IS '功德业障记录表';
```

### 2.2.4 功法修行模块

#### 表：technique（功法主表）

```sql
CREATE TABLE technique (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL UNIQUE,
    category        VARCHAR(50) NOT NULL COMMENT '炼体/炼气/炼神/剑法/符箓/阵法/丹道/器修/鬼道/妖族',
    grade           VARCHAR(20) NOT NULL COMMENT '凡阶/灵阶/仙阶/神阶/天阶/禁忌',
    suitable_realm  INTEGER[] COMMENT '适合境界ID数组',
    required_merit  INTEGER NOT NULL DEFAULT 0 COMMENT '功德值要求',
    required_condition TEXT COMMENT '其他前提条件',
    current_version INTEGER NOT NULL DEFAULT 1 COMMENT '当前版本号',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tech_category ON technique(category);
CREATE INDEX idx_tech_grade ON technique(grade);
CREATE INDEX idx_tech_active ON technique(is_active) WHERE is_active = TRUE;
COMMENT ON TABLE technique IS '功法主表';
```

#### 表：technique_version（功法版本历史）

```sql
CREATE TABLE technique_version (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    technique_id    UUID NOT NULL REFERENCES technique(id) ON DELETE CASCADE,
    version         INTEGER NOT NULL,
    changelog       TEXT COMMENT '版本变更说明',
    changed_by      UUID NOT NULL REFERENCES member(id),
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(technique_id, version)
);

CREATE INDEX idx_tv_technique ON technique_version(technique_id);
COMMENT ON TABLE technique_version IS '功法版本历史表';
```

#### 表：technique_chapter（功法章节）

```sql
CREATE TABLE technique_chapter (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    technique_id    UUID NOT NULL REFERENCES technique(id) ON DELETE CASCADE,
    chapter_number  INTEGER NOT NULL,
    title           VARCHAR(200) NOT NULL,
    content         TEXT NOT NULL COMMENT 'Markdown富文本内容',
    key_points      TEXT[] COMMENT '要点提炼数组',
    precautions     TEXT COMMENT '修行注意事项',
    UNIQUE(technique_id, chapter_number)
);

CREATE INDEX idx_tc_technique ON technique_chapter(technique_id);
COMMENT ON TABLE technique_chapter IS '功法图文章节表';
```

#### 表：technique_video（功法视频）

```sql
CREATE TABLE technique_video (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    technique_id    UUID NOT NULL REFERENCES technique(id) ON DELETE CASCADE,
    title           VARCHAR(200) NOT NULL,
    video_url       VARCHAR(500) NOT NULL COMMENT '视频存储URL',
    duration_seconds INTEGER NOT NULL COMMENT '时长秒数',
    instructor_id   UUID REFERENCES member(id),
    description     TEXT,
    subtitle_file_id UUID COMMENT '字幕文件ID',
    suitable_realm_id INTEGER REFERENCES realm(id),
    quality_level   VARCHAR(20) DEFAULT '高清' COMMENT '流畅/高清/超清/4K',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tv_technique ON technique_video(technique_id);
COMMENT ON TABLE technique_video IS '功法视频教程表';
```

#### 表：technique_audio（功法音频）

```sql
CREATE TABLE technique_audio (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    technique_id    UUID NOT NULL REFERENCES technique(id) ON DELETE CASCADE,
    title           VARCHAR(200) NOT NULL,
    audio_url       VARCHAR(500) NOT NULL,
    duration_seconds INTEGER NOT NULL,
    instructor_id   UUID REFERENCES member(id),
    suitable_scene  VARCHAR(20) DEFAULT '打坐' COMMENT '打坐/行走/睡眠',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ta_technique ON technique_audio(technique_id);
COMMENT ON TABLE technique_audio IS '功法音频教程表';
```

#### 表：cultivation_log（修行日志）

```sql
CREATE TABLE cultivation_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id       UUID NOT NULL REFERENCES member(id) ON NULL CASCADE,
    log_date        DATE NOT NULL,
    technique_id    UUID REFERENCES technique(id),
    duration_minutes INTEGER NOT NULL COMMENT '修习时长（分钟）',
    location_id     UUID REFERENCES location(id),
    progress        DECIMAL(5,2) COMMENT '修为增长量',
    body_status     VARCHAR(20) NOT NULL DEFAULT '正常' COMMENT '精力充沛/正常/疲惫/走火入魔',
    abnormality     TEXT COMMENT '异常记录',
    reflection      TEXT COMMENT '心得体会',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cl_member ON cultivation_log(member_id);
CREATE INDEX idx_cl_date ON cultivation_log(log_date);
CREATE INDEX idx_cl_member_date ON cultivation_log(member_id, log_date);
COMMENT ON TABLE cultivation_log IS '修行日志表';
```

#### 表：cultivation_assessment（修行考核）

```sql
CREATE TABLE cultivation_assessment (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id       UUID NOT NULL REFERENCES member(id),
    assessment_type VARCHAR(20) NOT NULL COMMENT '年度考核/境界考核/师门考核',
    assessed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    realm_before_id INTEGER NOT NULL REFERENCES realm(id),
    realm_after_id  INTEGER REFERENCES realm(id),
    exam_content    JSONB COMMENT '{"笔试":题目,"实操":项目}',
    exam_score      JSONB COMMENT '{"笔试成绩":85,"实操成绩":90}',
    overall_result  VARCHAR(20) NOT NULL COMMENT '优秀/良好/及格/不及格',
    judge_comment   TEXT COMMENT '考官评语',
    judge_id        UUID NOT NULL REFERENCES member(id),
    promotion_result VARCHAR(20) COMMENT '晋升/保留/降级',
    passed          BOOLEAN COMMENT '是否通过',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ca_member ON cultivation_assessment(member_id);
CREATE INDEX idx_ca_type ON cultivation_assessment(assessment_type);
COMMENT ON TABLE cultivation_assessment IS '修行考核表';
```

#### 表：master_apprentice（师徒关系）

```sql
CREATE TABLE master_apprentice (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_id       UUID NOT NULL REFERENCES member(id),
    apprentice_id   UUID NOT NULL REFERENCES member(id),
    relation_type   VARCHAR(20) NOT NULL DEFAULT '正式弟子' COMMENT '正式弟子/记名弟子/外门弟子',
    apprentice_date DATE NOT NULL,
    graduate_date   DATE COMMENT '出师日期，NULL表示未出师',
    status          VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT '存续/出师/叛师/逐出',
    techniques_passed UUID[] COMMENT '传承功法ID数组',
    master_rating   DECIMAL(3,2) COMMENT '师父对徒弟评分 1-5',
    apprentice_rating DECIMAL(3,2) COMMENT '徒弟对师父评分 1-5',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_no_self_master CHECK (master_id != apprentice_id)
);

CREATE INDEX idx_ma_master ON master_apprentice(master_id);
CREATE INDEX idx_ma_apprentice ON master_apprentice(apprentice_id);
CREATE INDEX idx_ma_status ON master_apprentice(status) WHERE status = 'active';
COMMENT ON TABLE master_apprentice IS '师徒关系表';
```

### 2.2.5 通讯与通缉模块

#### 表：system_notice（天机通报）

```sql
CREATE TABLE system_notice (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notice_type     VARCHAR(20) NOT NULL COMMENT '天庭令/地府牒/三界通缉/悬赏公告',
    title           VARCHAR(200) NOT NULL,
    urgency         VARCHAR(20) NOT NULL DEFAULT '一般' COMMENT '一般/紧急/限时/最高',
    content         TEXT NOT NULL,
    publisher_id    UUID NOT NULL REFERENCES member(id),
    published_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    receiver_scope  VARCHAR(50) NOT NULL COMMENT '全三界/天庭/地府/特定族群',
    attachment_ids  UUID[] COMMENT '附件文件ID数组',
    status          VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending/executing/completed/revoked',
    expired_at      TIMESTAMPTZ COMMENT '过期时间',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sn_type ON system_notice(notice_type);
CREATE INDEX idx_sn_status ON system_notice(status);
CREATE INDEX idx_sn_published ON system_notice(published_at);
COMMENT ON TABLE system_notice IS '天机通报表';
```

#### 表：notice_read_record（通报阅读记录）

```sql
CREATE TABLE notice_read_record (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notice_id       UUID NOT NULL REFERENCES system_notice(id) ON DELETE CASCADE,
    reader_id       UUID NOT NULL REFERENCES member(id),
    read_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    execution_status VARCHAR(20) DEFAULT 'unread' COMMENT 'unread/read/executing/completed',
    execution_note  TEXT COMMENT '执行备注'
);

CREATE UNIQUE INDEX idx_nrr_unique ON notice_read_record(notice_id, reader_id);
COMMENT ON TABLE notice_read_record IS '通报阅读记录表';
```

#### 表：wanted_order（通缉令）

```sql
CREATE TABLE wanted_order (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wanted_member_id UUID NOT NULL REFERENCES member(id),
    reason          TEXT NOT NULL COMMENT '通缉原因',
    danger_level    VARCHAR(20) NOT NULL COMMENT 'A级/B级/C级/D级',
    reward          JSONB NOT NULL COMMENT '{"merit_value":5000,"items":["青葫芦"]}',
    issuer_id       UUID NOT NULL REFERENCES member(id),
    issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoke_condition TEXT COMMENT '撤销条件',
    status          VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT 'active/caught/revoked',
    capturer_id     UUID REFERENCES member(id),
    captured_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wo_member ON wanted_order(wanted_member_id);
CREATE INDEX idx_wo_status ON wanted_order(status) WHERE status = 'active';
COMMENT ON TABLE wanted_order IS '通缉令表';
```

### 2.2.6 审计日志模块（所有敏感操作）

```sql
CREATE TABLE audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operator_id     UUID NOT NULL REFERENCES member(id),
    operator_name   VARCHAR(100) NOT NULL,
    operation_type  VARCHAR(50) NOT NULL COMMENT 'CREATE/READ/UPDATE/DELETE',
    target_table    VARCHAR(100) NOT NULL COMMENT '操作的表名',
    target_id       UUID NOT NULL COMMENT '操作记录ID',
    target_desc     VARCHAR(200) COMMENT '操作对象描述（如成员姓名）',
    old_value       JSONB COMMENT '修改前的值（JSON）',
    new_value       JSONB COMMENT '修改后的值（JSON）',
    change_fields   TEXT[] COMMENT '被修改的字段名数组',
    reason          TEXT COMMENT '操作原因',
    ip_address      VARCHAR(50),
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_al_operator ON audit_log(operator_id);
CREATE INDEX idx_al_target ON audit_log(target_table, target_id);
CREATE INDEX idx_al_created ON audit_log(created_at);
CREATE INDEX idx_al_type ON audit_log(operation_type);
-- 仅保留最近2年数据，定期归档清理
COMMENT ON TABLE audit_log IS '审计日志表（防篡改）';
```

---

# 第三部分：权限体系设计（RBAC + ABAC）

## 3.1 角色定义

### 天道超级管理员（TIANDAO_ADMIN）

| 权限 | 说明 |
|------|------|
| `*` | 所有权限，可管理所有角色和权限 |

### 天帝（HEAVEN_EMPEROR）

| 权限 | 说明 |
|------|------|
| `member:*` | 成员全管理 |
| `heaven:*` | 天庭事务全管理 |
| `underworld:*` | 地府事务全管理 |
| `technique:*` | 功法全管理 |
| `notice:*` | 通缉/通报全管理 |
| `role:assign` | 分配角色 |
| `audit:read` | 查看审计日志 |

### 殿主（HALL_MASTER）

| 权限 | 说明 |
|------|------|
| `member:read` | 查看成员档案 |
| `member:read_self` | 仅查看本殿成员 |
| `underworld_zone:*` | 本殿事务全管理 |
| `sentence:*` | 判决全管理（限本殿） |
| `imprisonment:*` | 关押全管理（限本殿） |
| `merit:*` | 功德业障记录（限本殿） |
| `audit:read_own` | 仅查看本殿审计日志 |

### 判官（JUDGE）

| 权限 | 说明 |
|------|------|
| `lifebook:read` | 查看生死簿 |
| `sentence:create` | 新增判决 |
| `sentence:read` | 查看判决 |
| `merit:create` | 新增功德业障记录 |
| `merit:read` | 查看功德业障 |

### 轮回司主（REINCARNATION_MASTER）

| 权限 | 说明 |
|------|------|
| `reincarnation:*` | 轮回事务全管理 |
| `lifebook:read` | 查看生死簿 |
| `merit:read` | 查看功德业障 |
| `underworld_zone:read` | 查看地府分区 |

### 雷部天神（LIGHTNING_GOD）

| 权限 | 说明 |
|------|------|
| `lightning:*` | 雷电事务全管理 |
| `weather:*` | 天气调控 |
| `disaster:*` | 自然灾害管理 |

### 雨师/龙王（WATER_GOD）

| 权限 | 说明 |
|------|------|
| `weather:control` | 降雨调控 |
| `disaster:read` | 查看灾害预警 |

### 修行者（CULTIVATOR）

| 权限 | 说明 |
|------|------|
| `member:read_self` | 查看本人档案 |
| `member:update_self` | 更新本人信息 |
| `technique:read` | 查看功法列表 |
| `technique:learn` | 申请学习功法 |
| `cultivation:create` | 记录修行日志 |
| `cultivation:read_self` | 查看本人修行记录 |
| `master_apprentice:*` | 师徒关系（限本人） |

### 凡人（MORTAL）

| 权限 | 说明 |
|------|------|
| `member:read_self` | 查看本人档案 |
| `notice:read_public` | 查看公开通报 |

## 3.2 权限表结构

```sql
-- 权限定义表
CREATE TABLE permission (
    code            VARCHAR(100) PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    category        VARCHAR(50) NOT NULL COMMENT 'member/heaven/underworld/technique/notice/system',
    description     TEXT,
    risk_level      VARCHAR(20) NOT NULL DEFAULT 'low' COMMENT 'low/medium/high/critical'
);

-- 角色定义表
CREATE TABLE role (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            VARCHAR(50) NOT NULL UNIQUE,
    name            VARCHAR(100) NOT NULL,
    description     TEXT,
    is_system       BOOLEAN NOT NULL DEFAULT FALSE COMMENT '系统内置不可删除',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 角色-权限关联表
CREATE TABLE role_permission (
    role_id         UUID NOT NULL REFERENCES role(id) ON DELETE CASCADE,
    permission_code VARCHAR(100) NOT NULL REFERENCES permission(code),
    granted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_by      UUID REFERENCES member(id),
    PRIMARY KEY (role_id, permission_code)
);

-- 成员-角色关联表（同一成员可有多角色）
CREATE TABLE member_role (
    member_id       UUID NOT NULL REFERENCES member(id) ON DELETE CASCADE,
    role_id         UUID NOT NULL REFERENCES role(id) ON DELETE CASCADE,
    scope           VARCHAR(50) COMMENT '权限范围：全局/本殿/本人',
    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_by     UUID REFERENCES member(id),
    expires_at      TIMESTAMPTZ COMMENT '角色过期时间，NULL表示永久',
    PRIMARY KEY (member_id, role_id)
);

-- 权限申请记录（敏感权限需要审批）
CREATE TABLE permission_request (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id       UUID NOT NULL REFERENCES member(id),
    requested_perm  VARCHAR(100) NOT NULL REFERENCES permission(code),
    reason          TEXT NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending/approved/rejected',
    approver_id     UUID REFERENCES member(id),
    approved_at     TIMESTAMPTZ,
    approver_note   TEXT,
    requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## 3.3 ABAC 动态权限补充规则

除 RBAC 静态角色外，系统还支持基于属性的动态权限判断：

| 场景 | 判断条件 | 结果 |
|------|---------|------|
| 本殿成员查看 | `member.realm == user.assigned_hall` | 允许查看本殿成员 |
| 判官仅能判决本殿魂魄 | `sentence.zone_id == user.assigned_hall` | 允许创建判决 |
| 师徒关系查看 | `member_relationship.member_a_id == user.id OR member_relationship.member_b_id == user.id` | 允许查看本人关系 |
| 修行者仅看自己功法 | `cultivation_log.member_id == user.id` | 允许增删改本人记录 |
| 功德记录仅本殿可查 | `merit_record.member_id IN (本殿所有成员)` | 允许本殿查看功德 |

---

# 第四部分：跨模块事务边界设计

## 4.1 领域事件总线设计

所有跨模块操作通过事件总线（RabbitMQ/Kafka）解耦，不直接跨库调用：

```
┌──────────────┐    事件    ┌──────────────┐    事件    ┌──────────────┐
│ 成员服务      │ ────────→ │ 事件总线      │ ────────→ │ 天庭服务     │
│ MemberService│           │ EventBus     │           │ HeavenService│
└──────────────┘           └──────────────┘           └──────────────┘
                                    │
                                    ▼
                          ┌──────────────────┐
                          │ 订阅者（Subscriber）│
                          └──────────────────┘
```

### 事件格式（统一）

```json
{
  "eventId": "uuid",
  "eventType": "member.realm_changed",
  "aggregateType": "member",
  "aggregateId": "member-uuid",
  "payload": {
    "oldRealm": "人间散修",
    "newRealm": "天庭",
    "changedAt": "2026-04-05T10:00:00Z",
    "changedBy": "operator-uuid"
  },
  "metadata": {
    "correlationId": "uuid",
    "causationId": "operation-uuid",
    "timestamp": "2026-04-05T10:00:00Z"
  }
}
```

### 事件列表（所有跨模块事件）

| 事件名 | 来源模块 | 目标模块 | 说明 |
|--------|---------|---------|------|
| `member.realm_changed` | 成员 | 天庭/地府 | 成员阵营变更 |
| `member.died` | 成员 | 地府 | 成员死亡，通知生死簿 |
| `member.promoted` | 成员 | 天庭 | 成员晋升，通知天庭更新 |
| `sentence.created` | 地府 | 成员 | 新判决通知当事人 |
| `merit.recorded` | 地府 | 成员 | 功德变更通知当事人 |
| `imprisonment.started` | 地府 | 成员 | 开始关押通知 |
| `imprisonment.released` | 地府 | 成员 | 关押结束通知 |
| `technique.learned` | 功法 | 成员 | 功法学习通知 |
| `cultivation.assessed` | 功法 | 成员 | 考核结果通知 |
| `wanted.created` | 通报 | 天庭/地府 | 新通缉令全网通知 |
| `wanted.captured` | 通报 | 天庭/地府 | 通缉犯落网通知 |

## 4.2 核心业务流程事务边界

### 流程A：成员加入天庭

```
事务范围：member 表 + member_role 表（同一个 PostgreSQL 事务）
                                 ↓ 成功后发布事件
                         member.realm_changed
                                 ↓
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
      订阅者：天庭更新     订阅者：地府记录    订阅者：通知此人
      组织成员表           备注栏变更           系统通报
```

**PostgreSQL 事务（强一致）：**
```sql
BEGIN;
  INSERT INTO member (...) VALUES (...);         -- 创建成员
  INSERT INTO member_role (member_id, role_id)   -- 分配默认角色
    VALUES (new_member_id, 'CULTIVATOR');
  INSERT INTO audit_log (...) VALUES (...);      -- 审计日志
COMMIT;
-- 事件发布在事务外（确保主事务成功才发布）
```

### 流程B：判决创建（地府判官量刑）

```
PostgreSQL 事务（强一致）：
  BEGIN;
    INSERT INTO sentence (...) VALUES (...);     -- 创建判决记录
    UPDATE lifebook SET soul_state='囚禁'       -- 更新生死簿状态
      WHERE id = soul_id;
    INSERT INTO imprisonment (...) VALUES (...); -- 创建关押记录
    UPDATE underworld_zone SET current_count = current_count + 1  -- 更新在押数
      WHERE id = zone_id;
    INSERT INTO audit_log (...) VALUES (...);   -- 审计日志
  COMMIT;
  
  -- 事务成功后发布事件：
  sentence.created        → 通知当事人
  imprisonment.started   → 更新相关统计
```

### 流程C：修行者考核晋升

```
PostgreSQL 事务（强一致）：
  BEGIN;
    INSERT INTO cultivation_assessment (...)     -- 创建考核记录
    UPDATE member_cultivation                   -- 更新境界
      SET realm_id = new_realm_id
      WHERE member_id = member_id;
    INSERT INTO audit_log (...) VALUES (...);  -- 审计日志
  COMMIT;
  
  -- 成功后发布事件：
  cultivation.assessed → 通知修行者
  member.promoted     → 若跨境界，通知天庭更新成员阵营
```

### 流程D：通缉令发布

```
PostgreSQL 事务（强一致）：
  BEGIN;
    INSERT INTO system_notice (type='三界通缉', ...)  -- 发布通报
    INSERT INTO wanted_order (...)                    -- 创建通缉令
    INSERT INTO audit_log (...) VALUES (...);         -- 审计日志
  COMMIT;
  
  -- 成功后发布事件：
  wanted.created → 全三界所有成员收到推送通知
```

## 4.3 Saga 补偿事务（跨多服务操作）

对于无法在单事务完成的跨服务操作，使用 Saga 模式：

### 案例：判官外出押送魂魄（跨区域）

```
Step 1: 地府服务创建押送任务（本地事务）
        → 发布 event: escort_task.created

Step 2: 押送途中到达目标殿（服务调用）
        → 调用目标殿接收API
        → 若超时/失败，执行补偿：取消押送任务，恢复原状态

Step 3: 魂魄登记入目标殿（本地事务）
        → 发布 event: soul.transferred

补偿链：
  若 Step3 失败 → 调用 Step2 取消接收 → 调用 Step1 取消任务
```

## 4.4 死信队列与最终一致性

```
事件发布 → 消费者处理失败 → 重试3次 → 仍失败 → 投入死信队列（DLQ）
                                    ↓
                        人工介入处理 + 告警通知
```

| 配置项 | 值 | 说明 |
|--------|---|------|
| 最大重试次数 | 3 | 自动重试次数 |
| 重试间隔 | 1min/5min/30min | 指数退避 |
| DLQ 保留时间 | 7天 | 人工处理窗口 |
| 告警阈值 | DLQ > 10 | 触发告警 |

---

# 第五部分：API 契约设计

## 5.1 RESTful API 规范

### 基础规范

- URL 格式：`/api/v1/{resource}/{id}/{sub-resource}`
- 认证：`Authorization: Bearer {token}`
- 限流：`X-RateLimit-Limit: 1000/min`
- 版本：`URL 前缀 /api/v1/`

### 核心 API 列表

#### 成员管理

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | /api/v1/members | TIANDAO_ADMIN | 创建成员 |
| GET | /api/v1/members | authenticated | 查询成员列表 |
| GET | /api/v1/members/{id} | authenticated | 成员详情 |
| PUT | /api/v1/members/{id} | member:update_self 或 ADMIN | 更新成员 |
| DELETE | /api/v1/members/{id} | ADMIN | 软删除成员 |
| GET | /api/v1/members/{id}/relationships | owner 或 ADMIN | 社会关系 |
| GET | /api/v1/members/{id}/cultivation | owner 或 ADMIN | 修行状态 |

#### 天庭管理

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | /api/v1/heaven/territories | authenticated | 区域列表 |
| GET | /api/v1/heaven/territories/{id}/weather | authenticated | 区域天气 |
| POST | /api/v1/heaven/weather/control | weather:control | 调控天气 |
| POST | /api/v1/heaven/lightning | lightning:* | 雷电事件 |
| GET | /api/v1/heaven/disasters | authenticated | 灾害预警 |
| POST | /api/v1/heaven/disasters | disaster:* | 创建预警 |

#### 地府管理

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | /api/v1/underworld/lifebook | lifebook:read | 生死簿查询 |
| GET | /api/v1/underworld/lifebook/{id} | lifebook:read | 生死簿详情 |
| PUT | /api/v1/underworld/lifebook/{id}/soul-state | ADMIN | 更新灵魂状态 |
| GET | /api/v1/underworld/zones | authenticated | 分区列表 |
| GET | /api/v1/underworld/zones/{id}/prisoners | zone:read | 在押魂魄 |
| POST | /api/v1/underworld/imprisonment | imprisonment:create | 创建关押 |
| PUT | /api/v1/underworld/imprisonment/{id}/release | imprisonment:release | 释放魂魄 |
| POST | /api/v1/underworld/sentence | sentence:create | 创建判决 |
| GET | /api/v1/underworld/sentences | sentence:read | 判决列表 |

#### 功法管理

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | /api/v1/techniques | authenticated | 功法列表 |
| GET | /api/v1/techniques/{id} | authenticated | 功法详情 |
| POST | /api/v1/techniques | ADMIN | 创建功法 |
| GET | /api/v1/techniques/{id}/chapters | authenticated | 章节列表 |
| GET | /api/v1/techniques/{id}/videos | authenticated | 视频列表 |
| POST | /api/v1/members/{id}/cultivation/log | owner 或 ADMIN | 记录修行 |
| GET | /api/v1/members/{id}/cultivation/logs | owner 或 ADMIN | 修行历史 |
| POST | /api/v1/techniques/{id}/learn | technique:learn | 申请学习 |

#### 通缉与通报

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | /api/v1/notices | authenticated | 通报列表 |
| POST | /api/v1/notices | notice:create | 发布通报 |
| GET | /api/v1/notices/{id}/read-status | owner 或 ADMIN | 阅读状态 |
| GET | /api/v1/wanted | authenticated | 通缉令列表 |
| POST | /api/v1/wanted | notice:create | 发布通缉 |
| PUT | /api/v1/wanted/{id}/capture | ADMIN | 标记抓获 |

#### 审计日志

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | /api/v1/audit-logs | audit:read | 审计日志（ADMIN） |
| GET | /api/v1/audit-logs/export | audit:read | 导出审计报告 |

---

# 第六部分：扩展功能（保留）

以下功能在本版本 v1.1 中预留接口，后续分期实现：

1. **洞府福地管理** - 灵气浓度、位置、容量管理
2. **法器登记** - 法器认主、转让、维修记录
3. **天道历法** - 三界历法换算、节日提醒
4. **三界贸易** - 功德值交易平台
5. **AI 辅助** - 雷劫预测、功德自动核算

---

# 第七部分：系统分期

## 第一期（核心基础）v1.1
- [x] 成员基础档案（含 DDL）
- [x] 权限体系（RBAC + ABAC）
- [x] 审计日志
- [x] 领域事件总线设计
- [x] API 契约 v1

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

_本方案 v1.1 基于 v1.0 评审意见重点补足：ER图、权限体系、事务边界。_
