# 天道·系统 - 项目总结

> 本文档为天道·系统设计方案的完整记录，供新 session 参考。

---

## 一、设计文档版本

| 版本 | 文件 | 说明 |
|------|------|------|
| v1.0 - v1.5 | `TIANDAO-SYSTEM-DESIGN-v1.5.md` | 核心数据库设计 |
| v1.6 | `TIANDAO-SYSTEM-DESIGN-v1.6.md` | 角色动态化 + 部门归属 |
| v1.7 | `TIANDAO-SYSTEM-DESIGN-v1.7.md` | 循环依赖修复 + 部门路径优化 |
| v1.0 - v7.0 | `TIANDAO-MODULE-LOGIC-v13.0.md` | 模块逻辑关系 + 微服务架构 + 高优先级修复（v5.0→v7.0） |

---

## 二、最终设计方案（v1.7）

### 角色体系

| 角色 | 全称 | 职责 | 权限 |
|------|------|------|------|
| HEAVEN_EMPEROR | 昊天金阙玉皇上帝 | 主管天界（诸神/天庭机构/星辰运转） | heaven 类别 |
| POLAR_PURPLE_GOD | 北极紫微大帝 | 主管人间与冥界 | member + underworld + reincarnation |
| LIGHTNING_GOD | 九天应元雷声普化天尊 | 主管天界气象（雷电/风雨/霜雪/灾害/降雨） | heaven:lightning/weather/disaster/territory |
| WATER_GOD | 水部天神 | 主管水系事务 | 权限默认空，管理员自定义 |
| HALL_MASTER | 殿主 | 地府十殿殿主 | underworld:zone:* |
| JUDGE | 判官 | 判决魂魄、记录功德业障 | sentence + merit |
| REINCARNATION_MASTER | 轮回司主 | 轮回投胎事务 | reincarnation + lifebook |

### 部门体系

初始9个部门：天枢部/雷部/水部/功德司/考功司/第一殿/轮回司/人间道/天道秘书处

---

## 三、微服务架构（v4.0）

### 服务列表（11个业务服务 + 2个前端）

```
common/                    # 公共库（3个）
├── common-auth/
├── common-event/
└── common-utils/

auth-service/            # 权限域
member-service/         # 成员域
time-service/          # 时间域（去中心化）
underworld-service/    # 地府域
heaven-service/       # 天庭域
karma-service/        # 现世报域
technique-service/    # 功法域
resource-service/     # 资源物品域（灵石/法宝/丹药）
notice-service/       # 通讯域
world-event-service/  # 现实世界事件接入层【新增v4.0】
gateway/              # API网关
admin-web/            # PC管理后台
admin-app/            # 手机APP
```

### 开发顺序

```
第一阶段：common 四件套
第二阶段：auth → member → notice
第三阶段：time / underworld / heaven / resource
第四阶段：technique → karma
第五阶段：world-event-service【新增】
第六阶段：gateway / admin-web / admin-app
```

---

## 四、world-event-service（v4.0 新增）

### 核心功能
将现实世界事件（天气/自然灾害/战争/瘟疫）映射为天道因果。

### 数据来源
| 数据 | 来源 |
|------|------|
| 天气 | wttr.in / Open-Meteo API |
| 自然灾害 | GDACS / USGS地震API |
| 战争/冲突 | News API |
| 瘟疫 | WHO API |

### 初始映射规则（18条）
- 地震/洪水/台风 → 业障（重度/中度/轻度）
- 战争/恐袭 → 业障重度
- 科技进步/和平条约 → 功德提升

### 核心流程
```
现实事件采集 → karma映射计算 → world.event.occurred → 
karma/underworld/heaven分别处理 → notice全网通报
```

---

## 五、评审结果汇总

### 设计方案评审历史

| 版本 | 模型 | 分数 | 结论 |
|------|------|------|------|
| v1.3 | DeepSeek | 9.2 | 强烈推荐 |
| v1.4 | Gemini 3 Flash | 9.5 | 强烈推荐 |
| v1.5 | Gemini 3 Flash | 9.2 | 强烈推荐 |
| v1.7 | Gemini 3 Flash | 9.2 | 推荐采纳 |

### 模块逻辑评审历史

| 版本 | 模型 | 分数 | 结论 |
|------|------|------|------|
| v2.0 | 多模型 | - | 有条件推荐 |
| v3.0 | DeepSeek | 8.8 | 推荐采纳 |
| v3.0 | Qwen | 7/10 | 有遗漏 |
| v3.0 | Gemini 3 Flash | 口头 | 有建议 |
| v4.0 | DeepSeek | 8.0 | 推荐采纳 |
| v4.0 | Qwen | 6/10 | 细节不足 |
| v4.0 | Gemini 3 Flash | 口头 | 有建议 |
| v5.0 | 自我修复 | — | 5个高优先级问题修复完成，待外部评审 |
| v6.0 | 自我修复 | — | 二次修复（Redis+事务+UNION ALL），待外部评审 |
| v13.0 | 自我修复 | — | 九次修复（event参数补全）（语法错误+async调用链+函数体补全）（INSERT RETURNING*原子幂等）（alert+DLQ+FOR UPDATE+背压）（P0 consumed_events schema + batch并发 + 失败告警 + karma取整），待外部评审 |

---

## 六、待修复问题（进入开发前需解决）

### 高优先级 ✅ 已修复（v2.0）

| # | 问题 | 修复方案 |
|---|------|------|
| 1 | 外部 API 无熔断/容错机制 | Circuit Breaker + Retry + Fallback 三层防护 |
| 2 | 地理查询无 PostGIS，批量处理会爆炸 | 碎片化 bounding box + 空间索引 + 分页批次 |
| 3 | 映射规则太粗，需公式化 | `karma_delta = f(severity, distance, realm, karma_coefficient)` |
| 4 | 缺少批量 API（member地理查询/karma批量触发） | 成员地理批量查询 + karma 批量触发接口 |
| 5 | notice-service 订阅所有事件会被打爆 | 分级过滤 + 聚合通知 + 限流 |

### 中优先级

| # | 问题 | 来源 |
|---|------|------|
| 6 | 缺少"直接触发现世报"规则 | DeepSeek | ✅ v10.0 已新增 `manual` 触发条件类型 + 规则数据 |
| 7 | 成员位置数据来源/更新机制未定义 | DeepSeek | ✅ v10.0 已定义三种更新机制（登录GPS/主动上报/定时刷新）|
| 8 | 公平性质疑（无辜平民受灾却增业障） | DeepSeek | ✅ v10.0 已引入 `accountability_factor` 责任系数 |
| 9 | resource-service 缺少 member.realm_changed 订阅 | Qwen | ✅ v10.0 已补充订阅 + 资源上限调整逻辑 |
| 10 | 缺少多源校验机制（防天道误判） | Gemini | ✅ v10.0 已新增多源校验 + 置信度阈值 |

---

## 七、关键设计决策

| 决策 | 说明 |
|------|------|
| 时间基准 | 以人间时间（GMT+8）为唯一基准，天庭/地府按365倍速/1倍速 |
| 权限设计 | 数据库驱动，管理员可自定义，WATER_GOD 权限默认空 |
| 角色自定义 | is_system=FALSE 时管理员可创建/编辑/删除 |
| 部门路径 | dept_path 字段（如 /TIANDAO_ADMIN/TIANHEAVEN_01）支持前缀查询 |
| 事件格式 | 统一 HeavenlyEvent，含 eventId + idempotencyKey + correlationId |
| time-service | 去中心化，每服务维护自己逻辑时钟 |
| world-event | 按地理范围事件发布，不按成员拆分 |

---

## 八、文件路径

### 设计文档
```
/home/ai/.openclaw/workspace/TIANDAO-SYSTEM-DESIGN-v1.7.md   # 最终版
/home/ai/.openclaw/workspace/TIANDAO-MODULE-LOGIC-v4.0.md    # 模块架构
/home/ai/.openclaw/workspace/TIANDAO-DEVELOPMENT-PLAN.md     # 开发计划
```

### 历史版本
```
/home/ai/.openclaw/workspace/TIANDAO-SYSTEM-DESIGN-v1.0.md
/home/ai/.openclaw/workspace/TIANDAO-SYSTEM-DESIGN-v1.1.md
/home/ai/.openclaw/workspace/TIANDAO-SYSTEM-DESIGN-v1.2.md
/home/ai/.openclaw/workspace/TIANDAO-SYSTEM-DESIGN-v1.3.md
/home/ai/.openclaw/workspace/TIANDAO-SYSTEM-DESIGN-v1.4.md
/home/ai/.openclaw/workspace/TIANDAO-SYSTEM-DESIGN-v1.5.md
/home/ai/.openclaw/workspace/TIANDAO-SYSTEM-DESIGN-v1.6.md
/home/ai/.openclaw/workspace/TIANDAO-MODULE-LOGIC-v2.0.md
/home/ai/.openclaw/workspace/TIANDAO-MODULE-LOGIC-v3.0.md
```

---

## 九、下一步工作

### 立即可开始
1. 基于 v1.7 数据库设计，生成 DDL 脚本
2. 基于 common-auth/common-event，搭建项目脚手架

### 需先解决
1. world-event-service 的 API 容错设计
2. PostGIS 地理查询方案
3. 映射规则公式化
4. 批量 API 接口定义

---

_最后更新：2026-04-05 03:33 GMT+8_
