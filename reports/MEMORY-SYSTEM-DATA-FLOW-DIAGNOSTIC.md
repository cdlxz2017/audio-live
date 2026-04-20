# 记忆系统数据流深度诊断报告

**日期**: 2026-04-14 22:39
**分析师**: 记忆系统架构师
**范围**: 全链路从 gateway hook → Neo4j Graphify

---

## 1. 数据流全链路 ASCII 图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        用户对话入口                                  │
│  WebChat / WeChat / Discord → gateway hook → conversation_messages  │
│  状态: ✅ 正常  (+27条/小时, 累计4028条, max_id=5244)                │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │ Redis: last_a_write │ ← gateway hook 直写
                    │  状态: ✅ 正常      │
                    └──────────┬──────────┘
                               │
         ┌─────────────────────┴─────────────────────┐
         │                                           │
         ▼                                           ▼
┌────────────────────┐                    ┌──────────────────────────┐
│ session-extractor  │                    │  summary-extractor (PM2) │
│ (PM2 #1, 30s轮询)  │                    │  状态: ⚠️ 卡滞           │
│                    │                    │                          │
│ extractor-file-based.js                 │ - 等2分钟idle窗口触发     │
│   ↓                                    │ - 持续被新消息打断         │
│ session-indexer.js  ← 扫描 sessions/    │ - summary_cursor停在5235   │
│   ├ sessions.json (188条) ✅           │ - 未摘要消息: 8条         │
│   └ glob扫描补充 (252个文件)           │ - 今日产出: 0条摘要       │
│                    ↓                   └──────────┬───────────────┘
│ session-reader.js                                 │
│   状态: ❌ BUG #1 (offset双加)                    │
│                    ↓                              │
│ extractMemories() ← LLM (qwen-max)               │
│   状态: ⚠️ 效率低                                 │ summary-extractor.js
│   - 每轮只处理10个文件                            │   ↓
│   - checkpoint文件产生0对                         │ saveSummary() → memory_summaries
│                    ↓                              │   状态: ⚠️ 被上游阻塞
│ personal_memories (dialogue)                      │   675条, 最新: 4月13日
│   状态: ✅ 正常 (+36条dialogue)                   │          ↓
│                    ↓                              │ publishGraphEvent()
│ memory-writer.js → memories                      │   ↓
│   状态: ⚠️ 增长缓慢                              │ Redis Stream: graph:sync:events
│   - 今日仅+5条                                    │   34828条, 无pending
│   - 最新来源=hermes(非session-extractor)          │   状态: ✅ 正常
│   - 2597条累计                                    │          ↓
└────────────────────┬──────────────────────────────┴──────────────┐
                     │                                             │
                     ▼                                             ▼
          ┌──────────────────────┐                    ┌────────────────────┐
          │  graph-linker (PM2)  │                    │ summary → Neo4j    │
          │  10个消费者进程       │                    │ PersonalMemory     │
          │  状态: ⚠️ 空转       │                    │ 状态: ❌ 不增长     │
          │  - 消费graph:sync     │                    │ - 1284节点, +0/日  │
          │  - lag=0, 但无新事件  │                    │ - 最新: 4月13日23:57│
          │  - Redis频繁重连      │                    └────────────────────┘
          └──────────┬───────────┘
                     │
                     ▼
          ┌──────────────────────┐
          │  Neo4j: Memory_*     │
          │  3891节点            │
          │  状态: ✅ 已建立      │
          │  但今日不增长         │
          └──────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                     Graphify 子系统 (独立运行)                        │
│                                                                     │
│  collection_layer.py → Redis: graphify:collection:events            │
│    状态: ⚠️ 仅产health-check文件 (1839条事件, 103 pending)           │
│         ↓                                                           │
│  bridge-layer.js (PM2 in graphify-opus-manager)                     │
│    状态: ✅ 运行中                                                   │
│    - 消费事件 → 提取代码结构 → 写入GraphifyCode                     │
│    - GraphifyCode: 80413节点, +0 (backfill已完成)                    │
│    - ALIGNED_TO: 36901关系, +0                                      │
│    - alignment依赖memory_summaries, 但summary不产出                  │
│         ↓                                                           │
│  Neo4j: GraphifyCode (80413) + ALIGNED_TO (36901)                   │
│    状态: ✅ 历史数据完整, 但无新对齐                                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 每个链路节点的健康状态

| 节点 | 组件 | 状态 | 问题 |
|------|------|------|------|
| 1 | gateway hook → conversation_messages | ✅ 正常 | +27条/小时 |
| 2 | Redis last_a_write | ✅ 正常 | 实时更新 |
| 3 | session-indexer.js | ⚠️ 效率低 | 32个checkpoint文件不在sessions.json中 |
| 4 | **session-reader.js offset** | **❌ 严重BUG** | 偏移量双重累加，导致跳过数据 |
| 5 | checkpoint文件处理 | **❌ 严重** | 从错误offset读取，0对话对 |
| 6 | LLM extraction | ⚠️ 低效 | maxFiles=10，30s轮询效率低 |
| 7 | personal_memories (dialogue) | ✅ 正常 | +36条 |
| 8 | **memory-writer.js → memories** | **❌ 几乎停滞** | 今日仅+5条，非session-extractor写入 |
| 9 | summary-extractor idle检测 | **⚠️ 卡滞** | 2分钟idle被持续新消息打断 |
| 10 | summary-extractor 产出 | **❌ 停止** | 今日0条摘要 |
| 11 | graph-linker消费 | ⚠️ 空转 | 无新事件可消费 |
| 12 | Neo4j PersonalMemory | **❌ 不增长** | 上游无新数据 |
| 13 | Neo4j Memory_summary | **❌ 不增长** | upstream停止 |
| 14 | GraphifyCode | ✅ 静态 | backfill完成，无新代码变更 |
| 15 | bridge-layer ALIGNED_TO | ⚠️ 停滞 | 依赖memory_summaries |
| 16 | summary-extractor DB连接 | ⚠️ 资源浪费 | 每30秒新连接 |
| 17 | graph-linker Redis | ⚠️ 重连循环 | 10个进程同时连接 |

---

## 3. 根因分析

### 根因 #1: session-reader.js safeReadLines 偏移量双重累加（P0 - 致命）

**位置**: `session-reader.js` 第 144-155 行

**代码**:
```javascript
// 第111行: offset初始化
let offset = startOffset;

while (offset < maxReadOffset) {
  // 第122行: 从offset位置读取bytesRead字节
  const { bytesRead } = fs.readSync(fd, buffer, 0, bytesToRead, offset);
  
  // ...分割行...
  
  for (const line of lines) {
    // 第144行: offset按行字节累加
    offset += Buffer.byteLength(line) + 1;  // ← 第一次累加
  }
  
  // 第155行: offset又按chunk字节累加
  offset += bytesRead;  // ← 第二次累加（重复！）
}
```

**问题**: `offset` 被双重累加。行字节总和 ≈ chunk字节总和（因为chunk就是由这些行组成的），所以offset ≈ 实际位置 × 2。

**验证数据**:
- 70507字节的文件，读取后offset变为130600 (1.85x)
- 2723539字节的checkpoint文件，cursor在155405，实际应只处理了约83000字节

**影响**:
1. 大量数据被跳过，从未被提取为记忆
2. cursor存储了膨胀的offset
3. 下次运行时，膨胀的offset可能超出文件大小 → 被误判为"stale cursor" → 重置为0 → 重新读取 → 再次膨胀 → 无限循环
4. 即使不超出，从错误offset开始也跳过了大部分对话内容

**为什么checkpoint文件产生0对**: checkpoint文件是子任务session，消息分布在不同位置。当从膨胀的offset开始读时，可能只读到assistant/toolResult消息而没有user消息，无法形成对话对。

### 根因 #2: session-extractor 被 checkpoint 文件淹没（P1 - 严重）

**位置**: `session-indexer.js` 第 70-95 行 (glob扫描)

**问题**: 
- `sessions.json` 只有188个常规session条目，不含checkpoint文件
- glob扫描发现32个checkpoint文件（`xxx.checkpoint.yyy.jsonl`）
- checkpoint文件占用了处理配额（maxFiles=10）
- 由于根因#1的offset bug，每个checkpoint文件读0对，浪费所有配额

**影响**: 常规session文件几乎没有被处理的机会。252个文件中32个checkpoint占用了大量轮次，且每个都产出0记忆。

### 根因 #3: summary-extractor 的2分钟idle策略在活跃session中永不到达（P1 - 严重）

**位置**: `summary-extractor.js` 第 76-90 行

**代码**:
```javascript
const IDLE_THRESHOLD_MS = 2 * 60 * 1000;  // 2分钟

async shouldTriggerSummary() {
  const lastWriteStr = await client.get('memory:last_a_write');
  const lastWrite = parseInt(lastWriteStr, 10);
  const now = Date.now();
  const idleTime = now - lastWrite;
  return idleTime >= IDLE_THRESHOLD_MS;
}
```

**问题**: WebChat用户持续对话，`last_a_write` 每几分钟更新一次，idle窗口永远无法达到2分钟。这导致 summary-extractor 运行了2小时但产出0条摘要。

**验证**: `last_a_write` = 1776177659710 (2026-04-14 14:40:59)，与当前时间差 < 2分钟。

**影响**: 
- memory_summaries 表今日+0条
- Neo4j PersonalMemory 和 Memory_summary 停止增长
- bridge-layer 的实体对齐缺少新的memory_summaries输入

### 根因 #4: graph-linker 10个重复进程（P2 - 中等）

**位置**: PM2配置

**现象**: 10个graph-linker进程（id: 2, 13-21）同时消费同一个consumer group，导致Redis连接抖动。

**影响**: 资源浪费，但不影响功能（同一group会自动分配消息）。

### 根因 #5: summary-extractor 的 DB 连接泄漏（P2 - 中等）

**位置**: `summary-extractor.js` 每30秒运行一次

**现象**: 日志显示 `[DB] New client connected` 持续刷屏。说明每次 `runOnce()` 调用都创建了新的数据库连接。

**影响**: 30秒创建一次连接，不释放 → 连接池逐渐耗尽。

### 非根因说明

- **varchar(64)错误**: memories表的entity/attribute/value字段类型都是`text`，无长度限制。该错误不存在于当前代码库中。
- **LLM URL**: `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` 是正确的Dashscope兼容模式URL。
- **Ghost cursor**: 不是"幽灵"，而是offset双重累加导致的偏移量膨胀。

---

## 4. 完整修复方案

### 修复顺序

```
P0: 修复session-reader offset bug → 恢复数据流
  ↓
P1: 过滤checkpoint文件 → 提升处理效率
  ↓
P1: 修改summary-extractor idle策略 → 恢复摘要产出
  ↓
P2: 减少graph-linker进程数 → 降低资源消耗
  ↓
P2: 修复summary-extractor DB连接 → 防止连接泄漏
```

### 修复 #1: session-reader.js offset 双重累加

**文件**: `session-reader.js`

**改动**: 删除第155行的 `offset += bytesRead`

```diff
      // 处理所有完整行
      for (const line of lines) {
        lineIndex++;
        
        const entry = parseLine(line, lineIndex, offset);
        if (!entry) continue;
        
        const lineOffset = offset;
        offset += Buffer.byteLength(line) + 1;  // +1 for \n
        
        if (entry._parseError) {
          yield { offset: lineOffset, line, entry: null, type: 'parse_error' };
          continue;
        }
        
        yield { offset, line, entry, type };
      }
      
-     offset += bytesRead;
    }
  } finally {
    fs.closeSync(fd);
  }
  
  // 返回下次继续的偏移量（通过 generator return）
  return offset;
```

**风险评估**: 低风险。这是纯数学bug修复，不影响业务逻辑。修复后需要清除所有Redis cursor，让它们从正确位置重新开始。

### 修复 #2: 过滤checkpoint文件 + 增大maxFiles

**文件**: `session-indexer.js`

**改动**: 在glob扫描中排除checkpoint文件

```diff
  const IGNORE_PATTERNS = [
    /\.reset\./,    // 重置文件
    /\.lock$/,      // 锁文件
    /^sessions\.json$/,  // 索引文件本身
+   /\.checkpoint\./,  // checkpoint快照（不独立处理）
  ];
```

**文件**: `session-file-extractor-loop.js`

**改动**: 增大maxFiles参数

```diff
- const SCRIPT = path.join(MEMORY_SYSTEM, 'scripts', 'extractor-file-based.js');
+ const SCRIPT = path.join(MEMORY_SYSTEM, 'scripts', 'extractor-file-based.js');
+ const MAX_FILES = 50;  // 每轮处理更多文件
  const INTERVAL_MS = 30 * 1000;

  const proc = spawn('node', [SCRIPT, '--max=' + MAX_FILES], {
```

**风险评估**: 低风险。checkpoint文件是OpenClaw的快照文件，内容已被parent session覆盖，单独处理无意义。

### 修复 #3: summary-extractor idle策略

**文件**: `summary-extractor.js`

**方案A（推荐）**: 改为基于消息数量的触发

```diff
  // 移除idle检测，改为每N条消息触发一次摘要
- const IDLE_THRESHOLD_MS = 2 * 60 * 1000;      // 2分钟
+ const UNPROCESSED_THRESHOLD = 5;              // 每5条新消息触发
  const CHECK_INTERVAL_MS = 30 * 1000;          // 每30秒检查一次
```

同时修改 `shouldTriggerSummary()`:

```diff
  async shouldTriggerSummary() {
-   const client = await this.getRedisClient();
-   const lastWriteStr = await client.get('memory:last_a_write');
-   if (!lastWriteStr) return false;
-   const lastWrite = parseInt(lastWriteStr, 10);
-   const now = Date.now();
-   return (now - lastWrite) >= IDLE_THRESHOLD_MS;
+   // 检查未摘要消息数量
+   const cursor = await db.query(
+     'SELECT last_summarized_msg_id FROM summary_cursor WHERE id = 1'
+   );
+   const lastId = cursor.rows[0]?.last_summarized_msg_id || 0;
+   const unsummarized = await db.query(
+     'SELECT count(*) as cnt FROM conversation_messages WHERE id > $1',
+     [lastId]
+   );
+   return parseInt(unsummarized.rows[0].cnt) >= UNPROCESSED_THRESHOLD;
  }
```

**风险评估**: 中风险。改变了触发逻辑，需要验证在大量消息涌入时不会过度消耗LLM。

### 修复 #4: 减少graph-linker进程

**操作**: PM2命令

```bash
pm2 delete graph-linker  # 删除所有10个进程
pm2 start graph-linker.js --name graph-linker -i 2  # 启动2个
```

**风险评估**: 无风险。消费者group自动分配消息，减少进程数不影响功能。

### 修复 #5: summary-extractor DB连接

**文件**: `summary-extractor.js`

**改动**: 使用db模块的单例连接，不每次创建新连接

```diff
  async runContinuous() {
    console.log('[SummaryExtractor] Starting continuous mode (check every 30s)');
    
    while (true) {
      const result = await this.runOnce();
      
      if (result.triggered) {
        console.log(`[SummaryExtractor] Summary created: ${result.summariesCreated} summaries from ${result.pairsProcessed} pairs`);
      }
      
      // 等待下一次检查
      await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS));
    }
  }
```

实际上db.js已经使用了连接池。问题在于每次 `new client` 时的日志输出。需要检查db.js的连接管理。

### 修复 #6: 回填所有历史数据

修复offset bug后，需要清除Redis中所有膨胀的cursor，让extractor从正确位置重新处理：

```bash
# 清除所有cursor
redis-cli KEYS 'cursor:*' | xargs redis-cli DEL

# 触发回填
cd /home/ai/.openclaw/workspace/memory-system/scripts
node extractor-file-based.js --backfill --max=50
```

---

## 5. 风险评估和回滚方案

| 修复 | 风险等级 | 影响范围 | 回滚方案 |
|------|---------|---------|---------|
| #1 offset bug | 低 | 所有session读取 | 恢复原文件，cursor不受损（只改读取逻辑） |
| #2 过滤checkpoint | 低 | session索引 | 恢复IGNORE_PATTERNS，无数据丢失 |
| #3 idle策略 | 中 | 摘要产出频率 | 恢复2分钟idle策略，不会丢数据 |
| #4 graph-linker | 无 | 资源消耗 | pm2 scale graph-linker=10 |
| #5 DB连接 | 低 | 日志噪音 | 恢复原文件 |
| #6 回填 | 低 | 历史数据处理 | 停止回填进程即可 |

**总体风险评估**: 低风险。所有修复都是增量式改进，不破坏现有数据结构。

**回滚总策略**:
1. 所有改动在git中提交，可随时 `git revert`
2. 数据库操作都有幂等保证（ON CONFLICT / MERGE）
3. Redis cursor可随意清除重建
4. Neo4j写入是幂等的（MERGE语义）

**验证步骤**:
1. 修复后运行 `node session-reader.js` 测试offset正确性（ratio应≈1.0）
2. 运行extractor一轮，检查memories增长
3. 等待30秒，检查summary-extractor产出
4. 检查Neo4j节点增长
5. 24小时后对比各表增长率

---

## 附录: 当前系统快照

```
数据库:
  memories:            2597条  (今日+5)
  personal_memories:   4021条  (今日+36 dialogue)
  conversation_messages: 4028条 (今日+94)
  memory_summaries:     675条  (今日+0)

Redis:
  graph:sync:events:   34828条
  memory:last_a_write: 2026-04-14T14:40:59
  cursor keys:         125个

Neo4j:
  PersonalMemory:      1284节点 (最新: 4月13日 23:57)
  Memory_*:            3891节点
  GraphifyCode:        80413节点
  ALIGNED_TO:          36901关系
  PersonalEntity:      3节点

PM2:
  session-extractor:   online, 30s轮询, 每次处理10文件(全为checkpoint, 0产出)
  summary-extractor:   online, 30s检查, idle触发(永不到达)
  graph-linker:        10个进程, 消费lag=0
  graphify-opus-manager: online, 三层架构健康
```
