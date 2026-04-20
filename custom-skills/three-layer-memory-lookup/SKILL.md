# Three-Layer Memory Lookup Skill

> 从摘要追溯原始对话的标准方法

## 功能

通过 `memory_summaries` 的 `source_session_id` + `source_message_ids` 字段，精确定位原始对话上下文。

## 三层记忆架构

| 层级 | 数据表 | 作用 | 定位方式 |
|------|--------|------|----------|
| **第一层** | `conversation_messages` | 原始对话，600+条/session | session_id → 整段会话 |
| **第二层** | `memory_summaries` | LLM 综合理解 | source_session_id + source_message_ids |
| **第三层** | `memories` / MEMORY.md | 结构化/精选记忆，永久沉淀 | entity/attr/value 查询 |

## 追溯流程

```
summary.id = <ID>
  │
  ├─ source_session_id ──→ conversation_messages.session_id = <SID>
  │                          └─ 整段 session 的全部消息
  │
  └─ source_message_ids ──→ conversation_messages.id IN (<IDs>)
                              └─ 精确定位触发消息
```

## 使用方式

### 查询某条摘要的原始对话

```bash
node /home/ai/.openclaw/workspace/custom-skills/three-layer-memory-lookup/lookup.js <summary_id>
```

示例：
```bash
node /home/ai/.openclaw/workspace/custom-skills/three-layer-memory-lookup/lookup.js 1710
```

### 在代码中使用

```javascript
const { lookupSummary } = require('./custom-skills/three-layer-memory-lookup/lookup.js');

// 查找摘要对应的原始消息
const result = await lookupSummary('1710');
// result: { summary, source_session_id, source_message_ids, messages }
```

## 输出示例

```
【摘要 #1710】factual
用户要求对现有数据链开展系统性分析...

【原始消息 #6859】
[Sat 2026-04-17 21:14 GMT+8] 需要修复哪些地方？系统分析一下数据链...

【会话 #121b7b7c-...】共 3 条相关消息
  【6859】user | 需要修复哪些地方？系统分析一下数据链...
  【6860】assistant | 好的，我开始系统性分析...
```

## 注意事项

- 摘要内容是 LLM 对**整个 session** 的综合理解，非单一消息
- `source_message_ids` 指向触发摘要生成的消息，但摘要反映的是整段上下文
- 单轮指令型 → 摘要精准对应；多轮推导型 → 摘要体现全局意图
- 追溯链路：**摘要 → session → 完整上下文**，三层联动

## 适用场景

- 用户问"这是什么时候说的"
- 需要核实摘要内容的原始依据
- 审计/回溯特定决策的背景
- 验证摘要准确性
