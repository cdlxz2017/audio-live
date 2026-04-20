# tech-knowledge 技术知识库

## 基本信息
- **类型**：知识检索
- **路径**：`custom-skills/tech-knowledge/`
- **来源**：自制
- **状态**：✅ 正常

## 能力
- 技术文档向量检索（21 个文档入库）
- 配置参数检索
- 独立于记忆系统

## 技术栈
| 组件 | 技术 |
|------|------|
| 向量表 | tech_docs / tech_params |
| 索引 | pgvector IVFFlat |
| 模型 | BGE-m3（1024维） |

## 调用
```bash
node .../tech-recall.js "查询内容"
```

## 入库文档
- SOP 操作流程（Gateway重启/系统清洁/邮件发送）
- LLM API 配置（DeepSeek/4sapi/MiniMax/OpenDoor/有道）
- 系统架构文档（记忆系统/A2A/lingyi-cms评审）
