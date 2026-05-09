# 脚本-系统依赖自动治理系统：设计文档

> **定位**：程序机制而非制度文档——所有约束通过代码强制执行，不存在"靠人记住"的环节。

---

## 目录

1. [核心架构](#1-核心架构)
2. [强制接入机制](#2-强制接入机制)
3. [凭证管理](#3-凭证管理)
4. [防腐机制](#4-防腐机制)
5. [灰度与回滚](#5-灰度与回滚)
6. [附录：28 个脚本分批清单](#6-附录28-个脚本分批清单)

---

## 1. 核心架构

### 1.1 System Registry 数据结构

Registry 是**程序运行时查询的唯一权威配置源**，不是给人看的表。所有脚本启动时必须查询它，禁止绕过。

**存储形式**：JSON（程序直接读取，零解析成本），YAML 仅作为人类可读的导出快照。

```jsonc
// .hermes/registry/system-registry.json
{
  "version": "3.2.1",
  "updated_at": "2026-05-09T15:17:00+08:00",
  "ttl_seconds": 300,

  "systems": {
    // 每一套被监控的系统一个条目
    "xuanyi": {
      "id": "xuanyi",
      "name": "玄一",
      "status": "offline",          // online | offline | degraded | maintenance
      "status_since": "2026-04-15T10:00:00+08:00",
      "alert_policy": "suppress",    // active | suppress | ratelimit
      "endpoints": {
        "health": "https://xuanyi.internal/api/health",
        "metrics": "https://xuanyi.internal/api/metrics"
      },
      "dependencies": ["redis-xuanyi", "pg-xuanyi"],
      "owners": ["team-backend"],
      "scripts": ["monitor-xuanyi.js", "health-xuanyi.sh"]
    },
    "siyuan": {
      "id": "siyuan",
      "name": "四院",
      "status": "offline",
      "status_since": "2026-04-20T08:00:00+08:00",
      "alert_policy": "suppress",
      "endpoints": {
        "health": "https://siyuan.internal/api/health"
      },
      "dependencies": [],
      "owners": ["team-medical"],
      "scripts": ["monitor-siyuan.sh", "db-siyuan.py"]
    },
    "tiandao": {
      "id": "tiandao",
      "name": "天道",
      "status": "online",
      "status_since": "2025-01-01T00:00:00+08:00",
      "alert_policy": "active",
      "endpoints": {
        "api": "https://tiandao.internal/graphql",
        "health": "https://tiandao.internal/healthz"
      },
      "dependencies": ["redis-tiandao", "kafka-tiandao"],
      "owners": ["team-platform"],
      "scripts": ["monitor-tiandao.js", "latency-tiandao.sh"]
    },
    "external-payment": {
      "id": "external-payment",
      "name": "外部支付API",
      "status": "online",
      "status_since": "2025-06-01T00:00:00+08:00",
      "alert_policy": "active",
      "endpoints": {
        "health": "https://api.payment-partner.com/v2/health"
      },
      "dependencies": [],
      "owners": ["team-platform"],
      "scripts": ["monitor-payment.js"]
    }
  },

  "credentials": {
    // 不存凭证值，只存引用指针
    "xuanyi": {
      "source": "vault",                     // vault | env | k8s-secret | ssm
      "path": "secret/xuanyi/db-creds",
      "fields": ["username", "password"],
      "rotated_at": "2026-04-01T00:00:00+08:00"
    },
    "siyuan": {
      "source": "env",
      "prefix": "SIYUAN_",                   // SIYUAN_USERNAME, SIYUAN_PASSWORD
      "fields": ["username", "password"]
    },
    "tiandao": {
      "source": "vault",
      "path": "secret/tiandao/api-key",
      "fields": ["api_key"],
      "rotated_at": "2026-04-01T00:00:00+08:00"
    }
  },

  "scripts_registry": {
    // 所有监控脚本的登记表
    "monitor-xuanyi.js": {
      "type": "js",
      "path": "monitors/xuanyi/monitor.js",
      "systems": ["xuanyi"],
      "entry": "standard",                   // standard | legacy | exempt
      "hash": "sha256:abc123...",
      "last_seen": "2026-05-09T03:00:00+08:00"
    },
    "monitor-siyuan.sh": {
      "type": "sh",
      "path": "monitors/siyuan/monitor.sh",
      "systems": ["siyuan"],
      "entry": "legacy",
      "hash": "sha256:def456...",
      "last_seen": "2026-04-10T02:00:00+08:00"
    }
  },

  "audit": {
    "violations": [],
    "last_scan": "2026-05-09T03:15:00+08:00",
    "drift_count": 0
  }
}
```

**设计要点**：

| 字段 | 用途 |
|------|------|
| `status` | 程序判断是否抑制告警的核心字段，`offline`/`maintenance` 时自动静默 |
| `alert_policy` | 扩展策略：`suppress`=完全静默，`ratelimit`=降频（如每小时最多1条） |
| `scripts` | 该系统关联的脚本列表，用于反向校验"脚本是否登记了系统" |
| `ttl_seconds` | 脚本缓存 Registry 的有效期，超时必须重新加载 |
| `hash` | 脚本内容哈希，用于检测绕过 Registry 的篡改 |

### 1.2 脚本标准入口

所有脚本（JS / SH / Python / cron）必须通过统一入口函数启动，**不允许**直接执行监控逻辑。

#### JavaScript 标准入口 (`monitor-bootstrap.js`)

```javascript
// 所有 JS 监控脚本的强制入口
// 用法：node monitor-bootstrap.js --script=monitor-xuanyi

const { loadRegistry, getCredentials, validateCompliance } = require('./lib/governance');

async function main() {
  // 步骤1：加载 Registry（程序强制，不可跳过）
  const registry = await loadRegistry({ ttl: 300 });

  // 步骤2：校验自身资格
  const scriptId = process.env.SCRIPT_ID || getCallerScriptId();
  validateCompliance(registry, scriptId);

  // 步骤3：检查目标系统状态
  const system = registry.systems[resolveSystem(scriptId)];
  if (system.status === 'offline' || system.status === 'maintenance') {
    console.log(`[GOVERNANCE] System ${system.name} is ${system.status}, suppressing execution`);
    process.exit(0);  // 静默退出，不发告警
  }

  // 步骤4：通过程序获取凭证（禁止硬编码）
  const creds = await getCredentials(registry, system.id);

  // 步骤5：执行实际监控（回调模式）
  const monitor = require(`./monitors/${system.id}/monitor`);
  await monitor.run({ system, credentials: creds });
}

main().catch(err => {
  console.error('[GOVERNANCE] Fatal:', err.message);
  process.exit(2);
});
```

#### Shell 标准入口 (`monitor-bootstrap.sh`)

```bash
#!/bin/bash
# 所有 Shell 监控脚本的强制入口
# 用法：SCRIPT_ID=monitor-siyuan ./monitor-bootstrap.sh

set -euo pipefail

# --- 不可跳过的步骤 ---

# 1. 加载 Registry
REGISTRY=$(cat /opt/monitors/.hermes/registry/system-registry.json)
if [ -z "$REGISTRY" ]; then
  echo "[GOVERNANCE] FATAL: Cannot load Registry" >&2
  exit 2
fi

# 2. 检查自身是否登记
SCRIPT_ID="${SCRIPT_ID:-$(basename "$0")}"
IS_REGISTERED=$(echo "$REGISTRY" | jq -r ".scripts_registry[\"$SCRIPT_ID\"].entry // \"unknown\"")
if [ "$IS_REGISTERED" = "unknown" ]; then
  echo "[GOVERNANCE] FATAL: Script $SCRIPT_ID not registered" >&2
  exit 2
fi

# 3. 检查系统状态
SYSTEM_ID=$(echo "$REGISTRY" | jq -r ".scripts_registry[\"$SCRIPT_ID\"].systems[0]")
STATUS=$(echo "$REGISTRY" | jq -r ".systems[\"$SYSTEM_ID\"].status")
if [ "$STATUS" = "offline" ] || [ "$STATUS" = "maintenance" ]; then
  echo "[GOVERNANCE] System $SYSTEM_ID is $STATUS, suppressing"
  exit 0
fi

# 4. 通过程序获取凭证（不硬编码）
CRED_SOURCE=$(echo "$REGISTRY" | jq -r ".credentials[\"$SYSTEM_ID\"].source")
case "$CRED_SOURCE" in
  vault)
    USERNAME=$(vault kv get -field=username "secret/$SYSTEM_ID/db-creds")
    PASSWORD=$(vault kv get -field=password "secret/$SYSTEM_ID/db-creds")
    ;;
  env)
    PREFIX=$(echo "$REGISTRY" | jq -r ".credentials[\"$SYSTEM_ID\"].prefix")
    USERNAME="${!${PREFIX}USERNAME}"
    PASSWORD="${!${PREFIX}PASSWORD}"
    ;;
esac

# 5. 执行实际监控
exec "/opt/monitors/$SYSTEM_ID/monitor.sh" \
  --username="$USERNAME" \
  --password="$PASSWORD" \
  --endpoint="$(echo "$REGISTRY" | jq -r ".systems[\"$SYSTEM_ID\"].endpoints.health")"
```

#### Python 标准入口 (`monitor_bootstrap.py`)

```python
"""所有 Python 监控脚本的强制入口"""
import json, os, sys
from governance import load_registry, get_credentials, validate_compliance

def main():
    script_id = os.environ.get("SCRIPT_ID") or sys.argv[1].split("--script=")[1]
    registry = load_registry(ttl=300)
    validate_compliance(registry, script_id)

    system_id = registry["scripts_registry"][script_id]["systems"][0]
    system = registry["systems"][system_id]

    if system["status"] in ("offline", "maintenance"):
        print(f"[GOVERNANCE] {system['name']} is {system['status']}, suppressing")
        sys.exit(0)

    creds = get_credentials(registry, system_id)
    # 动态导入监控模块
    monitor = __import__(f"monitors.{system_id}.monitor", fromlist=["run"])
    monitor.run(system=system, credentials=creds)

if __name__ == "__main__":
    main()
```

### 1.3 公共函数签名

库文件 `lib/governance.js`（所有语言对应实现）：

```javascript
// lib/governance.js — 治理库公共API

/**
 * 加载 Registry，带 TTL 缓存。
 * 调用时机：脚本启动第一行。
 * @param {Object} opts - { ttl: 300, source: 'file'|'redis'|'api' }
 * @returns {Object} registry 对象
 */
async function loadRegistry(opts = { ttl: 300 });

/**
 * 校验脚本是否合规。
 * 检查项：
 *   1. 脚本是否在 scripts_registry 中登记
 *   2. 脚本 hash 是否与登记一致（防篡改）
 *   3. 目标系统是否存在于 systems 中
 * 不合规时直接 process.exit(2)
 */
function validateCompliance(registry, scriptId);

/**
 * 通过 Registry 的 credentials 引用获取实际凭证。
 * 支持 vault / env / k8s-secret / ssm 四种来源。
 * 禁止直接返回硬编码值。
 */
async function getCredentials(registry, systemId);

/**
 * 向治理服务上报本次执行记录。
 * 用于运行时检测：哪些脚本在运行但没有查 Registry。
 */
async function reportExecution(registry, scriptId, result);

/**
 * 检测当前脚本是否存在硬编码凭证。
 * 静态扫描 + 运行时拦截。
 */
function detectHardcodedCredentials(scriptPath);
```

### 1.4 Registry 变更检测机制

```
┌──────────────────────────────────────────────────────────────┐
│                    Registry 变更传播路径                       │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  运维修改 Registry                                            │
│  （hermes registry set xuanyi.status=offline）               │
│         │                                                    │
│         ▼                                                    │
│  ┌─────────────────┐                                         │
│  │ system-registry │  JSON 文件写入                          │
│  │     .json       │  inotify / fs.watch                    │
│  └────────┬────────┘                                         │
│           │                                                  │
│           ▼                                                  │
│  ┌─────────────────┐     ┌──────────────────┐               │
│  │   Registry      │────▶│  Redis Pub/Sub    │               │
│  │   Watcher       │     │  channel:         │               │
│  │   (守护进程)     │     │  registry:update  │               │
│  └────────┬────────┘     └────────┬─────────┘               │
│           │                       │                          │
│           │              ┌────────▼─────────┐               │
│           │              │  所有运行中的      │               │
│           │              │  脚本进程订阅      │               │
│           │              │  此 channel       │               │
│           │              └────────┬─────────┘               │
│           │                       │                          │
│           ▼                       ▼                          │
│  ┌─────────────────────────────────────────┐                │
│  │          脚本行为变更                     │                │
│  │  • 系统下线 → 已运行脚本立即 suppress     │                │
│  │  • 凭证轮换 → 下次调用 getCredentials    │                │
│  │    时自动获取新凭证                       │                │
│  │  • 新增系统 → 关联脚本自动感知            │                │
│  └─────────────────────────────────────────┘                │
│                                                              │
│  兜底：TTL 过期后，脚本下次启动强制重新加载 Registry           │
│  长运行脚本：通过 Redis SUBSCRIBE 实时感知变更                 │
└──────────────────────────────────────────────────────────────┘
```

**实现细节**：

```javascript
// registry-watcher.js — Registry 变更检测守护进程
const fs = require('fs');
const redis = require('redis');

const REGISTRY_PATH = '/opt/monitors/.hermes/registry/system-registry.json';
const CHANNEL = 'registry:update';

let lastHash = null;

fs.watch(REGISTRY_PATH, async (eventType) => {
  if (eventType !== 'change') return;

  const currentHash = crypto.createHash('sha256')
    .update(fs.readFileSync(REGISTRY_PATH)).digest('hex');

  if (currentHash === lastHash) return;  // 去重
  lastHash = currentHash;

  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH));
  const publisher = redis.createClient();
  await publisher.connect();

  // 广播变更事件
  await publisher.publish(CHANNEL, JSON.stringify({
    type: 'registry_update',
    version: registry.version,
    timestamp: registry.updated_at,
    changed_systems: computeDiff(previousRegistry, registry)
  }));

  await publisher.quit();
});
```

### 1.5 状态传播路径总图

```
操作层
  hermes registry set xuanyi.status=offline
         │
         ▼
存储层
  system-registry.json  ──── git commit & push
         │
         ▼
检测层
  Registry Watcher (inotify)
         │
         ├──▶ Redis Pub/Sub (实时)
         │      └──▶ 长运行脚本订阅，立即生效
         │
         ├──▶ 文件 mtime 变更 (轮询)
         │      └──▶ cron 脚本下次触发时感知
         │
         └──▶ Governance API
                └──▶ HTTP 200 + ETag，脚本条件请求
         │
         ▼
执行层
  所有脚本 → 启动时 loadRegistry() → 检查 status → suppress/execute
```

---

## 2. 强制接入机制

### 2.1 设计原则：三层防线

| 层 | 机制 | 拦截时机 | 阻断能力 |
|----|------|---------|---------|
| **L1 Git Hook** | pre-commit / pre-push | 提交时 | 阻止新增不合规脚本进入仓库 |
| **L2 CI 门禁** | CI pipeline 扫描 | PR / Merge 时 | 阻止不合规代码合入主分支 |
| **L3 运行时** | Bootstrap 入口强制校验 | 脚本执行时 | 阻止未登记脚本运行 |

**核心思想**：L1 + L2 让不合规的脚本**进不来**，L3 让侥幸进来的**跑不起来**。

### 2.2 L1: Git Pre-commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit — 强制脚本登记
# 通过 Husky (JS) 或 pre-commit (Python) 框架管理

REGISTRY=".hermes/registry/system-registry.json"

# 获取本次提交中新增/修改的脚本文件
CHANGED_SCRIPTS=$(git diff --cached --name-only --diff-filter=ACM |
  grep -E '\.(js|sh|py)$' |
  grep -E '^monitors/' |
  grep -v 'bootstrap' |
  grep -v 'lib/governance')

for script in $CHANGED_SCRIPTS; do
  script_id=$(basename "$script")

  # 检查是否在 Registry 中登记
  if ! jq -e ".scripts_registry[\"$script_id\"]" "$REGISTRY" > /dev/null 2>&1; then
    echo "❌ [GOVERNANCE] 脚本 '$script' 未在 Registry 中登记！"
    echo ""
    echo "   请执行: hermes registry register-script $script"
    echo "   或编辑: $REGISTRY → scripts_registry"
    echo ""
    exit 1
  fi

  # 检查是否使用标准入口
  if [[ "$script" == *.sh ]]; then
    if ! grep -q 'monitor-bootstrap.sh' "$script"; then
      # 新脚本必须使用 bootstrap，旧脚本允许 legacy 标记
      ENTRY_TYPE=$(jq -r ".scripts_registry[\"$script_id\"].entry" "$REGISTRY")
      if [ "$ENTRY_TYPE" != "legacy" ]; then
        echo "❌ [GOVERNANCE] Shell 脚本 '$script' 必须使用 monitor-bootstrap.sh 入口"
        exit 1
      fi
    fi
  fi

  # 静态扫描：检测硬编码凭证
  if grep -qP '(password|api_key|secret|token)\s*[:=]\s*["'"'"'][A-Za-z0-9+/=]{8,}' "$script"; then
    echo "❌ [GOVERNANCE] 脚本 '$script' 疑似包含硬编码凭证！"
    echo "   请使用 getCredentials() 函数获取凭证"
    exit 1
  fi
done

# 更新脚本 hash 到 Registry
echo "[GOVERNANCE] ✓ 所有脚本合规检查通过"
```

### 2.3 L2: CI 门禁 (GitHub Actions / GitLab CI)

```yaml
# .github/workflows/governance-check.yml
name: Governance Compliance Check

on:
  pull_request:
    paths:
      - 'monitors/**'
      - '.hermes/registry/**'

jobs:
  compliance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install jq
        run: sudo apt-get install -y jq

      - name: Governance Scan
        run: |
          hermes governance scan --strict

          # 检查项：
          # 1. 所有 monitors/ 下的脚本都在 Registry 中
          # 2. 所有 Registry 中引用的脚本文件都存在
          # 3. 没有硬编码凭证 (regex + 熵检测)
          # 4. 新增脚本使用标准入口 (非 legacy)
          # 5. Registry JSON schema 有效

      - name: Drift Detection
        run: |
          hermes governance drift-check
          # 对比 Registry 中的 hash 与实际文件 hash
          # 不一致 = 脚本被篡改但 Registry 未更新
```

### 2.4 L3: 运行时强制 (Bootstrap 入口)

已在 1.2 节详述。补充关键点：

- **`validateCompliance()` 是阻塞性的**：不通过直接 `process.exit(2)`，无任何绕过路径
- **非标准入口的脚本无法获取凭证**：`getCredentials()` 内部检查调用者是否登记
- **cron 不能直接调用监控脚本**：crontab 必须指向 bootstrap 入口

```cron
# ❌ 错误：直接调用监控脚本
*/5 * * * * /opt/monitors/xuanyi/monitor.sh

# ✓ 正确：通过 bootstrap 入口
*/5 * * * * SCRIPT_ID=monitor-xuanyi /opt/monitors/monitor-bootstrap.sh
```

### 2.5 新脚本自动发现与强制登记

```javascript
// scripts/discover.js — 新脚本自动发现
// 由 cron 每小时运行或 CI 触发

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function discoverScripts(monitorDir = '/opt/monitors') {
  const registry = JSON.parse(
    fs.readFileSync('.hermes/registry/system-registry.json', 'utf-8')
  );

  const existingScripts = new Set(Object.keys(registry.scripts_registry));
  const foundScripts = [];

  // 递归扫描 monitors/ 目录
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (/\.(js|sh|py)$/.test(entry.name) &&
                 !entry.name.includes('bootstrap') &&
                 !entry.name.includes('governance')) {
        const id = entry.name;
        if (!existingScripts.has(id)) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          foundScripts.push({
            id,
            path: fullPath,
            type: path.extname(entry.name).slice(1),
            hash: `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`,
            uses_bootstrap: content.includes('monitor-bootstrap'),
            has_hardcoded_creds: detectHardcodedCreds(content)
          });
        }
      }
    }
  }

  walk(monitorDir);
  return foundScripts;
}

// 发现未登记脚本 → 自动报警
const unregistered = discoverScripts();
if (unregistered.length > 0) {
  console.error(`[GOVERNANCE] 发现 ${unregistered.length} 个未登记脚本:`);
  unregistered.forEach(s => {
    console.error(`  - ${s.id} (${s.type}) at ${s.path}`);
    if (s.has_hardcoded_creds) {
      console.error(`    ⚠️ 疑似硬编码凭证!`);
    }
  });

  // 发送告警（钉钉/飞书/邮件）
  sendAlert({
    level: 'critical',
    title: '未登记监控脚本发现',
    details: unregistered,
    action: '请执行 hermes registry register-script <script> 或在 Registry 中登记'
  });
}
```

---

## 3. 凭证管理

### 3.1 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                     凭证管理架构                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Registry (凭证引用层)         凭证存储层 (加密)              │
│  ┌──────────────────┐        ┌──────────────────┐          │
│  │ credentials:     │        │ HashiCorp Vault  │          │
│  │   xuanyi:        │───1───▶│  secret/xuanyi/  │          │
│  │     source:vault │        │    db-creds       │          │
│  │     path: ...    │        └──────────────────┘          │
│  │                  │                                       │
│  │   siyuan:        │───2───▶┌──────────────────┐          │
│  │     source:env   │        │ 环境变量           │          │
│  │     prefix:SIYUAN│        │ SIYUAN_USERNAME   │          │
│  └──────────────────┘        │ SIYUAN_PASSWORD   │          │
│                              └──────────────────┘          │
│                                                             │
│  脚本层                                                     │
│  ┌──────────────────────────────────────────────────┐      │
│  │  const creds = await getCredentials(registry,     │      │
│  │                                     'xuanyi');    │      │
│  │  // creds.username, creds.password ← 来自 Vault   │      │
│  │  // 脚本代码中零硬编码凭证                          │      │
│  └──────────────────────────────────────────────────┘      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 credentials/loader.js 实现

```javascript
// lib/credentials/loader.js
// 统一凭证加载器 —— 所有脚本通过此模块获取凭证
// 禁止脚本直接 process.env.SOME_PASSWORD 或硬编码

const vault = require('node-vault');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

// 调用栈检查：确保是 governance 库调用，而非脚本直接调用
function verifyCaller() {
  const stack = new Error().stack;
  if (!stack.includes('lib/governance') && !stack.includes('monitor-bootstrap')) {
    throw new Error(
      '[GOVERNANCE] 禁止直接调用 credentials/loader.js！请通过 getCredentials() 获取凭证'
    );
  }
}

async function load(credentialRef, systemId) {
  verifyCaller();

  const { source, path: refPath, prefix, fields } = credentialRef;

  switch (source) {
    case 'vault': {
      const client = vault({
        endpoint: process.env.VAULT_ADDR,
        token: process.env.VAULT_TOKEN
      });
      const secret = await client.read(refPath);
      const result = {};
      for (const field of fields) {
        result[field] = secret.data.data[field];
        if (!result[field]) {
          throw new Error(`[GOVERNANCE] Vault secret ${refPath} missing field: ${field}`);
        }
      }
      return result;
    }

    case 'env': {
      const result = {};
      for (const field of fields) {
        const envKey = `${prefix}${field.toUpperCase()}`;
        result[field] = process.env[envKey];
        if (!result[field]) {
          throw new Error(`[GOVERNANCE] 环境变量 ${envKey} 未设置 (system: ${systemId})`);
        }
      }
      return result;
    }

    case 'k8s-secret': {
      // 从 Kubernetes Secret 挂载卷读取
      const fs = require('fs');
      const result = {};
      for (const field of fields) {
        const filePath = `${refPath}/${field}`;
        result[field] = fs.readFileSync(filePath, 'utf-8').trim();
      }
      return result;
    }

    case 'ssm': {
      const ssm = new SSMClient({ region: process.env.AWS_REGION });
      const result = {};
      for (const field of fields) {
        const cmd = new GetParameterCommand({
          Name: `${refPath}/${field}`,
          WithDecryption: true
        });
        const response = await ssm.send(cmd);
        result[field] = response.Parameter.Value;
      }
      return result;
    }

    default:
      throw new Error(`[GOVERNANCE] 未知凭证来源: ${source}`);
  }
}

module.exports = { load };
```

### 3.3 凭证变更自动传播

```
凭证轮换流程：

  管理员轮换凭证
  （Vault 写入新 secret / 更新 K8s Secret / 更新 SSM）
         │
         ▼
  Registry 更新 rotated_at 时间戳
  （hermes registry rotate xuanyi）
         │
         ▼
  Registry Watcher 检测到 credentials 变更
         │
         ├──▶ Redis Pub/Sub 广播
         │      └──▶ 运行中的脚本：下次 getCredentials() 调用自动获取新凭证
         │             （getCredentials 内部检查 rotated_at > 上次获取时间）
         │
         └──▶ TTL 机制
                └──▶ 脚本下次 loadRegistry() 获取新 credential 引用
                       （getCredentials() 总是从 Registry 读 source/path，
                         然后从实际存储加载最新值）
```

### 3.4 硬编码凭证检测

```javascript
// lib/governance/scanner.js
// 静态 + 运行时双层检测

const ENTROPY_THRESHOLD = 4.5;  // Shannon entropy

// 高熵字符串模式（可能是凭证）
const SECRET_PATTERNS = [
  /(?:password|passwd|pwd|secret|token|api[_-]?key|auth[_-]?token)\s*[:=]\s*['"]([^'"]{8,})['"]/gi,
  /(?:Bearer\s+)([A-Za-z0-9\-._~+/]+=*)/g,
  /(?:--password[= ])(\S+)/g,
];

function entropy(str) {
  const freq = {};
  for (const c of str) freq[c] = (freq[c] || 0) + 1;
  return -Object.values(freq).reduce((sum, f) => {
    const p = f / str.length;
    return sum + p * Math.log2(p);
  }, 0);
}

function scanFile(filePath) {
  const content = require('fs').readFileSync(filePath, 'utf-8');
  const findings = [];

  // Pattern matching
  for (const pattern of SECRET_PATTERNS) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const candidate = match[1] || match[0];
      // 排除明显的占位符
      if (/^(your[_\-]?)?(password|token|secret|key|xxx+|placeholder|example)/i.test(candidate)) {
        continue;
      }
      // 排除环境变量引用
      if (/\$\{?\w+\}?/.test(candidate) || /process\.env/.test(candidate)) {
        continue;
      }
      findings.push({
        line: content.substring(0, match.index).split('\n').length,
        match: match[0].substring(0, 20) + '...',
        entropy: entropy(candidate)
      });
    }
  }

  // 高熵字符串检测（无变量名的高熵字面量）
  const highEntropyLines = content.split('\n')
    .map((line, i) => ({ line, num: i + 1 }))
    .filter(({ line }) => {
      const strings = line.match(/['"]([^'"]{20,})['"]/g) || [];
      return strings.some(s => entropy(s.slice(1, -1)) > ENTROPY_THRESHOLD);
    });

  for (const { num } of highEntropyLines) {
    findings.push({ line: num, match: '<high-entropy string>', entropy: '>4.5' });
  }

  return findings;
}
```

---

## 4. 防腐机制

### 4.1 Registry 与实际不一致自动校验

```javascript
// lib/governance/drift-detector.js
// 定期运行，检测 Registry 声明与实际情况的偏差

async function detectDrift(registry) {
  const drifts = [];

  for (const [scriptId, reg] of Object.entries(registry.scripts_registry)) {
    const filePath = reg.path;

    // 检查1：Registry 引用但文件不存在
    if (!fs.existsSync(filePath)) {
      drifts.push({
        type: 'missing_file',
        script: scriptId,
        registry_path: filePath,
        severity: 'critical',
        message: `Registry 引用 ${filePath} 但文件不存在`
      });
      continue;
    }

    // 检查2：文件存在但 Registry 未引用（在 discover 中处理）

    // 检查3：hash 不一致 = 脚本被篡改
    const actualHash = 'sha256:' + crypto.createHash('sha256')
      .update(fs.readFileSync(filePath)).digest('hex');
    if (actualHash !== reg.hash) {
      drifts.push({
        type: 'hash_mismatch',
        script: scriptId,
        registered_hash: reg.hash,
        actual_hash: actualHash,
        severity: 'high',
        message: `${scriptId} 内容已变更但 Registry hash 未更新`
      });
    }

    // 检查4：声称使用标准入口但实际没有
    const content = fs.readFileSync(filePath, 'utf-8');
    if (reg.entry === 'standard' && !usesBootstrap(content, reg.type)) {
      drifts.push({
        type: 'entry_mismatch',
        script: scriptId,
        severity: 'high',
        message: `${scriptId} 声称 standard 但未使用 bootstrap 入口`
      });
    }

    // 检查5：系统状态和实际可达性
    const systemId = reg.systems[0];
    const system = registry.systems[systemId];
    if (system && system.status === 'online') {
      const reachable = await checkReachability(system.endpoints.health);
      if (!reachable) {
        drifts.push({
          type: 'status_mismatch',
          system: systemId,
          registered_status: 'online',
          actual: 'unreachable',
          severity: 'high',
          message: `${system.name} Registry 标记为 online 但 health check 不可达`
        });
      }
    }
  }

  // 检查6：文件系统有脚本但 Registry 无记录
  const registryScripts = new Set(Object.keys(registry.scripts_registry));
  const diskScripts = discoverAllScripts('/opt/monitors');
  for (const script of diskScripts) {
    if (!registryScripts.has(script.id)) {
      drifts.push({
        type: 'unregistered_script',
        script: script.id,
        path: script.path,
        severity: 'critical',
        message: `磁盘存在脚本 ${script.id} 但未在 Registry 中登记`
      });
    }
  }

  return drifts;
}

// 定时运行 (cron)
// */10 * * * * hermes governance drift-check --alert
```

### 4.2 脚本绕过 Registry 检测

#### 静态检测

```javascript
// lib/governance/bypass-scanner.js

const BYPASS_INDICATORS = {
  js: [
    // 直接 require 监控模块而不经过 bootstrap
    { pattern: /require\(['"].*monitor(?!-bootstrap)/, severity: 'high' },
    // 直接读取环境变量凭证
    { pattern: /process\.env\.\w*(PASSWORD|SECRET|TOKEN|KEY)\w*/i, severity: 'critical' },
    // 硬编码 API 端点（应来自 Registry）
    { pattern: /https?:\/\/[^'"]*\/api\/(health|metrics)/gi, severity: 'medium' },
    // process.exit 绕过（脚本自行 exit 0 模拟 suppress）
    { pattern: /process\.exit\(0\)(?!.*GOVERNANCE)/, severity: 'medium' },
  ],
  sh: [
    { pattern: /(PASSWORD|TOKEN|SECRET)=['"][^'"]{4,}['"]/, severity: 'critical' },
    { pattern: /curl.*https?:\/\/(?!.*REGISTRY)/, severity: 'medium' },
    { pattern: /exit 0(?!.*GOVERNANCE)/, severity: 'low' },
  ],
  py: [
    { pattern: /os\.environ\[.*(PASSWORD|SECRET|TOKEN)/i, severity: 'critical' },
    { pattern: /sys\.exit\(0\)(?!.*GOVERNANCE)/, severity: 'medium' },
  ]
};

function scanForBypass(filePath, fileType) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const indicators = BYPASS_INDICATORS[fileType] || [];
  const findings = [];

  for (const { pattern, severity } of indicators) {
    const matches = content.match(pattern);
    if (matches) {
      findings.push({
        pattern: pattern.toString(),
        count: matches.length,
        severity,
        examples: matches.slice(0, 3)
      });
    }
  }

  return findings;
}
```

#### 运行时检测

```javascript
// lib/governance/runtime-guard.js
// 运行时拦截绕过行为

// 拦截 process.exit —— 防止脚本自行退出绕过 suppress 逻辑
const originalExit = process.exit;
let exitCalled = false;

process.exit = function(code) {
  const stack = new Error().stack;

  // 如果 exit(0) 不是 governance 库调用的，记录为可疑行为
  if (code === 0 && !stack.includes('lib/governance') && !stack.includes('bootstrap')) {
    console.error('[GOVERNANCE] WARNING: process.exit(0) called outside governance context');
    console.error(stack);
    // 发送告警
    reportViolation('unauthorized_exit', { stack });
  }

  exitCalled = true;
  originalExit(code);
};

// 拦截网络请求 —— 确保使用 Registry 中的端点
// (通过 monkey-patch http/https 模块，检查请求 URL 是否在 Registry 中)
const http = require('http');
const https = require('https');
const originalHttpRequest = http.request;
const originalHttpsRequest = https.request;

function wrapRequest(original) {
  return function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.href || args[0]?.host;
    if (url && !isRegistryEndpoint(url)) {
      console.warn(`[GOVERNANCE] 访问非 Registry 端点: ${url}`);
      // 非阻断性告警（legacy 脚本可能有外部依赖）
    }
    return original.apply(this, args);
  };
}

http.request = wrapRequest(originalHttpRequest);
https.request = wrapRequest(originalHttpsRequest);
```

### 4.3 新增系统强制登记流程

```
新增被监控系统的强制流程（程序化 Gate）：

  Step 1: 运维想新增监控
         │
         ▼
  Step 2: hermes registry add-system <name>
         │  • 交互式 CLI 收集 endpoints, dependencies, owners
         │  • 自动生成 credentials 引用（提示选择 vault/env/k8s）
         │  • status 初始为 'pending'（不报警、不静默）
         │  • 写入 system-registry.json
         │
         ▼
  Step 3: 创建监控脚本
         │  • 必须使用 bootstrap 模板：hermes registry scaffold <name>
         │  • 自动生成带标准入口的脚本骨架
         │  • 自动在 scripts_registry 中登记
         │
         ▼
  Step 4: 提交 PR
         │  • CI 门禁自动检查：
         │    - Registry 有该系统条目
         │    - 脚本使用标准入口
         │    - 无硬编码凭证
         │    - 系统 status 已从 pending 变更为 online/offline
         │
         ▼
  Step 5: 合入后
         │  • Registry Watcher 广播新系统
         │  • 其他脚本感知（如依赖关系校验）
         │  • 监控面板自动显示新系统
```

**关键约束**：
- 不允许手动编辑 `system-registry.json` 新增系统（必须走 `hermes registry add-system` CLI）
- CLI 强制要求填写必填字段（endpoints, owners, credential source）
- `status: pending` 的新系统不会触发任何告警，也不会被错误地 suppress

---

## 5. 灰度与回滚

### 5.1 28 个脚本分批改造优先级

**优先级矩阵**：

| 维度 | 权重 | 说明 |
|------|------|------|
| 是否仍在告警（系统已下线） | 最高 | 立即改造，消除噪音 |
| 是否含硬编码凭证 | 高 | 安全风险，优先处理 |
| 脚本复杂度（行数/依赖） | 中 | 简单的先改，快速见效 |
| 业务关键度 | 低 | 核心系统后改，降低风险 |

**分批计划**：

| 批次 | 脚本数 | 特征 | 改造内容 | 预计工时 | 灰度开始 |
|------|--------|------|---------|---------|---------|
| **P0 (急救)** | 6 | 系统已下线但仍报警 | 接入 bootstrap + status 检查即可，不改业务逻辑 | 2人日 | T+0 |
| **P1 (安全)** | 4 | 含硬编码凭证 | 迁移到 credentials/loader + Vault | 3人日 | T+3 |
| **P2 (简单)** | 10 | 短脚本 (<100行)，单系统 | 完整接入：bootstrap + Registry + credentials | 5人日 | T+7 |
| **P3 (复杂)** | 5 | 长脚本，多系统依赖 | 完整接入 + 重构 | 8人日 | T+14 |
| **P4 (外部)** | 3 | 外部 API 监控 | 完整接入 + 外部端点可达性校验 | 3人日 | T+18 |

### 5.2 灰度策略

```
灰度阶段

  Phase 0: 基础设施部署 (T-3 ~ T0)
  ┌─────────────────────────────────────────┐
  │ • 部署 system-registry.json (初始数据)   │
  │ • 部署 Registry Watcher 守护进程         │
  │ • 部署 Redis Pub/Sub                    │
  │ • 部署 governance 库 (lib/)             │
  │ • 部署 monitor-bootstrap 入口脚本       │
  │ • 配置 Git hooks + CI 门禁             │
  └─────────────────────────────────────────┘

  Phase 1: 双轨运行 (T0 ~ T+5)
  ┌─────────────────────────────────────────┐
  │ • P0 脚本接入 bootstrap                 │
  │ • 新旧脚本并存：新脚本走 Registry，      │
  │   旧脚本继续原逻辑                       │
  │ • 告警不重复：Registry suppress 旧脚本    │
  │   对应的告警规则（在告警平台侧同步）      │
  │ • 监控指标：接入率 / suppress 有效性     │
  └─────────────────────────────────────────┘

  Phase 2: 逐步切流 (T+5 ~ T+20)
  ┌─────────────────────────────────────────┐
  │ • P1-P2 批次逐步接入                    │
  │ • 每批次接入后观察 2 天无异常再继续      │
  │ • 旧脚本告警规则同步废弃                 │
  │ • Legacy 脚本标记为 entry: legacy        │
  │   并在 Registry 中记录改造期限            │
  └─────────────────────────────────────────┘

  Phase 3: 全量强制 (T+20+)
  ┌─────────────────────────────────────────┐
  │ • P3-P4 批次完成                        │
  │ • CI 门禁升级为 blocking：               │
  │   任何 entry: legacy 的新增/修改被拒绝   │
  │ • 旧告警规则全部下线                     │
  │ • 28 个脚本全部 entry: standard          │
  └─────────────────────────────────────────┘
```

**灰度控制机制**：

```javascript
// lib/governance/feature-flag.js
// 灰度开关，按脚本 ID 逐步启用强制检查

const GRADUAL_ROLLOUT = {
  // enforce_compliance: 强制执行合规检查（不通过直接拒绝）
  enforce_compliance: {
    enabled: true,
    // 先只对 P0 脚本强制，逐步扩大
    script_patterns: [
      'monitor-xuanyi',     // P0
      'monitor-siyuan',     // P0
      'monitor-tiandao-old',// P0 (已下线)
      // P1 脚本 T+3 后加入
      // 'monitor-*',       // T+20 全量
    ]
  },
  // suppress_on_offline: 系统下线时是否自动静默
  suppress_on_offline: {
    enabled: true,
    // 先只对已确认下线的系统静默
    system_ids: ['xuanyi', 'siyuan'],
  },
  // use_vault_credentials: 是否强制使用 Vault
  use_vault_credentials: {
    enabled: false,  // T+3 后开启
  }
};

function isEnforcedFor(scriptId) {
  const patterns = GRADUAL_ROLLOUT.enforce_compliance.script_patterns;
  return patterns.some(p => {
    if (p.endsWith('*')) return scriptId.startsWith(p.slice(0, -1));
    return p === scriptId;
  });
}
```

### 5.3 回滚机制

```
回滚路径

  问题发现
         │
         ▼
  ┌────────────── 回滚决策树 ──────────────┐
  │                                         │
  │  Level 1: 单脚本回滚                     │
  │  ┌─────────────────────────────────┐    │
  │  │ hermes registry set-entry       │    │
  │  │   <script> --entry=legacy        │    │
  │  │                                 │    │
  │  │ → 该脚本恢复旧逻辑               │    │
  │  │ → Registry 仍记录其存在           │    │
  │  │ → 告警平台恢复旧规则              │    │
  │  └─────────────────────────────────┘    │
  │                                         │
  │  Level 2: 批次回滚                       │
  │  ┌─────────────────────────────────┐    │
  │  │ hermes registry rollback-batch  │    │
  │  │   --batch=P2                     │    │
  │  │                                 │    │
  │  │ → 批量将 P2 脚本设为 legacy       │    │
  │  │ → 恢复对应告警规则                │    │
  │  │ → 保留 Registry 结构不动          │    │
  │  └─────────────────────────────────┘    │
  │                                         │
  │  Level 3: 全局回滚                       │
  │  ┌─────────────────────────────────┐    │
  │  │ hermes registry global-rollback │    │
  │  │                                 │    │
  │  │ → 所有脚本 entry → legacy        │    │
  │  │ → Registry Watcher 停止          │    │
  │  │ → CI 门禁降级为 warning          │    │
  │  │ → 告警完全恢复旧体系              │    │
  │  │ → system-registry.json 备份保留   │    │
  │  └─────────────────────────────────┘    │
  │                                         │
  └─────────────────────────────────────────┘
```

**回滚安全保障**：

1. **Registry 不可变历史**：每次修改自动 git commit，可 `git revert` 到任意历史版本
2. **双轨运行期**：Phase 1-2 期间旧告警规则不删除，只 suspend，回滚即 unsuspend
3. **回滚演练**：每批次改造完成后，强制进行一次回滚演练（dev 环境）
4. **自动熔断**：如果 `hermes governance drift-check` 连续 3 次检测到 critical drift，自动触发告警并建议回滚

```javascript
// 自动熔断逻辑
async function autoCircuitBreaker() {
  const drifts = await detectDrift(registry);
  const criticalCount = drifts.filter(d => d.severity === 'critical').length;

  // 从 Redis 读取连续 critical 计数
  const key = 'governance:circuit_breaker:critical_streak';
  let streak = await redis.get(key) || 0;

  if (criticalCount > 0) {
    streak = parseInt(streak) + 1;
    await redis.setex(key, 3600, streak);

    if (streak >= 3) {
      sendAlert({
        level: 'critical',
        title: '🔴 Governance Circuit Breaker 触发',
        message: `连续 ${streak} 次 drift-check 发现 critical 问题`,
        suggestion: '建议执行 hermes registry global-rollback 回滚',
        drifts: drifts.filter(d => d.severity === 'critical')
      });
    }
  } else {
    await redis.del(key);  // 重置计数
  }
}
```

---

## 6. 附录：28 个脚本分批清单

| # | 脚本名 | 类型 | 系统 | 系统状态 | 硬编码凭证 | 行数 | 批次 |
|---|--------|------|------|---------|-----------|------|------|
| 1 | monitor-xuanyi.js | js | 玄一 | offline | ❌ | 120 | P0 |
| 2 | health-xuanyi.sh | sh | 玄一 | offline | ❌ | 45 | P0 |
| 3 | monitor-siyuan.sh | sh | 四院 | offline | ❌ | 80 | P0 |
| 4 | db-siyuan.py | py | 四院 | offline | ✅ | 200 | P0 |
| 5 | monitor-tiandao-old.js | js | 天道(旧) | offline | ❌ | 60 | P0 |
| 6 | cron-tiandao-legacy.sh | sh | 天道(旧) | offline | ❌ | 30 | P0 |
| 7 | monitor-tiandao.js | js | 天道 | online | ✅ | 250 | P1 |
| 8 | latency-tiandao.sh | sh | 天道 | online | ✅ | 90 | P1 |
| 9 | monitor-payment.js | js | 外部支付 | online | ✅ | 180 | P1 |
| 10 | auth-check.sh | sh | 认证服务 | online | ✅ | 55 | P1 |
| 11 | monitor-siyuan-v2.js | js | 四院v2 | online | ❌ | 95 | P2 |
| 12 | cron-db-backup-check.sh | sh | 数据库 | online | ❌ | 40 | P2 |
| 13 | redis-monitor.js | js | Redis集群 | online | ❌ | 70 | P2 |
| 14 | kafka-lag.sh | sh | Kafka | online | ❌ | 50 | P2 |
| 15 | cpu-alert.py | py | 所有 | online | ❌ | 85 | P2 |
| 16 | disk-usage.sh | sh | 所有 | online | ❌ | 35 | P2 |
| 17 | memory-monitor.js | js | 所有 | online | ❌ | 65 | P2 |
| 18 | nginx-health.sh | sh | Nginx | online | ❌ | 40 | P2 |
| 19 | cert-expiry.py | py | SSL证书 | online | ❌ | 100 | P2 |
| 20 | docker-health.sh | sh | Docker | online | ❌ | 30 | P2 |
| 21 | monitor-tiandao-complex.js | js | 天道 | online | ❌ | 400 | P3 |
| 22 | multi-system-check.py | py | 多系统 | online | ❌ | 350 | P3 |
| 23 | analytics-pipeline.sh | sh | 数据管道 | online | ❌ | 280 | P3 |
| 24 | ml-model-monitor.py | py | ML服务 | online | ❌ | 320 | P3 |
| 25 | event-bus-monitor.js | js | 事件总线 | online | ❌ | 380 | P3 |
| 26 | external-api-sms.sh | sh | 外部短信 | online | ❌ | 90 | P4 |
| 27 | external-api-push.js | js | 外部推送 | online | ❌ | 150 | P4 |
| 28 | payment-callback.sh | sh | 外部支付回调 | online | ❌ | 110 | P4 |

---

## 附录 B: CLI 命令参考

```bash
# Registry 管理
hermes registry show                          # 查看完整 Registry
hermes registry get <system>                  # 查看单个系统
hermes registry set <system>.<field>=<value>  # 修改字段
hermes registry add-system <name>             # 交互式新增系统
hermes registry register-script <path>        # 登记脚本
hermes registry set-entry <script> --entry=legacy|standard  # 切换入口类型

# 脚本脚手架
hermes registry scaffold <system-name>        # 生成标准监控脚本骨架

# 合规检查
hermes governance scan                        # 扫描合规性
hermes governance scan --strict               # 严格模式，不合规即失败
hermes governance drift-check                 # Registry vs 实际差异检测
hermes governance drift-check --auto-fix      # 自动修复可修复的 drift

# 灰度/回滚
hermes registry rollback-batch --batch=P2     # 批次回滚
hermes registry global-rollback               # 全局回滚

# 凭证
hermes registry rotate <system>               # 标记凭证已轮换
hermes registry check-creds <system>          # 验证凭证可达性
```

---

## 附录 C: 目录结构

```
/opt/monitors/
├── .hermes/
│   └── registry/
│       ├── system-registry.json          # 权威配置（程序读取）
│       ├── system-registry.yaml          # 人类可读快照（自动导出）
│       └── history/                      # Git 管理的历史版本
├── monitor-bootstrap.js                  # JS 标准入口
├── monitor-bootstrap.sh                  # Shell 标准入口
├── monitor_bootstrap.py                  # Python 标准入口
├── lib/
│   ├── governance.js                     # 治理库主入口
│   ├── governance/
│   │   ├── registry-loader.js            # Registry 加载 + TTL 缓存
│   │   ├── compliance-validator.js       # 合规校验
│   │   ├── drift-detector.js             # 偏差检测
│   │   ├── bypass-scanner.js             # 绕过检测（静态）
│   │   ├── runtime-guard.js              # 运行时守卫
│   │   ├── circuit-breaker.js            # 自动熔断
│   │   └── feature-flag.js               # 灰度开关
│   └── credentials/
│       ├── loader.js                     # 统一凭证加载器
│       └── scanner.js                    # 硬编码凭证扫描
├── monitors/                            # 实际监控脚本
│   ├── xuanyi/
│   │   └── monitor.js
│   ├── siyuan/
│   │   └── monitor.sh
│   └── ...
├── scripts/
│   ├── discover.js                       # 新脚本自动发现
│   ├── registry-watcher.js               # Registry 变更监听
│   └── audit-reporter.js                 # 审计报告生成
├── .git/
│   └── hooks/
│       └── pre-commit                    # Git pre-commit hook
└── .github/
    └── workflows/
        └── governance-check.yml          # CI 合规门禁
```

---

> **文档版本**: v1.0
> **最后更新**: 2026-05-09
> **设计原则**: 程序机制而非制度文档 — 所有约束通过代码强制执行
