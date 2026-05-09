# 脚本-系统依赖自动治理：架构重构方案

> 基准文档：`2026-05-09-governance-risk-analysis.md` + `2026-05-09-auto-governance-design.md`
> 重构原则：**危险点最小化、可最优管理、程序强制执行**
> 版本：v1.0 | 2026-05-09

---

## 一、重构后的架构总图

### 1.1 核心架构（ASCII文本版）

```
┌──────────────────────────────────────────────────────────────────────┐
│                     重构后的治理架构（去单点化）                        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────────── 写入路径 ──────────────────────────────┐    │
│  │                                                               │    │
│  │   运维 CLI                                                    │    │
│  │   hermes registry set xuanyi.status=offline                   │    │
│  │        │                                                      │    │
│  │        ▼                                                      │    │
│  │   ┌─────────────────┐    原子写入（tmp+fsync+rename）         │    │
│  │   │  Registry SQLite │◀─── 每次修改自动备份到 backups/         │    │
│  │   │  (WAL 模式)      │     Git auto-commit 作为审计历史        │    │
│  │   └────────┬────────┘                                         │    │
│  │            │                                                   │    │
│  │            ├──▶ backups/registry-{timestamp}.json (自动)        │    │
│  │            ├──▶ git auto-commit (审计轨迹)                      │    │
│  │            └──▶ inotify → notify-daemon (轻量通知)              │    │
│  │                                                               │    │
│  └───────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌────────────────────── 读取路径（每个脚本独立） ───────────────┐    │
│  │                                                               │    │
│  │   cron 触发 / PM2 进程 / 手动执行                               │    │
│  │        │                                                      │    │
│  │        ▼                                                      │    │
│  │   ┌──────────────────────────────────────┐                    │    │
│  │   │  governance.loadRegistry()           │                    │    │
│  │   │                                      │                    │    │
│  │   │  1. 尝试 SQLite（主路径）              │                    │    │
│  │   │     ↓ 失败                            │                    │    │
│  │   │  2. 尝试 JSON 文件缓存（.cache/）       │                    │    │
│  │   │     ↓ 失败                            │                    │    │
│  │   │  3. 降级模式：空 Registry               │                    │    │
│  │   │     → 所有系统标记 online               │                    │    │
│  │   │     → 脚本正常运行，不做治理判断          │                    │    │
│  │   │     → 记录 WARN + 发送告警              │                    │    │
│  │   └──────────────────────────────────────┘                    │    │
│  │        │                                                      │    │
│  │        ▼                                                      │    │
│  │   ┌──────────────────────────────────────┐                    │    │
│  │   │  validateCompliance(registry, id)    │                    │    │
│  │   │                                      │                    │    │
│  │   │  已登记脚本 → 正常治理（状态检查/凭证）   │                    │    │
│  │   │  未登记脚本 → fail-open（放行+强制审计）│                    │    │
│  │   └──────────────────────────────────────┘                    │    │
│  │        │                                                      │    │
│  │        ▼                                                      │    │
│  │   脚本正常执行（治理层不阻断执行，只控制告警决策）                │    │
│  │                                                                 │
│  └───────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌────────────────────── 通知机制 ──────────────────────────────┐    │
│  │                                                               │    │
│  │   Registry SQLite 变更                                        │    │
│  │        │                                                      │    │
│  │        ▼                                                      │    │
│  │   ┌──────────────────┐     ┌─────────────────────┐           │    │
│  │   │  notify-daemon   │────▶│  文件 mtime 信号     │           │    │
│  │   │  (inotify 监听)  │     │  /tmp/registry-      │           │    │
│  │   │                  │     │  updated.signal      │           │    │
│  │   └──────────────────┘     └─────────┬───────────┘           │    │
│  │                                      │                        │    │
│  │   长运行 PM2 脚本定期 stat() 该文件    │                        │    │
│  │   mtime 变更 → 重新加载 Registry       │                        │    │
│  │   cron 脚本每次启动自动加载             │                        │    │
│  │                                                               │    │
│  └───────────────────────────────────────────────────────────────┘    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.2 对比：原架构 vs 重构架构

```
原架构的核心问题：
┌─────────────────────────────────────────────────────────────┐
│  单一 JSON 文件                                               │
│       │                                                      │
│       ├── 损坏/误删 → ALL exit(2) → 全局宕机                  │
│       ├── 并发写入 → 读到半截 JSON                            │
│       ├── 无本地缓存 → 完全无降级                              │
│       └── Redis Pub/Sub → 新增 SPOF（Redis 也是被管系统）      │
└─────────────────────────────────────────────────────────────┘

重构后的关键变化：
┌─────────────────────────────────────────────────────────────┐
│  SQLite (WAL模式)                                            │
│       │                                                      │
│       ├── 损坏 → 降级到 JSON 缓存 → 降级到空 Registry          │
│       ├── 并发写入 → SQLite 自带 WAL 锁                       │
│       ├── 每次成功读取自动写 .cache/  本地副本                 │
│       └── inotify + signal file → 不依赖 Redis（Redis独立恢复）│
└─────────────────────────────────────────────────────────────┘
```

---

## 二、危险点矩阵（概率×影响）

### 2.1 风险热力图

```
         影响
         ↑
    致命 │  R1 ██          R7 ██      R2 ██
         │
      高 │  R3 ██    R10  ██         R8  ██
         │
      中 │  R4  ██   R5  ██    R9  ██  R11  ██
         │
      低 │       R6  ██   R12  ██
         │
         └──────────────────────────────────────→ 概率
              极低      低       中       高

图例：██ = 原架构风险等级   位置 = 重构后风险等级（应该向左下移动）
```

### 2.2 完整风险矩阵

| ID | 风险名称 | 原概率 | 原影响 | 原等级 | 缓解后概率 | 缓解后影响 | 缓解后等级 | 缓解措施 |
|----|---------|--------|--------|--------|-----------|-----------|-----------|---------|
| R1 | Registry 单点故障→全局脚本死亡 | 中 | 致命 | 🔴致命 | 极低 | 中 | 🟡中 | SQLite+本地缓存+空Registry三级降级 |
| R2 | unknown→exit(2) 阻断紧急响应 | 高 | 致命 | 🔴致命 | 极低 | 低 | 🟢低 | 改为WARN模式+强制审计fail-open |
| R3 | Shell语法错误(bootstrap.sh) | 确定 | 高 | 🔴致命 | 极低 | — | 🟢已消除 | 修复语法+静态分析CI门禁 |
| R4 | 双轨运行告警不一致(6-8周) | 高 | 中 | 🟡中高 | 中 | 低 | 🟢低 | 按系统分组+legacy标签+缩短到4周 |
| R5 | 并发写Registry读到半截JSON | 低 | 中 | 🟡中 | 极低 | — | 🟢已消除 | SQLite WAL模式自带并发安全 |
| R6 | Registry Watcher进程死亡 | 低 | 高 | 🟡中高 | 极低 | 低 | 🟢低 | PM2 auto-restart+健康检查+cron兜底 |
| R7 | Bootstrap不覆盖cron直接调用 | 高 | 致命 | 🔴致命 | 低 | 高 | 🟡高 | cron wrapper强制包装+定期扫描crontab |
| R8 | 凭证硬编码(6处)未被替换 | 中 | 高 | 🟡中高 | 低 | 中 | 🟡中 | 动态映射表+自动扫描+CI阻断 |
| R9 | Vault引入增加运维复杂度 | 中 | 中 | 🟡中 | — | — | 推迟 | 独立Phase，当前用env模式 |
| R10 | Registry路径硬编码不一致 | 中 | 高 | 🟡高 | 极低 | — | 🟢已消除 | 统一环境变量REGISTRY_PATH |
| R11 | TTL 300s对PM2脚本延迟过大 | 中 | 中 | 🟡中 | 低 | 低 | 🟢低 | signal文件(mtime)+TTL降低到60s |
| R12 | Git Hook --no-verify绕过 | 高 | 低 | 🟢低 | 高 | 低 | 🟢低 | 重新定位为辅助提醒(非强制) |
| R13 | 系统已退役但监控脚本重建僵尸 | 低 | 高 | 🟡中高 | 低 | 低 | 🟡低 | decommissioned状态+脚本前置检查 |

### 2.3 重构前后的风险总量对比

```
重构前致命风险：R1, R2, R3, R7 = 4 个致命 🔴
重构后致命风险：0 个
重构前高风险：R6, R10 = 2 个高
重构后高风险：R7（已降为高但未消除）= 1 个高
```

---

## 三、Registry替代方案深度对比

这是整个重构中最关键的架构决策。以下对比三种可行方案：

### 3.1 方案总览

| 维度 | A. SQLite嵌入式 | B. 文件+缓存方案 | C. Git-backed | D. Redis（原方案） |
|------|----------------|-----------------|--------------|-------------------|
| **并发安全** | ✅ WAL模式原生 | ⚠️ 需自行实现锁 | ❌ git merge冲突 | ⚠️ 单写者 |
| **原子写入** | ✅ 事务保证 | ⚠️ tmp+fsync+rename | ✅ git commit | ⚠️ SET单Key原子 |
| **损坏恢复** | ✅ WAL自动恢复 | ⚠️ 手动从cache恢复 | ✅ git checkout | ✅ RDB/AOF |
| **读取性能** | ✅ <1ms 索引查询 | ⚠️ 全量JSON.parse | ⚠️ 全量JSON.parse | ✅ <1ms |
| **写入性能** | ✅ <5ms | ✅ <5ms | ❌ >500ms | ✅ <1ms |
| **查询能力** | ✅ SQL灵活查询 | ❌ 只能全量加载 | ❌ 只能全量加载 | ⚠️ HGET单字段 |
| **外部依赖** | ✅ 零（SQLite内置） | ✅ 零 | ⚠️ 需要git | ❌ 需要Redis |
| **运维复杂度** | ✅ 低（文件即数据库） | ✅ 最低 | ⚠️ 中（git操作） | ⚠️ 中（Redis运维） |
| **SPOF风险** | ⚠️ 文件损坏仍有风险 | ⚠️ 文件损坏仍有风险 | ⚠️ 仓库损坏 | ⚠️ Redis宕机 |
| **降级路径** | ✅ 自动→cache→空 | ✅ 自动→空 | ⚠️ 无法降级 | ❌ Redis挂=全挂 |
| **版本审计** | ⚠️ 需额外实现 | ❌ 无 | ✅ git log原生 | ❌ 需AOF解析 |
| **通知机制** | ✅ inotify+signal | ✅ inotify | ⚠️ post-commit hook | ✅ Pub/Sub原生 |

### 3.2 推荐方案：A（SQLite嵌入式）+ B的降级能力

**核心设计**：

```
主路径：SQLite（WAL模式）
  ↓ 失败
第一降级：JSON缓存文件（上次成功加载的快照）
  ↓ 失败
第二降级：空Registry（所有系统标记online，脚本正常运行）
```

**为什么选SQLite而不是文件+缓存？**

1. **并发写入安全**：WAL模式原生支持多读单写，不需要自行实现文件锁
2. **增量查询**：不用每次加载整个JSON（对Registry而言数据量小，但架构上更正确）
3. **事务保证**：写入要么完整生效要么完全不生效，不存在读到半截JSON的窗口
4. **零运维成本**：SQLite是一个文件，和JSON文件一样简单，`apt install sqlite3` 即可
5. **WAL自动恢复**：进程崩溃后WAL自动回滚，不需要手动检查文件完整性

**为什么不是Git-backed？**

- Git commit的500ms+延迟对"脚本启动时加载"不可接受
- Git仓库损坏比SQLite文件损坏更难恢复
- 版本审计可以用单独的git auto-commit实现（写入后异步commit），不绑定到读取路径
- Git-backed将"读取路径"绑在"版本控制系统"上，违反了松耦合原则

**为什么不是Redis？**

- Redis本身就是被监控系统之一，存在循环依赖（"治理系统依赖被治理系统"）
- Redis宕机 = 所有脚本无法获取Registry状态 = 全局降级
- 增加了SPOF而非消除SPOF

### 3.3 SQLite Schema设计

```sql
-- 系统表（替代原 systems: {} 字典）
CREATE TABLE systems (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'online'
                CHECK (status IN ('online','offline','degraded','maintenance','pending','decommissioned')),
    status_since TEXT NOT NULL,
    -- status=pending: 等待首次拉起
    -- status=online: 正常运行
    -- status=offline: 故障，监控脚本应尝试修复
    -- status=degraded: 部分功能受损，降级运行
    -- status=maintenance: 维护中
    -- status=decommissioned: 主动退役，监控脚本不得重建
    alert_policy TEXT NOT NULL DEFAULT 'active'
                CHECK (alert_policy IN ('active','suppress','ratelimit')),
    endpoints   TEXT NOT NULL DEFAULT '{}',  -- JSON对象
    dependencies TEXT NOT NULL DEFAULT '[]', -- JSON数组
    owners      TEXT NOT NULL DEFAULT '[]',  -- JSON数组
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 脚本登记表（替代原 scripts_registry: {}）
-- 注意：脚本执行前应查询关联 systems.status，
-- 若为 decommissioned 则跳过执行（防止僵尸复活）
CREATE TABLE scripts_registry (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL CHECK (type IN ('js','sh','py','binary')),
    path        TEXT NOT NULL,
    systems     TEXT NOT NULL DEFAULT '[]',  -- JSON数组，关联systems.id
    entry       TEXT NOT NULL DEFAULT 'standard'
                CHECK (entry IN ('standard','legacy','exempt')),
    hash        TEXT,
    last_seen   TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 凭证引用表（替代原 credentials: {}）
CREATE TABLE credentials (
    system_id   TEXT PRIMARY KEY REFERENCES systems(id),
    source      TEXT NOT NULL CHECK (source IN ('env','vault','k8s-secret','ssm')),
    prefix      TEXT,       -- env模式的前缀
    vault_path  TEXT,       -- vault模式的路径
    fields      TEXT NOT NULL DEFAULT '[]',  -- JSON数组
    rotated_at  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 审计表（替代原 audit.violations）
CREATE TABLE audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type  TEXT NOT NULL  -- 'unregistered_run','degraded','registry_change'  -- no 'bypass' type, fail-open handles it
    script_id   TEXT,
    system_id   TEXT,
    detail      TEXT NOT NULL DEFAULT '{}',  -- JSON对象
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 索引
CREATE INDEX idx_scripts_systems ON scripts_registry(systems);
CREATE INDEX idx_audit_event_type ON audit_log(event_type, created_at);
CREATE INDEX idx_audit_script ON audit_log(script_id, created_at);
```

### 3.4 Registry写入API（原子性保证）

```javascript
// lib/governance/registry-writer.js
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REGISTRY_DB = process.env.REGISTRY_PATH || '/opt/monitors/.hermes/registry/governance.db';
const BACKUP_DIR = path.join(path.dirname(REGISTRY_DB), 'backups');
const CACHE_FILE = path.join(path.dirname(REGISTRY_DB), '.cache', 'registry-snapshot.json');
const SIGNAL_FILE = '/tmp/registry-updated.signal';

function getDB() {
  const db = new Database(REGISTRY_DB);
  db.pragma('journal_mode = WAL');         // 并发读+原子写
  db.pragma('foreign_keys = ON');          // 引用完整性
  db.pragma('busy_timeout = 3000');        // 3秒等锁
  return db;
}

async function writeRegistry(operations) {
  const db = getDB();
  try {
    // 1. 事务写入
    const writeTransaction = db.transaction(() => {
      for (const op of operations) {
        // op: { table, action: 'upsert'|'delete', data }
        switch (op.action) {
          case 'upsert':
            db.prepare(`INSERT OR REPLACE INTO ${op.table} ...`).run(op.data);
            break;
          case 'delete':
            db.prepare(`DELETE FROM ${op.table} WHERE id = ?`).run(op.id);
            break;
        }
      }
    });
    writeTransaction();

    // 2. 更新缓存快照（供降级使用）
    const snapshot = exportSnapshot(db);
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(snapshot, null, 2));

    // 3. 自动备份
    const backupFile = path.join(BACKUP_DIR, `registry-${Date.now()}.db`);
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    db.backup(backupFile);

    // 4. 异步 Git commit（不阻塞写入路径）
    setImmediate(() => {
      try {
        execSync(`cd ${path.dirname(REGISTRY_DB)} && git add governance.db && git commit -m "auto: registry update"`, {
          timeout: 10000
        });
      } catch (e) { /* 静默失败，Git不可用时不影响主路径 */ }
    });

    // 5. 写信号文件（通知长运行脚本）
    fs.writeFileSync(SIGNAL_FILE, Date.now().toString());

    // 6. 审计日志
    db.prepare(`INSERT INTO audit_log (event_type, detail) VALUES (?, ?)`)
      .run('registry_change', JSON.stringify({ operation_count: operations.length }));

    return { success: true };
  } finally {
    db.close();
  }
}
```

---

## 四、三层防线的重新定位

### 4.1 原设计的问题

```
原设计声称：
  L1 (Git Hook) ──→ 阻止不合规脚本进入仓库
  L2 (CI 门禁)  ──→ 阻止不合规代码合入主分支
  L3 (Runtime)  ──→ 阻止未登记脚本运行

实际情况：
  L1 → --no-verify 一键绕过，价值最低
  L2 → 只覆盖PR/Merge，不覆盖cron直接调用
  L3 → 真正起作用的唯一层，但Registry是SPOF
```

### 4.2 重构后的三层定位

```
┌──────────────────────────────────────────────────────────────┐
│                重构后的三层防线（重新定位）                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  L1: 开发时提醒层 (Dev-Time Nudge)                            │
│  ┌────────────────────────────────────────────────────┐      │
│  │  定位: 辅助提醒，非强制阻断                          │      │
│  │  价值: 在 commit 时提醒开发者"这个脚本还没登记"       │      │
│  │  强制力: 低（接受 --no-verify）                      │      │
│  │  覆盖: Git提交的新增/修改脚本                         │      │
│  │  无法覆盖: cron直接调用、服务器上直接编辑              │      │
│  │  ★ 真实作用: 减少"忘记登记"而非"阻止绕过"            │      │
│  └────────────────────────────────────────────────────┘      │
│                                                              │
│  L2: CI质量门 (CI Quality Gate)                               │
│  ┌────────────────────────────────────────────────────┐      │
│  │  定位: 自动化质量检查，非安全强制                     │      │
│  │  价值: 自动发现未登记脚本、硬编码凭证、hash不一致       │      │
│  │  强制力: 中（PR/Merge时阻断，但可admin override）     │      │
│  │  覆盖: 通过Git工作流的代码变更                        │      │
│  │  无法覆盖: 直接push main、cron直接调用                │      │
│  │  ★ 真实作用: 自动扫描 → 发现问题 → 自动修复/告警       │      │
│  └────────────────────────────────────────────────────┘      │
│                                                              │
│  L3: 运行时治理层 (Runtime Governance) ★ 唯一强制层           │
│  ┌────────────────────────────────────────────────────┐      │
│  │  定位: 运行时行为治理，不可绕过（通过cron wrapper）     │      │
│  │  价值: 实时控制脚本行为（系统离线→静默告警）            │      │
│  │  强制力: 高（所有cron+PM2入口统一收敛）                │      │
│  │  覆盖: 100%执行路径（见第五节）                       │      │
│  │  降级: Registry不可用时→本地缓存→空Registry           │      │
│  │  ★ 真实作用: 告警决策层的集中控制                      │      │
│  └────────────────────────────────────────────────────┘      │
│                                                              │
│  核心原则：永远可以执行，谁来发告警由治理层决定                  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 4.3 L1/L2的增强：从"名不副实"到"真正有价值"

| 增强项 | 原方案 | 重构方案 |
|--------|--------|---------|
| L1 Git Hook | 阻断式（--no-verify一击即溃） | **自动修复式**：发现未登记→自动调用`hermes registry register-script`→如果成功则继续commit，失败才提示 |
| L2 CI | 仅扫描+阻断 | **扫描+自动修复+报告**：自动登记的脚本不会阻断构建；只有无法自动修复的（如硬编码凭证）才阻断 |
| 新增L1.5 | 无 | **crontab扫描器**：每日定时扫描crontab，发现直接调用脚本→自动替换为wrapper调用→发通知确认 |
| 新增L2.5 | 无 | **Registry一致性定时校验**：每小时对比crontab/PM2配置与实际Registry，发现漂移→自动修复或告警 |

---

## 五、五个核心问题的解决方案

### 5.1 如何消除Registry单点故障？

**方案：三级降级路径 + SQLite WAL + 信号文件**

```
┌──────────────────────────────────────────────────────────┐
│  每个脚本启动时的 loadRegistry() 逻辑                       │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  function loadRegistry(opts = {}) {                      │
│                                                          │
│    // 第一级：SQLite主路径                                │
│    try {                                                 │
│      const db = openRegistryDB();                        │
│      const registry = queryAll(db);                      │
│      writeSnapshotCache(registry);  // 异步写缓存         │
│      return registry;                                    │
│    } catch (err1) {                                      │
│      log.warn('Registry SQLite 不可用，尝试缓存', err1);   │
│                                                          │
│      // 第二级：JSON缓存文件                              │
│      try {                                               │
│        const cached = JSON.parse(                        │
│          fs.readFileSync(CACHE_FILE)                      │
│        );                                                │
│        log.warn('使用本地缓存（可能过期）');                │
│        return cached;                                    │
│      } catch (err2) {                                    │
│        log.error('Registry 缓存也不可用，进入降级模式');   │
│        sendAlert('governance_degraded');                 │
│                                                          │
│        // 第三级：空Registry（降级模式）                   │
│        return EMPTY_REGISTRY;  // 所有系统标记online      │
│      }                                                   │
│    }                                                     │
│  }                                                       │
│                                                          │
└──────────────────────────────────────────────────────────┘

降级保障链：
  SQLite.db → .cache/registry-snapshot.json → EMPTY_REGISTRY
  主路径       自动生成（每次成功加载后写入）     硬编码空对象
  故障概率低   故障概率极低                      不会故障
```

**关键设计决策**：

| 决策 | 选择 | 理由 |
|------|------|------|
| 阻断 vs 降级 | **降级** | Registry故障时脚本"继续运行"比"全部死亡"更安全 |
| 缓存从哪里来 | **每次成功加载后自动写入** | 无额外运维步骤，始终有最近可用的快照 |
| 降级模式行为 | **所有系统标记online，不做治理判断** | 宁可多发告警也不遗漏告警（fail-open） |
| 降级告警 | **立即发送P1告警** | 运维需要知道"治理系统降级了，告警可能不准" |

### 5.2 Bootstrap L3如何覆盖所有cron路径？

**方案：cron wrapper统一拦截 + 被动扫描兜底**

**Step 1：统一cron wrapper**

```bash
#!/bin/bash
# /opt/monitors/cron-wrapper.sh
# 替代所有 crontab 中的直接脚本调用
# 这是 L3 覆盖的物理保证：只要 crontab 指向这里，就必然经过治理

export REGISTRY_PATH="${REGISTRY_PATH:-/opt/monitors/.hermes/registry/governance.db}"
export SCRIPT_ID="$1"
shift

# 加载治理库并执行
exec node /opt/monitors/monitor-bootstrap.js --script="$SCRIPT_ID" "$@"
```

**Step 2：批量迁移13个cron条目**

```cron
# 迁移前（直接调用，绕过L3）
# */5 * * * * cd memory-system && node scripts/recall-live-monitor.js --alert
# 0 9 * * *   /usr/bin/timeout 60 .../skill-update-checker.sh
# * * * * *   cd workspace && node scripts/feedback-watcher.js

# 迁移后（通过wrapper，必然经过L3）
*/5 * * * * /opt/monitors/cron-wrapper.sh recall-live-monitor --alert
0 9 * * *   /opt/monitors/cron-wrapper.sh skill-update-checker
* * * * *   /opt/monitors/cron-wrapper.sh feedback-watcher
```

**Step 3：被动扫描兜底（每日自动）**

```bash
#!/bin/bash
# cron-scan.sh — 每日检查crontab是否还有未收敛的直接调用
# 放入 cron.daily

CURRENT_CRON=$(crontab -l 2>/dev/null)
DIRECT_CALLS=$(echo "$CURRENT_CRON" | grep -v '^#' | grep -v 'cron-wrapper.sh' | grep -E '(node|python|\.sh|\.py|\.js)')

if [ -n "$DIRECT_CALLS" ]; then
    echo "[GOVERNANCE] 发现未收敛的cron直接调用:" >&2
    echo "$DIRECT_CALLS" >&2
    # 发送告警通知运维
    hermes alert governance:cron_unconverged "$DIRECT_CALLS"
fi
```

**覆盖保证矩阵**：

| 执行入口 | 原架构覆盖 | 重构后覆盖 | 覆盖方式 |
|---------|-----------|-----------|---------|
| cron → 脚本 | ❌ 直接调用绕过 | ✅ 100% | cron wrapper强制拦截 |
| PM2 → 脚本 | ⚠️ 需逐个改PM2配置 | ✅ 100% | PM2配置指向wrapper |
| 手动 node x.js | ❌ 绕过 | ⚠️ 告警不阻断 | 被动扫描发现 |
| 手动 bash x.sh | ❌ 绕过 | ⚠️ 告警不阻断 | 被动扫描发现 |
| Systemd timer | ❌ 绕过 | ✅ 100% | 指向wrapper |
| Git Hook触发 | ❌ 绕过 | ⚠️ 半覆盖 | 脚本规范+CI检测 |

**关键：手动执行不强制阻断。强制阻断只在自动化路径上生效。**

### 5.3 fail-open：未知脚本直接放行 + 强制审计

**核心决策：不做 SEAL，做 fail-open**

| 对比 | SEAL（免死金牌） | fail-open（直接放行） |
|------|-----------------|---------------------|
| 紧急场景 | 需人工激活 bypass | 不需要任何操作 |
| 架构复杂度 | 高（bypass 逻辑） | 低（无特殊路径） |
| 审计 | 有 | 有 |
| 攻击面 | bypass 本身是攻击面 | 无特殊后门 |

**结论**：fail-open 方向更干净。治理系统永远不「杀死」被管理的脚本。

```
脚本执行
  ↓
检查 Registry
  ↓
┌─ 已登记？──是──→ 正常执行 + 记录
└─ 未登记？──否──→ 放行 + 强制写 audit_log
                         ↓
                   记录：谁/何时/为何没登记
                   脚本继续执行（不阻断）
```

**为什么 fail-open 够用**：

1. **紧急场景不需要任何操作** — 脚本直接跑，审计自动记
2. **事后追溯** — audit_log 里有完整记录，逃不掉
3. **长期治理** — 没登记的脚本慢慢补登记，存量越来越少
4. **消除悖论** — 治理系统永远不会「杀死」被管理的脚本


### 5.4 Git Hook / CI的真正价值定位

**结论：从"防线"重构为"自动化助手"**

```
┌──────────────────────────────────────────────────────────────┐
│           Git Hook / CI 的新定位：自动化助手而非防线            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  原定位（名不副实）：                                          │
│    "L1+L2让不合规的脚本进不来" → 实际上--no-verify可绕过       │
│                                                              │
│  新定位（诚实的）：                                            │
│    "L1+L2在开发者工作流中自动发现问题并尝试修复"                 │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐     │
│  │              工作流重塑                               │     │
│  │                                                     │     │
│  │  开发者写新脚本 monitor-new.js                       │     │
│  │       │                                             │     │
│  │       ▼                                             │     │
│  │  git add monitor-new.js                             │     │
│  │       │                                             │     │
│  │       ▼                                             │     │
│  │  git commit -m "add new monitor"                    │     │
│  │       │                                             │     │
│  │       ▼                                             │     │
│  │  ┌─────────────────────────────────────┐            │     │
│  │  │  PRE-COMMIT HOOK (自动化助手)        │            │     │
│  │  │                                      │            │     │
│  │  │  1. 扫描变更文件中的脚本              │            │     │
│  │  │  2. 发现未登记 → 自动登记到Registry  │ ← 关键变化  │     │
│  │  │  3. 发现硬编码凭证 → 警告（不阻断）    │            │     │
│  │  │  4. 发现不使用bootstrap → 自动注入    │            │     │
│  │  │  5. 输出友好报告                      │            │     │
│  │  └─────────────────────────────────────┘            │     │
│  │       │                                             │     │
│  │       ▼                                             │     │
│  │  提交成功（Registry可能已被自动更新）                  │     │
│  │       │                                             │     │
│  │       ▼                                             │     │
│  │  git push → 创建 PR                                 │     │
│  │       │                                             │     │
│  │       ▼                                             │     │
│  │  ┌─────────────────────────────────────┐            │     │
│  │  │  CI PIPELINE (深度扫描+自动修复)      │            │     │
│  │  │                                      │            │     │
│  │  │  1. Registry完整性校验               │            │     │
│  │  │  2. 硬编码凭证扫描（阻断！）           │ ← 真正强制  │     │
│  │  │  3. Hash一致性检查                   │            │     │
│  │  │  4. 跨脚本依赖分析                   │            │     │
│  │  │  5. 生成治理报告，贴在PR评论里         │            │     │
│  │  └─────────────────────────────────────┘            │     │
│  │                                                     │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                              │
│  ★ 核心转变：阻断点从"是否登记"移到"是否有安全风险"            │
│     - 未登记 → 自动修复（不阻断）                              │
│     - 硬编码凭证 → 阻断（安全红线）                            │
│     - Hash不一致 → 警告（可能正常改动）                        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**新CI规则矩阵**：

| 检查项 | 原行为 | 新行为 | 理由 |
|--------|--------|--------|------|
| 脚本未在Registry登记 | 阻断 | **自动登记 → 放行** | 减少开发阻力，自动收敛 |
| 硬编码凭证（高熵+模式匹配） | 阻断 | **阻断** | 安全红线，不可自动修复 |
| 脚本不使用bootstrap入口 | 阻断(非legacy) | **自动注入 → 放行** | 自动添加bootstrap调用 |
| Registry hash与实际不一致 | 阻断 | **警告** | 可能是正常改动 |
| Registry JSON schema错误 | 阻断 | **阻断** | 数据完整性 |
| 系统status与实际可达性不一致 | 无检查 | **警告** | drift检测（新增） |

### 5.5 Registry变更通知的最优路径

**方案对比与推荐：信号文件（inotify + mtime polling）**

```
┌──────────────────────────────────────────────────────────────┐
│            Registry变更通知方案对比                              │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  方案A：文件轮询（stat mtime）                                 │
│  ┌─────────────────────────────────────────────────────┐     │
│  │  notify-daemon 写 /tmp/registry-updated.signal      │     │
│  │  长运行脚本每 N 秒 stat() 该文件                      │     │
│  │  mtime变更 → 重新加载Registry                        │     │
│  │                                                     │     │
│  │  延迟: N秒（可配置）                                  │     │
│  │  依赖: 文件系统（可用性99.999%）                       │     │
│  │  SPOF: 无（文件系统故障=服务器故障）                   │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                              │
│  方案B：inotify（内核事件）                                    │
│  ┌─────────────────────────────────────────────────────┐     │
│  │  notify-daemon 用 fs.watch 监听 SQLite 文件          │     │
│  │  变更后立即写 signal 文件                              │     │
│  │  脚本侧仍通过 signal 文件感知（不直接依赖inotify）      │     │
│  │                                                     │     │
│  │  延迟: <100ms（通知daemon） + N秒（脚本检测）          │     │
│  │  依赖: 内核inotify（几乎所有Linux）                    │     │
│  │  SPOF: notify-daemon进程（PM2 auto-restart兜底）      │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                              │
│  方案C：Redis Pub/Sub（原设计）                                │
│  ┌─────────────────────────────────────────────────────┐     │
│  │  notify-daemon → Redis PUBLISH → 脚本 SUBSCRIBE     │     │
│  │  变更后脚本立即收到通知                                │     │
│  │                                                     │     │
│  │  延迟: <10ms                                         │     │
│  │  依赖: Redis服务（可用性取决于Redis运维质量）           │     │
│  │  SPOF: Redis（如果Redis挂→通知中断→脚本降级到TTL）     │     │
│  │  循环依赖: Redis本身是被监控系统之一                   │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ★ 推荐方案：B（inotify + signal文件）                        │
│                                                              │
│  理由：                                                       │
│  1. 零新增依赖（文件系统天然存在）                              │
│  2. 无循环依赖（不依赖Redis）                                  │
│  3. notify-daemon挂了→脚本降级到TTL轮询→不受影响               │
│  4. 延迟可接受：cron脚本本身就是定时触发，对延迟不敏感；        │
│     PM2脚本的60s TTL足以满足"系统下线→停止告警"的需求          │
│  5. Redis Pub/Sub保留为可选增强（日后可插拔接入）               │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**实现：**

```javascript
// notify-daemon.js（轻量守护进程）
const fs = require('fs');
const path = require('path');

const REGISTRY_DB = process.env.REGISTRY_PATH || '/opt/monitors/.hermes/registry/governance.db';
const SIGNAL_FILE = '/tmp/registry-updated.signal';

let watcher;
let reconnectTimer;

function startWatching() {
  watcher = fs.watch(path.dirname(REGISTRY_DB), (eventType, filename) => {
    if (filename === path.basename(REGISTRY_DB) && eventType === 'change') {
      // 去重：100ms 内的多次change合并为一次
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        fs.writeFileSync(SIGNAL_FILE, Date.now().toString());
      }, 100);
    }
  });

  watcher.on('error', (err) => {
    console.error('[notify-daemon] fs.watch error:', err);
    // PM2 will restart us
    process.exit(1);
  });
}

startWatching();

// 优雅退出
process.on('SIGTERM', () => { if (watcher) watcher.close(); process.exit(0); });
```

---

## 六、分阶段实施路径

### 6.1 总体路线图

```
Week  1-2       Week  3-4        Week  5-6        Week  7-8
┌──────────┐   ┌──────────┐    ┌──────────┐    ┌──────────┐
│ Phase 1  │   │ Phase 2  │    │ Phase 3  │    │ Phase 4  │
│ 地基重建 │──▶│ 入口收敛 │───▶│ 全量治理 │───▶│ 收尾运营 │
│          │   │          │    │          │    │          │
│ SQLite   │   │ cron全部 │    │ 凭证迁移 │    │ 废弃清理 │
│ 降级机制 │   │ 走wrapper│    │ 全量接入 │    │ 审计闭环 │
│ 语法修复 │   │ fail-open上线 │ │ 强制模式 │    │ 文档归档 │
│ 原子写入 │   │ PM2收敛  │    │ CI升级   │    │ 技能沉淀 │
└──────────┘   └──────────┘    └──────────┘    └──────────┘
  2周            2周              2周              2周
```

### 6.2 Phase 1：地基重建（Week 1-2）

**目标：消除SPOF，建立降级能力，修复已知bug**

```
□ Phase 1.1：Registry基础设施重建
  ├── □ 创建 SQLite Schema（governance.db）
  ├── □ 实现 Registry 写入API（原子事务+备份+git auto-commit）
  ├── □ 实现 loadRegistry() 三级降级（SQLite→缓存→空Registry）
  ├── □ 实现 validateCompliance() 改为WARN模式（不exit(2)）
  ├── □ 实现信号文件通知机制（notify-daemon.js）
  └── □ PM2配置：notify-daemon 自动重启

□ Phase 1.2：修复已知致命bug
  ├── □ 修复 bootstrap.sh 间接引用语法（${!${PREFIX}...} → 两步）
  ├── □ 统一 REGISTRY_PATH 为环境变量（不再硬编码路径）
  ├── □ 添加 bash -n 语法检查到CI
  └── □ 添加 SQLite schema 迁移脚本

□ Phase 1.3：数据迁移
  ├── □ 将原 system-registry.json 数据导入 SQLite
  ├── □ 登记28个脚本到 scripts_registry 表
  ├── □ 标记已下线系统（玄一、四院、天道旧）
  └── □ 标记6处硬编码凭证脚本

□ Phase 1.4：验证
  ├── □ 单元测试：三级降级路径
  ├── □ 集成测试：Registry 文件损坏 → 脚本仍运行
  ├── □ 压力测试：100并发读取SQLite（WAL模式验证）
  └── □ 回滚演练：SQLite → JSON文件恢复
```

**Phase 1完成标准**：
- Registry故障时脚本不死亡（降级运行）
- 所有28个脚本在Registry中有记录
- bootstrap.sh语法正确
- 原子写入+自动备份生效

### 6.3 Phase 2：入口收敛（Week 3-4）

**目标：100%自动化执行路径经过治理层**

```
□ Phase 2.1：cron wrapper部署
  ├── □ 编写 cron-wrapper.sh
  ├── □ 迁移13个cron条目（逐个替换，每替换一个验证一个）
  ├── □ 部署 cron-scan.sh（每日自动扫描未收敛的cron直接调用）
  └── □ 告警规则：发现未收敛cron调用 → P2通知

□ Phase 2.2：PM2入口收敛 + 系统退役机制
  ├── □ 修改PM2配置：所有managed脚本经过bootstrap
  ├── □ PM2进程逐个 reload（非 restart，避免中断）
  ├── □ 验证：PM2 status → 所有进程正常运行
  └── □ 系统退役机制：scripts执行前检查关联system.status=status=decommissioned则跳过

□ Phase 2.3：fail-open上线
  ├── □ 所有 legacy 脚本在 crontab 注释标记 # LEGACY
  ├── □ 告警平台：legacy告警标记 [LEGACY]
  ├── □ 按系统分组接入（主脑记忆系统4脚本第一批）
  └── □ 监控指标：覆盖率 = wrapper调用数 / 总执行数
```

**Phase 2完成标准**：
- 所有cron调用经过cron-wrapper
- 所有PM2脚本经过bootstrap
- fail-open机制可用且已文档化
- 覆盖率 > 95%

### 6.4 Phase 3：全量治理（Week 5-6）

**目标：凭证迁移、强制模式启用、CI升级**

```
□ Phase 3.1：凭证管理
  ├── □ 实现从Registry SQLite动态生成凭证映射（不再硬编码CREDENTIAL_KEYS）
  ├── □ 迁移6处硬编码凭证到env模式
  ├── □ 实现凭证自动扫描（CI中检测硬编码凭证）
  └── □ Vault评估：独立文档，不在本Phase实现

□ Phase 3.2：强制模式渐进开启
  ├── □ 按系统分组逐步启用 enforce 模式
  │     Wave 1: 主脑记忆系统（已验证稳定）
  │     Wave 2: 四院系统
  │     Wave 3: 其余系统
  ├── □ enforce模式：已登记脚本 → 正常治理
  │     未登记脚本 → WARN（不阻断，但发送P2告警）
  └── □ 每个Wave后观察2天无异常再继续

□ Phase 3.3：CI升级
  ├── □ Pre-commit hook → 自动登记+自动注入bootstrap
  ├── □ CI pipeline → 硬编码凭证阻断（唯一强制阻断项）
  ├── □ CI pipeline → 自动生成治理报告贴到PR评论
  └── □ 每日 drift-check → 自动修复可修复项

□ Phase 3.4：监控与告警
  ├── □ Grafana dashboard：治理覆盖率、降级次数、未登记脚本运行次数
  ├── □ 告警规则：Registry降级超过5分钟 → P1
  └── □ 告警规则：未登记脚本运行 → 通知团队
```

**Phase 3完成标准**：
- 6处硬编码凭证迁移完成
- 所有系统 enforce 模式开启
- CI自动修复率 > 80%
- 告警噪音降低（系统下线后相关告警静默）

### 6.5 Phase 4：收尾运营（Week 7-8）

**目标：清理、归档、知识沉淀**

```
□ Phase 4.1：清理
  ├── □ 废弃旧告警规则
  ├── □ 删除旧 crontab 条目（已迁移到wrapper的）
  ├── □ 归档旧 JSON Registry（数据已迁移到SQLite）
  └── □ 清理临时文件和调试日志

□ Phase 4.2：审计闭环
  ├── □ 审计日志完整性检查
  ├── □ 生成治理系统运行报告（覆盖率、降级事件、未登记脚本运行次数）
  └── □ 运维培训（fail-open机制、新增系统登记流程）

□ Phase 4.3：文档归档
  ├── □ 运维手册：cron管理、fail-open机制、故障恢复
  ├── □ 开发手册：如何新增脚本、如何接入bootstrap
  └── □ 架构文档：最终状态完整文档

□ Phase 4.4：知识沉淀
  ├── □ 创建 skill：governance-system（运维技能）
  └── □ 记录已知问题和规避方案
```

---

## 七、每个风险点的明确缓解措施

| 风险ID | 风险 | 缓解措施 | 负责人 | 验证方式 |
|--------|------|---------|--------|---------|
| R1 | Registry SPOF→全局死亡 | 三级降级（SQLite→缓存→空Registry） | Phase 1.1 | 删除governance.db → 验证脚本仍运行 |
| R2 | unknown→exit(2)阻断 | WARN模式替代exit(2)；fail-open+强制审计 | Phase 1.1 | 运行未登记脚本 → 验证不阻断 |
| R3 | Shell语法错误 | 修复两步间接引用；CI添加bash -n | Phase 1.2 | bash -n bootstrap.sh |
| R4 | 双轨混乱6-8周 | 按系统分组接入；legacy标签；4周完成 | Phase 2.4 | 检查所有legacy脚本有标签 |
| R5 | 并发写半截JSON | SQLite WAL事务保证原子写入 | Phase 1.1 | 并发写入测试 |
| R6 | Watcher进程死亡 | PM2 auto-restart；信号文件兜底 | Phase 1.1 | kill watcher → 验证PM2重启 |
| R7 | cron直接调用绕过 | cron-wrapper强制拦截；每日扫描兜底 | Phase 2.1 | grep crontab → 无直接调用 |
| R8 | 凭证硬编码未替换 | 动态映射表；CI阻断硬编码凭证 | Phase 3.1 | grep硬编码凭证 → 0结果 |
| R9 | Vault增加复杂度 | 独立Phase评估；当前用env模式 | Phase 3.1 | — |
| R10 | 路径硬编码不一致 | 统一环境变量REGISTRY_PATH | Phase 1.2 | grep硬编码路径 → 0结果 |
| R11 | TTL 300s延迟大 | signal文件 + 可配置TTL（默认60s） | Phase 1.1+5.5 | 修改Registry → 60s内PM2脚本感知 |
| R12 | Git Hook绕过 | 重新定位为自动化助手；不强依赖 | Phase 3.3 | — |
| R13 | 僵尸复活 | 系统status=decommissioned；脚本执行前检查 | Phase 2.2 | 下线系统 → 监控脚本不再重建 |

---

## 八、关键设计决策汇总

| # | 决策点 | 选择 | 一句话理由 |
|---|--------|------|-----------|
| 1 | Registry存储 | **SQLite (WAL)** | 嵌入式零依赖 + 事务原子写入 + 三级降级 |
| 2 | 未登记脚本行为 | **WARN模式（放行+告警）** | 宁可多发告警不错过，Registry故障时不死 |
| 3 | 紧急脚本机制 | **fail-open（直接放行）** | 紧急场景无需任何操作，审计自动记录 |
| 4 | cron覆盖方案 | **cron-wrapper强制拦截** | 物理保证：crontab只指向wrapper |
| 5 | 变更通知 | **inotify + signal文件** | 零新增依赖，无循环依赖（不用Redis） |
| 6 | L1/L2定位 | **自动化助手（非防线）** | 自动登记 > 阻断提醒，减少开发阻力 |
| 7 | 三层防线 | **L3 = 唯一强制层** | L1/L2有价值但非强制，诚实定位 |
| 8 | 凭证方案 | **env模式（Vault独立Phase）** | 当前6处凭证量不值得引入Vault复杂度 |
| 9 | 灰度策略 | **按系统分组，4周完成** | 缩短双轨期，减少行为不一致窗口 |
| 10 | 阻断vs降级 | **永远降级不阻断** | 治理系统不应成为比被治理系统更脆弱的环节 |

---

## 九、架构原则验证

| 原则 | 验证 | 状态 |
|------|------|------|
| **危险点最小化** | SQLite+三级降级→无单点可致全局崩溃 | ✅ |
| **可最优管理** | cron wrapper+SQLite查询→管理成本低于原JSON方案 | ✅ |
| **程序强制执行** | L3运行时不可绕过（cron必须经过wrapper） | ✅ |
| **不引入新SPOF** | 不依赖Redis/消息队列/外部服务 | ✅ |
| **fail-open** | Registry故障→脚本继续运行→宁可多发不错过 | ✅ |
| **务实的强制力** | 自动化路径强制，手动路径告警不阻断 | ✅ |

---

## 十、与原始设计的差异总结

| 维度 | 原设计 | 重构方案 | 变化原因 |
|------|--------|---------|---------|
| Registry存储 | 单一JSON文件 | SQLite + JSON缓存 | 消除并发写入问题+支持查询 |
| 故障行为 | exit(2)硬阻断 | 三级降级+fail-open | 消除SPOF |
| 未登记脚本 | 阻断(exit(2)) | WARN(放行+告警) | 保留紧急响应能力 |
| 通知机制 | Redis Pub/Sub | inotify + signal文件 | 消除Redis循环依赖 |
| 三层防线 | 三层强制 | L3唯一强制，L1/L2自动化助手 | 诚实定位 |
| 凭证 | Vault + env | env（Vault独立Phase） | 降低实施复杂度 |
| cron覆盖 | 改13个cron条目 | cron wrapper全局拦截 | 保证100%覆盖 |
| 紧急机制 | 无 | fail-open+强制审计 | 紧急场景零人工干预 |
| 双轨期 | 6-8周 | 4周 | 缩短混乱窗口 |
| 降级设计 | 口头提及（未实现） | 代码实现+测试覆盖 | 从设计到落地的完整路径 |

---

> **文档版本**: v1.0
> **重构日期**: 2026-05-09
> **基准文档**: governance-risk-analysis.md + auto-governance-design.md
> **核心改动**: 去SPOF化 + 降级容错 + 务实定位 + 全路径覆盖
