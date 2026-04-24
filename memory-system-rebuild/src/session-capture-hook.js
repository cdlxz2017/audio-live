/**
 * Session Capture Hook — 会话消息捕获
 * 写入链路: 用户消息 → session-capture-hook → conversation_messages
 */
const crypto = require('crypto');
const db = require('./db');

function toUuid(input) {
  if (!input) return '00000000-0000-0000-0000-000000000000';
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (re.test(input)) return input;
  const h = crypto.createHash('md5').update(input).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}

function extractContent(msg) {
  if (!msg) return '';
  if (Array.isArray(msg.content)) return msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return msg.content || '';
}

async function writeMessage({ sessionId, role, content, channel, metadata }) {
  if (!content || typeof content !== 'string' || content.trim().length < 2) return null;
  const sid = toUuid(sessionId);
  const maxTurn = await db.query('SELECT COALESCE(MAX(turn_index), 0) as m FROM conversation_messages WHERE session_id = $1', [sid]);
  const turnIndex = maxTurn.rows[0].m + 1;
  const result = await db.query(`
    INSERT INTO conversation_messages (session_id, turn_index, message_index, role, content, message_type, channel, metadata, created_at)
    VALUES ($1, $2, $2, $3, $4, $5, $6, $7, NOW())
    ON CONFLICT (session_id, turn_index, role) DO NOTHING RETURNING id
  `, [sid, turnIndex, role, content.substring(0, 50000), 'chat', channel || 'webchat', JSON.stringify(metadata || {})]);
  if (result.rows[0]) {
    console.log(`[capture] written id=${result.rows[0].id} role=${role} session=${sessionId} len=${content.length}`);
  }
  return result.rows[0]?.id || null;
}

const handler = (event) => {
  const type = event.type;
  const action = event.action;
  const msg = event.message;

  // before_message_write
  if (!type && msg && msg.role) {
    const content = extractContent(msg);
    if (!content) return;
    const ctx = event.context || {};
    const sessionKey = ctx.conversationId || ctx.sessionKey || event.sessionKey || 'unknown';
    const channel = ctx.channelId || event.channel || 'webchat';
    writeMessage({ sessionId: sessionKey, role: msg.role, content, channel, metadata: { source: 'before_message_write' } })
      .catch(e => console.error(`[capture] error: ${e.message}`));
    return;
  }

  // message:received / message:sent
  if (type === 'message') {
    const ctx = event.context || {};
    const content = ctx.content || ctx.bodyForAgent || ctx.body || ctx.transcript || '';
    if (!content || typeof content !== 'string' || content.trim().length < 2) return;
    const sessionKey = ctx.conversationId || event.sessionKey || 'unknown';
    const channel = ctx.channelId || 'webchat';
    const role = (action === 'received' || action === 'preprocessed') ? 'user' : 'assistant';
    writeMessage({ sessionId: sessionKey, role, content, channel, metadata: { source: `message-${action}` } })
      .catch(e => console.error(`[capture] error: ${e.message}`));
  }
};

module.exports = handler;
module.exports.writeMessage = writeMessage;
