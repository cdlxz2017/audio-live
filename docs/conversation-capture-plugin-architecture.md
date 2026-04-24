# conversation-capture-plugin 架构设计文档

> 版本: v1.0 | 日期: 2026-04-21 | 状态: Design

---

## 1. 问题陈述

现有 `conversation_messages` 表的数据来源是 JSONL 提取器（extractor），提取的是 **enrichment 之后**的 prompt（包含系统指令、记忆注入、工具结果等拼接内容）。

**缺失**：
- 用户原始消息（未经 enrichment 的纯内容）
- assistant 的完整原始回复（包括工具调用前后的中间消息）

**目标**：在 OpenClaw hook 层直接捕获并写入原始对话到 `conversation_messages` 表。

---

## 2. 已确认的技术事实

### 2.1 OpenClaw Hook 事件结构

#### `before_dispatch`（来源：`dispatch-JNo_iJw5.js` L511）

```js
hookRunner.runBeforeDispatch({
  content: hookContext.content,      // enrichment 前的原始用户消息文本（string）
  body: hookContext.bodyForAgent ?? hookContext.body,
  channel: hookContext.channelId,   // e.g. "webchat"
  sessionKey: sessionKey,            // session 唯一标识键
  senderId: hookContext.senderId,
  isGroup: hookContext.isGroup,
  timestamp: hookContext.timestamp
}, {
  channelId, accountId, conversationId, sessionKey, senderId  // ctx
});
```

**关键**：`event.content` 是**未经 enrichment 的原始字符串**，这是唯一能拿到原始用户消息的 hook。

- **claiming hook**：返回 `{ handled: true }` 会短路消息处理流程。插件必须**不返回** handled。
- 每个新用户消息触发一次。

#### `agent_end`（来源：`pi-embedded-runner-DN0VbqlW.js` L6891）

```js
hookRunner.runAgentEnd({
  messages: messagesSnapshot,       // 完整的 user+assistant 消息数组
  success: !aborted && !promptError,
  error: promptError ? formatErrorMessage(promptError) : void 0,
  durationMs: Date.now() - promptStartedAt
}, {
  runId, agentId, sessionKey, sessionId, workspaceDir,
  messageProvider, trigger, channelId
});
```

- **void hook**：fire-and-forget，源码已 `.catch()` 处理，错误不影响主流程。
- 每个模型完成一轮处理触发一次（不是每条消息）。

### 2.2 数据库 Schema（已验证）

```sql
CREATE TABLE conversation_messages (
  id            BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  session_id    VARCHAR(100) NOT NULL,
  message_index INTEGER      NOT NULL,
  role          VARCHAR(20)  NOT NULL,
  content       TEXT         NOT NULL,
  sender_id     VARCHAR(100),
  channel       VARCHAR(50),
  metadata      JSONB        DEFAULT '{}',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  turn_index    INTEGER      NOT NULL DEFAULT 0,
  message_type  VARCHAR(20)  DEFAULT 'chat'
);

-- UNIQUE 约束（幂等键）
conversation_messages_session_turn_role_key  UNIQUE (session_id, turn_index, role)
```

**⚠️ 幂等键是 `(session_id, turn_index, role)`，不是 `(session_id, message_index, role)`。**

这意味着：对于同一 session，同一 turn_index，同一 role，**只能有一条记录**。

### 2.3 sessionKey → session_id 映射

Extractor 使用 md5 哈希将 sessionKey 转为 UUID 以保证 ID 长度可控：
```js
// multi-backfill.js 中的转换函数
function sessionIdToUuid(sessionId) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(sessionId)) return sessionId;  // 已是 UUID 直接返回
  const h = crypto.createHash('md5').update(sessionId).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}
```

插件中需要使用**相同算法**以保证 session_id 与历史数据一致。

---

## 3. 插件目录结构

```
~/.openclaw/extensions/conversation-capture-plugin/
├── index.js              # 主插件入口（CommonJS，与 problem-thread-plugin 一致）
├── openclaw.plugin.json  # 插件元数据 + configSchema
├── package.json          # npm 包信息
└── README.md             # 使用说明
```

---

## 4. 核心设计：双 Hook 协作

### 4.1 消息流

```
用户发送消息
    │
    ▼
┌──────────────────────────────────────────────────┐
│  before_dispatch hook                            │
│                                                  │
│  event.content = 原始用户消息（未 enrichment）     │
│  ctx.sessionKey → sessionIdToUuid() → session_id │
│                                                  │
│  → 查询 MAX(turn_index) + 1 = nextTurn           │
│  → INSERT user 行（幂等键锁定）                   │
│    session_id, turn_index=nextTurn, role='user'  │
│    content = event.content（原始文本）             │
└──────────────────────────────────────────────────┘
    │
    ▼  模型处理（enrichment、工具调用等）
    │
┌──────────────────────────────────────────────────┐
│  agent_end hook                                  │
│                                                  │
│  event.messages = 完整快照（含 assistant）        │
│  ctx.sessionKey → sessionIdToUuid() → session_id │
│                                                  │
│  turn_index = MAX(turn_index) — 即 before_dispatch│
│              写入时使用的 nextTurn                │
│                                                  │
│  → INSERT assistant 行                           │
│    session_id, turn_index, role='assistant'      │
│    content = 从 event.messages 提取的 assistant  │
│                                                  │
│  → UPDATE user 行 metadata（确认 metadata 完整）  │
└──────────────────────────────────────────────────┘
```

### 4.2 为什么 before_dispatch 必须捕获原始消息？

`agent_end` 的 `event.messages` 中的 user 消息**已经 enrichment 处理**（可能已被系统指令、记忆注入等修改）。

`before_dispatch` 的 `event.content` 是模型看到用户消息**之前**的内容，是真正的原始输入。

两者都需要。

### 4.3 turn_index 分配策略

**问题**：`before_dispatch` 发生时，无法预知这是第几轮。

**方案**：
```sql
SELECT COALESCE(MAX(turn_index), -1) + 1 FROM conversation_messages WHERE session_id = $1;
```
`before_dispatch` 写入时使用该值；`agent_end` 读取并确认（应与写入值一致，因同一 session 的 hooks 串行执行）。

**并发安全**：`before_dispatch` 是 per-session 串行调用的，同一 session 不会并发。

### 4.4 message_index 赋值

由于幂等键是 `(session_id, turn_index, role)`，每个 turn 每种 role **只能有一条记录**。

因此 `message_index` 在同一 turn 内恒为 0：
- `(session_id, 0, 'user')` → 1 条
- `(session_id, 0, 'assistant')` → 1 条
- `(session_id, 1, 'user')` → 1 条
- `(session_id, 1, 'assistant')` → 1 条

这与现有数据行为一致（见前文样例）。

---

## 5. 完整代码

### 5.1 index.js

```javascript
/**
 * Conversation Capture Plugin — OpenClaw
 *
 * 职责：
 *   - before_dispatch: 写入用户原始消息（enrichment 前）
 *   - agent_end: 写入 assistant 回复 + 确认 user 行 metadata
 *
 * 设计原则：
 *   - 写入失败绝不阻塞主流程（safeDbOperation 包装）
 *   - 幂等写入（ON CONFLICT DO NOTHING / DO UPDATE SET）
 *   - 不修改 OpenClaw 核心代码
 */

const { Client } = require('pg');
const crypto = require('crypto');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// sessionKey → session_id 转换（与 multi-backfill.js 一致）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function sessionIdToUuid(sessionId) {
  if (!sessionId) return '00000000-0000-0000-0000-000000000000';
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(sessionId)) return sessionId;
  const h = crypto.createHash('md5').update(sessionId).digest('hex');
  return (
    h.slice(0, 8) + '-' +
    h.slice(8, 12) + '-' +
    h.slice(12, 16) + '-' +
    h.slice(16, 20) + '-' +
    h.slice(20, 32)
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 数据库连接
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function createDbClient(config) {
  return new Client({
    host: config?.host || process.env.PGHOST || 'localhost',
    port: config?.port || parseInt(process.env.PGPORT) || 5432,
    database: config?.database || process.env.PGDATABASE || 'openclaw_memory',
    user: config?.user || process.env.PGUSER || 'openclaw_ai',
    password: config?.password || process.env.PGPASSWORD,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SQL 语句
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** 获取下一轮 turn_index */
const SQL_GET_NEXT_TURN = `
  SELECT COALESCE(MAX(turn_index), -1) + 1 AS next_turn
  FROM conversation_messages
  WHERE session_id = $1
`;

/** 确认 turn_index（用于 agent_end 读取，与 before_dispatch 的 nextTurn 一致） */
const SQL_GET_CURRENT_TURN = `
  SELECT COALESCE(MAX(turn_index), -1) AS current_turn
  FROM conversation_messages
  WHERE session_id = $1
`;

/**
 * 写入 user 消息（before_dispatch）
 * 幂等键：(session_id, turn_index, role='user')
 * ON CONFLICT DO NOTHING — 防止 before_dispatch 被调用两次（如重试）
 */
const SQL_INSERT_USER = `
  INSERT INTO conversation_messages
    (session_id, message_index, role, content, channel, metadata, turn_index, message_type)
  VALUES
    ($1, 0, 'user', $2, $3, $4, $5, 'chat')
  ON CONFLICT ON CONSTRAINT conversation_messages_session_turn_role_key
    DO NOTHING
`;

/**
 * 写入 assistant 消息（agent_end）
 * 幂等键：(session_id, turn_index, role='assistant')
 * ON CONFLICT DO NOTHING — 不覆盖已有记录
 */
const SQL_INSERT_ASSISTANT = `
  INSERT INTO conversation_messages
    (session_id, message_index, role, content, channel, metadata, turn_index, message_type)
  VALUES
    ($1, 0, 'assistant', $2, $3, $4, $5, 'chat')
  ON CONFLICT ON CONSTRAINT conversation_messages_session_turn_role_key
    DO NOTHING
`;

/**
 * 更新 user 行的 metadata（agent_end 确认后补充字段）
 * 注意：ON CONFLICT DO UPDATE 会覆盖原有 metadata
 */
const SQL_UPDATE_USER_METADATA = `
  INSERT INTO conversation_messages
    (session_id, message_index, role, content, channel, metadata, turn_index, message_type)
  VALUES
    ($1, 0, 'user', $2, $3, $4, $5, 'chat')
  ON CONFLICT ON CONSTRAINT conversation_messages_session_turn_role_key
    DO UPDATE SET metadata = EXCLUDED.metadata
`;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 工具函数
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 从消息 content 字段提取纯文本
 * 兼容 string 和 array of content blocks
 */
function extractText(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter(b => b && typeof b === 'object' && b.type === 'text')
      .map(b => b.text || '')
      .join('\n')
      .trim();
  }
  return String(content || '').trim();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 插件主入口
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

module.exports = {
  id: 'conversation-capture-plugin',
  name: 'Conversation Capture',
  description: '在 hook 层捕获原始对话消息并写入 conversation_messages 表',
  version: '1.0.0',

  register(api) {
    const logger = api.logger || console;
    const pluginConfig = api.pluginConfig || {};
    const dbConfig = (pluginConfig.database || {});
    const enabled = pluginConfig.enabled !== false;

    if (!enabled) {
      logger.info('[conversation-capture] Plugin disabled by config');
      return;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 数据库连接管理（懒初始化）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    let dbClient = null;
    let dbConnecting = null;
    let dbReady = false;

    async function ensureDb() {
      if (dbReady && dbClient) return dbClient;
      if (dbConnecting) return dbConnecting;

      dbConnecting = (async () => {
        try {
          dbClient = createDbClient(dbConfig);
          await dbClient.connect();
          dbReady = true;
          logger.info('[conversation-capture] Database connected');
          return dbClient;
        } catch (err) {
          logger.warn(`[conversation-capture] DB connect failed: ${err.message}`);
          dbConnecting = null;
          throw err;
        }
      })();

      return dbConnecting;
    }

    /**
     * 所有 DB 操作的安全包装
     * 失败时仅记录 debug 日志，不抛出异常，不阻塞主流程
     */
    async function safeDbOp(opName, fn) {
      try {
        const client = await ensureDb();
        await fn(client);
      } catch (err) {
        // 只在 debug 级别记录，避免生产日志刷屏
        logger.debug(`[conversation-capture] ${opName} error: ${err.message}`);
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Hook 1: before_dispatch
    // 捕获用户原始消息（enrichment 之前）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    api.on('before_dispatch', async (event, ctx) => {
      // ⚠️ 不要返回 { handled: true }，否则消息被短路
      const sessionKey = ctx.sessionKey || event.sessionKey;
      if (!sessionKey) return;

      const rawContent = event.content;
      if (!rawContent || typeof rawContent !== 'string' || rawContent.trim().length < 2) return;

      const sessionId = sessionIdToUuid(sessionKey);
      const channel = event.channel || ctx.channelId || 'unknown';
      const senderId = event.senderId || ctx.senderId || null;
      const timestamp = event.timestamp || Date.now();

      const metadata = {
        rawSessionId: sessionKey,
        senderId,
        userTimestamp: timestamp,
        capturedBy: 'conversation-capture-plugin',
        capturedAt: 'before_dispatch',
      };

      safeDbOp('before_dispatch', async (client) => {
        // 查询下一个 turn_index
        const { rows } = await client.query(SQL_GET_NEXT_TURN, [sessionId]);
        const nextTurn = rows[0].next_turn;

        await client.query(SQL_INSERT_USER, [
          sessionId,
          rawContent.trim(),   // 原始内容（未 enrichment）
          channel,
          JSON.stringify(metadata),
          nextTurn,
        ]);

        logger.debug(
          `[conversation-capture] before_dispatch: session=${sessionKey.slice(0, 16)}... turn=${nextTurn}`
        );
      });
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Hook 2: agent_end
    // 捕获 assistant 回复 + 确认 user 行 metadata
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    api.on('agent_end', async (event, ctx) => {
      if (!event.success) return;
      if (!event.messages || !Array.isArray(event.messages) || event.messages.length === 0) return;

      const sessionKey = ctx.sessionKey;
      if (!sessionKey) return;

      const sessionId = sessionIdToUuid(sessionKey);
      const channel = ctx.channelId || ctx.messageProvider || 'unknown';
      const durationMs = event.durationMs || 0;

      safeDbOp('agent_end', async (client) => {
        // 获取当前最大 turn_index（即 before_dispatch 写入的 nextTurn）
        const { rows } = await client.query(SQL_GET_CURRENT_TURN, [sessionId]);
        const currentTurn = rows[0].current_turn;

        if (currentTurn < 0) {
          // 没有对应的 user 行（before_dispatch 失败），跳过
          logger.debug(`[conversation-capture] agent_end: no user turn found for session`);
          return;
        }

        const assistantMsgs = event.messages.filter(
          m => m && typeof m === 'object' && m.role === 'assistant'
        );

        const userMsgs = event.messages.filter(
          m => m && typeof m === 'object' && m.role === 'user'
        );

        // 写入所有 assistant 消息（同一 turn_index，幂等跳过重复）
        for (const msg of assistantMsgs) {
          const content = extractText(msg.content);
          if (!content) continue;

          const metadata = {
            rawSessionId: sessionKey,
            capturedBy: 'conversation-capture-plugin',
            capturedAt: 'agent_end',
            turnIndex: currentTurn,
            conversationDurationMs: durationMs,
          };

          await client.query(SQL_INSERT_ASSISTANT, [
            sessionId,
            content,
            channel,
            JSON.stringify(metadata),
            currentTurn,
          ]);
        }

        // 补充/确认 user 行的 metadata（DO UPDATE SET metadata）
        for (const msg of userMsgs) {
          const content = extractText(msg.content);
          if (!content) continue;

          const metadata = {
            rawSessionId: sessionKey,
            capturedBy: 'conversation-capture-plugin',
            capturedAt: 'agent_end',
            turnIndex: currentTurn,
            conversationDurationMs: durationMs,
          };

          await client.query(SQL_UPDATE_USER_METADATA, [
            sessionId,
            content,
            channel,
            JSON.stringify(metadata),
            currentTurn,
          ]);
        }

        logger.info(
          `[conversation-capture] agent_end: session=${sessionKey.slice(0, 16)}... ` +
          `turn=${currentTurn} user=${userMsgs.length} assistant=${assistantMsgs.length} ` +
          `duration=${durationMs}ms`
        );
      });
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 服务生命周期
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    api.registerService({
      id: 'conversation-capture-plugin',
      start() {
        logger.info('[conversation-capture-plugin] Registered (lazy DB init)');
      },
      async stop() {
        if (dbClient) {
          try {
            await dbClient.end();
            dbReady = false;
            dbClient = null;
            logger.info('[conversation-capture-plugin] DB disconnected');
          } catch (err) {
            logger.warn(`[conversation-capture-plugin] Disconnect error: ${err.message}`);
          }
        }
      },
    });
  },
};
```

### 5.2 openclaw.plugin.json

```json
{
  "id": "conversation-capture-plugin",
  "name": "Conversation Capture",
  "description": "在 hook 层捕获原始对话消息并写入 conversation_messages 表",
  "version": "1.0.0",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "enabled": {
        "type": "boolean",
        "default": true,
        "description": "是否启用本插件"
      },
      "database": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "host": { "type": "string", "default": "localhost" },
          "port": { "type": "integer", "default": 5432 },
          "database": { "type": "string", "default": "openclaw_memory" },
          "user": { "type": "string", "default": "openclaw_ai" },
          "password": { "type": "string" }
        }
      }
    }
  }
}
```

### 5.3 package.json

```json
{
  "name": "conversation-capture-plugin",
  "version": "1.0.0",
  "description": "OpenClaw plugin: capture raw conversation at hook level",
  "main": "index.js",
  "dependencies": {
    "pg": "^8.13.0"
  }
}
```

---

## 6. 数据库写入 SQL 汇总

| # | 操作 | 时机 | SQL | 幂等键 |
|---|------|------|-----|--------|
| 1 | 查询 next turn | before_dispatch | `SELECT COALESCE(MAX(turn_index),-1)+1` | — |
| 2 | 写入 user | before_dispatch | `INSERT ... ON CONFLICT ... DO NOTHING` | `(session_id, turn_index, 'user')` |
| 3 | 查询 current turn | agent_end | `SELECT MAX(turn_index)` | — |
| 4 | 写入 assistant | agent_end | `INSERT ... ON CONFLICT ... DO NOTHING` | `(session_id, turn_index, 'assistant')` |
| 5 | 确认 user metadata | agent_end | `INSERT ... ON CONFLICT ... DO UPDATE SET metadata` | `(session_id, turn_index, 'user')` |

---

## 7. 危险点分析

### 7.1 🔴 高危险

| # | 危险描述 | 影响 | 缓解措施 |
|---|---------|------|----------|
| 1 | **DB 连接失败阻塞 before_dispatch** | 用户消息处理延迟 | `safeDbOp` 捕获所有异常，catch 后只写 debug 日志；before_dispatch **不返回 handled**，消息继续处理 |
| 2 | **ON CONFLICT 约束不匹配** | 唯一约束与代码假设不一致导致 23505 错误 | 已在设计阶段验证约束为 `(session_id, turn_index, role)`，使用正确的三列组合 |
| 3 | **session_id 格式与历史数据不一致** | 无法与已有数据 JOIN/聚合 | 使用 `sessionIdToUuid()`（md5 哈希），与 multi-backfill.js 算法完全一致 |
| 4 | **agent_end 的 messages 包含工具消息** | 工具调用消息被写入表 | 仅过滤 `role === 'user'` 和 `role === 'assistant'` 的消息，跳过 tool_use/tool_result/system |

### 7.2 🟡 中危险

| # | 危险描述 | 影响 | 缓解措施 |
|---|---------|------|----------|
| 5 | **before_dispatch 和 agent_end 的 turn_index 不一致** | 数据错乱 | 两者通过 `MAX(turn_index)` 确认；per-session 串行执行，无并发问题 |
| 6 | **用户连续发两条消息（无 assistant 响应）** | agent_end 拿不到 assistant，user 行 metadata 未更新 | `agent_end` 只写 assistant 和更新 user metadata；如果该轮始终无 assistant，user 行以 before_dispatch 的 metadata 结束（可接受） |
| 7 | **插件启动时 DB 未就绪** | 首次写入失败 | 懒初始化：第一次 safeDbOp 时才连接；连接失败不阻塞，debug 记录 |
| 8 | **message_index 始终为 0** | 同一 turn 内多轮 user/assistant 无法区分 | UNIQUE 约束决定每 turn 每 role 仅一条记录；如需多轮，用 turn_index 区分即可 |

### 7.3 🟢 低危险

| # | 危险描述 | 影响 | 缓解措施 |
|---|---------|------|----------|
| 9 | **插件卸载后 DB 连接未释放** | 连接池泄漏 | `registerService.stop()` 中调用 `dbClient.end()` |
| 10 | **OpenClaw 升级后 hook 接口变化** | 插件失效 | 与 memory-lancedb 使用相同 API 模式（`api.on('agent_end', ...)`），后者已验证 |
| 11 | **与 extractor 同时写入同一 session** | UNIQUE 冲突导致 DO NOTHING | extractor 写 enrichment 后的内容；插件写原始内容；即使 key 相同，两者内容不同，metadata.capturedBy 区分来源 |

### 7.4 关键设计决策

**Q: 为什么在 agent_end 中也写 user 行（DO UPDATE）？**
A: before_dispatch 写入时 metadata 缺少 `conversationDurationMs` 和 `turnIndex`（因为 assistant 还未响应）。agent_end 确认后用 DO UPDATE SET metadata 补充完整。

**Q: 为什么不把所有消息都在 agent_end 中写？**
A: agent_end 的 messages 中的 user 消息已经 enrichment 处理。唯一能拿到真正原始用户消息的时机是 before_dispatch。

**Q: 为什么用 md5(sessionKey) 做 session_id 而不是直接用 sessionKey？**
A: 历史数据（extractor 写入）全部使用 UUID 格式的 session_id。为保证查询时一致，插件必须使用相同算法。

**Q: 为什么 message_index 固定为 0？**
A: UNIQUE 约束是 `(session_id, turn_index, role)`，每个 turn 每种 role 只能有一条记录，因此 message_index 在 turn 内恒为 0。

---

## 8. 兼容性

| 组件 | 兼容性 |
|------|--------|
| memory-lancedb | ✅ 无冲突（独立 hook，各自写自己的数据库） |
| problem-thread-plugin | ✅ 无冲突（不同的 hook 时机，无共享状态） |
| extractor（JSONL） | ✅ 幂等设计保证不冲突；metadata.capturedBy 区分来源 |
| OpenClaw 升级 | ✅ 使用公开 api.on() 接口，与已验证插件模式一致 |

---

## 9. 安装与验证

```bash
# 1. 创建目录
mkdir -p ~/.openclaw/extensions/conversation-capture-plugin

# 2. 安装 pg 依赖
cd ~/.openclaw/extensions/conversation-capture-plugin
npm init -y
npm install pg

# 3. 放置文件：index.js, openclaw.plugin.json, package.json

# 4. 在 openclaw 配置中添加（参考 openclaw.plugin.json configSchema）
# 5. 重启 OpenClaw
openclaw gateway restart

# 6. 验证日志
openclaw logs 2>&1 | grep -i "conversation-capture"

# 7. 验证数据库写入
psql -h localhost -U openclaw_ai -d openclaw_memory -c "
  SELECT session_id, turn_index, role,
         LEFT(content, 80) AS preview,
         metadata->>'capturedBy' AS source
  FROM conversation_messages
  WHERE metadata->>'capturedBy' = 'conversation-capture-plugin'
  ORDER BY created_at DESC LIMIT 20;
"
```

---

## 10. 文件清单

```
conversation-capture-plugin/
├── index.js              # 主体逻辑（约 280 行）
├── openclaw.plugin.json  # 插件配置 + configSchema
└── package.json          # npm 元数据
```
