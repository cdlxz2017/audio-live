/**
 * Hermes Router - Enhanced
 * Adds pre-warm context injection via OpenClaw memory recall
 * and routes to the persistent Hermes server instead of invoking CLI.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

const HERMES_DIR = '/home/ai/apps/hermes-agent';
const HERMES_HOME = path.join(process.env.HOME, '.hermes');
const HERMES_SERVER_URL = process.env.HERMES_SERVER_URL || 'http://127.0.0.1:31235';

// Memory system paths
const WORKSPACE = process.env.OPENCLAW_WORKSPACE || '/home/ai/.openclaw/workspace';
const MEMORY_SCRIPTS = path.join(WORKSPACE, 'memory-system/scripts');

// ── Routing patterns (same as original) ────────────────────────────────────
const HERMES_PATTERNS = [
  /分析|比较|设计|研究|评估|优化|架构|重构|调试|实现|生成|编写|开发|规划/,
  /\b(analyze|analyse|compare|design|research|evaluate|optimize|architect|refactor|debug|implement|generate\s+code|code\s+review|review\s+code|explain\s+why|how\s+does|deep\s+dive)\b/i,
  /\b(step[- ]by[- ]step|multiple|complex|comprehensive|detailed\s+plan|full\s+implementation)\b/i,
];

const DIRECT_PATTERNS = [
  /\b(what\s+is|when\s+(is|was|will)|where\s+is|who\s+is)\b/i,
  /记住|查一下|告诉我|什么时候|在哪里|是什么/,
  /\b(remember|recall|lookup|find|status|check)\b/i,
];

/**
 * Determine if a message should be routed to Hermes.
 */
function shouldInvokeHermes(message) {
  if (!message || typeof message !== 'string') {
    return { invoke: false, score: 0, reason: 'empty message' };
  }
  const msg = message.trim();
  let score = 0;
  let hermesHits = 0;
  for (const pattern of HERMES_PATTERNS) {
    if (pattern.test(msg)) { hermesHits++; score += 3; }
  }
  if (hermesHits >= 2) score += 2;
  for (const pattern of DIRECT_PATTERNS) {
    if (pattern.test(msg)) score -= 2;
  }
  if (msg.length > 200) score += 2;
  if (msg.length > 500) score += 1;
  if (/```|`[^`]+`/.test(msg)) score += 2;
  score = Math.max(0, Math.min(10, score));
  return { invoke: score >= 3, score, reason: score >= 3 ? 'complex task' : 'simple/direct task' };
}

/**
 * Load API key from ~/.hermes/.env
 */
function loadEnvVars() {
  const envPath = path.join(HERMES_HOME, '.env');
  const vars = {};
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (match) vars[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
  return vars;
}

// ── Memory recall ─────────────────────────────────────────────────────────────

/** Lazy-loaded recall service (only loaded once) */
let _recallService = null;

function getRecallService() {
  if (_recallService) return _recallService;
  try {
    const recallModule = require(path.join(MEMORY_SCRIPTS, 'session-recall'));
    const RecallService = recallModule.RecallService || recallModule.recallService;
    _recallService = typeof RecallService === 'function' ? new RecallService() : RecallService;
    return _recallService;
  } catch (err) {
    console.error('[hermes-router] Could not load recall service:', err.message);
    return null;
  }
}

/**
 * Recall relevant memories for a query.
 * Returns array of {entity, attribute, value, score} objects.
 */
async function recallMemories(query, options = {}) {
  const { topK = 5, userId = 'default' } = options;
  const svc = getRecallService();
  if (!svc) return [];

  try {
    let results;
    if (typeof svc.recall === 'function') {
      results = await svc.recall({ query, userId, topK });
    } else if (typeof svc.semanticSearch === 'function') {
      results = await svc.semanticSearch(query, topK);
    } else {
      return [];
    }
    // Normalize to array
    return Array.isArray(results) ? results : (results.memories || results.results || []);
  } catch (err) {
    console.error('[hermes-router] Recall error:', err.message);
    return [];
  }
}

/**
 * Format recalled memories as a context prefix string.
 */
function formatMemories(memories) {
  if (!memories || memories.length === 0) return '';
  const lines = memories.map(m => {
    if (m.value) return `- ${m.entity ? m.entity + '/' : ''}${m.attribute ? m.attribute + ': ' : ''}${m.value}`;
    if (m.content) return `- ${m.content}`;
    if (typeof m === 'string') return `- ${m}`;
    return `- ${JSON.stringify(m)}`;
  });
  return `[Relevant context from memory]:\n${lines.join('\n')}`;
}

// ── Hermes server HTTP client ─────────────────────────────────────────────────

/**
 * Simple HTTP GET request.
 */
function httpGet(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body)); }
          catch (e) { resolve({ raw: body }); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

/**
 * Simple HTTP POST to Hermes server.
 */
function httpPost(url, body, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + (parsed.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body)); }
          catch (e) { resolve({ response: body }); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * Check if Hermes server is alive.
 */
async function isHermesServerAlive() {
  try {
    await httpGet(HERMES_SERVER_URL + '/health', 3000);
    return true;
  } catch {
    return false;
  }
}

// ── Main invocation methods ────────────────────────────────────────────────────

/**
 * Invoke Hermes via persistent server with optional pre-warmed context.
 */
async function invokeHermesPersistent(prompt, options = {}) {
  const { sessionId, prewarm = true, timeout = 120000 } = options;

  let contextPrefix = '';
  if (prewarm) {
    const memories = await recallMemories(prompt);
    contextPrefix = formatMemories(memories);
  }

  const reqBody = {
    prompt,
    session_id: sessionId || undefined,
    prewarm,
    context_prefix: contextPrefix || undefined,
  };

  try {
    const result = await httpPost(`${HERMES_SERVER_URL}/chat`, reqBody, timeout);
    return { success: true, output: result.response, session_id: result.session_id, turn: result.turn, elapsed_ms: result.elapsed_ms };
  } catch (err) {
    return { success: false, output: '', error: err.message };
  }
}

/**
 * Invoke Hermes CLI (fallback when server is not running).
 */
function invokeHermesCLI(prompt, options = {}) {
  const { timeout = 120000 } = options;
  const envVars = loadEnvVars();
  const env = { ...process.env, ...envVars, HERMES_HOME, PYTHONPATH: HERMES_DIR };
  try {
    const output = execSync(
      `cd ${HERMES_DIR} && python3 -m hermes_cli --print --prompt ${JSON.stringify(prompt)}`,
      { env, timeout, cwd: HERMES_DIR, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );
    return { success: true, output: output.trim() };
  } catch (err) {
    return { success: false, output: '', error: err.message || String(err) };
  }
}

/**
 * Invoke Hermes: tries persistent server first, falls back to CLI.
 */
async function invokeHermes(prompt, options = {}) {
  const alive = await isHermesServerAlive();
  if (alive) {
    return invokeHermesPersistent(prompt, options);
  }
  console.warn('[hermes-router] Server not available, falling back to CLI');
  return invokeHermesCLI(prompt, options);
}

/**
 * Route a message and handle it appropriately.
 */
function route(message) {
  const decision = shouldInvokeHermes(message);
  return {
    handler: decision.invoke ? 'hermes' : 'openclaw',
    score: decision.score,
    reason: decision.reason,
  };
}

/**
 * Full route-and-invoke pipeline (for external callers).
 * @returns {Promise<{handler, score, reason, result?}>}
 */
async function routeWithContext(message, options = {}) {
  const decision = route(message);
  if (decision.handler === 'hermes') {
    const result = await invokeHermes(message, { prewarm: true, ...options });
    return { ...decision, result };
  }
  return decision; // openclaw handles it
}

module.exports = {
  shouldInvokeHermes,
  invokeHermes,
  invokeHermesPersistent,
  invokeHermesCLI,
  recallMemories,
  formatMemories,
  isHermesServerAlive,
  route,
  routeWithContext,
  loadEnvVars,
};

// CLI usage: node hermes-router-enhanced.js "your message here"
if (require.main === module) {
  const msg = process.argv.slice(2).join(' ');
  if (!msg) {
    console.log('Usage: node hermes-router-enhanced.js "your message"');
    process.exit(1);
  }
  (async () => {
    const result = await routeWithContext(msg);
    console.log(JSON.stringify(result, null, 2));
  })().catch(err => { console.error(err); process.exit(1); });
}
