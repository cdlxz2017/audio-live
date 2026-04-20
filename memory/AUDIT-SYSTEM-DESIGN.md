# 独立操作审计日志系统 — 深化设计文档
**方案：B · audit/YYYY-MM-DD.jsonl**
**版本：v1.0**
**日期：2026-04-20**
**状态**：✅ Phase 1 已实施（2026-04-20）

**当前已部署**：
- `audit-scripts/append-audit.js` — 核心写入模块
- `audit-scripts/audit-redact.js` — 脱敏模块
- `audit-scripts/audit-query.js` — CLI查询工具
- `audit-scripts/audit-monitor.js` — 健康监控（✅ 新增）
- `audit/` — 审计日志存储目录（chmod 700）
- `memory-system/hooks/session-capture-hook/handler.js` — ✅ 已接入（DATABASE写入审计）
- `scripts/health-check-report.sh` — ✅ 已接入健康检查（每4小时发送邮件）

---

## 1. 背景与目标

### 1.1 问题陈述

当前系统缺乏统一的操作审计层，存在以下问题：

| 痛点 | 说明 |
|------|------|
| **操作不可追溯** | 文件变更、配置修改、数据库写入均由各自模块自行管理，无统一视图 |
| **故障无根因** | PM2 进程抖动、配置漂移、数据不一致时缺乏操作链可供回溯 |
| **安全盲区** | 敏感操作（删除资源、修改权限）无独立记录，易被篡改或遗漏 |
| **回归测试缺失** | 修改记忆系统后无法快速验证影响面，只能靠人工检查 |

### 1.2 现有审计基础设施（盘点）

| 组件 | 状态 | 说明 |
|------|------|------|
| `memories_audit_log` 表 | 存在但为空（0条） | 设计过于简单，未实际使用 |
| `ai_operations` 表 | 9条记录 | 仅记录 LLM 操作，类型单一 |
| `trace_chain` 表 | 活跃（42条） | 覆盖记忆写入路径（summarized→outbox→personal→neo4j） |
| `recall_logs` 表 | 411条记录 | 覆盖召回路径，含延迟和来源 |
| `session-capture-hook` | 活跃 | 捕获消息到 PostgreSQL，已验证可用 |
| `/logs/` 目录 | 多个日志文件 | 结构各异，无统一格式 |

**结论**：现有系统覆盖了「记忆读写」链路，但缺乏覆盖「系统级操作」（文件/配置/进程/Git）的能力。

### 1.3 设计目标

```
目标1：不干扰主流程 — 审计日志为旁路写入，失败不阻断业务
目标2：全覆盖 — 文件变更 + 配置变更 + 数据库写入 + 进程变更 + Git操作 + 外部API
目标3：高可靠写入 — append-only 文件，原子追加，进程崩溃不丢失
目标4：快查询 — 支持按时间/操作者/目标/类型过滤，支持 CLI 和 API 两种访问方式
目标5：防篡改 — 日志只增不改，敏感内容脱敏，保留期后可归档不可删除
```

---

## 2. 操作分类与捕获策略

### 2.1 操作分类（7大类）

```
OPERATION_CATEGORIES:
  FILE          # 文件系统变更
  CONFIG        # 配置文件变更
  DATABASE      # 数据库记录变更
  PROCESS       # 进程生命周期变更
  GIT           # Git 版本控制操作
  EXTERNAL_API  # 外部 API 调用
  CRON          # 定时任务执行
```

### 2.2 各类别捕获策略

#### 2.2.1 FILE — 文件系统变更

**捕获机制：inotifywait 监控（自动）**

```bash
# 监控目录（排除日志/临时文件）
inotifywait -m -r \
  --exclude '(\.log|\.tmp|\.swp|node_modules|\.git/)' \
  /home/ai/.openclaw/workspace/{memory-system,custom-skills,scripts,plugins} \
  -e create,modify,delete,move \
  --format '%w%f %e %T' --timefmt '%Y-%m-%dT%H:%M:%S%.3NZ'
```

**操作类型**：
| op | 说明 | before 捕获 |
|----|------|------------|
| `file:create` | 新建文件 | 无（新建文件无旧内容）|
| `file:modify` | 内容变更 | 读取变更前内容（截取前 4KB 元信息）|
| `file:delete` | 删除文件 | 读取被删文件内容（截取前 4KB）|
| `file:move` | 重命名/移动 | 读取原路径内容 |

**before 快照策略**：
- 文件 < 1MB：完整读取 before 内容
- 文件 1-10MB：截取前 4KB header + 后 4KB trailer
- 文件 > 10MB：仅记录路径 + 大小 + SHA256，不读取内容
- 排除规则：`*.log`、`*.tmp`、`*.swp`、`node_modules/`、`\.git/`

**before 内容存储**：
```json
{
  "path": "/home/ai/.openclaw/workspace/memory-system/scripts/session-reader.js",
  "op": "file:modify",
  "before": {
    "size_bytes": 12430,
    "sha256": "abc123...",
    "preview": "<first 4KB hex>",
    "tail_preview": "<last 4KB hex>"
  },
  "after": {
    "size_bytes": 12510,
    "sha256": "def456..."
  }
}
```

#### 2.2.2 CONFIG — 配置文件变更

**监控范围**：
```javascript
const CONFIG_PATHS = [
  '/home/ai/.openclaw/workspace/memory-system/scripts/config.js',
  '/home/ai/.openclaw/workspace/.env',
  '/home/ai/.openclaw/credentials/*.env',
  '/home/ai/.openclaw/workspace/memory-system/ecosystem.*.json',
  '/etc/systemd/system/openclaw*.service',
  '/home/ai/.openclaw/workspace/memory-system/.env',
];
```

**捕获机制**：文件监控自动触发（已包含在上节 FILE 策略中）

**before 捕获**：配置变更前读取完整内容（配置文件通常较小，直接读取）

**敏感字段脱敏**（在写入前处理）：
```javascript
const SENSITIVE_KEYS = [
  'password', 'secret', 'token', 'api_key', 'apikey',
  'private_key', 'credential', 'PGPASSWORD', 'NEO4J_PASSWORD'
];

function redactConfig(content) {
  return content.replace(
    /("?)(\w*(?:password|secret|token|key|credential)\w*)\s*[:=]\s*(")([^"]*)(")/gi,
    '$2: "[REDACTED]"'
  );
}
```

#### 2.2.3 DATABASE — 数据库记录变更

**捕获机制：PostgreSQL LISTEN/NOTIFY + 轻量 Trigger**

不采用数据库 Trigger（性能开销大），而是在应用层**在写入操作前后主动记录**。

在 `memory-writer.js`、每个 extractor、每个 PM2 脚本的数据库写入点插入：

```javascript
// 统一的审计写入接口（轻量，不阻塞主事务）
async function auditWrite({ pool, table, op, pkValue, beforeRow, afterRow, actor }) {
  // 异步写入，不阻塞主流程
  setImmediate(() => {
    appendAuditLog({
      category: 'DATABASE',
      op: `db:${op}`,          // db:insert / db:update / db:delete
      table,
      pk: pkValue,
      before: beforeRow ? sanitizeRow(beforeRow) : null,
      after: afterRow ? sanitizeRow(afterRow) : null,
      actor,
      ts: new Date().toISOString()
    });
  });
}
```

**before 捕获时机**：
- `UPDATE` / `DELETE`：先 SELECT 拿到旧值，再执行变更
- `INSERT`：before = null

**脱敏规则**（同 CONFIG）：
- 排除 `password`、`api_key`、`token` 等字段值
- 大字段（text、jsonb）只记录前 200 字符 preview

#### 2.2.4 PROCESS — 进程生命周期变更

**捕获机制：PM2 的 `process:event` 监听**

PM2 支持进程事件通知，在 memory-system 中新增一个轻量 `pm2-audit-listener.js`：

```javascript
// pm2-audit-listener.js（独立进程，不影响其他 PM2 服务）
const { fork } = require('child_process');
// 监听进程退出/重启/崩溃
```

**监控事件**：
| PM2 Event | 审计 op | 附加信息 |
|-----------|---------|---------|
| `exit` | `process:exit` | exit code, signal |
| `restart` | `process:restart` | restart count, uptime |
| `reload` | `process:reload` | old vs new pid |
| `stop` | `process:stop` | 停止原因 |
| `crash` | `process:crash` | exit code, threw |
| `online` | `process:start` | new pid |

**systemd 服务变更**（OpenClaw Gateway）：

```bash
# 监控 systemd 服务状态变化
journalctl -f -u openclaw-gateway.service --since "1 minute ago" | \
  while read line; do
    echo "$line" | parse-systemd-status >> audit/$(date +%Y-%m-%d).jsonl
  done
```

#### 2.2.5 GIT — Git 操作

**监控范围**：
- `/home/ai/.openclaw/workspace/`（主仓库）
- `/home/ai/.openclaw/workspace/memory-system/`（子仓库）

**捕获机制：Git hooks（post-commit / post-merge / post-checkout）**

在两个仓库的 `.git/hooks/` 安装 `post-commit`、`post-merge`、`post-checkout` 钩子：

```bash
#!/bin/bash
# post-commit hook
AUDIT_FILE="/home/ai/.openclaw/workspace/audit/$(date +%Y-%m-%d).jsonl"
GIT_DIR=$(git rev-parse --git-dir)
REPO_NAME=$(basename "$GIT_DIR" .git)
COMMIT_HASH=$(git rev-parse HEAD)
BRANCH=$(git branch --show-current)
COMMIT_MSG=$(git log -1 --format='%s')
AUTHOR=$(git log -1 --format='%an <%ae>')

echo "{\"category\":\"GIT\",\"op\":\"commit\",\"repo\":\"$REPO_NAME\",\"branch\":\"$BRANCH\",\"commit\":\"$COMMIT_HASH\",\"message\":$(echo "$COMMIT_MSG" | jq -Rs .),\"author\":$(echo "$AUTHOR" | jq -Rs .),\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\"}" >> "$AUDIT_FILE"
```

**操作类型**：
| op | 触发 | 捕获内容 |
|----|------|---------|
| `git:commit` | post-commit | commit hash, branch, message, author, changed files |
| `git:push` | （需手动或 remote hook） | remote, branch, pushed commits |
| `git:merge` | post-merge | merged branch, conflict count |
| `git:branch` | post-checkout / 手动 | branch name, is remote |

#### 2.2.6 EXTERNAL_API — 外部 API 调用

**捕获范围**：仅记录「敏感操作」和「失败操作」，避免记录普通查询。

**判断标准（敏感操作）**：
```javascript
const SENSITIVE_API_PATTERNS = [
  /create/i, /delete/i, /destroy/i, /remove/i,
  /update.*password/i, /modify.*permission/i,
  /revoke/i, /transfer.*fund/i, /deploy/i
];
```

**捕获时机**：在 HTTP 层统一拦截（axios / node-fetch 包装器）

```javascript
// 包装 fetch，在响应后记录审计
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const reqTs = Date.now();
  const method = options?.method || 'GET';
  try {
    const response = await originalFetch(url, options);
    const latencyMs = Date.now() - reqTs;
    if (isSensitive(url, method)) {
      appendAuditLog({
        category: 'EXTERNAL_API',
        op: 'api:call',
        method,
        url: redactUrl(url),
        status: response.status,
        latencyMs,
        ts: new Date(reqTs).toISOString()
      });
    }
    return response;
  } catch (err) {
    appendAuditLog({
      category: 'EXTERNAL_API',
      op: 'api:error',
      method,
      url: redactUrl(url),
      error: err.message,
      latencyMs: Date.now() - reqTs,
      ts: new Date(reqTs).toISOString()
    });
    throw err;
  }
};
```

#### 2.2.7 CRON — 定时任务执行

**捕获机制**：Cron 执行时在 crontab 中统一包装

```bash
# 在 crontab 中，每个任务前加审计包装
*/10 * * * * /usr/bin/write-audit.sh "CRON" "sync-trace-chain" && /home/ai/.openclaw/workspace/scripts/sync-trace-chain-to-thread.sh >> /tmp/sync-trace-chain.log 2>&1
```

**统一包装脚本** `write-audit.sh`：

```bash
#!/bin/bash
# 用法：write-audit.sh <category> <task_name> [start|end|error]
CATEGORY=$1
TASK=$2
PHASE=${3:-start}
AUDIT_FILE="/home/ai/.openclaw/workspace/audit/$(date +%Y-%m-%d).jsonl"
TS=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)

if [ "$PHASE" = "start" ]; then
  echo "{\"category\":\"$CATEGORY\",\"op\":\"cron:start\",\"task\":\"$TASK\",\"ts\":\"$TS\"}" >> "$AUDIT_FILE"
elif [ "$PHASE" = "end" ]; then
  echo "{\"category\":\"$CATEGORY\",\"op\":\"cron:end\",\"task\":\"$TASK\",\"exitCode\":$?,\"ts\":\"$TS\"}" >> "$AUDIT_FILE"
else
  echo "{\"category\":\"$CATEGORY\",\"op\":\"cron:error\",\"task\":\"$TASK\",\"ts\":\"$TS\"}" >> "$AUDIT_FILE"
fi
```

**当前 cron 任务清单（需覆盖）**：

| 频率 | 任务 | 审计覆盖 |
|------|------|---------|
| `*/10 * * * *` | sync-trace-chain-to-thread.sh | ✅ 需接入 |
| `*/10 * * * *` | sync-learning-engine.sh | ✅ 需接入 |
| `*/30 * * * *` | run-learned-import.sh | ✅ 需接入 |
| 手动 | 各类 node 脚本 | ✅ 需提供统一调用接口 |

---

## 3. 日志格式设计

### 3.1 统一日志格式（JSONL）

```json
{
  "id": "uuid-v4",
  "category": "FILE|CONFIG|DATABASE|PROCESS|GIT|EXTERNAL_API|CRON",
  "op": "string (小写:冒号分隔)",
  "actor": {
    "type": "human|agent|subagent|cron|system",
    "id": "username或process-name或cron-task-name",
    "sessionId": "optional-session-id"
  },
  "target": {
    "type": "file|table|process|repo|url|cron",
    "path": "/optional/path",
    "identifier": "table-name或process-id或commit-hash"
  },
  "before": {
    "type": "none|null|full|preview|metadata-only",
    "content": "any（脱敏后）",
    "sha256": "optional-file-hash"
  },
  "after": {
    "type": "none|null|full|preview|metadata-only",
    "content": "any（脱敏后）",
    "sha256": "optional-file-hash"
  },
  "result": {
    "success": true,
    "error": null,
    "latencyMs": 42
  },
  "metadata": {
    "gitBranch": "optional",
    "gitCommit": "optional",
    "env": "production",
    "hostname": "ai-MS-S1-MAX"
  },
  "ts": "2026-04-20T03:41:00.000Z"
}
```

### 3.2 操作类型命名规范

```
category:op 格式，小写，冒号分隔

FILE:
  file:create
  file:modify
  file:delete
  file:move

CONFIG:
  config:modify
  config:reload

DATABASE:
  db:insert     (table: memories,  pk: 1234)
  db:update     (table: memories,  pk: 1234, before: {...}, after: {...})
  db:delete     (table: memories,  pk: 1234)

PROCESS:
  process:start    (process: session-extractor,  pid: 1923299)
  process:restart  (process: session-extractor,  pid: 1923299→new)
  process:reload   (process: session-extractor,  pid: 1923299→new)
  process:stop     (process: session-extractor,  pid: 1923299, reason: manual)
  process:crash    (process: session-extractor,  pid: 1923299, exitCode: 1)

GIT:
  git:commit   (repo: workspace,  commit: abc123,  branch: main)
  git:push     (repo: workspace,  remote: origin, branch: main, commits: 3)
  git:merge    (repo: workspace,  branch: feature-abc → main, conflicts: 0)
  git:branch   (repo: workspace,  branch: feature-abc, action: create|delete)

EXTERNAL_API:
  api:call     (method: POST,  url: https://api.example.com/resource, status: 201)
  api:error    (method: POST,  url: https://api.example.com/resource, error: ECONNREFUSED)

CRON:
  cron:start   (task: sync-trace-chain)
  cron:end     (task: sync-trace-chain, exitCode: 0, latencyMs: 1234)
  cron:error   (task: sync-trace-chain, error: "pm2 not running")
```

### 3.3 脱敏规则

**统一脱敏函数** `audit-redact.js`：

```javascript
// 脱敏优先级：P0 完全隐藏，P1 部分隐藏，P2 日志记录但标红
const REDACT_FULL = ['password', 'secret', 'token', 'api_key', 'apikey', 
                     'private_key', 'credential', 'authorization'];
const REDACT_PARTIAL = ['email', 'phone', 'ip', 'session_id'];
const REDACT_SIZE = 200; // 大字段截断长度

function redactValue(key, value) {
  if (!value || typeof value !== 'string') return value;
  const k = key.toLowerCase();
  if (REDACT_FULL.some(p => k.includes(p))) return '[REDACTED-P0]';
  if (REDACT_PARTIAL.some(p => k.includes(p))) {
    return value.slice(0, 3) + '***' + value.slice(-3);
  }
  if (value.length > REDACT_SIZE) return value.slice(0, REDACT_SIZE) + '...[truncated]';
  return value;
}

function redactObject(obj) {
  if (Array.isArray(obj)) return obj.map(v => redactObject(v));
  if (obj && typeof obj === 'object') {
    const r = {};
    for (const [k, v] of Object.entries(obj)) r[k] = redactValue(k, v);
    return r;
  }
  return obj;
}
```

---

## 4. 写入架构

### 4.1 目录结构

```
/home/ai/.openclaw/workspace/
├── audit/
│   ├── 2026-04-20.jsonl          # 当天审计日志（活跃）
│   ├── 2026-04-19.jsonl.gz       # 压缩归档
│   ├── 2026-04-18.jsonl.gz       # 压缩归档
│   ├── ...
│   └── index/                    # 查询加速索引
│       ├── 2026-04-20.by-op.json  # 按 op 分组索引
│       └── 2026-04-20.by-actor.json # 按 actor 分组索引
├── audit-scripts/
│   ├── append-audit.js           # 统一追加写入接口
│   ├── inotify-monitor.sh       # 文件监控守护进程
│   ├── pm2-audit-listener.js    # PM2 进程事件监听
│   ├── git-hooks/               # Git hooks 安装脚本
│   │   ├── install.sh
│   │   ├── post-commit
│   │   ├── post-merge
│   │   └── post-checkout
│   ├── audit-query.js           # CLI 查询工具
│   ├── audit-compact.js         # 日志压缩/归档脚本
│   ├── audit-integrity.js        # 完整性校验脚本
│   └── audit-redact.js          # 脱敏工具库
```

### 4.2 追加写入机制（避免锁竞争）

```javascript
// append-audit.js — 核心写入模块
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { promisify } = require('util');

const AUDIT_DIR = '/home/ai/.openclaw/workspace/audit';
const COMPRESS_AFTER_DAYS = 3; // 3天后压缩
const MAX_FILE_SIZE_MB = 100;  // 单文件超过100MB触发轮转

let _writeLock = false;
let _writeQueue = [];
let _flushTimer = null;

function getAuditFile(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return path.join(AUDIT_DIR, `${yyyy}-${mm}-${dd}.jsonl`);
}

/**
 * 追加单条审计日志（异步，非阻塞）
 * 内部批量合并，每 100ms 或积累 10 条强制刷盘
 */
function appendAudit(entry) {
  _writeQueue.push(entry);
  if (!_flushTimer) _flushTimer = setTimeout(flushQueue, 100);
  if (_writeQueue.length >= 10) flushQueue();
}

async function flushQueue() {
  if (_writeLock || _writeQueue.length === 0) return;
  _writeLock = true;
  clearTimeout(_flushTimer);
  _flushTimer = null;
  
  const batch = _writeQueue.splice(0, _writeQueue.length);
  _writeLock = false;
  
  const lines = batch.map(e => JSON.stringify({
    ...e,
    id: require('crypto').randomUUID(),
    ts: e.ts || new Date().toISOString()
  })).join('\n') + '\n';
  
  const file = getAuditFile();
  await fs.promises.appendFile(file, lines, 'utf8').catch(() => {
    // 写入失败时写 fallback 文件
    fs.promises.appendFile(file + '.fallback', lines, 'utf8').catch(() => {});
  });
  
  // 文件轮转检查
  const stats = await fs.promises.stat(file).catch(() => null);
  if (stats && stats.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    // 超过阈值，在下一次写入时轮转
    await fs.promises.rename(file, file + '.rotated.' + Date.now());
  }
}

module.exports = { appendAudit };
```

**写入保障**：
- 每条日志先 `appendFile`（操作系统保证原子性）
- 批量合并减少 IOPS（最多 100ms 延迟）
- 失败时写 `.fallback` 文件，不丢失数据
- 主进程退出时 `process.on('exit')` 强制刷盘

### 4.3 日志压缩

```javascript
// audit-compact.js — 每日定时压缩（cron）
// 压缩 3 天前的日志（当天保留明文供实时查询）
const y昨天 = new Date(Date.now() - 3 * 86400 * 1000);
const src = getAuditFile(y昨天);
const dst = src + '.gz';

const data = await fs.promises.readFile(src);
const gz = zlib.createGzip();
const out = fs.createWriteStream(dst);
await pipeline(gz, out);
await fs.promises.unlink(src); // 删除原文
```

### 4.4 文件轮转策略

| 条件 | 动作 |
|------|------|
| 00:00 UTC+8 | 切换新文件（`YYYY-MM-DD.jsonl`） |
| 文件 > 100MB | 轮转到 `YYYY-MM-DD.jsonl.rotated.N` |
| 文件 > 3 天 | 压缩为 `.jsonl.gz` |
| 文件 > 30 天 | 可选择上传到 OSS/冷存储，或删除（可配置） |

---

## 5. 查询接口

### 5.1 CLI 查询工具

```bash
# audit-query.js — 审计日志查询 CLI
# 用法：node audit-query.js [选项]
#
# 选项：
#   --since, -s     ISO 时间戳起始
#   --until, -u     ISO 时间戳结束
#   --category, -c  分类过滤（FILE|CONFIG|DATABASE|PROCESS|GIT|EXTERNAL_API|CRON）
#   --op, -o        操作类型过滤（如 file:modify）
#   --actor, -a     操作者过滤
#   --target, -t    目标路径/标识过滤（支持模糊匹配）
#   --success, -S   成功/失败（true|false）
#   --limit, -l     最大返回条数（默认 50）
#   --format, -f    输出格式（json|table|summary）
#   --date, -d      指定日期（YYYY-MM-DD，默认今天）
#
# 示例：
#   node audit-query.js -d 2026-04-19 --category DATABASE --op db:update
#   node audit-query.js --since 2026-04-19T00:00:00Z --until 2026-04-20T00:00:00Z --category PROCESS
#   node audit-query.js --actor cron --format summary
#   node audit-query.js -t "/workspace/memory-system/scripts" --op file:modify
```

**输出格式示例（table）**：
```
=== 审计查询结果 (2026-04-20, DATABASE, 12条) ===
TS                      CATEGORY  OP            ACTOR              TARGET                RESULT
2026-04-20T03:45:12.123Z  DATABASE  db:update    agent/subagent     memories(id=47613)    ✅ success(23ms)
2026-04-20T03:42:08.001Z  PROCESS   process:stop agent/main         session-extractor    ✅ exit:0(1023ms)
2026-04-20T03:41:55.000Z  FILE      file:modify  agent/subagent     config.js            ✅ success(5ms)
2026-04-20T03:41:00.000Z  GIT       git:commit   agent/main         workspace            ✅ abc123def(main)
```

**输出格式示例（summary）**：
```
=== 审计汇总 (2026-04-20) ===
总计: 47 条操作
按类别: FILE(12) DATABASE(18) PROCESS(8) GIT(3) CRON(6)
按结果: success(45) failed(2)
最活跃操作者: agent/main(20) cron/sync-trace-chain(6) agent/subagent(15)
文件变更: 12次modify, 2次create, 0次delete
数据库变更: 18次update, 4次insert, 2次delete
进程事件: 3次restart, 2次crash, 3次start
```

### 5.2 API 查询（副脑 Thread 联动）

通过副脑 Problem Thread（Port 54321）暴露查询接口：

```javascript
// 在 audit-query-server.js 中
// GET /audit/query?category=DATABASE&since=...&limit=50
// 响应格式同 CLI JSON 输出
// 由副脑 Thread 统一路由
```

### 5.3 与副脑 Problem Thread 联动

```
用户问："昨晚为什么 session-extractor 崩溃了？"
  ↓
副脑 Thread 接收问题
  ↓
调用 audit-query --category PROCESS --op process:crash --since 2026-04-19T22:00:00Z --until 2026-04-20T06:00:00Z
  ↓
返回进程崩溃时间线 + 前后日志片段
  ↓
副脑整合为可读报告
```

---

## 6. 安全与存储

### 6.1 防篡改机制

**措施 1：只读挂载（可选，高安全场景）**

```bash
# 审计目录设为只读（需要root权限修改）
mount -o bind,ro /home/ai/.openclaw/workspace/audit /home/ai/.openclaw/workspace/audit
# 或使用 chattr +i 锁定文件
chattr +i /home/ai/.openclaw/workspace/audit/*.jsonl
```

**措施 2：哈希链（每条日志链接前一条哈希）**

```javascript
let _lastHash = null;

function appendAudit(entry) {
  const line = JSON.stringify({ ...entry, prevHash: _lastHash });
  const hash = crypto.createHash('sha256').update(line).digest('hex');
  _lastHash = hash;
  // ...
}
```

**措施 3：定期校验和导出**

```javascript
// audit-integrity.js — 完整性校验
// 每日执行：计算当日所有日志的 SHA256 Merkle 根，存入 immutable 存储
// 可检测到任何事后修改（追加以外的操作）
```

### 6.2 敏感内容脱敏

见 3.3 脱敏规则。所有 `password`、`api_key`、`token` 等字段值一律替换为 `[REDACTED-P0]`。

### 6.3 存储空间管理

| 保留期 | 格式 | 存储位置 |
|--------|------|---------|
| 0-3 天 | `.jsonl` 明文 | `/home/ai/.openclaw/workspace/audit/` |
| 4-30 天 | `.jsonl.gz` 压缩 | `/home/ai/.openclaw/workspace/audit/` |
| 31-90 天 | `.jsonl.gz` 压缩 | 冷存储（OSS / S3） |
| 90 天以上 | 删除或主人确认 | — |

**预估存储**：
- 每天预估：~500 条审计日志（活跃使用时）
- 明文单条 ~500 字节 → 每天 ~250KB
- 压缩后 ~50KB/天
- 30 天 ≈ 1.5MB，90 天 ≈ 4.5MB
- **结论：存储成本极低，可放心保留**

### 6.4 备份策略

```javascript
// 每日备份脚本（上传至 OSS）
// 与现有备份流程整合
const aliOSS = require('./aliyun-oss-backup');
await aliOSS.upload(`/audit/${yyyy-mm-dd}.jsonl.gz`, `backup/audit/${yyyy-mm-dd}.jsonl.gz`);
```

---

## 7. 与现有系统联动

### 7.1 Git Commit Message 自动生成参考

审计日志为 Git commit message 生成提供上下文：

```
# 从审计日志获取上次 commit 后改了什么
node audit-query.js --category FILE --since "last-git-commit-date" --format json
→ 可自动生成有意义的 commit message
```

### 7.2 PM2 日志整合

PM2 进程的 stdout/stderr 重定向到：
```
/home/ai/.openclaw/workspace/memory-system/logs/{process-name}/{date}.log
```
审计系统不替代 PM2 日志，但可记录进程事件与 PM2 日志的时间对应关系。

### 7.3 现有 Hook 体系整合

现有 `session-capture-hook` 已活跃，新审计系统不修改它，而是在其**下游**接入：

```
session-capture-hook (已有)
  → 写入 PostgreSQL conversation_messages (已有)
  → 新增：触发审计日志 (db:insert on conversation_messages)
```

---

## 8. 实施步骤（Phase 1/2/3）

### Phase 1：核心基础设施（约 2-3 小时）

**目标**：建立最小可用审计系统，能够记录文件变更和数据库写入

| 步骤 | 内容 | 产出 |
|------|------|------|
| 1.1 | 创建 `audit/` 目录结构 | `mkdir -p /home/ai/.openclaw/workspace/audit/index` |
| 1.2 | 部署 `append-audit.js`（核心写入模块） | 可用的 `audit-scripts/append-audit.js` |
| 1.3 | 部署 `audit-redact.js`（脱敏模块） | 可用的 `audit-scripts/audit-redact.js` |
| 1.4 | 在 `memory-writer.js` 关键写入点接入审计调用 | 记忆写入时自动记录 `db:insert/update/delete` |
| 1.5 | 在 `session-capture-hook` 接入审计调用 | conversation_messages 写入时自动记录 |
| 1.6 | 验证：执行一次记忆写入，检查审计日志是否产生 | `cat audit/YYYY-MM-DD.jsonl` |

### Phase 2：全覆盖监控（约 4-6 小时）

**目标**：覆盖所有 7 大操作类别

| 步骤 | 内容 | 产出 |
|------|------|------|
| 2.1 | 部署 `inotify-monitor.sh` 守护进程 | 文件变更自动记录（FILE 类别） |
| 2.2 | 部署 `pm2-audit-listener.js` 守护进程 | PM2 进程事件自动记录（PROCESS 类别） |
| 2.3 | 安装 Git hooks（post-commit 等） | Git 操作自动记录（GIT 类别） |
| 2.4 | 部署 `audit-query.js` CLI 工具 | 可查询的审计日志系统 |
| 2.5 | 将现有 cron 任务接入审计包装脚本 | CRON 类别覆盖 |
| 2.6 | 在关键 HTTP 调用点接入 API 审计拦截 | EXTERNAL_API 类别覆盖 |
| 2.7 | 端到端验证：触发各类操作，验证记录完整性 | 完整的 7 类操作审计 |

### Phase 3：安全加固与自动化（约 2-3 小时）

**目标**：生产级安全与自动化

| 步骤 | 内容 | 产出 |
|------|------|------|
| 3.1 | 部署日志压缩脚本（`audit-compact.js`） | 3天前日志自动压缩 |
| 3.2 | 部署完整性校验脚本（`audit-integrity.js`） | 哈希链防篡改 |
| 3.3 | 配置审计目录只读（`chattr +i`） | 操作系统级防篡改 |
| 3.4 | 配置每日备份到 OSS | 审计日志冷存储 |
| 3.5 | 将审计查询接入副脑 Problem Thread | 自然语言查询审计日志 |
| 3.6 | 编写运行手册（SOPS-AUDIT.md） | 可交给后续子程序维护 |

---

## 9. 风险评估

### 9.1 风险矩阵

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 审计写入阻塞主流程 | 低 | 高 | append-only 异步，不使用同步锁；主流程失败不依赖审计 |
| 大文件 before 快照导致内存溢出 | 中 | 中 | 超过 10MB 仅记录 metadata；inotify 限流 |
| 审计日志本身被删除/篡改 | 低 | 高 | 目录只读挂载 + 哈希链 + 定期上传 OSS |
| 审计写入失败导致日志丢失 | 低 | 中 | .fallback 文件保底 + 进程退出强制刷盘 |
| 压缩脚本误删未满3天日志 | 极低 | 中 | 压缩条件增加「当前文件已关闭」检查 |
| 敏感信息泄露到日志 | 低 | 高 | P0 脱敏规则覆盖所有常见 key；定期抽查 |
| inotify 监控大量文件消耗 CPU | 低 | 低 | 排除 node_modules、.git 等大目录；限流 |
| PM2 进程事件监听器本身崩溃 | 低 | 中 | 用 `pm2 start --no-autorestart` 独立运行，崩溃不影响业务 |

### 9.2 不适合纳入审计的内容

| 内容 | 原因 | 替代方案 |
|------|------|---------|
| 用户消息内容（聊天内容） | 已有 session-capture-hook 记录 | 通过 sessionId 关联 |
| OpenClaw Gateway 的每次 LLM 调用 | 数据量过大 | 通过 ai_operations 表已有记录 |
| PM2 stdout/stderr 内容 | 已有独立日志文件 | 通过 process 事件关联时间线 |
| node_modules 文件变更 | 无意义且量极大 | 已在 inotify 排除规则中 |
| 内存中临时数据 | 无法可靠捕获 | N/A |

---

## 10. 快速参考

### 启动审计系统

```bash
# 启动 inotify 文件监控
nohup bash /home/ai/.openclaw/workspace/audit-scripts/inotify-monitor.sh >> /home/ai/.openclaw/workspace/logs/inotify-audit.log 2>&1 &

# 启动 PM2 进程事件监听
node /home/ai/.openclaw/workspace/audit-scripts/pm2-audit-listener.js &

# 安装 Git hooks
bash /home/ai/.openclaw/workspace/audit-scripts/git-hooks/install.sh
```

### 查询审计日志

```bash
# 查看今天所有操作
node /home/ai/.openclaw/workspace/audit-scripts/audit-query.js

# 查看数据库变更（过去1小时）
node /home/ai/.openclaw/workspace/audit-scripts/audit-query.js --category DATABASE --format table

# 查看文件变更
node /home/ai/.openclaw/workspace/audit-scripts/audit-query.js --category FILE --op file:modify

# 查看进程事件
node /home/ai/.openclaw/workspace/audit-scripts/audit-query.js --category PROCESS --format summary
```

### 手动追加审计记录

```javascript
const { appendAudit } = require('/home/ai/.openclaw/workspace/audit-scripts/append-audit');

appendAudit({
  category: 'DATABASE',
  op: 'db:update',
  actor: { type: 'agent', id: 'main', sessionId: 'session-xxx' },
  target: { type: 'table', identifier: 'memories', path: null },
  before: { type: 'full', content: { id: 123, value: 'old' } },
  after: { type: 'full', content: { id: 123, value: 'new' } },
  result: { success: true, latencyMs: 23 }
});
```
