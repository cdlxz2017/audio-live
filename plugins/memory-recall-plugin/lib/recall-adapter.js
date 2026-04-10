const path = require('path');
const crypto = require('crypto');

/**
 * 创建召回适配器，桥接现有 memory-system 模块
 */
function createRecallAdapter(api) {
  const pluginConfig = api.pluginConfig || {};
  let workspaceDir = api.config.workspace?.dir;
  if (!workspaceDir) {
    // 尝试从环境变量获取
    workspaceDir = process.env.OPENCLAW_WORKSPACE;
    if (!workspaceDir) {
      throw new Error('Workspace directory not found. Set config.workspace.dir or OPENCLAW_WORKSPACE.');
    }
  }

  const memorySystemPath = path.join(workspaceDir, 'memory-system');
  const scriptsPath = path.join(memorySystemPath, 'scripts');

  // 动态加载现有模块（注意：这些模块是 CommonJS）
  let RecallService, buildMemoryPrompt, config, redis, sessionContextLoader;
  try {
    const recallModule = require(path.join(scriptsPath, 'session-recall'));
    RecallService = recallModule.RecallService || recallModule.recallService;
    buildMemoryPrompt = recallModule.buildMemoryPrompt;
    config = require(path.join(scriptsPath, 'config'));
    redis = require(path.join(scriptsPath, 'redis'));
    sessionContextLoader = require(path.join(scriptsPath, 'session-context-loader'));
  } catch (err) {
    api.logger.error(`[memory-recall] Failed to load memory-system modules: ${err.message}`);
    throw err;
  }

  const recallService = typeof RecallService === 'function' ? new RecallService() : RecallService;
  const redisClient = redis.getClient();

  // Redis 键前缀（与原有 hook 保持一致）
  const CONTEXT_LOADED_KEY_PREFIX = 'context_loaded:';
  const PROACTIVE_LOADED_KEY_PREFIX = 'proactive_loaded:';

  /**
   * 检查上下文是否已加载
   */
  async function isContextLoaded(sessionKey) {
    const loaded = await redisClient.get(`${CONTEXT_LOADED_KEY_PREFIX}${sessionKey}`);
    return loaded === '1';
  }

  /**
   * 标记上下文已加载
   */
  async function markContextLoaded(sessionKey) {
    await redisClient.setex(`${CONTEXT_LOADED_KEY_PREFIX}${sessionKey}`, 86400, '1'); // 24h TTL
  }

  /**
   * 检查 Proactive 是否已加载
   */
  async function isProactiveLoaded(sessionKey) {
    const loaded = await redisClient.get(`${PROACTIVE_LOADED_KEY_PREFIX}${sessionKey}`);
    return loaded === '1';
  }

  /**
   * 标记 Proactive 已加载
   */
  async function markProactiveLoaded(sessionKey) {
    await redisClient.setex(`${PROACTIVE_LOADED_KEY_PREFIX}${sessionKey}`, 86400, '1'); // 24h TTL
  }

  /**
   * 截断记忆文本到指定长度
   */
  function truncateMemory(memory, maxLen) {
    const text = memory.value || '';
    return text.length > maxLen ? text.substring(0, maxLen) + '...' : text;
  }

  /**
   * 根据 Tier 级别过滤和截断记忆
   * Tier 1: top 3, 60字截断（轻量注入）
   * Tier 2: top 5, 全文（完整注入）
   */
  function applyTierFilter(memories, tier) {
    if (tier === 1) {
      return memories.slice(0, 3).map(m => ({
        ...m,
        value: truncateMemory(m, 60),
      }));
    }
    // Tier 2: top 5, 全文
    return memories.slice(0, 5);
  }

  /**
   * 构建带上下文的查询（最后 4 条用户消息）
   */
  function buildQueryWithContext(messages) {
    const userMessages = (messages || []).filter(m => m.role === 'user');
    const recentUserMessages = userMessages.slice(-4);
    return recentUserMessages.map(m => m.content).join(' | ').substring(0, 500);
  }

  /**
   * 核心召回流程
   */
  async function recallWithContext(params) {
    const {
      tenantId,
      userId,
      query: originalQuery,
      messages,
      sessionKey,
      sessionId,
      channelId,
      trigger,
      workspaceDir,
    } = params;

    const injectionParts = [];

    // ── 步骤 1: 标记当前 session 为该用户的最新 session ──
    if (userId && sessionKey) {
      await sessionContextLoader.markSessionForUser(userId, sessionKey);
    }

    // ── 步骤 2: 新 session 检测 — 加载上一 session 的对话上下文 ──
    //    v4.3 (Week 2): 场景 A: 新 session 预加载记忆
    if (userId && sessionKey && !(await isContextLoaded(sessionKey))) {
      // 原有逻辑：加载上一 session 摘要
      const { context, lastSessionId } = await sessionContextLoader.loadPreviousContext(
        userId,
        sessionKey,
        3  // 取最近 3 轮对话
      );

      if (context && lastSessionId) {
        injectionParts.unshift(context);  // 插入到最前面
        api.logger.debug(`[memory-recall] Loaded previous context from session=${lastSessionId} for user=${userId}`);
      }

      // Week 2 场景 A: 新 session 预加载用户相关记忆
      if (!(await isProactiveLoaded(sessionKey))) {
        const proactiveContext = await sessionContextLoader.preloadMemoriesForNewSession(recallService, userId);
        if (proactiveContext) {
          injectionParts.push(proactiveContext);
          api.logger.debug(`[memory-recall] Proactive: preloaded memories for new session, user=${userId}`);
        }
        await markProactiveLoaded(sessionKey);
      }

      // 标记已加载，避免重复
      await markContextLoaded(sessionKey);
    }

    // ── 步骤 2.5 (Week 2): 场景 C — 长时间沉默检测 ──
    let forceRefresh = false;
    if (userId) {
      const isIdle = await sessionContextLoader.detectIdleSilence(userId);
      if (isIdle) {
        forceRefresh = true;
        api.logger.debug(`[memory-recall] Proactive: idle silence detected for user=${userId}, forcing refresh`);
      }
    }

    // ── 步骤 3: 记忆召回 ──
    // 构建带上下文的 query（最后 4 条用户消息）
    const query = buildQueryWithContext(messages);
    if (!query) {
      // 没有用户消息，不进行召回
      if (injectionParts.length > 0) {
        return { injection: injectionParts.join('\n\n') };
      }
      return null;
    }

    // Week 2 场景 B: 话题切换检测
    let topicShifted = false;
    const userMessages = (messages || []).filter(m => m.role === 'user');
    if (userMessages.length >= 2) {
      const prevMsg = userMessages[userMessages.length - 2]?.content || '';
      const currMsg = userMessages[userMessages.length - 1]?.content || '';
      topicShifted = sessionContextLoader.detectTopicShift(prevMsg, currMsg);
      if (topicShifted) {
        api.logger.debug(`[memory-recall] Proactive: topic shift detected, triggering fresh recall`);
      }
    }

    // v4.2+: 记忆召回（含 graphify 并行触发）
    // 话题切换或长时间沉默时增加 candidateK 提高召回质量
    const candidateK = (topicShifted || forceRefresh) ? 20 : 10;

    const { memories, graphify, intent } = await recallService.recall({
      tenantId,
      userId,
      query,
      topK: pluginConfig.maxMemories || config.recall?.maxMemories || 5,
      candidateK,
    });

    // ── v4.3 (Week 2): Tier 分级注入 ──
    const intentCfg = config.intentConfig[intent] || config.intentConfig.DEFAULT;
    const tier = intentCfg.tier || 1;

    if (memories && memories.length > 0) {
      // 根据 Tier 级别过滤和截断
      const tierMemories = applyTierFilter(memories, tier);
      const memoryPrompt = buildMemoryPrompt(tierMemories);
      injectionParts.push(memoryPrompt);
      api.logger.debug(`[memory-recall] Injected ${tierMemories.length} memories (tier=${tier}) for session=${sessionKey}, intent=${intent}`);
    }

    // ── v4.2: Graphify Code Context 注入（TECHNICAL/PROJECT 类） ──
    if (graphify && graphify.length > 0) {
      // 需要 graphify-fetch 模块的 formatGraphifyContext 函数
      try {
        const { formatGraphifyContext } = require(path.join(scriptsPath, 'graphify-fetch'));
        const codeContext = formatGraphifyContext(graphify);
        if (codeContext) {
          injectionParts.push(codeContext);
          api.logger.debug(`[memory-recall] Injected ${graphify.length} Graphify code blocks for intent=${intent}`);
        }
      } catch (err) {
        api.logger.warn(`[memory-recall] Failed to format graphify context: ${err.message}`);
      }
    }

    if (injectionParts.length === 0) {
      return null;
    }

    return {
      injection: injectionParts.join('\n\n'),
      memories,
      intent,
      graphify,
    };
  }

  return {
    recallWithContext,
  };
}

module.exports = { createRecallAdapter };