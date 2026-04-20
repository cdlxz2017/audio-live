# 三层记忆查找

## 基本信息
- **类型**：记忆工具
- **路径**：`custom-skills/three-layer-memory-lookup/`
- **来源**：自制
- **状态**：✅ 正常

## 三层架构
| 层级 | 数据 | 作用 |
|------|------|------|
| 第一层 | conversation_messages | 原始对话 |
| 第二层 | memory_summaries | LLM 综合理解 |
| 第三层 | memories / MEMORY.md | 结构化精选记忆 |

## 能力
- 通过摘要 ID 追溯原始对话
- 精确定位触发摘要的消息
- 查看完整 session 上下文

## 调用
```bash
node .../lookup.js <summary_id>
# 例：node .../lookup.js 1710
```

## 适用场景
- "这是什么时候说的？"
- 核实摘要内容的原始依据
- 审计特定决策的背景
