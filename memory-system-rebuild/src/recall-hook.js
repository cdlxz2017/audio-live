/**
 * Recall Hook — before_prompt_build 召回注入
 * 链路: 用户消息 → before_prompt_build → RecallService → BGE-m3 → HNSW 三表搜索 → 注入 LLM
 */
const { recallService, buildMemoryPrompt, classifyIntent } = require('./recall-service');

const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';

const handler = async (event) => {
  try {
    const ctx = event.context || {};
    const messages = ctx.messages || [];
    if (!messages.length) return;

    // 提取最后用户消息（截取500字）
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) return;
    const content = typeof lastUserMsg.content === 'string'
      ? lastUserMsg.content
      : (Array.isArray(lastUserMsg.content) ? lastUserMsg.content.filter(b => b.type === 'text').map(b => b.text).join('') : '');
    if (!content || content.trim().length < 3) return;

    const query = content.substring(0, 500);
    const tenantId = ctx.tenantId || DEFAULT_TENANT;
    const userId = ctx.userId || null;

    const result = await recallService.recall({ tenantId, userId, query, topK: 5 });

    if (result.memories && result.memories.length > 0) {
      const memoryPrompt = buildMemoryPrompt(result.memories);
      // 注入到 context 的 prependContext
      if (!ctx.prependContext) ctx.prependContext = '';
      ctx.prependContext = memoryPrompt + '\n' + ctx.prependContext;
      console.log(`[recall-hook] Injected ${result.memories.length} memories (intent=${result.intent}, cached=${result.cached}, latency=${result.latencyMs}ms)`);
    }
  } catch (err) {
    // 召回失败不阻塞主流程
    console.error(`[recall-hook] Error: ${err.message}`);
  }
};

module.exports = handler;
