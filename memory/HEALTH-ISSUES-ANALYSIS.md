# 记忆系统健康问题分析报告

**生成时间**: 2026-04-20 21:57 GMT+8
**分析师**: Architect 子程序

---

## 问题一：summary-extractor PM2 进程崩溃循环

### 状态
- **PM2 进程名**: `summary-extractor` (id: 2)
- **当前状态**: `online`（但处于崩溃重启循环）
- **重启次数**: 565,879 次（持续增长）
- **运行时间**: 每次启动后存活约 16 秒即崩溃
- **脚本路径**: `/home/ai/.openclaw/workspace/memory-system/scripts/summary-extractor-loop.js`

### 根因

**入口文件 `summary-extractor-loop.js` 缺失**。该文件不存在于脚本目录，仅存在 `.bak` 备份文件：
```
/home/ai/.openclaw/workspace/memory-system/scripts/summary-extractor-loop.js.bak  (存在)
summary-extractor-loop.js  (不存在)
```

PM2 每次尝试启动进程时，找不到入口模块，立即 crash，触发下一次重启。形成死亡循环。

### 影响
- CPU/内存资源持续被消耗（每次 crash 前进程约占用 58MB）
- 日志文件持续写入错误堆栈
- summary-extractor 的 Neo4j PersonalMemory 同步功能完全不可用

### 修复方案
**优先级: P0（最高）**

方案A（推荐）: 从备份恢复入口文件
```bash
cp /home/ai/.openclaw/workspace/memory-system/scripts/summary-extractor-loop.js.bak \
   /home/ai/.openclaw/workspace/memory-system/scripts/summary-extractor-loop.js
pm2 restart summary-extractor
```

方案B: 更新 PM2 脚本路径指向 session-summary-extractor 入口（如果该入口更完整）

---

## 问题二：session-summary-extractor 进程未启动

### 状态
- **PM2 进程名**: `session-summary-extractor`
- **当前状态**: 未在 PM2 中注册（不存在）
- **配置文件**: `/home/ai/.openclaw/workspace/memory-system/ecosystem.session-summary.json` 存在

### 根因
`ecosystem.session-summary.json` 配置文件存在，但对应的进程从未被 PM2 启动（或已被删除）。与 `summary-extractor` 是两个独立的进程。

### 修复方案
**优先级: P1**
```bash
cd /home/ai/.openclaw/workspace/memory-system
pm2 start ecosystem.session-summary.json
```

---

## 问题三：Neo4j 认证问题

### 状态
- **错误信息**: `Unsupported authentication token, scheme 'none' is only allowed when auth is disabled.`
- **neo4j uri**: `bolt://localhost:7687`
- **neo4j user**: `undefined`（测试脚本访问路径错误）

### 根因分析

**测试脚本访问路径错误，非实际连接问题。**

Config 结构为：
```js
config.neo4j = {
  uri: 'bolt://localhost:7687',
  auth: {
    username: 'neo4j',        // 默认值，来自 process.env.NEO4J_USER
    password: 'openclaw_neo4j_2026'  // 来自 credentials/database.env
  }
}
```

测试脚本错误地访问了 `config.neo4j.user`（undefined），而不是 `config.neo4j.auth.username`。

实际运行中的脚本（`graph-linker.js`, `summary-extractor.js`）均正确使用：
```js
neo4j.auth.basic(config.neo4j.auth.username, config.neo4j.auth.password)
```

**Neo4j 认证实际工作正常。** `database.env` 中已配置 `NEO4J_PASSWORD=openclaw_neo4j_2026`，credentials loader 正常加载。

### 唯一潜在风险
`NEO4J_USER` 环境变量未在 `database.env` 中设置（只设置了 `NEO4J_PASSWORD`），依赖 `process.env.NEO4J_USER` 读取失败后的默认值 `'neo4j'`。需确认 Neo4j 服务器上的实际用户名是否为 `neo4j`。

### 修复方案
**优先级: P2**

1. 确认 Neo4j 服务器用户名（大概率就是 `neo4j`，无需修改）
2. 可选：在 `database.env` 中显式添加 `NEO4J_USER=neo4j` 以消除歧义

---

## 关联分析

| 问题 | summary-extractor 崩溃 | session-summary-extractor 未启动 | Neo4j 认证 |
|------|------------------------|-------------------------------|-----------|
| 关联性 | 直接阻塞 Neo4j PersonalMemory 同步 | 独立问题 | **非根因**，是测试脚本的误报 |
| 修复顺序 | P0（先修） | P1 | P2（无需紧急修复） |

**结论**: summary-extractor 的崩溃循环与 Neo4j 认证问题**相互独立**。summary-extractor 崩溃会导致 Neo4j 写入功能不可用，但 Neo4j 本身连接正常。两个问题需分别修复，但应优先解决 P0 崩溃问题。

---

## 修复优先级汇总

| 优先级 | 问题 | 操作 |
|--------|------|------|
| **P0** | summary-extractor 崩溃循环 | 恢复 `summary-extractor-loop.js` 并重启进程 |
| **P1** | session-summary-extractor 未启动 | 执行 `pm2 start ecosystem.session-summary.json` |
| **P2** | Neo4j 认证歧义 | 确认用户名，补充 `NEO4J_USER` 到 `database.env` |
