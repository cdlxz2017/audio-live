/**
 * Memory Writer — 记忆写入 (memories / memory_summaries / personal_memories)
 * 生成 embedding → 冲突检测 → 幂等写入 PG + Redis Stream 事件
 */
const crypto = require('crypto');
const db = require('./db');
const redis = require('./redis');
const { embedder } = require('./embedder');

function sessionKeyToUuid(sessionKey) {
  if (!sessionKey) return null;
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (re.test(sessionKey)) return sessionKey;
  const m = sessionKey.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.checkpoint\./i);
  if (m && re.test(m[1])) return m[1];
  return null;
}

class MemoryWriter {
  /** 写入 memories 表 */
  async writeMemory(mem) {
    const { tenantId, userId, sessionId, messageIndex, entity, attribute, value,
            memoryType = 'factual', rawText = null, confidence = 0.8, source = 'realtime' } = mem;
    const sid = sessionKeyToUuid(sessionId);
    const uid = sessionKeyToUuid(userId);
    const text = `${entity} ${attribute} ${value}`;
    const embedding = await embedder.embed(text);
    const content = `${entity}.${attribute} = ${value}`;

    // 冲突处理
    if (memoryType === 'factual') {
      await db.query(`UPDATE memories SET is_active = FALSE, updated_at = NOW()
        WHERE tenant_id = $1 AND user_id = $2 AND entity = $3 AND attribute = $4
        AND memory_type = 'factual' AND is_active = TRUE`, [tenantId, uid, entity, attribute]);
    }

    const result = await db.query(`
      INSERT INTO memories (tenant_id, user_id, session_id, message_index, entity, attribute, value,
        raw_text, content, memory_type, embedding, confidence, is_active, source)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE,$13)
      ON CONFLICT (tenant_id, session_id, message_index, entity, attribute)
      DO UPDATE SET is_active = TRUE, content = EXCLUDED.content
      RETURNING id
    `, [tenantId, uid, sid, messageIndex, entity, attribute, value, rawText, content,
        memoryType, JSON.stringify(embedding), confidence, source]);

    const memoryId = result.rows[0]?.id;
    redis.invalidateRecallCache().catch(() => {});
    this._publishGraphSync({ type: 'memory_created', memoryId, entity, attribute, value, memoryType }).catch(() => {});
    return memoryId;
  }

  /** 写入 memory_summaries 表 */
  async writeSummary({ summary, summaryType = 'default', sourceSessionId, sourceMessageIds, confidence = 0.8, metadata = {} }) {
    const embedding = await embedder.embed(summary);
    const contentHash = crypto.createHash('md5').update(summary).digest('hex');

    // 去重
    const dup = await db.query('SELECT id FROM memory_summaries WHERE content_hash = $1', [contentHash]);
    if (dup.rows.length > 0) return dup.rows[0].id;

    const result = await db.query(`
      INSERT INTO memory_summaries (summary, summary_type, source_session_id, source_message_ids,
        embedding, confidence, is_active, metadata, content_hash)
      VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7,$8) RETURNING id
    `, [summary, summaryType, sourceSessionId, sourceMessageIds || [],
        JSON.stringify(embedding), confidence, JSON.stringify(metadata), contentHash]);

    redis.invalidateRecallCache().catch(() => {});
    return result.rows[0].id;
  }

  /** 写入 personal_memories 表 */
  async writePersonal({ content, category = 'general', insightType = 'general', originSessionId, confidence = 0.8, metadata = {} }) {
    const embedding = await embedder.embed(content);
    const result = await db.query(`
      INSERT INTO personal_memories (content, category, insight_type, embedding, embedding_model,
        origin_session_id, confidence, is_active, metadata)
      VALUES ($1,$2,$3,$4,'bge-m3',$5,$6,TRUE,$7) RETURNING id
    `, [content, category, insightType, JSON.stringify(embedding), originSessionId, confidence, JSON.stringify(metadata)]);

    redis.invalidateRecallCache().catch(() => {});
    return result.rows[0].id;
  }

  /** 批量写入 */
  async writeBatch(memories) {
    const ids = [];
    for (const m of memories) {
      try { ids.push(await this.writeMemory(m)); } catch (err) { console.error('[Writer] batch error:', err.message); }
    }
    return ids;
  }

  async _publishGraphSync(event) {
    const payload = JSON.stringify({ ...event, timestamp: new Date().toISOString() });
    await redis.xadd('graph:sync:events', null, { type: event.type, payload });
  }
}

const memoryWriter = new MemoryWriter();
module.exports = { MemoryWriter, memoryWriter };
