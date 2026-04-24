/**
 * RecallService — 三级 HNSW 召回 + 意图分类 8 类
 */
const crypto = require('crypto');
const { embedder } = require('./embedder');
const db = require('./db');
const { getCachedCandidates, cacheCandidates } = require('./redis');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

const cfgPath = path.join(__dirname, '..', 'config.yaml');
const cfg = yaml.load(fs.readFileSync(cfgPath, 'utf8'));

const QUERY_INTENTS = {
  FACTUAL:'FACTUAL', PREFERENCE:'PREFERENCE', EVENT:'EVENT',
  TECHNICAL:'TECHNICAL', PROJECT:'PROJECT', PERSON:'PERSON',
  REASONING:'REASONING', DEFAULT:'DEFAULT',
};

const INTENT_KEYWORDS = {
  TECHNICAL: ['代码','函数','bug','error','api','docker','pm2','nginx','部署','编译','redis','sql','数据库','hook','plugin','config','git','node','npm','embedding','vector','hnsw','pgvector','prompt','llm','model','recall','memory','session','ollama','bge-m3'],
  PROJECT: ['项目','进度','milestone','sprint','计划','任务','deadline','roadmap','版本'],
  EVENT: ['昨天','今天','上周','上次','什么时候','几号','日期','事件','会议','发生'],
  PREFERENCE: ['喜欢','偏好','习惯','风格','设置','prefer','favorite','常用'],
  PERSON: ['谁','联系人','团队','同事','朋友','人','名字'],
  REASONING: ['为什么','分析','推理','原因','策略','方案','比较','权衡'],
  FACTUAL: ['是什么','定义','解释','含义','概念','知识'],
};

const TECHNICAL_PATTERNS = [
  /代码|函数|class |def |import |require\(|报错|bug|error/i,
  /api|route|endpoint|config|数据库|db|sql|docker|pm2|nginx/i,
  /\/[a-zA-Z_]+\.(py|js|ts|vue|tsx|go|java|rs)/,
  /\b(redis|mongo|postgresql|mysql|sqlite)/i,
  /graphify|hook|plugin|extension|module|package/i,
  /vector|embedding|cosine|hnsw|pgvector/i,
  /prompt|llm|model|token|temperature/i,
  /memory|recall|summary|extractor|archiver/i,
  /ollama|bge-m3|session/i,
];

const INTENT_CONFIG = cfg.intentConfig || {};

function classifyIntent(query) {
  const q = query.toLowerCase();
  if (TECHNICAL_PATTERNS.some(p => p.test(query))) return QUERY_INTENTS.TECHNICAL;
  for (const intent of ['PROJECT','EVENT','PREFERENCE','PERSON','REASONING','FACTUAL']) {
    if (INTENT_KEYWORDS[intent] && INTENT_KEYWORDS[intent].some(kw => q.includes(kw))) return QUERY_INTENTS[intent];
  }
  return QUERY_INTENTS.DEFAULT;
}

function computeQueryHash(query) {
  return crypto.createHash('md5').update(query.trim().toLowerCase()).digest('hex').substring(0, 16);
}

function timeDecayScore(createdAtMs, halfLifeHours = 2) {
  return Math.exp(-0.693 * (Date.now() - createdAtMs) / (halfLifeHours * 3600000));
}

function round(val, d) { return Math.round(val * 10**d) / 10**d; }

function computeRecallScore(intent, semanticSim, createdAtMs, confidence) {
  const ic = INTENT_CONFIG[intent] || INTENT_CONFIG.DEFAULT || {};
  const w = ic.weights || { semantic: 0.6, time_decay: 0.2, confidence: 0.2 };
  const ts = timeDecayScore(createdAtMs, ic.halfLifeHours || 2);
  const ageH = (Date.now() - createdAtMs) / 3600000;
  let tm = 1.0;
  if (ageH <= 1) tm = ic.recentMultiplier || 1.0;
  else if (ageH <= (ic.timeWindowHours || 24)) tm = ic.mediumDecay || 1.0;
  else tm = 0.05;
  return round(w.semantic * semanticSim + w.time_decay * ts * tm + w.confidence * confidence, 6);
}

function level2Rerank(scored, query, intent) {
  const qw = new Set(query.toLowerCase().split(/[\s|]+/).filter(w => w.length >= 2));
  const MAP = {
    TECHNICAL:['technical','code','config','debug','api'],
    PROJECT:['project','plan','milestone','sprint'],
    PREFERENCE:['preference','habit','style','setting'],
    EVENT:['event','fact','decision','meeting'],
    PERSON:['person','contact','team','user'],
    REASONING:['reasoning','analysis','decision','strategy'],
    FACTUAL:['fact','knowledge','definition'],
    DEFAULT:[],
  };
  return scored.map(c => {
    let bonus = 0;
    const ew = new Set([...((c.entity||'').toLowerCase().split(/\s+/).filter(w=>w.length>=2)),...((c.attribute||'').toLowerCase().split(/\s+/).filter(w=>w.length>=2))]);
    if ([...qw].some(w => ew.has(w))) bonus += 0.05;
    if ((MAP[intent]||[]).some(t => (c.memory_type||'').toLowerCase().includes(t))) bonus += 0.05;
    return { ...c, score: round(c.score + bonus, 6) };
  }).sort((a, b) => b.score - a.score);
}

class RecallService {
  async recall({ tenantId, userId, query, topK = 5, candidateK = 20 }) {
    const startTime = Date.now();
    const intent = classifyIntent(query);
    const queryHash = computeQueryHash(query);

    const cached = await getCachedCandidates(queryHash);
    if (cached) {
      await this._logRecall({ tenantId, userId, query, intent, results: cached, latencyMs: Date.now() - startTime });
      return { memories: cached, intent, cached: true };
    }

    const queryVec = await embedder.embed(query.substring(0, 500));
    const [memRes, sumRes, perRes] = await Promise.all([
      this._searchMemories(queryVec, tenantId, candidateK),
      this._searchSummaries(queryVec, candidateK),
      this._searchPersonal(queryVec, candidateK),
    ]);

    const all = [...memRes, ...sumRes, ...perRes];
    const scored = all.map(c => {
      const sim = 1 - (c.embedding_cosine_distance || 0);
      const ts = new Date(c.created_at).getTime();
      const score = computeRecallScore(intent, sim, ts, c.confidence || 0.8);
      return { ...c, score, similarity: round(sim, 4) };
    });

    const reranked = level2Rerank(scored, query, intent);
    const results = reranked.slice(0, topK);

    await cacheCandidates(queryHash, results);
    await this._logRecall({ tenantId, userId, query, intent, results, latencyMs: Date.now() - startTime });

    return { memories: results, intent, cached: false, latencyMs: Date.now() - startTime };
  }

  async _searchMemories(queryVec, tenantId, limit) {
    try {
      const vecStr = `[${queryVec.join(',')}]`;
      let sql, params;
      if (tenantId) {
        sql = `SELECT id, entity, attribute, value, memory_type, raw_text, content, confidence, is_active, created_at,
               embedding <=> $1::vector AS embedding_cosine_distance
               FROM memories WHERE tenant_id = $2 AND is_active = TRUE AND embedding IS NOT NULL
               ORDER BY embedding <=> $1::vector LIMIT $3`;
        params = [vecStr, tenantId, limit];
      } else {
        sql = `SELECT id, entity, attribute, value, memory_type, raw_text, content, confidence, is_active, created_at,
               embedding <=> $1::vector AS embedding_cosine_distance
               FROM memories WHERE is_active = TRUE AND embedding IS NOT NULL
               ORDER BY embedding <=> $1::vector LIMIT $2`;
        params = [vecStr, limit];
      }
      const result = await db.query(sql, params);
      return result.rows.map(r => ({ ...r, _table: 'memories' }));
    } catch (err) {
      console.error('[Recall] memories search error:', err.message);
      return [];
    }
  }

  async _searchSummaries(queryVec, limit) {
    try {
      const vecStr = `[${queryVec.join(',')}]`;
      const sql = `SELECT id, 'memory_summary' AS entity, summary_type AS attribute, summary AS value,
                   summary_type AS memory_type, summary AS raw_text, COALESCE(confidence, 0.8) AS confidence,
                   TRUE AS is_active, created_at,
                   embedding <=> $1::vector AS embedding_cosine_distance
                   FROM memory_summaries WHERE embedding IS NOT NULL AND is_active = TRUE
                   ORDER BY embedding <=> $1::vector LIMIT $2`;
      const result = await db.query(sql, [vecStr, limit]);
      return result.rows.map(r => ({ ...r, _table: 'memory_summaries' }));
    } catch (err) {
      console.error('[Recall] summaries search error:', err.message);
      return [];
    }
  }

  async _searchPersonal(queryVec, limit) {
    try {
      const vecStr = `[${queryVec.join(',')}]`;
      const sql = `SELECT id, 'personal' AS entity, category AS attribute, content AS value,
                   category AS memory_type, content AS raw_text, COALESCE(confidence, 0.8) AS confidence,
                   TRUE AS is_active, created_at,
                   embedding <=> $1::vector AS embedding_cosine_distance
                   FROM personal_memories WHERE embedding IS NOT NULL
                   ORDER BY embedding <=> $1::vector LIMIT $2`;
      const result = await db.query(sql, [vecStr, limit]);
      return result.rows.map(r => ({ ...r, _table: 'personal_memories' }));
    } catch (err) {
      console.error('[Recall] personal search error:', err.message);
      return [];
    }
  }

  async _logRecall({ tenantId, userId, query, intent, results, latencyMs }) {
    try {
      const ids = results.map(r => r.id).filter(Boolean);
      const scores = results.map(r => r.score || 0);
      const sources = results.map(r => r._table || 'unknown');
      await db.query(`INSERT INTO recall_logs (tenant_id, user_id, query_text, recalled_ids, recalled_sources, scores, latency_ms, intent)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [tenantId || '00000000-0000-0000-0000-000000000000', userId, query, `{${ids.join(',')}}`, sources, scores, latencyMs, intent]);
    } catch (err) {
      console.error('[Recall] log error:', err.message);
    }
  }
}

function buildMemoryPrompt(memories) {
  if (!memories || memories.length === 0) return '';
  const lines = ['[Recalled Memories]'];
  for (const m of memories) {
    if (m._table === 'memory_summaries') {
      lines.push(`- [${m.memory_type}] ${m.raw_text || m.value || ''}`);
    } else if (m._table === 'personal_memories') {
      lines.push(`- [${m.memory_type}] ${m.value || ''} (score: ${(m.score||0).toFixed(3)})`);
    } else {
      lines.push(`- [${m.memory_type}] ${m.entity}.${m.attribute} = ${m.value} (score: ${(m.score||0).toFixed(3)})`);
    }
  }
  lines.push('[End Memories]');
  return lines.join('\n');
}

const recallService = new RecallService();

module.exports = {
  RecallService, recallService, buildMemoryPrompt, classifyIntent,
  computeRecallScore, level2Rerank, QUERY_INTENTS,
};
