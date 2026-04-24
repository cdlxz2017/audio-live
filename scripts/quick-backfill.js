#!/usr/bin/env node
// Quick backfill: process session JSONL files
// Parses the OpenClaw session JSONL format correctly

const fs = require('fs');
const readline = require('readline');
const path = require('path');

const SESSION_FILE = process.argv[2];
if (!SESSION_FILE) {
  console.error('Usage: node quick-backfill.js <session.jsonl>');
  process.exit(1);
}

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

async function processFile(filePath) {
  const rawSessionId = path.basename(filePath, '.jsonl');
  const sessionId = sessionIdToUuid(rawSessionId);
  
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  
  const messages = [];
  
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'message' && obj.message) {
        const role = obj.message.role;
        const content = extractTextContent(obj.message.content);
        if ((role === 'user' || role === 'assistant') && content) {
          messages.push({
            role,
            content,
            timestamp: obj.timestamp || obj.message.timestamp,
          });
        }
      }
    } catch(e) {
      // skip broken lines
    }
  }
  
  // Group into pairs
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
  
  console.log(`File: ${rawSessionId}`);
  console.log(`Messages: ${messages.length}, Pairs: ${pairs.length}`);
  
  if (pairs.length > 0) {
    try {
      const results = await conversationArchiver.archive(sessionId, pairs, { rawSessionId });
      const newCount = results.filter(r => !r.skipped).length;
      const skipCount = results.filter(r => r.skipped).length;
      console.log(`Archived: ${newCount} new, ${skipCount} skipped`);
    } catch(e) {
      console.error(`Archiver error: ${e.message}`);
    }
  }
  
  if (typeof db.close === 'function') {
    await db.close();
  }
}

processFile(SESSION_FILE).catch(e => { console.error(e.message); process.exit(1); });
