# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

---

## 凭证管理（2026-04-20 新增）

所有敏感凭证集中在 `~/.openclaw/credentials/` 管理，不再散落各处。

| 文件 | 内容 |
|------|------|
| `database.env` | PostgreSQL / Neo4j 密码 |
| `api-keys.env` | DeepSeek / MiniMax / Brave / DashScope API Keys |
| `qqmail.env` | QQ 邮箱凭证 |
| `loader.js` | Node.js 中央读取器 |
| `loader.py` | Python 中央读取器 |

**使用方式**：
```javascript
const { getApiKey, getDbPassword } = require('~/.openclaw/credentials/loader');
const key = getApiKey('deepseek');
```

**读取优先级**：`process.env` > `credentials/*.env` > `fallback`

详情：`memory/API-KEY-MANAGEMENT.md`

---

## 常用命令 (2026-04-09)

### 记忆系统检查
```bash
node /home/ai/.openclaw/workspace/memory-system/scripts/health-check.js
```
> 用户说"检查记忆系统"时调用此脚本

## 大模型路由策略 (2026-04-04 实测)

### 可用模型速查

| 模型 | 速度 | 评分 | 最佳场景 |
|------|------|------|----------|
| 4sapi/claude-opus-4-6 | ~1.5s | 9/10 | 代码/推理/分析 (当前主模型) |
| 4sapi/claude-sonnet-4-6 | ~1.5s | 8/10 | 日常对话 |
| deepseek/deepseek-reasoner | ~1.5s | 8/10 | 深度推理，含思考链 |
| deepseek/deepseek-chat | ~1s | 8/10 | 快速问答/翻译/大上下文 |
| nvidia/llama-3.1-nemotron-ultra-253b-v1 | ~0.7s | 7/10 | 最快英文任务 |
| nvidia/meta/llama-4-maverick-17b-128e-instruct | ~0.8s | 7/10 | 快速英文任务 |
| nvidia/moonshotai/kimi-k2-instruct | ~1.7s | 7/10 | 快速响应 |
| opendoor/gpt-4.1-mini | ~1.4s | 7/10 | 超大上下文(2M) |
| ollama/qwen3:30b-a3b | ~26s | 6/10 | 本地/隐私/综合 |
| ollama/huihui_ai/deepseek-r1-abliterated:8b | ~29s | 6/10 | 本地深度思考 |
| ollama/lukey03/qwen3.5-9b-abliterated-vision:latest | ~6s | 7/10 | 图文理解(本地) |

### 不可用
- minimax/MiniMax-M2.7 ❌ API Key 格式错误
- minimax-cn/MiniMax-M2.5 ❌ 同上
- 4sapi-gemini/gemini-3-flash ❌ 无权限

### 子任务路由（不影响主对话）

使用 `sessions_spawn` 后台执行：

```
长文本分析 → deepseek/deepseek-chat (1600K 上下文)
代码生成   → 4sapi/claude-opus-4-6
深度推理   → deepseek/deepseek-reasoner
快速翻译   → deepseek/deepseek-chat (~1s)
隐私任务   → ollama/qwen3:30b-a3b (本地)
图文理解   → ollama/qwen3.5-vision:latest
```

详细报告见：`memory/MODEL-SCORE-2026-04-04.md`

---

## 本地大模型 (Ollama)

| 模型 | 大小 | 显存 | 状态 |
|------|------|------|------|
| gemma4:26b | 18 GB | 16GB VRAM | ✅ 正常，39 tok/s |
| gemma4:31b | 20 GB | 16GB VRAM | ❌ GPU OOM |
| bge-m3:latest | 1.2 GB | — | ✅ 向量嵌入 |

**GPU**: AMD Radeon 8060S (Ryzen AI MAX+ 395 集成) | VRAM: 16 GB

## 运维检查脚本 (2026-04-10)

### 安全系统检查
```bash
bash /home/ai/.openclaw/workspace/scripts/security-check.sh
```
> 用户说"检查安全"时调用此脚本
> 检查 UFW 防火墙 + OSSEC HIDS + Active Response + fail2ban

### Skill 更新检查
```bash
bash /home/ai/.openclaw/workspace/scripts/skill-update-checker.sh
```
> 每日 09:00 cron 自动跑，也可手动触发
> 检查 clawhub 已安装 skill 的最新版本，生成报告并发邮件

### 记忆系统检查
```bash
node /home/ai/.openclaw/workspace/memory-system/scripts/health-check.js
```
> 用户说"检查记忆系统"时调用此脚本

## 记忆召回系统 (2026-04-10)

- 文档: `memory-system/docs/RECALL-DESIGN.md`
- Git: `f653af4 feat: 记忆召回系统 Week1+2 升级`
- recall_logs bug 已修复 (user_id NOT NULL / 空vector)

## 审计系统工具 (2026-04-20)

| 工具 | 路径 | 说明 |
|------|------|------|
| append-audit.js | `audit-scripts/append-audit.js` | 核心写入模块（append-only + 批量合并） |
| audit-redact.js | `audit-scripts/audit-redact.js` | 敏感信息脱敏 |
| audit-query.js | `audit-scripts/audit-query.js` | CLI查询工具 |
| audit-monitor.js | `audit-scripts/audit-monitor.js` | 健康监控 |

**常用命令**：
```bash
node audit-scripts/audit-query.js --stats                    # 今日统计
node audit-scripts/audit-query.js --category DATABASE       # 按类别查
node audit-scripts/audit-monitor.js                         # 监控检查
```

**存储位置**：`/home/ai/.openclaw/audit/YYYY-MM-DD.jsonl`（权限 600）

## Thread 系统 API（problem-thread）

**Base URL**: `http://localhost:54321`

### 更新 Thread 阶段
```bash
curl -s -X PATCH "http://localhost:54321/threads/<id>/stage" \
  -H "Content-Type: application/json" \
  -d '{
    "stage": "implementation",
    "content": { "description": "已完成：..." }
  }'
```
- `stage` 可选值：`problem` | `analysis` | `decision` | `implementation` | `verification`
- `content` 对象会 JSON.stringify 存入 `stage_<stage>` 字段

### 更新 Thread 状态
```bash
curl -s -X PATCH "http://localhost:54321/threads/<id>/status" \
  -H "Content-Type: application/json" \
  -d '{"status":"completed"}'
```
- `status` 可选值：`new` | `active` | `completed`

### 查询 Thread
```bash
curl -s "http://localhost:54321/threads?status=active"
curl -s "http://localhost:54321/threads/<id>"
```

**Thread ID 查询**：先 GET `/threads?status=active` 找到目标 Thread 的 id，再做后续操作。
