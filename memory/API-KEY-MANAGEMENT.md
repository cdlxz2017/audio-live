# OpenClaw API Key 中央管理方案

> ✅ **状态**: Phase 0-5 全部完成（2026-04-20）

---

## 一、API Key 分布全图盘点

### 1.1 openclaw.json（~/.openclaw/openclaw.json）

OpenClaw 框架的主配置文件，**JSON 明文存储所有密钥**。

| 路径 | Key 名称 | 用途 | 框架读取 | 脚本读取 | 风险等级 |
|------|---------|------|---------|---------|---------|
| `models.providers.4sapi.apiKey` | 4sapi API Key | Claude/GPT 等模型调用 | ✅ | ❌ | 🔴 高 |
| `models.providers.4sapi-gemini.apiKey` | 4sapi Gemini Key | Gemini 模型调用 | ✅ | ❌ | 🔴 高 |
| `models.providers.deepseek.apiKey` | DeepSeek Key | DeepSeek 模型调用 | ✅ | ⚠️ 被 active-researcher.js 直接读 | 🔴 高 |
| `models.providers.nvidia.apiKey` | NVIDIA API Key | NVIDIA NIM 模型 | ✅ | ❌ | 🔴 高 |
| `models.providers.opendoor.apiKey` | OpenDoor Key | GPT-4.1 等 | ✅ | ❌ | 🔴 高 |
| `models.providers.minimax.apiKey` | MiniMax Key | MiniMax M2.7 等 | ✅ | ❌ | 🔴 高 |
| `models.providers.dashscope.apiKey` | DashScope Key | 通义千问等 | ✅ | ❌ | 🔴 高 |
| `models.providers.aicoding.apiKey` | AICoding Key | Codex/Claude Code | ✅ | ❌ | 🔴 高 |
| `models.providers.minimax-cn.apiKey` | MiniMax-CN Key | **无 apiKey 字段**（authHeader 模式） | ✅ | ❌ | 🟡 中 |
| `channels.telegram.botToken` | Telegram Bot Token | Telegram 消息收发 | ✅ | ❌ | 🔴 高 |
| `channels.feishu.appSecret` | Feishu App Secret | 飞书渠道认证 | ✅ | ❌ | 🔴 高 |
| `plugins.entries.brave.config.webSearch.apiKey` | Brave Search API Key | Web 搜索 | ✅ | ⚠️ active-researcher.js 读 | 🔴 高 |
| `gateway.auth.token` | Gateway Auth Token | Web UI 管理界面认证 | ✅ | ❌ | 🔴 高 |

### 1.2 memory-system/.env

记忆系统的环境变量配置文件，**git 已被 .gitignore 排除**。

| 变量名 | 值用途 | 读取方 | 风险等级 |
|--------|-------|--------|---------|
| `LLM_API_KEY` | 通义千问/DashScope LLM | memory-system 各脚本 | 🔴 高 |
| `DEEPSEEK_API_KEY` | DeepSeek（备用） | active-researcher.js 等 | 🔴 高 |
| `PGPASSWORD` | PostgreSQL 密码 | memory-system 各脚本 | 🔴 高 |
| `NEO4J_PASSWORD` | Neo4j 密码 | memory-system 各脚本 | 🔴 高 |

### 1.3 硬编码在脚本中的 Key

#### active-researcher.js
路径: `memory-system/scripts/active-researcher.js`

```javascript
// 第32行 - 硬编码 DeepSeek Key（与 openclaw.json 重复！）
const DEEPSEEK_API_KEY_HARDCODED = 'sk-b8ea3f548e574d42aaa527ba07318aca';
// 第73行 - 硬编码 fallback
const LLM_API_KEY = process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY || DEEPSEEK_API_KEY_HARDCODED;
```

**问题**: DeepSeek Key 硬编码在源码中，且与 openclaw.json 重复，任意一个泄露等于双重泄露。

#### session-summary-now.js
路径: `memory-system/scripts/session-summary-now.js`

```javascript
// 第22行 - 硬编码 MiniMax Key
const LLM_API_KEY = process.env.LLM_API_KEY || 'sk-50c8c0524a8244ffbdcb9131545dfa56';
```

#### session-summary-extractor.js
路径: `memory-system/scripts/session-summary-extractor.js`

```javascript
// 第36行、第46行 - 从 process.env 读取（OK）
apiKey: process.env.MINIMAX_API_KEY || null,
apiKey: process.env.DEEPSEEK_API_KEY || null,
```

### 1.4 Python 脚本硬编码

#### send-email.py / receive-email.py
路径: `custom-skills/send-email/scripts/`

```python
SMTP_PASS = "egtlvgsyafpvcfde"  # QQ邮箱授权码（硬编码）
IMAP_PASS = "egtlvgsyafpvcfde"  # QQ邮箱授权码（重复硬编码）
```

#### transcriber.py
路径: `custom-skills/camera-recorder/scripts/`

```python
DASHSCOPE_API_KEY = 'sk-50c8c0524a8244ffbdcb9131545dfa56'  # 硬编码
```

#### summarizer.py
路径: `custom-skills/camera-recorder/scripts/`

```python
LLM_API_KEY = "sk-50c8c0524a8244ffbdcb9131545dfa56"  # 硬编码（与 .env 重复）
```

#### camera-recorder/config.json
路径: `custom-skills/camera-recorder/config.json`

```json
"db": { "password": "zyxrcy910128" }  // PostgreSQL 密码（硬编码）
```

### 1.5 数据库凭证（散落）

| 位置 | 内容 | 风险 |
|------|------|------|
| `memory-system/.env` | PostgreSQL / Redis / Neo4j 密码 | 🔴 高 |
| `voice-system/v2/config.yaml` | PostgreSQL URL（含密码明文） | 🟡 中 |
| `camera-recorder/config.json` | PostgreSQL 密码 | 🔴 高 |
| `lingyi-cms/backend/config.py` | JWT SECRET + PostgreSQL URL | 🟡 中（仅本地开发） |

---

## 二、读取方式分析

### 2.1 OpenClaw 框架读取 openclaw.json 的机制

```
OpenClaw Framework
  └── dist/setup-*.js  → 读取 ~/.openclaw/openclaw.json
  └── dist/message-*.js → 使用配置的 keys 通过各 provider SDK 调用外部 API
```

框架本身通过 Node.js `fs.readFileSync` 加载 `~/.openclaw/openclaw.json`，解析后传递给各 provider（OpenAI-compatible、Anthropic、Feishu SDK 等）。

**关键约束**: `openclaw.json` 必须保持框架可读格式，迁移 keys 到外部文件需要框架本身支持新的配置加载机制。

### 2.2 脚本读取方式分类

| 读取方式 | 脚本 | 安全等级 |
|---------|------|---------|
| `process.env.VAR` | session-summary-extractor.js, recall-hook/handler.js | 🟢 相对安全（依赖进程环境） |
| `fs.readFileSync(openclaw.json)` | active-researcher.js 的 `getBraveKeyFromConfig()` | 🟡 中（读取配置文件） |
| 硬编码 | active-researcher.js, session-summary-now.js, transcriber.py, summarizer.py | 🔴 极不安全 |
| 直接写入脚本 | send-email.py, receive-email.py | 🔴 极不安全 |
| 读取 config.json | camera-recorder 脚本们 | 🔴 不安全 |

### 2.3 风险矩阵

| Key | 当前暴露方式 | 泄露后果 | 泄露概率评估 |
|-----|------------|---------|------------|
| DeepSeek Key | openclaw.json + 硬编码 + .env | 可调用 DeepSeek API 消耗额度 | 🔴 高 |
| MiniMax/Minimaxi Key | openclaw.json + 硬编码 + .env | 可调用 MiniMax API 消耗额度 | 🔴 高 |
| DashScope Key | .env + 硬编码 | 可调用阿里通义千问 API | 🔴 高 |
| Telegram Bot Token | openclaw.json | 接管 Telegram Bot | 🔴 高 |
| Feishu App Secret | openclaw.json | 接管飞书 Bot | 🔴 高 |
| Gateway Auth Token | openclaw.json | 未授权访问 Web UI | 🔴 高 |
| Brave Search Key | openclaw.json | 消耗 Brave Search 额度 | 🟡 中 |
| QQ 邮箱授权码 | 脚本硬编码 | 收发邮件、泄露通信内容 | 🔴 高 |
| PostgreSQL 密码 | .env + config.json | 数据库未授权访问 | 🔴 高 |
| Neo4j 密码 | .env | 图数据库未授权访问 | 🟡 中 |

---

## 三、中央配置方案设计

### 3.1 目录结构

```
~/.openclaw/credentials/           # 新建：中央密钥目录
├── .gitignore                     # 确保整体排除 git
├── api-keys.env                   # 所有外部 API keys
│   # 格式：KEY_NAME=value
│   # 包括所有 sk- 开头的 key、Bot Token 等
├── database.env                   # 数据库凭证
│   # 包括 PostgreSQL / Redis / Neo4j 密码
├── secrets.json                   # 不可进入 git 的高敏感项
│   # gateway.auth.token
│   # QQ邮箱授权码
│   # JWT secret
└── README.md                      # 说明文件（不含密钥）

~/.openclaw/openclaw.json          # 框架配置（保留框架必需字段）
~/.openclaw/workspace/memory-system/.env  # 软链接或符号链接 → ~/.openclaw/credentials/database.env
```

### 3.2 读取接口设计

**Node.js 读取模块** `~/.openclaw/credentials/loader.js`:

```javascript
// loader.js — 中央密钥加载器
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const CRED_DIR = path.join(os.homedir(), '.openclaw', 'credentials');

function loadCredentials() {
  dotenv.config({ path: path.join(CRED_DIR, 'api-keys.env') });
  dotenv.config({ path: path.join(CRED_DIR, 'database.env') });
  // secrets.json 单独加载
  const secretsPath = path.join(CRED_DIR, 'secrets.json');
  if (fs.existsSync(secretsPath)) {
    const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf-8'));
    for (const [k, v] of Object.entries(secrets)) {
      process.env[k] = v;
    }
  }
}

module.exports = { loadCredentials };
```

**Python 读取模块** `~/.openclaw/credentials/loader.py`:

```python
import os
from pathlib import Path
from dotenv import load_dotenv

CRED_DIR = Path.home() / '.openclaw' / 'credentials'

def load_credentials():
    load_dotenv(CRED_DIR / 'api-keys.env')
    load_dotenv(CRED_DIR / 'database.env')
    secrets_file = CRED_DIR / 'secrets.json'
    if secrets_file.exists():
        import json
        with open(secrets_file) as f:
            secrets = json.load(f)
        for k, v in secrets.items():
            os.environ[k] = v
```

### 3.3 Key 分类处理策略

| Key 类型 | 处理方式 | 能否合并 |
|---------|---------|---------|
| 模型 API Keys（DeepSeek/MiniMax/DashScope/4sapi/NVIDIA/OpenDoor） | 迁移到 `api-keys.env` | ✅ 同类可合并 |
| Bot Tokens（Telegram/Feishu） | 迁移到 `secrets.json`（框架需支持新的加载方式，或通过 env 注入） | ❌ 必须单独 |
| 数据库密码（PG/Redis/Neo4j） | 迁移到 `database.env` | ✅ 可合并 |
| QQ 邮箱授权码 | 迁移到 `secrets.json` | ✅ 可合并 |
| Gateway Auth Token | 暂时保留在 openclaw.json（框架强耦合） | ❌ 单独 |
| Brave Search API Key | 迁移到 `api-keys.env` | ✅ 同类 |

### 3.4 Git 提交规则

```
# .gitignore 新增
/.openclaw/credentials/
/.env
!.env.example  # 模板可提交

# api-keys.env 模板（不含真实 key）
DEEPSEEK_API_KEY=sk-your-key-here
MINIMAX_API_KEY=sk-your-key-here
BRAVE_API_KEY=your-brave-key
...
```

| 文件 | 能否 git 提交 | 说明 |
|------|-------------|------|
| `credentials/api-keys.env` | ❌ 否 | 真实 key 禁止提交 |
| `credentials/api-keys.env.example` | ✅ 是 | 模板文件 |
| `credentials/database.env` | ❌ 否 | 数据库密码禁止提交 |
| `credentials/secrets.json` | ❌ 否 | 高敏感数据禁止提交 |
| `openclaw.json` | ⚠️ 有条件 | 不含真实 key 的模板可提交 |
| `credentials/loader.js` | ✅ 是 | 不含 key 的代码 |
| `credentials/README.md` | ✅ 是 | 文档文件 |

---

## 四、风险评估

### 4.1 改动风险

| 改动范围 | 风险级别 | 风险说明 |
|---------|---------|---------|
| `openclaw.json` 字段迁移 | 🔴 高 | 框架强依赖，迁移错误导致服务不可用 |
| 硬编码 key 替换 | 🟡 中 | 脚本路径依赖，需同步修改所有调用点 |
| 环境变量注入方式 | 🟢 低 | 通过 PM2/systemd 注入，无需改代码 |
| `.env` 文件迁移到 credentials/ | 🟡 中 | 需要处理软链接或路径更新 |

### 4.2 框架耦合风险

OpenClaw 框架本身从 `~/.openclaw/openclaw.json` 读取 provider apiKeys，这些 key 目前无法迁移到外部文件（框架没有支持外部 env 注入了 apiKey）。

**两条可行路线**:

**方案 A（保守）**: `openclaw.json` 保留 API keys，credentials/ 管理其余所有
- 优点: 无需修改 OpenClaw 框架
- 缺点: API keys 仍在 JSON 明文

**方案 B（激进）**: 框架通过环境变量注入 API keys（需修改框架或用 wrapper）
- 优点: 彻底消除明文存储
- 缺点: 需要修改 OpenClaw 框架或引入 wrapper 层

**推荐**: 先实施**方案 A**，同时在 `credentials/secrets.json` 中管理非框架 Key（QQ 邮箱、数据库密码等）。

---

## 五、分阶段实施计划

### 阶段 0：准备工作（不涉及线上变更）

**目标**: 创建中央密钥目录结构和加载器

**改动文件**:
```
~/.openclaw/credentials/
├── loader.js          # Node.js 加载器
├── loader.py          # Python 加载器
├── api-keys.env.example
├── database.env.example
├── secrets.json.example
└── README.md
```

**操作**:
```bash
mkdir -p ~/.openclaw/credentials
chmod 700 ~/.openclaw/credentials
```

**验证**: `node ~/.openclaw/credentials/loader.js && echo $DEEPSEEK_API_KEY`

---

### 阶段 1：迁移数据库密码（低风险）

**目标**: 统一管理 PostgreSQL / Redis / Neo4j 密码

**改动文件**:
- `memory-system/.env` → 改为读取 `credentials/database.env`
- `voice-system/v2/config.yaml` → 改为引用环境变量
- `custom-skills/camera-recorder/config.json` → 改为引用环境变量

**操作**:
1. 将 `memory-system/.env` 中的数据库密码写入 `credentials/database.env`
2. 修改 `config.js` 增加 `dotenv.config({path: '~/.openclaw/credentials/database.env'})`
3. Python 脚本改用 `load_credentials()`

**验证**: `node memory-system/scripts/task-crud.js list` 正常

---

### 阶段 2：消除 Python 脚本硬编码（低风险）

**目标**: 消除所有 Python 脚本中的硬编码 key

**改动文件**:
| 文件 | 操作 |
|------|------|
| `custom-skills/send-email/scripts/send-email.py` | 删除 `SMTP_PASS` 硬编码，改用 `os.environ['QQ_EMAIL_PASS']` |
| `custom-skills/send-email/scripts/receive-email.py` | 删除 `IMAP_PASS` 硬编码，改用 `os.environ['QQ_EMAIL_PASS']` |
| `custom-skills/camera-recorder/scripts/transcriber.py` | 删除 `DASHSCOPE_API_KEY` 硬编码 |
| `custom-skills/camera-recorder/scripts/summarizer.py` | 删除 `LLM_API_KEY` 硬编码 |
| `custom-skills/camera-recorder/config.json` | 删除 `db.password`，改用环境变量 |

**验证**: 发送测试邮件、录制后自动转录成功

---

### 阶段 3：消除 JavaScript 硬编码（中风险）

**目标**: 消除 active-researcher.js 和 session-summary-now.js 中的硬编码

**改动文件**:
| 文件 | 操作 |
|------|------|
| `memory-system/scripts/active-researcher.js` | 删除 `DEEPSEEK_API_KEY_HARDCODED`，优先从 `process.env.DEEPSEEK_API_KEY` 读取 |
| `memory-system/scripts/session-summary-now.js` | 删除硬编码 `LLM_API_KEY`，优先从 `process.env.LLM_API_KEY` 读取 |

**操作**: PM2 reload 或重启相关 cron 任务

**验证**: `node memory-system/scripts/active-researcher.js --query "test" --concept "test" --confidence 0.5` 正常

---

### 阶段 4：统一 Brave Key 读取路径（中风险）

**目标**: active-researcher.js 的 `getBraveKeyFromConfig()` 改为统一从 `process.env.BRAVE_API_KEY` 读取

**改动文件**:
- `memory-system/scripts/active-researcher.js` → 删除 `getBraveKeyFromConfig()` 函数，改为从 env 读

**操作**: `recall-hook/handler.js` 在启动 active-researcher 子进程时通过环境变量注入 `BRAVE_API_KEY`

**验证**: Brave Search 在 researcher 脚本中正常工作

---

### 阶段 5：框架层明文 key 处理（高风险，待定）

**目标**: 处理 `openclaw.json` 中的明文 API keys

**选项**:
- **方案 A（推荐短期）**: `openclaw.json` 权限收紧为 600
  ```bash
  chmod 600 ~/.openclaw/openclaw.json
  ```
- **方案 B（长期）**: 等待 OpenClaw 框架支持从环境变量加载 provider apiKeys，或开发 wrapper 脚本

**注意**: 框架升级可能覆盖 `chmod`，需在 systemd/PM2 配置中确保 umask 正确

---

## 六、具体改动文件清单

### 必须修改（6 步 × 若干文件）

```
阶段0: 创建结构
  + ~/.openclaw/credentials/loader.js
  + ~/.openclaw/credentials/loader.py
  + ~/.openclaw/credentials/api-keys.env.example
  + ~/.openclaw/credentials/database.env.example
  + ~/.openclaw/credentials/secrets.json.example
  + ~/.openclaw/credentials/README.md

阶段1: 数据库凭证
  M memory-system/scripts/config.js          # 增加 dotenv 加载
  M memory-system/scripts/task-crud.js       # 同上
  M voice-system/v2/config.yaml              # 改用环境变量
  M custom-skills/camera-recorder/config.json # 移除 db.password

阶段2: Python 脚本
  M custom-skills/send-email/scripts/send-email.py
  M custom-skills/send-email/scripts/receive-email.py
  M custom-skills/camera-recorder/scripts/transcriber.py
  M custom-skills/camera-recorder/scripts/summarizer.py

阶段3: JavaScript 脚本
  M memory-system/scripts/active-researcher.js
  M memory-system/scripts/session-summary-now.js

阶段4: Brave Key 统一
  M memory-system/hooks/recall-hook/handler.js  # 环境变量注入
  M memory-system/scripts/active-researcher.js   # 读取方式变更

阶段5: 权限加固
  + /etc/systemd/system/openclaw.service.d/override.conf  (可选)
  + ~/.openclaw/.gitignore 更新
```

### 不建议修改（框架强耦合）

```
openclaw.json 内的 models.providers.*.apiKey
channels.*.botToken / appSecret
gateway.auth.token
plugins.entries.brave.config.webSearch.apiKey（框架直接读）
```

---

## 七、安全加固建议

1. **立即执行**: `chmod 600 ~/.openclaw/openclaw.json`（阻止其他用户读取）
2. **立即执行**: `chmod 700 ~/.openclaw/credentials/`（新建目录权限）
3. **定期轮换**: 每 90 天轮换一次 DeepSeek/MiniMax API keys
4. **监控告警**: 在 Brave Search API 用量异常时告警
5. **禁用硬编码**: 在 CI 中加入 grep 检测 `sk-[a-zA-Z0-9]` 硬编码模式
6. **备份加密**: credentials/ 目录备份时使用 GPG 加密

---

## 八、结论

当前系统的 API Key 分布极度碎片化，存在**至少 3 处硬编码重复**（DeepSeek Key、MiniMax Key、PostgreSQL 密码）和**多处明文存储**。最优先的修复是：

1. **阶段 0 + 1**：创建 credentials/ 目录，统一管理数据库密码（低风险，高价值）
2. **阶段 2**：消除 Python 脚本硬编码（低风险，涉及邮件/录音功能）
3. **阶段 3**：消除 active-researcher.js 硬编码（中风险，涉及主动学习功能）
4. **阶段 5**：收紧 openclaw.json 文件权限（立即执行）

框架层的 openclaw.json 明文 key 问题需要等待 OpenClaw 框架本身支持外部环境变量注入才能彻底解决。
