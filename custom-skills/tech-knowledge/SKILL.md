# tech-knowledge Skill

> 技术知识库查询 — 利用记忆系统的 PG + pgvector 基础设施，独立检索技术文档

## 功能

在对话中识别技术类问题，自动查询技术知识库，返回相关文档和配置参数。

## 调用方式

### 命令行

```bash
node /home/ai/.openclaw/workspace/memory-system/scripts/tech-recall.js "查询内容"
```

### 示例查询

```bash
# 查询 gateway 配置相关
node .../tech-recall.js "gateway 端口"

# 查询邮件配置
node .../tech-recall.js "smtp 邮箱配置"

# 查询 SOP 相关
node .../tech-recall.js "如何重启 gateway"

# 查询记忆系统
node .../tech-recall.js "memory system 架构"

# 查询 PM2 进程
node .../tech-recall.js "PM2 进程管理"
```

## 技术文档索引（21个文档入库）

**SOP 操作流程：**
| 文档 | 路径 | 分类 |
|------|------|------|
| Gateway 重启 SOP | `SOP-GATEWAY-RESTART.md` | skill |
| 系统清洁 SOP | `SOP-CLEAN-SYSTEM.md` | skill |
| 邮件发送 SOP | `SOP-EMAIL.md` | skill |

**LLM API 配置文档：**
| 文档 | 路径 |
|------|------|
| DeepSeek API | `memory/deepseek-apis.md` |
| 4sapi API | `memory/4sapi-apis.md` |
| MiniMax API | `memory/minimax-apis.md` |
| OpenDoor API | `memory/opendoor-apis.md` |
| 阿里云百炼 API | `memory/aliyun-bailian-apis.md` |
| 有道翻译 API | `memory/youdao-apis.md` |
| 有道 TTS API | `memory/youdao-tts-api.md` |

**系统架构文档：**
| 文档 | 路径 |
|------|------|
| 记忆系统架构 | `memory-system/ARCHITECTURE.md` |
| 记忆系统设计 | `memory-system/MEMORY-SYSTEM-DESIGN.md` |
| 记忆系统维护 | `memory-system/MAINTENANCE.md` |
| 记忆系统任务 | `memory-system/TASKS.md` |
| A2A Gateway 测试报告 | `a2a-gateway/TEST-REPORT.md` |
| A2A 兼容性 | `a2a-gateway/docs/COMPATIBILITY.md` |
| lingyi-cms 评审 | `lingyi-cms/SYSTEM-REVIEW.md` |

## 数据库

- **表**: `tech_docs`（文档）、`tech_params`（配置参数）
- **引擎**: pgvector IVFFlat 向量索引
- **向量模型**: BGE-m3（1024维，Ollama）
- **独立于记忆系统**: 不读写 personal_memories / memories 表

## 维护

```bash
# 重新提取所有技术文档入库
node /home/ai/.openclaw/workspace/memory-system/scripts/tech-extractor.js

# 查看已入库文档数
python3 -c "
import psycopg2
conn = psycopg2.connect(host='localhost', port=5432, user='openclaw_ai', password='zyxrcy910128', database='openclaw_memory')
cur = conn.cursor()
cur.execute('SELECT COUNT(*) FROM tech_docs')
print('tech_docs:', cur.fetchone()[0])
cur.execute('SELECT COUNT(*) FROM tech_params')
print('tech_params:', cur.fetchone()[0])
"
```
