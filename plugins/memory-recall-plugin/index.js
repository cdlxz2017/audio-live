/**
 * Memory Recall Plugin for OpenClaw
 * 
 * 在 before_prompt_build 时机注入召回记忆。
 * 使用 before_dispatch 钩子捕获 senderId（awaited + 有 senderId）。
 * 
 * 复用现有 memory-system 模块：
 * - RecallService (session-recall.js)
 * - session-context-loader.js
 * - graphify-fetch.js
 * - config.js
 * - redis.js
 */

const path = require('path');

// ─── 复用现有 memory-system 模块 ────────────────────────────────
const SCRIPTS_DIR = '/home/ai/.openclaw/workspace/memory-system/scripts';

const { RecallService, buildMemoryPrompt } = require(path.join(SCRIPTS_DIR, 'session-recall'));
const { formatGraphifyContext } = require(path.join(SCRIPTS_DIR, 'graphify-fetch'));
const {
  markSessionForUser,
  loadPreviousContext,
  detectTopicShift,
  detectIdleSilence,
  preloadMemoriesForNewSession,
} = require(path.join(SCRIPTS_DIR, 'session-context-loader'));
const config = require(path.join(SCRIPTS_DIR, 'config'));
const redisModule = require(path.join(SCRIPTS_DIR, 'redis'));

// ─── 单例 ─────────────────────────────────────────────────────
let _recallService = null;

function getRecallService() {
  if (!_recallService) {
    _recallService = new RecallService();
  }
  return _recallService;
}

// ─── Redis key 前缀 ────────────────────────────────────────────
const CONTEXT_LOADED_PREFIX = 'ctx_loaded:';
const PROACTIVE_LOADED_PREFIX = 'proactive_loaded:';
const SENDER_MAP_PREFIX = 'plugin:sender:';  // sessionKey → senderId

// ─── Safe Redis 包装（降级模式）───────────────────────────────
async function safeRedisGet(key) {
  try {
    const client = redisModule.getClient();
    if (client.status !== 'ready') return null;
    return await client.get(key);
  } catch (err) {
    console.warn(`[memory-recall] Redis get failed, degrading: ${err.message}`);
    return null;
  }
}

async function safeRedisSet(key, value, ttlSeconds) {
  try {
    const client = redisModule.getClient();
    if (client.status !== 'ready') return false;
    await client.setex(key, ttlSeconds, value);
    return true;
  } catch (err) {
    console.warn(`[memory-recall] Redis set failed, degrading: ${err.message}`);
    return false;
  }
}

// ─── senderId 缓存 ─────────────────────────────────────────────
async function cacheSenderForSession(sessionKey, senderId) {
  if (!sessionKey || !senderId) return;
  await safeRedisSet(`${SENDER_MAP_PREFIX}${sessionKey}`, senderId, 86400);
}

async function getSenderForSession(sessionKey) {
  if (!sessionKey) return null;
  return await safeRedisGet(`${SENDER_MAP_PREFIX}${sessionKey}`);
}

// ─── Context loaded 状态 ─────────────────────────────────────
async function isContextLoaded(sessionKey) {
  const v = await safeRedisGet(`${CONTEXT_LOADED_PREFIX}${sessionKey}`);
  return v === '1';
}

async function markContextLoaded(sessionKey) {
  await safeRedisSet(`${CONTEXT_LOADED_PREFIX}${sessionKey}`, '1', 86400);
}

async function isProactiveLoaded(sessionKey) {
  const v = await safeRedisGet(`${PROACTIVE_LOADED_PREFIX}${sessionKey}`);
  return v === '1';
}

async function markProactiveLoaded(sessionKey) {
  await safeRedisSet(`${PROACTIVE_LOADED_PREFIX}${sessionKey}`, '1', 86400);
}

// ─── Tier 分级注入 ─────────────────────────────────────────────
function truncateMemory(memory, maxLen) {
  const text = memory.value || '';
  return text.length > maxLen ? text.substring(0, maxLen) + '...' : text;
}

function applyTierFilter(memories, tier) {
  if (tier === 1) {
    return memories.slice(0, 3).map(m => ({ ...m, value: truncateMemory(m, 60) }));
  }
  return memories.slice(0, 5);
}

// ─── Plugin Entry ──────────────────────────────────────────────
module.exports = {
  id: 'memory-recall-plugin',
  name: 'Memory Recall Plugin',
  description: 'Injects recalled memories into agent prompts',

  register(api) {
    const logger = api.logger || console;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 钩子 1: before_dispatch — 捕获 senderId（awaited + 有 senderId）
    // 在 agent run 启动前执行，确保缓存写入完成
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    api.on('before_dispatch', async (event, ctx) => {
      try {
        // before_dispatch 的 ctx 包含 senderId
        const senderId = ctx.senderId || event?.senderId;
        const sessionKey = ctx.sessionKey;

        if (senderId && sessionKey) {
          await cacheSenderForSession(sessionKey, senderId);
          logger.info(`[memory-recall] Cached senderId=${senderId} for session=${sessionKey}`);
        }
      } catch (err) {
        logger.warn(`[memory-recall] before_dispatch sender cache failed: ${err.message}`);
      }
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 钩子 2: before_prompt_build — 核心：注入召回记忆
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    api.on('before_prompt_build', async (event, ctx) => {
      const startTime = Date.now();

      try {
        const { sessionKey, senderId: ctxSenderId } = ctx;
        const { messages } = event;

        // ── 获取 senderId ──
        // 优先从 before_dispatch 缓存获取，其次从 ctx 尝试
        let senderId = await getSenderForSession(sessionKey);
        if (!senderId) {
          senderId = ctxSenderId || sessionKey || 'anonymous';
        }

        // ── 步骤 1: 标记 session ──
        if (senderId && sessionKey && senderId !== 'anonymous') {
          await markSessionForUser(senderId, sessionKey);
        }

        // ── 步骤 2: 新 session 上下文加载 ──
        const contextParts = [];

        if (senderId && sessionKey && !(await isContextLoaded(sessionKey))) {
          const recallService = getRecallService();

          // 加载上一 session 摘要
          const { context, lastSessionId } = await loadPreviousContext(senderId, sessionKey, 3);

          if (context && lastSessionId) {
            contextParts.push(context);
            logger.info(`[memory-recall] Loaded previous context from session=${lastSessionId}`);
          }

          // 新 session 预加载记忆
          if (!(await isProactiveLoaded(sessionKey))) {
            const proactiveContext = await preloadMemoriesForNewSession(recallService, senderId);
            if (proactiveContext) {
              contextParts.push(proactiveContext);
              logger.info(`[memory-recall] Proactive: preloaded memories for new session`);
            }
            await markProactiveLoaded(sessionKey);
          }

          await markContextLoaded(sessionKey);
        }

        // ── 步骤 2.5: 长时间沉默检测 ──
        let forceRefresh = false;
        if (senderId && senderId !== 'anonymous') {
          const isIdle = await detectIdleSilence(senderId);
          if (isIdle) {
            forceRefresh = true;
            logger.info(`[memory-recall] Proactive: idle silence detected, forcing refresh`);
          }
        }

        // ── 步骤 3: 记忆召回 ──
        const msgArray = Array.isArray(messages) ? messages : [];
        const userMessages = msgArray.filter(m => m && m.role === 'user');
        const lastUserMessage = userMessages[userMessages.length - 1];

        if (!lastUserMessage || !lastUserMessage.content) {
          if (contextParts.length > 0) {
            return { prependContext: contextParts.join('\n\n') };
          }
          return;
        }

        // 构建 query（最后 4 条用户消息，过滤 heartbeat / system 噪音）
        const NOISE_PATTERNS = [
          /^Read HEARTBEAT\.md/i,
          /^\s*\/new\s*$/,
          /^\s*\/reset\s*$/,
          /^HEARTBEAT_OK$/,
        ];
        const meaningfulUserMessages = userMessages.filter(m => {
          const c = typeof m.content === 'string' ? m.content.trim() : '';
          return c.length > 0 && !NOISE_PATTERNS.some(re => re.test(c));
        });
        const recentUserMessages = meaningfulUserMessages.slice(-4);
        const query = recentUserMessages
          .map(m => typeof m.content === 'string' ? m.content : '')
          .join(' | ')
          .substring(0, 500)
          .trim();

        // query 为空 → 跳过语义召回，直接返回已加载的上下文（避免空 query 触发 DEFAULT intent 召回 tech docs）
        if (!query) {
          logger.info(`[memory-recall] Skip recall: empty query after noise filter, returning preloaded context only`);
          if (contextParts.length > 0) {
            return { prependContext: contextParts.join('\n\n') };
          }
          return;
        }

        // 话题切换检测
        let topicShifted = false;
        if (userMessages.length >= 2) {
          const rawPrev = userMessages[userMessages.length - 2]?.content;
          const rawCurr = userMessages[userMessages.length - 1]?.content;
          const prevMsg = typeof rawPrev === 'string' ? rawPrev : (rawPrev?.text || String(rawPrev || ''));
          const currMsg = typeof rawCurr === 'string' ? rawCurr : (rawCurr?.text || String(rawCurr || ''));
          topicShifted = detectTopicShift(prevMsg, currMsg);
          if (topicShifted) {
            logger.info(`[memory-recall] Proactive: topic shift detected`);
          }
        }

        const tenantId = '00000000-0000-0000-0000-000000000000';
        const userId = senderId;
        const candidateK = (topicShifted || forceRefresh) ? 20 : 10;

        const recallService = getRecallService();
        const { memories, graphify, intent } = await recallService.recall({
          tenantId, userId, query, topK: 5, candidateK,
        });

        // Tier 分级注入
        const intentCfg = config.intentConfig[intent] || config.intentConfig.DEFAULT;
        const tier = intentCfg.tier || 1;

        if (memories && memories.length > 0) {
          const tierMemories = applyTierFilter(memories, tier);
          const memoryPrompt = buildMemoryPrompt(tierMemories);
          contextParts.push(memoryPrompt);
          logger.info(`[memory-recall] Injected ${tierMemories.length} memories (tier=${tier}, intent=${intent}) [${Date.now() - startTime}ms]`);
        }

        // Graphify Code Context 注入
        if (graphify && graphify.length > 0) {
          const codeContext = formatGraphifyContext(graphify);
          if (codeContext) {
            contextParts.push(codeContext);
            logger.info(`[memory-recall] Injected ${graphify.length} Graphify code blocks`);
          }
        }

        if (contextParts.length > 0) {
          return { prependContext: contextParts.join('\n\n') };
        }
      } catch (err) {
        logger.error(`[memory-recall] Error in before_prompt_build: ${err.message}`);
        // 不阻塞主流程
      }
    });

    logger.info('[memory-recall-plugin] Registered successfully');
  },
};
