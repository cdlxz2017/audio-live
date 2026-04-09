# 天道系统 · 完整设计方案 v1.0

> 设计者：AI Agent
> 版本：1.0（待审核）
> 创建时间：2026-04-05

---

## 一、系统定位与边界

### 1.1 是什么系统
天道系统是一套面向天道组织（含天庭体系与地府体系）的综合性成员与业务管理系统，核心管理：
- 成员个人信息（含四柱命理、照片、职位流转）
- 天庭/地府两大体系的信息维护
- 功法（修炼体系）的管理

### 1.2 非功能定位
- **私密性**：系统内容不对外公开，需登录使用
- **数据资产**：成员照片、四柱信息属于敏感数据，需设置访问权限
- **可扩展**：功法体系未来可能扩展，天庭/地府体系可能增加新的子系统

---

## 二、实体关系设计（ER Diagram）

### 核心实体

```
Member（成员）
  │
  ├── 个人信息（姓名、性别、生日、四柱、联系方式）
  ├── 证件照（身份证正面/背面）
  ├── 全身照
  │
  ├── Positions（当前职位）[N:N through MemberPosition]
  │     └── Position（职位字典）
  │
  ├── HistoricalRoles（历史角色）[N:N through MemberRoleHistory]
  │     └── Role（角色字典）
  │
  ├── MemberRealm（成员归属体系）[N:N]
  │     └── Realm（体系：天庭 / 地府）
  │
  └── MemberCultivation（成员功法修炼）[N:N through MemberCultivation]
        └── CultivationMethod（功法）

Realm（体系）
  ├── 天庭系统
  └── 地府系统

CultivationMethod（功法）
  └── 属性：功法名、等级、系别、修炼条件、效果描述
```

### 实体详细说明

#### 2.1 Member（成员）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name | VARCHAR(50) | 姓名（必填） |
| gender | ENUM(male,female,unknown) | 性别 |
| birthday | DATE | 生日（必填） |
| birth_time | TIME | 出生时辰（必填，用于四柱） |
| bazi | JSONB | 四柱：{year:{gan,zhi}, month:{gan,zhi}, day:{gan,zhi}, hour:{gan,zhi}} |
| phone | VARCHAR(20) | 联系方式 |
| id_card_no | VARCHAR(30) | 身份证号 |
| id_card_front | VARCHAR(500) | 身份证正面照片路径 |
| id_card_back | VARCHAR(500) | 身份证背面照片路径 |
| full_body_photo | VARCHAR(500) | 全身照路径 |
| remark | TEXT | 备注 |
| status | ENUM(active,inactive,deceased) | 状态 |
| created_at | TIMESTAMPTZ | 创建时间 |
| updated_at | TIMESTAMPTZ | 更新时间 |

#### 2.2 Realm（体系）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name | VARCHAR(50) | 体系名称（天庭/地府） |
| code | VARCHAR(20) UNIQUE | 代码（heavenly_court / underworld） |
| description | TEXT | 描述 |
| parent_id | UUID FK→Realm | 上级体系（天庭无上级，地府可设） |
| sort_order | INT | 排序 |
| created_at | TIMESTAMPTZ | |

#### 2.3 Position（职位）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name | VARCHAR(50) | 职位名 |
| code | VARCHAR(20) UNIQUE | 代码 |
| realm_id | UUID FK→Realm | 所属体系（可NULL表示通用） |
| level | INT | 层级（数字越大越高） |
| is_active | BOOLEAN | 是否启用 |
| created_at | TIMESTAMPTZ | |

#### 2.4 Role（角色/历史角色）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name | VARCHAR(50) | 角色名 |
| code | VARCHAR(20) UNIQUE | 代码 |
| realm_id | UUID FK→Realm | 所属体系 |
| is_historical | BOOLEAN | 是否为历史角色 |
| created_at | TIMESTAMPTZ | |

#### 2.5 MemberPosition（成员职位关联）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| member_id | UUID FK→Member | |
| position_id | UUID FK→Position | |
| assigned_at | DATE | 任职日期 |
| is_current | BOOLEAN | 是否当前任职 |
| remark | VARCHAR(200) | 备注 |

#### 2.6 MemberRoleHistory（成员历史角色）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| member_id | UUID FK→Member | |
| role_id | UUID FK→Role | |
| start_date | DATE | 开始日期 |
| end_date | DATE | 结束日期（NULL=未结束） |
| remark | VARCHAR(200) | 备注 |

#### 2.7 MemberRealm（成员体系归属）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| member_id | UUID FK→Member | |
| realm_id | UUID FK→Realm | |
| joined_at | DATE | 加入日期 |
| is_primary | BOOLEAN | 是否主要体系 |

#### 2.8 CultivationMethod（功法）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name | VARCHAR(100) | 功法名 |
| code | VARCHAR(50) UNIQUE | 编码 |
| level | INT | 等级（1-9，数字越大越高） |
| category | ENUM(heaven,earth,human,mixed) | 系别：天系/地系/人系/混合 |
| description | TEXT | 功法描述 |
| requirements | JSONB | 修炼条件 |
| effects | JSONB | 功法效果（数组） |
| is_active | BOOLEAN | 是否启用 |
| created_at | TIMESTAMPTZ | |

#### 2.9 MemberCultivation（成员功法修炼）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| member_id | UUID FK→Member | |
| cultivation_id | UUID FK→CultivationMethod | |
| learned_at | DATE | 学会日期 |
| current_level | INT | 当前等级（1-9） |
| status | ENUM(learning,mastered,suspended) | 修炼状态 |
| remark | TEXT | 备注 |

#### 2.10 SystemUser（系统用户）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| username | VARCHAR(50) UNIQUE | 用户名 |
| password_hash | VARCHAR(255) | 密码（bcrypt） |
| display_name | VARCHAR(50) | 显示名 |
| role | ENUM(admin,manager,viewer) | 角色 |
| status | BOOLEAN | 状态 |
| created_at | TIMESTAMPTZ | |

#### 2.11 AuditLog（操作审计）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| user_id | UUID FK→SystemUser | |
| action | VARCHAR(50) | 操作类型 |
| target_type | VARCHAR(50) | 目标类型 |
| target_id | UUID | 目标ID |
| detail | JSONB | 变更详情 |
| ip_address | VARCHAR(50) | IP地址 |
| created_at | TIMESTAMPTZ | |

---

## 三、功能模块设计

### 3.1 成员管理

#### 3.1.1 成员列表
- 按姓名/电话/体系/职位筛选
- 列表展示：姓名、性别、所属体系、当前职位、状态
- 点击进入详情

#### 3.1.2 成员新增/编辑
**基本信息**：姓名、性别、生日、出生时辰（12时辰选择）、四柱自动计算、手机号、身份证号

**四柱自动计算**：根据生日+时辰自动推算年柱、月柱、日柱、时柱（天干地支）

**证件照上传**：身份证正面/背面（支持JPG/PNG，最大5MB）

**全身照上传**：支持JPG/PNG，最大10MB

**所属体系**：天庭/地府/两者，设置主要体系

**当前职位**：可添加多个职位，设置任职日期，标记主职位

**历史角色**：从角色字典选择，设置起止日期

#### 3.1.3 成员详情
- 完整信息展示，照片点击放大
- 职位变迁时间线
- 历史角色列表
- 功法修炼记录

### 3.2 体系管理（天庭/地府）

- 树形结构展示（天庭→子部门，地府→子部门）
- 层级管理：名称、编码、描述、上级体系

**预设体系**：
- 天庭（heavenly_court）：玉皇大帝统御
- 地府（underworld）：阎王统御

### 3.3 职位管理

**预设天庭职位**：
| 职位名 | 代码 | 层级 |
|--------|------|------|
| 玉皇大帝 | yu_zong | 1 |
| 天王 | tian_wang | 2 |
| 星君 | xing_jun | 3 |
| 天官 | tian_guan | 4 |
| 天兵 | tian_bing | 5 |

**预设地府职位**：
| 职位名 | 代码 | 层级 |
|--------|------|------|
| 阎王 | yan_wang | 1 |
| 判官 | pan_guan | 2 |
| 鬼将 | gui_jiang | 3 |
| 鬼兵 | gui_bing | 4 |

### 3.4 角色管理

区分历史角色和曾任职位，按体系分类

### 3.5 功法系统

**预设天系功法**：
| 功法名 | 等级 | 效果 |
|--------|------|------|
| 九转玄天诀 | 9 | 天系至高功法 |
| 玉清仙法 | 8 | 天庭正统仙法 |
| 天雷诀 | 6 | 召唤天雷 |

**预设地系功法**：
| 功法名 | 等级 | 效果 |
|--------|------|------|
| 幽冥鬼功 | 9 | 地府至高功法 |
| 判官笔法 | 7 | 判官秘传 |
| 鬼卒心法 | 4 | 鬼兵入门功法 |

### 3.6 系统管理

- 用户管理（admin/manager/viewer 三级权限）
- 操作审计日志

---

## 四、技术架构

### 4.1 技术栈
| 层级 | 技术选型 |
|------|---------|
| 后端 | Node.js + Express.js |
| 数据库 | PostgreSQL 16（独立容器） |
| 文件存储 | 本地文件系统（/data/tianfa-uploads/） |
| 前端 | Vue 3 + Vite + Element Plus |
| 反向代理 | Nginx |
| 部署 | Docker + Docker Compose |

### 4.2 数据库连接
- 独立数据库 `tianfa_system`
- 独立用户 `tianfa_user`

### 4.3 文件存储
- 路径：`/data/tianfa-uploads/{member_id}/{photo_type}.{ext}`
- Nginx 直接访问该目录

---

## 五、四柱计算实现方案

### 5.1 核心算法
四柱计算依赖万年历数据，最准确的方式是内置日柱查表。

**天干对应表**（序号 0-9）：
0=甲, 1=乙, 2=丙, 3=丁, 4=戊, 5=己, 6=庚, 7=辛, 8=壬, 9=癸

**地支对应表**（序号 0-11）：
0=子, 1=丑, 2=寅, 3=卯, 4=辰, 5=巳, 6=午, 7=未, 8=申, 9=酉, 10=戌, 11=亥

**计算规则**：
- 年柱：年干 = (年号 - 4) % 10，年支 = (年号 - 4) % 12
- 月柱：月干需配合年干查"五虎遁"起月表，月支 = (月份 + 2) % 12
- 日柱：**使用万年历表查表**（最准确，约5万条数据覆盖1900-2050年）
- 时柱：时干需配合日干查"五鼠遁"起时表，时支 = 时辰序号 * 2

### 5.2 万年历数据
- 预置 1900-2050 年的日柱数据（`ganzhi_calendar` 表）
- 查询：根据出生日期直接查表获取日柱天干地支

---

## 六、API 设计

### 基础路径：`/api/v1`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /auth/login | 登录 |
| GET | /auth/me | 当前用户信息 |
| GET | /members | 成员列表（支持分页/筛选） |
| POST | /members | 新增成员 |
| GET | /members/:id | 成员详情 |
| PUT | /members/:id | 编辑成员 |
| DELETE | /members/:id | 删除成员（admin） |
| POST | /members/:id/positions | 添加职位 |
| POST | /members/:id/roles | 添加历史角色 |
| POST | /members/:id/cultivations | 登记功法修炼 |
| PUT | /members/:id/cultivations/:cid | 更新功法等级/状态 |
| GET | /realms | 体系列表（树形） |
| POST | /realms | 新增体系 |
| PUT | /realms/:id | 编辑体系 |
| DELETE | /realms/:id | 删除体系 |
| GET | /positions | 职位列表 |
| POST | /positions | 新增职位 |
| GET | /roles | 角色列表 |
| POST | /roles | 新增角色 |
| GET | /cultivations | 功法列表 |
| POST | /cultivations | 新增功法 |
| POST | /upload/id-card-front | 上传身份证正面 |
| POST | /upload/id-card-back | 上传身份证背面 |
| POST | /upload/full-body | 上传全身照 |

---

## 七、权限设计

| 角色 | 成员管理 | 体系管理 | 功法管理 | 系统用户 | 审计日志 |
|------|---------|---------|---------|---------|---------|
| admin | 增删改查 | 增删改查 | 增删改查 | 增删改查 | 查 |
| manager | 增删改查 | 增删改查 | 增删改查 | 查 | 查 |
| viewer | 查 | 查 | 查 | 查 | 查 |

---

## 八、部署方案

### 8.1 Docker Compose
```yaml
services:
  tianfa-backend:
    build: ./backend
    ports:
      - "3001:3001"
    volumes:
      - tianfa-uploads:/app/uploads
    environment:
      - DB_HOST=tianfa-db
      - DB_PORT=5432
      - DB_NAME=tianfa_system
      - DB_USER=tianfa_user
      - DB_PASSWORD=<password>
    depends_on:
      - tianfa-db

  tianfa-db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=tianfa_system
      - POSTGRES_USER=tianfa_user
      - POSTGRES_PASSWORD=<password>
    volumes:
      - tianfa-db-data:/var/lib/postgresql/data

  tianfa-frontend:
    build: ./frontend
    ports:
      - "3002:80"
    depends_on:
      - tianfa-backend

volumes:
  tianfa-uploads:
  tianfa-db-data:
```

### 8.2 端口规划
| 服务 | 端口 | 说明 |
|------|------|------|
| 后端 API | 3001 | Express |
| 前端 | 3002 | Nginx |
| 数据库 | 5432 | PostgreSQL |

---

## 九、待确认事项

1. **数据库**：复用 lingyi-db（同一PostgreSQL建新库）还是新建独立数据库服务？
2. **四柱万年历数据**：需要预置1900-2050年数据（约5万条），是否接受？
3. **照片存储**：本地文件系统+ Nginx 访问路径，是否符合要求？
4. **并发规模**：预计多少用户同时使用？
