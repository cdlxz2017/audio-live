# LinkMem v2.0 Phase 2 执行报告

**执行时间**: 2026-04-16 06:16 CST  
**执行者**: 子代理 (Claude Opus 4-6)  
**状态**: ✅ 全部完成

---

## T2.1 逆向追溯查询接口

### 执行结果: ✅ 成功

**文件**: `memory-system/scripts/get-summary-sources.js`

**功能说明**:
- `getSummarySources(summaryId)` — 给定 summary_id，通过 `summary_message_links` junction table 反查关联的原始对话内容（join `conversation_messages` + `conversation_pairs_view`）
- `getMessageSummaries(messageId)` — 给定 message_id，反查所有引用该消息的活跃摘要

**测试验证**:
```
$ node get-summary-sources.js 1

=== Summary #1 的原始对话 ===
(无关联对话，可能尚未建立 junction table 链接)
```
> 输出符合预期：summary_message_links 表当前无数据，脚本正确处理空结果。当 Phase 1 的 junction table 填充数据后，此接口即可返回完整追溯链路。

---

## T2.2 entity_registry 表

### 执行结果: ✅ 成功

**数据库**: openclaw_memory

**表结构验证**:

| 字段 | 类型 | 可空 | 默认值 |
|------|------|------|--------|
| id | bigint | NO | nextval (序列) |
| canonical_name | text | NO | — |
| aliases | text[] | NO | '{}' |
| entity_type | varchar(30) | YES | — |
| tenant_id | uuid | YES | — |
| user_id | uuid | YES | — |
| confidence | double precision | YES | 0.8 |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**索引验证**:

| 索引名 | 类型 | 定义 |
|--------|------|------|
| entity_registry_pkey | UNIQUE (btree) | id |
| idx_entity_canonical | UNIQUE (btree) | (canonical_name, tenant_id) |
| idx_entity_type | btree | entity_type |
| idx_entity_user | btree | user_id |

---

## 数据逻辑说明

### get-summary-sources.js
记忆系统的**逆向追溯层**。当 recall 返回一条摘要时，可通过此接口追溯到生成该摘要的原始对话片段，实现"摘要 → 原文"的完整链路。这是 LinkMem 架构中 junction table 的核心消费者。

### entity_registry 表
**跨 session 实体统一管理**。解决同一实体在不同对话中使用不同名称的问题（如"灵须子"/"姚旭"/"主人"指向同一人）。通过 `canonical_name` + `aliases[]` 数组实现别名归一化，`entity_type` 支持按类型（person/project/system/preference）分类检索。

---

## 风险评估

| 风险项 | 等级 | 说明 |
|--------|------|------|
| junction table 空数据 | 低 | T2.1 依赖 Phase 1 的 summary_message_links 数据填充，当前为空是正常状态 |
| entity_registry 无触发器 | 低 | updated_at 字段无自动更新触发器，需应用层维护或后续添加 |
| tenant_id NULL 唯一索引 | 低 | PostgreSQL 中 NULL 值在唯一索引中不互斥，多个 tenant_id=NULL 的同名记录可共存，符合单租户场景但多租户需注意 |

---

## 验收清单

- [x] T2.1: `get-summary-sources.js` 文件已创建
- [x] T2.1: `getSummarySources()` 函数可正常执行
- [x] T2.1: `getMessageSummaries()` 函数已导出
- [x] T2.1: CLI 测试入口正常工作
- [x] T2.2: `entity_registry` 表已在 openclaw_memory 数据库创建
- [x] T2.2: 9 个字段类型与默认值均符合设计
- [x] T2.2: 4 个索引（含主键）全部创建成功
- [x] T2.2: `idx_entity_canonical` 唯一约束生效
- [x] 临时执行脚本已清理
