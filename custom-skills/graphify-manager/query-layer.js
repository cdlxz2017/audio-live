#!/usr/bin/env node
// custom-skills/graphify-manager/query-layer.js
// 统一查询层：Graphify (Neo4j) + 记忆系统 (PostgreSQL) + 语义路由
// C2: 新增向量语义搜索路径，与全文索引并行，结果合并
const neo4j = require('neo4j-driver');
const { Client } = require('pg');
const NodeCache = require('node-cache');
const { promisify } = require('util');
const { exec } = require('child_process');
const execAsync = promisify(exec);
const { embedOne } = require('./embedder');
const crypto = require('crypto');

class QueryLayer {
  constructor(config = {}) {
    this.config = {
      neo4jUri: 'bolt://localhost:7687',
      neo4jAuth: { user: 'neo4j', password: 'openclaw_neo4j_2026' },
      pgConfig: {
        database: 'openclaw_memory',
        user: 'openclaw_ai',
        password: 'zyxrcy910128',
        host: 'localhost',
        port: 5432
      },
      ollamaUrl: 'http://localhost:11434/api/embeddings',
      cacheTtl: 300,
      maxResults: 20,
      ...config
    };

    this.neo4jDriver = null;
    this.pgClient = null;
    this.cache = new NodeCache({ stdTTL: this.config.cacheTtl, checkperiod: 60 });

    this.stats = { totalQueries: 0, cacheHits: 0, graphifyQueries: 0, memoryQueries: 0, vectorQueries: 0, failedQueries: 0 };

    // ===== 路由关键词 =====
    this.codeKeywords = [
      '代码', '函数', '类', 'class', 'function', 'method', 'API', '模块', '文件',
      '项目', '实现', '编程', '开发', '源码', 'git', 'commit', 'push', 'pull',
      '变量', '参数', '返回值', '接口', '抽象', '继承', '多态', '算法',
      '数据库', '缓存', '队列', '栈', '树', '引擎', 'engine', 'service',
      '管理器', 'manager', '处理器', 'handler', '路由', 'router', 'controller',
      '中间件', 'middleware', '插件', 'plugin', 'worker', 'task', 'job',
      'import', 'export', 'async', 'await', 'def', 'const', 'let', 'var',
      'return', 'if', 'else', 'for', 'while', 'try', 'catch', 'throw',
      'new', 'this', 'self', 'public', 'private', 'static', 'void',
      'int', 'string', 'bool', 'true', 'false', 'null', 'None',
      'engine', 'handler', 'service', 'manager', 'controller', 'router',
      'middleware', 'plugin', 'worker', 'task', 'job', 'queue', 'cache',
      'config', 'route', 'workflow', 'status', 'error', 'result',
      'builder', 'factory', 'parser', 'validator', 'formatter', 'converter',
      'client', 'server', 'database', 'util', 'helper', 'base', 'core',
      'common', 'utils', 'check', 'checker', 'test', 'mock', 'spy',
      'init', 'setup', 'teardown', 'run', 'execute', 'start', 'stop',
      'load', 'save', 'read', 'write', 'parse', 'format', 'encode', 'decode',
      'validate', 'transform', 'convert', 'find', 'search', 'match',
      'replace', 'update', 'delete', 'create', 'destroy', 'add', 'remove', 'set', 'get',
      'python', 'javascript', 'js', 'node', 'nodejs', 'rust', 'go', 'java',
      '提取', '解析', '正则', '匹配', 'bridge', 'layer', 'query', 'layer',
      'Graphify', 'GraphifyBridge', 'QueryLayer', 'extract', 'embedding',
      'neo4j', 'redis', 'stream', 'pm2', 'ecosystem', 'script'
    ];

    this.memoryKeywords = [
      '记得', '记住', '之前', '上次', '上周', '昨天', '那天', '曾经',
      '告诉我', '查一下', '有什么', '我做过的', '说过的', '决定',
      '任务', 'todo', '计划', '安排', '会议', '约定',
      'person', 'people', 'name', 'who', '谁', '人名',
      'when', '什么时候', '哪天', '几点',
      'where', '在哪', '地点', '位置',
      'what', '什么事', '做什么', '发生了什么',
      'why', '为什么', '原因',
      'how', '怎么', '如何', '怎样',
      'session', '对话', '聊天', '聊过', '提过',
      'fact', '事件', '事实', '真', '假', '对', '错'
    ];

    this.projectKeywords = [
      '系统', '架构', '设计', '方案', '修改', '改动', '变更',
      'bug', '问题', '修复', '优化', '性能', '内存', 'cpu',
      'deploy', '部署', '上线', '发布', '版本',
      'sop', '流程', '规范', '标准', '原则',
      'skill', '插件', '扩展', '集成',
      'summary', 'extractor', 'bridge', 'linker', 'sync',
      'memory', 'graph', '图谱', '知识', '索引',
      'gateway', 'openclaw', 'config', '配置'
    ];
  }

  async connect() {
    try {
      this.neo4jDriver = neo4j.driver(
        this.config.neo4jUri,
        neo4j.auth.basic(this.config.neo4jAuth.user, this.config.neo4jAuth.password)
      );
      const s = this.neo4jDriver.session();
      await s.run('RETURN 1');
      await s.close();
      console.log('✅ Neo4j 连接成功');
    } catch (error) {
      console.error('❌ Neo4j 连接失败:', error.message);
    }

    try {
      this.pgClient = new Client(this.config.pgConfig);
      await this.pgClient.connect();
      await this.pgClient.query('SELECT 1');
      console.log('✅ PostgreSQL 连接成功');
    } catch (error) {
      console.error('❌ PostgreSQL 连接失败:', error.message);
      this.pgClient = null;
    }

    return !!(this.neo4jDriver && this.pgClient);
  }

  routeQuery(userQuery, context = {}) {
    const q = userQuery.toLowerCase();
    const hasCode = this.codeKeywords.some(k => q.includes(k));
    const hasMemory = this.memoryKeywords.some(k => q.includes(k));
    const hasProject = this.projectKeywords.some(k => q.includes(k));

    const codeScore = hasCode ? 0.8 : 0;
    const memoryScore = hasMemory ? 0.6 : 0;
    const projectScore = hasProject ? 0.4 : 0;

    let intent = 'general';
    if (hasCode && !hasMemory) intent = 'code';
    else if (hasMemory && !hasCode) intent = 'memory';
    else if (hasCode && hasMemory) intent = 'mixed';
    else if (hasProject) intent = 'project';

    return {
      intent,
      includeGraphify: hasCode || hasProject,
      includeMemory: hasMemory || hasProject || !hasCode,
      priority: intent === 'code' ? 'code' : intent === 'memory' ? 'memory' : intent === 'project' ? 'project' : 'general',
      maxResults: hasCode ? 12 : 8,
      weight: { code: 0.8, memory: 0.6, project: 0.5 }
    };
  }

  async query(userQuery, userId, sessionId, context = {}) {
    const startTime = Date.now();
    this.stats.totalQueries++;

    try {
      const route = this.routeQuery(userQuery, context);
      // 缓存 key：使用 SHA-256 哈希（不截断，避免碰撞）+ 查询文本归一化（小写 + trim）
      // 知识库查询是 session-agnostic 的，不含 userId 确保跨会话复用
      const normalizedQuery = userQuery.toLowerCase().trim();
      const queryHash = crypto.createHash('sha256').update(normalizedQuery).digest('hex').substring(0, 40);
      const cacheKey = 'q:' + queryHash;

      const cached = this.cache.get(cacheKey);
      if (cached) {
        this.stats.cacheHits++;
        return cached;
      }

      const [graphifyResults, vectorResults, memoryResults] = await Promise.all([
        route.includeGraphify ? this.queryGraphify(userQuery, route) : [],
        route.includeGraphify ? this.queryGraphifyVector(userQuery, route) : [],
        route.includeMemory ? this.queryMemory(userQuery, route) : []
      ]);
      // C2: 合并全文索引 + 向量结果（去重后按得分排序）
      const mergedGraphify = this._mergeGraphifyResults(graphifyResults, vectorResults, route);

      const merged = this.mergeResults(mergedGraphify, memoryResults, route);
      const enhanced = await this.enrichWithAlignments(merged, route);
      const finalResults = this.annotateResults(enhanced, route);
      this.cache.set(cacheKey, finalResults);
      return finalResults;
    } catch (error) {
      this.stats.failedQueries++;
      console.error('统一查询失败:', error.message);
      return [];
    }
  }

  // ── C2: 向量语义搜索 ────────────────────────────────────────────────

  /**
   * queryGraphifyVector: 基于 BGE-m3 向量的语义搜索
   * 从 graphify_code_embeddings (PostgreSQL) 检索最近邻
   * 得分归一化：余弦相似度 [0,1]（内积转换）
   */
  async queryGraphifyVector(userQuery, route) {
    if (!this.pgClient) return [];
    this.stats.vectorQueries++;
    try {
      // 1. 生成查询向量
      const queryEmbedding = await embedOne(userQuery.substring(0, 500), 'bge-m3:latest', this.config.ollamaUrl);

      // 2. 向量近邻搜索（HNSW index，内积距离；BGE-m3 向量已归一化，<#> 取反即余弦相似度）
      //    得分公式：cosine_sim = 1 - (-<#>)/max_ip_norm
      //    实用做法：用 (1 + ip_dist) / 2 归一化到 [0,1]（ip_dist 在 [-1,1] 之间）
      const vectorJson = JSON.stringify(queryEmbedding);
      const limit = Math.min(route.maxResults, 15);

      const result = await this.pgClient.query(
        `SELECT
           e.node_id,
           e.node_name,
           e.node_type,
           e.tags,
           e.file_path,
           e.embed_text,
           1 - (e.embedding <=> $1::vector) AS cosine_sim
         FROM graphify_code_embeddings e
         ORDER BY e.embedding <=> $1::vector ASC
         LIMIT $2`,
        [vectorJson, limit]
      );

      if (result.rows.length === 0) return [];

      // 3. 过滤低相关性（cosine_sim < 0.55 视为噪声）
      const MIN_SIM = 0.55;
      const filtered = result.rows.filter(r => parseFloat(r.cosine_sim) >= MIN_SIM);

      return filtered.map(r => ({
        id: r.node_id,
        type: 'graphify',
        subtype: 'code',
        name: r.node_name,
        codeType: r.node_type,
        file: r.file_path || null,
        fileName: r.file_path ? r.file_path.split('/').pop() : null,
        tags: r.tags || null,
        relations: [],
        confidence: parseFloat(r.cosine_sim),
        source: 'graphify',
        searchMode: 'vector',
        // C2 得分：向量相似度 * 权重
        score: route.weight.code * parseFloat(r.cosine_sim)
      }));
    } catch (err) {
      // 向量查询失败不影响全文索引结果
      console.warn('[query] 向量查询失败:', err.message.substring(0, 80));
      return [];
    }
  }

  /**
   * _mergeGraphifyResults: 合并全文索引 + 向量结果
   * 策略：
   *   1. node_id 去重（全文 + 向量各命中同一节点时取较高分）
   *   2. 向量结果得分 * VECTOR_WEIGHT，全文得分 * FULLTEXT_WEIGHT
   *   3. 最终按合并得分降序
   */
  _mergeGraphifyResults(fulltextResults, vectorResults, route) {
    const FULLTEXT_WEIGHT = 0.6;  // 全文索引权重
    const VECTOR_WEIGHT   = 0.4;  // 向量权重（语义补充）

    const map = new Map();

    // 全文结果入 map
    for (const item of fulltextResults) {
      const key = item.id || item.name;
      map.set(key, { ...item, _ftScore: item.score, _vecScore: 0, _sources: ['fulltext'] });
    }

    // 向量结果合并
    for (const item of vectorResults) {
      const key = item.id || item.name;
      if (map.has(key)) {
        // 同一节点：两路得分加权融合
        const existing = map.get(key);
        existing._vecScore = item.score;
        existing._sources.push('vector');
        existing.score = existing._ftScore * FULLTEXT_WEIGHT + item.score * VECTOR_WEIGHT;
        existing.confidence = Math.max(existing.confidence, item.confidence);
        existing.searchMode = 'hybrid';
      } else {
        // 仅向量命中（全文未命中的语义结果）
        map.set(key, {
          ...item,
          _ftScore: 0,
          _vecScore: item.score,
          _sources: ['vector'],
          score: item.score * VECTOR_WEIGHT
        });
      }
    }

    return [...map.values()].sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  // ────────────────────────────────────────────────────────────────────────────

  async queryGraphify(userQuery, route) {
    if (!this.neo4jDriver) return [];
    this.stats.graphifyQueries++;
    const session = this.neo4jDriver.session();

    try {
      // 使用 Neo4j 全文索引查询，支持多词、自然语言、布尔查询
      // 旧逻辑（CONTAINS 子串匹配，多词查询总是返回空）：
      // const result = await session.run(
      //   'MATCH (g:GraphifyCode) ' +
      //   'WHERE toLower(g.name) CONTAINS toLower($query) ' +
      //   '   OR toLower(g.type) CONTAINS toLower($query) ' +
      //   '   OR (g.tags IS NOT NULL AND toLower(g.tags) CONTAINS toLower($query)) ' +
      //   'OPTIONAL MATCH (g)-[:BELONGS_TO]->(f:GraphifyFile) ' +
      //   'OPTIONAL MATCH (g)-[r]->(other:GraphifyCode) ' +
      //   'WHERE g <> other ' +
      //   'RETURN g, f, collect(DISTINCT {type: type(r), target: other.name, weight: r.weight}) as relations ' +
      //   'ORDER BY g.name LIMIT $limit',
      //   { query: userQuery.substring(0, 100), limit: neo4j.int(route.maxResults) }
      // );
      const result = await session.run(
        `CALL db.index.fulltext.queryNodes(
          'graphify_code_fulltext',
          $query
        ) YIELD node AS g, score
        OPTIONAL MATCH (g)-[:BELONGS_TO]->(f:GraphifyFile)
        OPTIONAL MATCH (g)-[r]->(other:GraphifyCode)
        WHERE g <> other
        RETURN g, f, score,
          collect(DISTINCT {type: type(r), target: other.name, weight: r.weight}) as relations
        ORDER BY score DESC
        LIMIT $limit`,
        { query: userQuery.substring(0, 200), limit: neo4j.int(route.maxResults) }
      );

      return result.records.map(record => {
        const g = record.get('g');
        const f = record.get('f');
        const relations = (record.get('relations') || []).filter(r => r.type);
        const ftScore = record.get('score');
        return {
          id: g.properties.id || g.properties.name,
          type: 'graphify',
          subtype: 'code',
          name: g.properties.name,
          codeType: g.properties.type,
          file: f ? f.properties.path : null,
          fileName: f ? f.properties.name : null,
          tags: g.properties.tags || null,
          relations: relations.slice(0, 5),
          confidence: 0.85,
          source: 'graphify',
          score: route.weight.code + (ftScore ? ftScore * 0.3 : 0) // 全文索引得分叠加
        };
      });
    } finally {
      await session.close();
    }
  }

  async queryMemory(userQuery, route) {
    if (!this.pgClient) return [];
    this.stats.memoryQueries++;
    const q = userQuery.trim();
    const limit = Math.min(route.maxResults, 8);
    const limit3 = Math.min(route.maxResults, 4);

    try {
      // 1. memories 表 entity/attribute/value 匹配
      // C3 改动: plainto_tsquery -> websearch_to_tsquery，支持短语/AND/OR/NOT 查询
      const exactResult = await this.pgClient.query(
        'SELECT id, entity, attribute, value, memory_type, confidence, ' +
        '       created_at, updated_at, source ' +
        'FROM memories ' +
        'WHERE is_deleted = false ' +
        '  AND (to_tsvector(\'simple\', coalesce(entity,\'\') || \' \' || coalesce(attribute,\'\') || \' \' || coalesce(value,\'\')) ' +
        // '       @@ plainto_tsquery(\'simple\', $1) ' +  // 旧: 仅支持空格分隔词
        '       @@ websearch_to_tsquery(\'simple\', $1) ' +  // 新: 支持短语"" AND OR NOT
        '       OR entity ILIKE $2 OR attribute ILIKE $2 OR value ILIKE $2) ' +
        'ORDER BY confidence DESC NULLS LAST, updated_at DESC LIMIT $3',
        [q, '%' + q + '%', limit]
      );

      // 2. memory_summaries 全文检索
      // C3 改动: plainto_tsquery -> websearch_to_tsquery，支持短语/AND/OR/NOT 查询
      const summaryResult = await this.pgClient.query(
        'SELECT id, summary, summary_type, time_range_start, time_range_end, ' +
        '       created_at, confidence, metadata ' +
        'FROM memory_summaries ' +
        'WHERE is_active = true ' +
        '  AND (to_tsvector(\'simple\', coalesce(summary, \'\')) ' +
        // '       @@ plainto_tsquery(\'simple\', $1) ' +  // 旧: 仅支持空格分隔词
        '       @@ websearch_to_tsquery(\'simple\', $1) ' +  // 新: 支持短语"" AND OR NOT
        '       OR summary ILIKE $2) ' +
        'ORDER BY ts_rank(to_tsvector(\'simple\', coalesce(summary, \'\')), websearch_to_tsquery(\'simple\', $1)) DESC, ' +
        '         created_at DESC LIMIT $3',
        [q, '%' + q + '%', limit3]
      );

      const memories = exactResult.rows.map(r => ({
        id: 'mem-' + r.id,
        type: 'memory',
        subtype: 'structured',
        entity: r.entity,
        attribute: r.attribute,
        value: r.value,
        memoryType: r.memory_type,
        confidence: r.confidence || 0.5,
        createdAt: r.created_at,
        source: r.source || 'memory',
        score: route.weight.memory * (r.confidence || 0.5)
      }));

      const summaries = summaryResult.rows.map(r => ({
        id: 'sum-' + r.id,
        type: 'memory',
        subtype: 'summary',
        content: r.summary,
        summaryType: r.summary_type,
        timeRange: r.time_range_start ? r.time_range_start + ' ~ ' + (r.time_range_end || 'ongoing') : null,
        confidence: r.confidence || 0.6,
        createdAt: r.created_at,
        metadata: r.metadata || {},
        score: route.weight.memory * 0.8
      }));

      return [...memories, ...summaries];
    } catch (error) {
      console.error('记忆查询失败:', error.message);
      return [];
    }
  }

  async enrichWithAlignments(results, route) {
    if (!this.neo4jDriver) return results;
    const graphifyItems = results.filter(r => r.type === 'graphify');
    if (graphifyItems.length === 0) return results;

    const session = this.neo4jDriver.session();
    try {
      for (const item of graphifyItems) {
        const aligned = await session.run(
          'MATCH (g:GraphifyCode {id: $gid})-[r:ALIGNED_TO]->(m:Memory_summary) ' +
          'RETURN m.id as mid, m.summary as summary, r.confidence as conf ' +
          'ORDER BY r.confidence DESC LIMIT 3',
          { gid: item.id }
        );
        if (aligned.records.length > 0) {
          item.alignedMemories = aligned.records.map(rec => ({
            id: rec.get('mid'),
            summary: rec.get('summary'),
            confidence: rec.get('conf')
          }));
        }

        const alignedPM = await session.run(
          'MATCH (g:GraphifyCode {id: $gid})-[r:ALIGNED_TO]->(pm:PersonalMemory) ' +
          'RETURN pm.id as pmid, pm.entity as entity, pm.value as value, r.confidence as conf ' +
          'ORDER BY r.confidence DESC LIMIT 2',
          { gid: item.id }
        );
        if (alignedPM.records.length > 0) {
          item.alignedPersonalMemories = alignedPM.records.map(rec => ({
            id: rec.get('pmid'),
            entity: rec.get('entity'),
            value: rec.get('value'),
            confidence: rec.get('conf')
          }));
        }
      }
    } catch (error) {
      // 对齐查询失败不影响主查询
    } finally {
      await session.close();
    }
    return results;
  }

  mergeResults(graphifyResults, memoryResults, route) {
    // 节点类型权重（改动三：Graphify 查询层节点类型加分）
    const NODE_TYPE_BOOST = {
      'skill': 0.15,
      'sop': 0.15,
      'agent': 0.15,
      'project_code': 0.10,
      'tech_doc': 0.10,
      'memory': 0.08,
      'code': 0.05,
      'package_json': -0.10,
      'config_json': -0.05,
      'messages_json': -0.15,  // Chrome插件多语言文件
      'lock': -0.15,          // package-lock.json
    };
    const all = [
      ...graphifyResults.map(r => ({ ...r, _source: 'graphify' })),
      ...memoryResults.map(r => ({ ...r, _source: 'memory' }))
    ];
    // 应用节点类型权重
    for (const item of all) {
      const itemType = item.codeType || item.type || '';
      const boost = NODE_TYPE_BOOST[itemType] || 0;
      item.score = (item.score || 0) + boost;
    }
    all.sort((a, b) => (b.score || 0) - (a.score || 0));
    return all.slice(0, this.config.maxResults);
  }

  annotateResults(results, route) {
    return results.map(item => ({
      ...item,
      displayName: item.name || item.content || item.entity || 'Memory ' + item.id,
      displaySource: item.source === 'graphify' ? '💻 代码图谱' : '💭 记忆系统',
      icon: item.source === 'graphify' ? '💻' : '💭',
      intent: route.intent,
      formatted: this.formatResult(item)
    }));
  }

  formatResult(item) {
    if (item.source === 'graphify') {
      const file = item.file ? ' (' + item.file.split('/').pop() + ')' : '';
      const aligned = item.alignedMemories ? ' → 📎对齐 ' + item.alignedMemories.length + ' 条记忆' : '';
      const mode = item.searchMode === 'vector' ? '🔍' : item.searchMode === 'hybrid' ? '🔮' : '';
      return mode + '[' + (item.codeType || 'code') + '] ' + item.name + file + aligned;
    }
    if (item.subtype === 'summary') {
      return '[' + (item.summaryType || 'summary') + '] ' + item.content.substring(0, 120) + (item.content.length > 120 ? '...' : '');
    }
    const parts = [(item.memoryType || 'fact'), item.entity || '', item.attribute || '', ':', item.value || ''];
    return parts.filter(Boolean).join(' ').substring(0, 150);
  }

  getStats() {
    return {
      ...this.stats,
      cacheSize: this.cache.getStats().keys,
      hitRate: this.stats.totalQueries > 0
        ? (this.stats.cacheHits / this.stats.totalQueries * 100).toFixed(1) + '%'
        : '0%'
    };
  }

  async stop() {
    if (this.neo4jDriver) await this.neo4jDriver.close();
    if (this.pgClient) await this.pgClient.end();
    this.cache.flushAll();
  }
}

module.exports = QueryLayer;
