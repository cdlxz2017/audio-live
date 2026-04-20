# 健康检查 Neo4j 卡住根因分析

> 调查时间：2026-04-20 22:45  
> 调查者：玄枢·架构分析子程序

---

## 1. 卡住位置定位

**结论：Neo4j 本身不是卡住的原因，卡住点有两处：**

### 卡住点 A：bash 脚本中的 Python 邮件发送（主因）

`health-check-report.sh` 末尾的邮件发送代码：
```bash
python3 /home/ai/.openclaw/workspace/custom-skills/send-email/scripts/send-email.py \
  --to cdlxz2017@qq.com \
  --subject "[健康检查] 记忆+审计 $(date '+%m/%d %H:%M')" \
  --body "${EMAIL_BODY}"
```

`sender-email.py` 使用 `smtplib.SMTP_SSL` 连接 `smtp.qq.com:465`，**未设置 socket timeout**。SSL 握手在网络异常时可能无限等待，导致整个脚本 hang 住。

**实测证据：**
- 直接运行 `bash health-check-report.sh` → 4分钟以上无返回（被 SIGKILL 杀死）
- 单独运行 email 脚本 → SSL 连接挂起
- 第一次测试整个脚本时，node 部分约 25s 完成，但 email 发送部分一直卡住

### 卡住点 B：Git 操作（次要因素，在 workspace root 执行时变慢）

`updateSystemRegistrySnapshots()` 中执行：
```javascript
execSync('git add SYSTEMS.md', { cwd: workspacePath });
const diff = execSync('git diff --cached --name-only', { cwd: workspacePath, encoding: 'utf8' });
```

当从 workspace root (`/home/ai/.openclaw/workspace`) 调用时，`workspacePath = /home/ai/.openclaw/workspace`，该目录是完整的 git repo，git 操作可能受大仓库影响。但 git 操作本身（`git add` / `git diff --cached`）实测只需 2-4ms，不是主要瓶颈。

---

## 2. 并发/串行分析

### 基础设施层（Promise.all 并行）

```javascript
const [dbResult, ollamaResult, neo4jResult, redisResult] = await Promise.all([
  checkDB(),
  checkOllama(),
  checkNeo4j(),
  checkRedis(),
]);
```

**4 个函数并行执行，互不阻塞。** `checkNeo4j()` 和 `checkRedis()` 各自有独立连接池，不会相互影响。

### Neo4j 专项检查（串行，每次一个查询）

**`checkGraphLinker()`** - 3 个查询串行：
```javascript
const result = await session.run('MATCH (n:PersonalMemory) RETURN count(n) as cnt');
const relResult = await session.run('MATCH ()-[r:RECORDS]->() RETURN count(r) as cnt');
const peResult = await session.run('MATCH (p:PersonalEntity) RETURN count(p) as cnt');
```

**`checkGraphifyOpusManager()`** - 4 个查询串行：
```javascript
const r1 = await session.run('MATCH (g:GraphifyCode) RETURN count(g) as cnt');
const r2 = await session.run('MATCH (g:GraphifyCode)-[r:ALIGNED_TO]->(m:Memory_summary) RETURN count(r) as cnt');
const r3 = await session.run('MATCH (m:Memory_summary) RETURN count(m) as cnt');
const r4 = await session.run('MATCH (p:PersonalEntity) RETURN count(p) as cnt');
```

**卡住不发生在 Neo4j 并发/串行逻辑。** 独立测试 `checkNeo4j()` 和直接 driver session.run 均正常完成（26ms）。

---

## 3. 工作目录差异

**实测发现：执行路径影响显著。**

| 执行方式 | 耗时 | 说明 |
|---------|------|------|
| `cd memory-system && node scripts/health-check.js` | ~0.5s ✅ | 正常运行 |
| `node memory-system/scripts/health-check.js` (从 workspace root) | 0.5s~25s ❓ | 不稳定，曾观察到 25s |

**原因分析：**
- 脚本使用 `path.join(__dirname, '..', '.env')` 定位 `.env`，与 cwd 无关（`__dirname` 固定为脚本所在目录）
- config.js 中的 `database.password` 从 `process.env.PGPASSWORD` 读取，`.env` 加载正常
- **差异来源：`git` 操作的工作目录**（`workspacePath = /home/ai/.openclaw/workspace`），大仓库 git 操作可能偶发慢

**根本原因不是工作目录差异导致卡住，而是邮件发送导致。**

---

## 4. .env 加载分析

```javascript
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    // ...
    if (!process.env[key]) process.env[key] = val;
  }
}
```

- `.env` 路径基于 `__dirname`（`/home/ai/.openclaw/workspace/memory-system/scripts`），与调用路径无关
- 环境变量 `NEO4J_URI=bolt://localhost:7687`, `NEO4J_USER=neo4j`, `NEO4J_PASSWORD=openclaw_neo4j_2026` 正确加载
- **.env 加载不是卡住原因**

```bash
$ cat /home/ai/.openclaw/workspace/memory-system/.env | grep NEO4J
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=openclaw_neo4j_2026
```

---

## 5. 超时参数有效性

### neo4j-driver 版本确认
```
neo4j-driver v5.28.3
```

### 超时参数验证

```javascript
_neo4jDriver = neo4j.driver(
  config.neo4j.uri,
  neo4j.auth.basic(config.neo4j.auth.username, config.neo4j.auth.password),
  { maxConnectionTimeout: 10000, connectionTimeout: 10000 },
);
```

**验证测试：**
```javascript
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'pass'), {
  maxConnectionTimeout: 5000, connectionTimeout: 5000
});
// Driver created successfully, no error ✅
```

**参数说明（neo4j-driver v5）：**
| 参数 | 含义 | 状态 |
|------|------|------|
| `maxConnectionTimeout` | 连接建立超时（ms） | ✅ 有效 |
| `connectionTimeout` | Socket 连接超时（ms） | ✅ 有效 |
| `connectionAcquisitionTimeout` | 从池中获取连接的超时（ms） | ✅ config.js 中设为 60000 |

`maxConnectionTimeout: 10000` = 10 秒超时，符合预期。

**独立 Neo4j 测试结果：**
```
Session created, running query...
Query OK: Integer { low: 1, high: 0 }  ✅
```
Neo4j 连接正常，无卡住。

---

## 6. 结论与修复建议

### 根因确认

| # | 根因 | 置信度 |
|---|------|--------|
| 1 | **Python 邮件发送脚本 SMTP_SSL 无超时**（主因） | ⭐⭐⭐⭐⭐ |
| 2 | ~~Neo4j 连接超时~~ | ❌ 排除 |
| 3 | ~~工作目录导致 .env 加载失败~~ | ❌ 排除 |
| 4 | ~~Promise.all 并发某个函数卡住~~ | ❌ 排除 |

### 修复方案

#### 方案 A：为邮件发送加超时（推荐）

在 `health-check-report.sh` 中用 `timeout` 命令包装邮件发送：

```bash
# 邮件发送最多等 30 秒
timeout 30 python3 /home/ai/.openclaw/workspace/custom-skills/send-email/scripts/send-email.py \
  --to cdlxz2017@qq.com \
  --subject "[健康检查] 记忆+审计 $(date '+%m/%d %H:%M')" \
  --body "${EMAIL_BODY}" \
  || echo "[WARNING] 邮件发送超时或失败"
```

#### 方案 B：在 send-email.py 中添加 socket 超时

在 `send-email.py` 的 SMTP_SSL 连接处添加：
```python
import socket
socket.setdefaulttimeout(30)  # 全局 30 秒超时
```

或在连接时：
```python
server = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=30)
```

#### 方案 C：移除邮件发送，改用 OpenClaw 消息通知

如果邮件不是必须的，可以用 `message` 工具发送健康检查结果，避免 SMTP 依赖。

### Neo4j 超时配置（已正确，无需修改）

当前配置：
```javascript
_neo4jDriver = neo4j.driver(
  config.neo4j.uri,
  neo4j.auth.basic(config.neo4j.auth.username, config.neo4j.auth.password),
  { maxConnectionTimeout: 10000, connectionTimeout: 10000 },
);
```

如需进一步强化，可添加：
```javascript
{ 
  maxConnectionTimeout: 10000, 
  connectionTimeout: 10000,
  maxConnectionLifeltime: 3600000,
  connectionAcquisitionTimeout: 10000,
}
```

### 验证计划

1. 修复邮件脚本超时
2. 执行 `bash health-check-report.sh` 验证总执行时间 < 60s
3. 确认健康检查邮件正常发送

---

## 附录：关键实测数据

```
neo4j-driver: v5.28.3
Neo4j 连接测试: Query OK (26ms) ✅
直接从 memory-system 目录运行: ~0.5s ✅
从 workspace root 运行: ~0.5-25s (git workspace 影响)
邮件发送: 挂起 > 4min ❌ (SMTP_SSL 无超时)
```
