/**
 * Hermes Router
 * Decides when to invoke Hermes agent vs handle directly via OpenClaw.
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const HERMES_DIR = '/home/ai/apps/hermes-agent';
const HERMES_HOME = path.join(process.env.HOME, '.hermes');

// Patterns that indicate Hermes-level complexity
const HERMES_PATTERNS = [
  // Chinese
  /分析|比较|设计|研究|评估|优化|架构|重构|调试|实现|生成|编写|开发|规划/,
  // English
  /\b(analyze|analyse|compare|design|research|evaluate|optimize|architect|refactor|debug|implement|generate\s+code|code\s+review|review\s+code|explain\s+why|how\s+does|deep\s+dive)\b/i,
  // Task complexity signals
  /\b(step[- ]by[- ]step|multiple|complex|comprehensive|detailed\s+plan|full\s+implementation)\b/i,
];

// Patterns for direct OpenClaw handling
const DIRECT_PATTERNS = [
  /\b(what\s+is|when\s+(is|was|will)|where\s+is|who\s+is)\b/i,
  /记住|查一下|告诉我|什么时候|在哪里|是什么/,
  /\b(remember|recall|lookup|find|status|check)\b/i,
];

/**
 * Determine if a message should be routed to Hermes.
 * @param {string} message - User message
 * @returns {{ invoke: boolean, score: number, reason: string }}
 */
function shouldInvokeHermes(message) {
  if (!message || typeof message !== 'string') {
    return { invoke: false, score: 0, reason: 'empty message' };
  }

  const msg = message.trim();
  let score = 0;

  // Check Hermes patterns (any single match is sufficient to trigger)
  let hermesHits = 0;
  for (const pattern of HERMES_PATTERNS) {
    if (pattern.test(msg)) {
      hermesHits++;
      score += 3;
    }
  }
  // Bonus: multiple Hermes signals
  if (hermesHits >= 2) score += 2;

  // Penalize for direct patterns
  for (const pattern of DIRECT_PATTERNS) {
    if (pattern.test(msg)) {
      score -= 2;
    }
  }

  // Length heuristic: longer messages tend to be more complex
  if (msg.length > 200) score += 2;
  if (msg.length > 500) score += 1;

  // Code block presence
  if (/```|`[^`]+`/.test(msg)) score += 2;

  score = Math.max(0, Math.min(10, score));

  return {
    invoke: score >= 3,
    score,
    reason: score >= 3 ? 'complex task' : 'simple/direct task',
  };
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
      if (match) {
        vars[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    }
  }
  return vars;
}

/**
 * Invoke Hermes CLI with a prompt (synchronous, returns stdout).
 * @param {string} prompt - User message
 * @param {object} options - { timeout: number (ms), sessionId: string }
 * @returns {{ success: boolean, output: string, error?: string }}
 */
function invokeHermes(prompt, options = {}) {
  const { timeout = 120000 } = options;
  const envVars = loadEnvVars();

  const env = {
    ...process.env,
    ...envVars,
    HERMES_HOME,
    PYTHONPATH: HERMES_DIR,
  };

  try {
    const output = execSync(
      `cd ${HERMES_DIR} && python3 -m hermes_cli --print --prompt ${JSON.stringify(prompt)}`,
      { env, timeout, cwd: HERMES_DIR, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );
    return { success: true, output: output.trim() };
  } catch (err) {
    return {
      success: false,
      output: '',
      error: err.message || String(err),
    };
  }
}

/**
 * Route a message and handle it appropriately.
 * @param {string} message - User message
 * @returns {{ handler: 'hermes'|'openclaw', score: number, reason: string }}
 */
function route(message) {
  const decision = shouldInvokeHermes(message);
  return {
    handler: decision.invoke ? 'hermes' : 'openclaw',
    score: decision.score,
    reason: decision.reason,
  };
}

module.exports = { shouldInvokeHermes, invokeHermes, route, loadEnvVars };

// CLI usage: node hermes-router.js "your message here"
if (require.main === module) {
  const msg = process.argv.slice(2).join(' ');
  if (!msg) {
    console.log('Usage: node hermes-router.js "your message"');
    process.exit(1);
  }
  const result = route(msg);
  console.log(JSON.stringify(result, null, 2));
}
