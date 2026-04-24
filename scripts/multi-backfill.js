#!/usr/bin/env node
// Multi-session backfill: process multiple files in one process
const fs = require('fs');
const readline = require('readline');
const path = require('path');

const db = require('/home/ai/.openclaw/workspace/memory-system/scripts/db');
const { conversationArchiver } = require('/home/ai/.openclaw/workspace/memory-system/scripts/conversation-archiver');

function sessionIdToUuid(sessionId) {
  const crypto = require('crypto');
  if (!sessionId) return '00000000-0000-0000-0000-000000000000';
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(sessionId)) return sessionId;
  const h = crypto.createHash('md5').update(sessionId).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}

function extractTextContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(c => typeof c === 'string' ? c : (c.text || '')).join('\n');
  }
  return String(content);
}

function parseSession(filePath) {
  const rawSessionId = path.basename(filePath, '.jsonl');
  if (rawSessionId.includes('checkpoint')) return null;
  
  const sessionId = sessionIdToUuid(rawSessionId);
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());
  
  const messages = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'message' && obj.message) {
        const role = obj.message.role;
        const content = extractTextContent(obj.message.content);
        if ((role === 'user' || role === 'assistant') && content) {
          messages.push({ role, content, timestamp: obj.timestamp || obj.message.timestamp });
        }
      }
    } catch(e) {}
  }
  
  const pairs = [];
  let turnIndex = 0;
  for (let i = 0; i < messages.length - 1; i++) {
    if (messages[i].role === 'user' && messages[i+1].role === 'assistant') {
      pairs.push({
        messageIndex: turnIndex++,
        user: messages[i].content,
        assistant: messages[i+1].content,
        userTimestamp: messages[i].timestamp,
        assistantTimestamp: messages[i+1].timestamp,
      });
      i++;
    }
  }
  
  return { rawSessionId, sessionId, pairs, messageCount: messages.length };
}

async function main() {
  const sessionsDir = '/home/ai/.openclaw/agents/main/sessions';
  const files = fs.readdirSync(sessionsDir)
    .filter(f => f.endsWith('.jsonl') && !f.includes('checkpoint'))
    .map(f => path.join(sessionsDir, f))
    .sort((a, b) => fs.statSync(b).mtime - fs.statSync(a).mtime)
    .slice(0, 30); // top 30 most recent
  
  console.log(`Found ${files.length} sessions to process`);
  
  let totalPairs = 0;
  let totalNew = 0;
  let totalSkipped = 0;
  
  for (const filePath of files) {
    const raw = path.basename(filePath, '.jsonl');
    try {
      const result = parseSession(filePath);
      if (!result || result.pairs.length === 0) {
        console.log(`[SKIP] ${raw}: 0 pairs`);
        continue;
      }
      
      console.log(`[PROC] ${raw}: ${result.pairs.length} pairs, ${result.messageCount} msgs`);
      
      const archiverResult = await conversationArchiver.archive(result.sessionId, result.pairs, { rawSessionId: result.raw });
      const newCount = archiverResult.filter(r => !r.skipped).length;
      const skipCount = archiverResult.filter(r => r.skipped).length;
      totalPairs += result.pairs.length;
      totalNew += newCount;
      totalSkipped += skipCount;
      console.log(`[DONE] ${raw}: +${newCount} new, ${skipCount} skipped`);
    } catch(e) {
      console.error(`[ERR] ${raw}: ${e.message}`);
    }
  }
  
  console.log(`\n=== TOTAL: ${totalPairs} pairs, ${totalNew} new, ${totalSkipped} skipped ===`);
  
  const countResult = await db.query('SELECT count(*) FROM conversation_messages');
  console.log(`DB total: ${countResult.rows[0].count} rows`);
  
  if (typeof db.close === 'function') await db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
