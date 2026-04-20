# Session 新建 Recall 优化方案
> 基于 Session Recall 机制对比报告 + memory-lancedb-pro + lossless-claw-enhanced 分析
> 日期：2026-04-18 | 执行人：玄枢

---

## 一、现状全景

### 1.1 我们已有的机制（before_prompt_build）

我们的 `memory-recall-plugin` 已经在 `before_prompt_build` 钩子上实现了完整的三层召回：

```
before_prompt_build 触发
    │
    ├── 步骤1: loadPreviousContext()
    │       → 从 memory_summaries 表加载上一 session 摘要（最多3条）
    │       → 从 conversation_messages 加载最近对话
    │       → 格式: [Previous Session Context]...[Previous Session Summaries]...
    │
    ├── 步骤2: preloadMemoriesForNewSession()
    │       → 用上一 session 摘要构建 query
    │       → 向量检索用户相关记忆
    │       → 格式: [Proactive: User Context Preload]...
    │
    ├── 步骤3: 语义召回（每轮prompt）
    │       → 最后4条用户消息构建query
    │       → candidateK: 话题切换时20，平时10
    │       → RecallService 召回 → Tier过滤 → buildMemoryPrompt
    │       → Graphify 代码上下文注入
    │
    └── prependContext 注入 prompt
```

### 1.2 我们缺失的机制

| 缺失项 | memory-lancedb-pro 对应方案 | lossless-claw-enhanced 对应方案 |
|--------|---------------------------|-------------------------------|
| 跨 session 上下文预热 | `before_agent_start` 注入 | LCM DAG 上下文装配 |
| 智能遗忘（衰减） | Weibull 拉伸指数衰减模型 | 无直接对应 |
| 记忆分级管理 | Core/Working/Peripheral 三层 | 无直接对应 |
| 混合检索 rerank | Cross-Encoder 精排 | 无直接对应 |
| CJK token 估算 | 无特殊处理 | 精确到字符的 token 估算 |
| Session 摘要文件系统写入 | sessionMemory hook → LanceDB | 无直接对应 |
| 启动序幕衔接 | 无（独立于 startupContext） | 无直接对应 |

### 1.3 核心问题定位

```
memory-recall-plugin 的 before_prompt_build
           │
           ↓
session-context-loader.loadPreviousContext()
           │
           ├── getLastSessionId()          ✅ 正常
           ├── loadSessionSummaryFromRedis()  ⚠️ Redis 可能无数据
           │
           └── memory_summaries 查询
                  │
                  ├─ 从 Redis 获取 session:uuid:{key} → UUID
                  │     └─ ⚠️ 若 Redis 无此映射，fallback 用 sessionIdToUuid()
                  │            └─ 这个转换可能是错的！
                  │
                  └─ SELECT summary FROM memory_summaries
                     WHERE source_session_id = UUID
                     AND is_active = TRUE
                     ORDER BY created_at DESC LIMIT 3
                         └─ ⚠️ 可能查不到，因为 UUID 不匹配
```

**最大概率故障点**：`session:uuid:{key}` 映射在 Redis 中不存在，且 `sessionIdToUuid()` 的确定性转换与 `session-summary-extractor` 写入时用的 UUID 生成方式不一致。

---

## 二、memory-lancedb-pro 可迁移技术

### 2.1 Weibull 衰减模型（decay-engine.ts）

**作用**：每次 recall 后，根据记忆的访问频率、距今时间和内在重要性，动态调整分数，使低价值记忆自然衰减。

**公式**：
```
composite = recencyWeight × recency
          + frequencyWeight × frequency
          + intrinsicWeight × intrinsic

recency   = Weibull(t, β, η)   # 时间衰减
frequency = log(access_count + 1)  # 访问次数饱和
intrinsic = importance × confidence  # 内在质量
```

**Tier 影响衰减速度**：
| Tier | β | 衰减速度 | floor |
|------|---|---------|-------|
| Core | 0.8 | 最慢 | 0.9 |
| Working | 1.0 | 中性 | 0.7 |
| Peripheral | 1.3 | 最快 | 0.5 |

**迁移方式**：在 `recall-adapter.js` 的 `recallWithContext()` 结果后，叠加 Weibull 衰减分，对结果重新排序。不改 recall 本身，只改结果排序。

### 2.2 混合检索 + Cross-Encoder Rerank

**当前我们的 RecallService**：向量检索 + BM25 并行，结果简单融合。

**memory-lancedb-pro 的改进**：
```
向量检索 → 向量分数
BM25检索 → BM25分数
融合 → 以向量分数为主，BM25 命中提供确认性加权

→ Cross-Encoder 精排（60% CE + 40% 原始分）
→ 长度归一化（惩罚过长 entry）
→ Hard Min Score 过滤（< 0.35 丢弃）
→ MMR Diversity（cosine > 0.85 的相似项延后）
→ 生命周期衰减 boost
```

**迁移方式**：
1. 在 recall-adapter 中，RecallService 返回结果后，串联一个轻量 rerank 步骤
2. 使用 `openai-compatible` API 调用 Cross-Encoder（比本地模型更快）
3. 不改 RecallService 本身，只在调用方做后处理

### 2.3 嵌入层噪声预过滤（noise-prototypes.ts）

**memory-lancedb-pro 策略**：
- 内置 ~15 条多语言噪声原型（问候、否认、元问题）
- 插件启动时嵌入所有原型并缓存向量
- auto-capture 管道中，SmartExtractor 前置嵌入预过滤
- 文本 < 300 字符跳过（长文本非噪声）
- 阈值：0.82 相似度

**迁移方式**：在 recall-adapter 的 query 构建阶段，对用户消息做嵌入预过滤，过滤掉已知噪声模式，减少无效 recall。

### 2.4 三层 Tier 晋升/降级

**当前我们有 tier 概念**（Tier 1/Tier 2 注入），但没有晋升/降级机制。

**迁移方式**：在 recall 后，写回 `access_count` 和 `last_accessed_at` 到记忆条目的 metadata（如果 recall service 支持扩展字段），触发晋升评估：
- Peripheral → Working：`access ≥ 3 且 composite ≥ 0.4`
- Working → Core：`access ≥ 10 且 composite ≥ 0.7 且 importance ≥ 0.8`
- Core/Working → Peripheral：`composite < 0.15 或 高龄低访问`

---

## 三、lossless-claw-enhanced 可迁移技术

### 3.1 CJK Token 估算修复

**问题**：上游 `Math.ceil(text.length / 4)` 对 CJK 低估 6 倍。

**修复方案**：在 `session-context-loader.js` 的 `smartTruncate()` 和所有 token 估算处，替换为：
```javascript
// 区分字符类型估算
const CJK_CHARS = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g;
const cjkCount = (text.match(CJK_CHARS) || []).length;
const otherCount = text.length - cjkCount;
const estimatedTokens = Math.ceil(cjkCount / 2) + Math.ceil(otherCount / 4);
```

**迁移位置**：
- `session-context-loader.js` 的 `smartTruncate()` 函数
- 任何做 token 预算的地方

### 3.2 Session 摘要文件系统双写

**lossless-claw-enhanced 的 contextThreshold + freshTailCount 思路** 启发了我们：

在 `session-summary-extractor.js` 中，在写入 `memory_summaries` 表的同时，同步将摘要写入文件系统：

```
memory/
  └── 2026-04-18/
        └── session-summary-{first-8-of-uuid}.md
```

**文件格式**：
```markdown
# Session Summary: 2026-04-18 02:30

- **Session ID**: abc12345
- **Source**: webchat
- **Summary Type**: session_summary

## 摘要内容
（memory_summaries 表中的 summary 字段内容）
```

**效果**：
- `startupContext prelude` 会自动加载这些文件（因为它读 `memory/YYYY-MM-DD-*.md`）
- 实现了 **双路径召回**：before_prompt_build 钩子 + startupContext 序幕 双重保障
- 即使钩子因 UUID 映射失败，还有文件系统路径兜底

---

## 四、完整实施方案（不改记忆系统）

### 4.1 方案总览

```
┌─────────────────────────────────────────────────────────┐
│                   不改记忆系统（禁区）                    │
│         memory-system/（PM2 进程 + 脚本 + 表结构）         │
└─────────────────────────────────────────────────────────┘
                              │
           ┌──────────────────┴──────────────────┐
           ▼                                     ▼
┌─────────────────────┐          ┌────────────────────────────┐
│  改动1: session-     │          │  改动2: recall-adapter.js   │
│  summary-extractor  │          │  升级混合检索 + Weibull 衰减  │
│  增加文件系统双写     │          │  + Cross-Encoder rerank     │
│  (写 memory/*.md)   │          │  + 嵌入噪声预过滤           │
└─────────────────────┘          └────────────────────────────┘
           │                                     │
           ▼                                     ▼
┌─────────────────────┐          ┌────────────────────────────┐
│  改动3: session-    │          │  改动4: memory-recall-      │
│  context-loader.js  │          │  plugin/index.js            │
│  CJK token 估算修复  │          │  before_prompt_build 钩子   │
│  sessionUUID 映射   │          │  增强（如果需要）            │
│  容错增强            │          │                             │
└─────────────────────┘          └────────────────────────────┘
           │                                     │
           └──────────────────┬──────────────────┘
                              ▼
              ┌──────────────────────────────┐
              │   before_prompt_build 触发     │
              │  = 双重召回路径保障              │
              │                               │
              │  路径A: startupContext prelude │
              │  → 读 memory/*.md（文件系统）  │
              │  → 最新 session-summary 文件   │
              │                               │
              │  路径B: before_prompt_build    │
              │  → loadPreviousContext()      │
              │  → preloadMemoriesForSession()│
              │  → RecallService 语义召回     │
              │  → Graphify 代码注入          │
              └──────────────────────────────┘
```

### 4.2 改动一：session-summary-extractor.js 双写

**文件**：`memory-system/scripts/session-summary-extractor.js`

**改动**：在 `writeSummaryToDatabase()` 成功后，追加文件系统写入：

```javascript
// 新增：写入 memory/YYYY-MM-DD/session-summary-{uuid8}.md
async function writeSummaryToFile(summary, sessionId, sessionKey) {
  const path = require('path');
  const fs = require('fs').promises;
  const workspaceDir = process.env.OPENCLAW_WORKSPACE || '/home/ai/.openclaw/workspace';
  
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const dir = path.join(workspaceDir, 'memory', today);
  await fs.mkdir(dir, { recursive: true });
  
  const uuid8 = sessionId.replace(/-/g, '').slice(0, 8);
  const filePath = path.join(dir, `session-summary-${uuid8}.md`);
  
  const content = [
    '# Session Summary: ' + today,
    '',
    `- **Session ID**: ${sessionId}`,
    `- **Session Key**: ${sessionKey}`,
    `- **Summary Type**: ${summary.summary_type || 'session_summary'}`,
    '',
    '## 摘要内容',
    summary.summary,
  ].join('\n');
  
  await fs.writeFile(filePath, content, 'utf-8');
  console.log(`[session-summary-extractor] Written: ${filePath}`);
}
```

**触发时机**：每次摘要写入 `memory_summaries` 成功后，异步调用（fire-and-forget，不阻塞主流程）。

### 4.3 改动二：recall-adapter.js 升级

**文件**：`plugins/memory-recall-plugin/lib/recall-adapter.js`

**4.3.1 CJK Token 估算**
```javascript
function estimateTokens(text) {
  const CJK = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g;
  const cjkCount = (text.match(CJK) || []).length;
  const otherCount = text.length - cjkCount;
  return Math.ceil(cjkCount / 2) + Math.ceil(otherCount / 4);
}
```

**4.3.2 Weibull 衰减后处理**
```javascript
function applyWeibullDecay(memories) {
  const now = Date.now();
  const DAY_MS = 86400000;
  const HALF_LIFE_DAYS = 30;
  
  return memories.map(m => {
    const ageDays = (now - new Date(m.created_at).getTime()) / DAY_MS;
    const beta = m.tier === 'core' ? 0.8 : m.tier === 'working' ? 1.0 : 1.3;
    const decay = Math.exp(-Math.pow(ageDays / HALF_LIFE_DAYS, beta));
    const frequency = Math.log((m.access_count || 0) + 1);
    const intrinsic = (m.importance || 0.5) * (m.confidence || 0.5);
    m.decayedScore = (m.score || 0) * decay * (1 + frequency * 0.1) * (1 + intrinsic);
    return m;
  }).sort((a, b) => b.decayedScore - a.decayedScore);
}
```

**4.3.3 嵌入层噪声预过滤**
```javascript
const NOISE_PROTOTYPES = [
  'what did we discuss before',
  'do you remember',
  'as mentioned earlier',
  'previously we talked about',
  // ...多语言噪声原型
];

async function filterNoiseByEmbedding(text) {
  if (text.length < 300) return false; // 长文本跳过
  const embedding = await getEmbedding(text);
  for (const noise of NOISE_PROTOTYPES) {
    const sim = cosineSimilarity(embedding, noiseVectors[noise]);
    if (sim > 0.82) return true; // 命中噪声
  }
  return false;
}
```

### 4.4 改动三：session-context-loader.js 修复

**文件**：`memory-system/scripts/session-context-loader.js`

**4.4.1 修复 session key → UUID 映射**
```javascript
async function loadPreviousContext(senderId, currentSessionId) {
  const lastSessionId = await getLastSessionId(senderId);
  if (!lastSessionId || lastSessionId === currentSessionId) {
    return { context: null, lastSessionId: null };
  }

  // 优先从 Redis 读映射
  let dbSessionId = await redisClient.get(`session:uuid:${lastSessionId}`);
  
  // Redis 没有 → 用 sessionIdToUuid() 但增加容错
  // 尝试多种 UUID 生成策略
  if (!dbSessionId) {
    const candidates = [
      sessionIdToUuid(lastSessionId),
      lastSessionId, // 本身可能就是 UUID
      uuidV4(), // 兜底生成（不推荐但容错）
    ];
    for (const candidate of candidates) {
      const exists = await db.query(
        `SELECT 1 FROM memory_summaries WHERE source_session_id = $1 LIMIT 1`,
        [candidate]
      );
      if (exists.rows.length > 0) {
        dbSessionId = candidate;
        break;
      }
    }
  }

  // 查询 memory_summaries
  if (dbSessionId) {
    const summaryResult = await db.query(
      `SELECT summary, summary_type, created_at
       FROM memory_summaries
       WHERE source_session_id = $1 AND is_active = TRUE
       ORDER BY created_at DESC LIMIT 3`,
      [dbSessionId]
    );
    // ...构建上下文
  }
}
```

**4.4.2 CJK Token 估算修复**
在 `smartTruncate()` 函数中，将 `Math.ceil(text.length / 4)` 替换为 CJK 感知估算。

### 4.5 改动四：bootstrap-extra-files 路径配置

**文件**：`openclaw.json` plugins 配置

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "bootstrap-extra-files": {
          "enabled": true,
          "paths": [
            "memory/*/session-summary-*.md",
            "memory/*/session-*.md"
          ]
        }
      }
    }
  }
}
```

**效果**：`startupContext prelude` 会加载所有 `session-summary-*.md` 文件，实现文件系统路径兜底召回。

---

## 五、总结

| 方案 | 来源 | 改动范围 | 风险 |
|------|------|---------|------|
| session-summary 双写 | 自主设计 | session-summary-extractor.js | 低（仅追加写） |
| CJK token 修复 | lossless-claw-enhanced | session-context-loader.js | 低（估算精度提升） |
| session UUID 容错 | 自主设计 | session-context-loader.js | 低（仅增加候选） |
| Weibull 衰减后处理 | memory-lancedb-pro | recall-adapter.js | 中（排序逻辑变化） |
| 嵌入噪声预过滤 | memory-lancedb-pro | recall-adapter.js | 中（额外 API 调用） |
| bootstrap-extra-files | OpenClaw 内置 | openclaw.json | 低（仅配置） |

**核心思路**：记忆系统（表 + PM2 进程）一字不动；在记忆系统之上、钩子之内做增强；双路径召回（文件系统 + 语义召回）互相兜底。
