#!/usr/bin/env node
// custom-skills/graphify-manager/query-layer.js
const neo4j = require('neo4j-driver');
const NodeCache = require('node-cache');

class QueryLayer {
  constructor(config = {}) {
    this.config = {
      neo4jUri: 'bolt://localhost:7687',
      neo4jAuth: { user: 'neo4j', password: 'openclaw_neo4j_2026' },
      cacheTtl: 300,
      maxResults: 20,
      ...config
    };
    
    this.neo4jDriver = null;
    this.cache = new NodeCache({ stdTTL: this.config.cacheTtl, checkperiod: 60 });
    
    this.stats = { totalQueries: 0, cacheHits: 0, graphifyQueries: 0, failedQueries: 0 };
    
    this.codeKeywords = ['代码', '函数', '类', 'API', '模块', '文件', '项目', '实现', '编程', '开发', '源码', 'git', 'commit', 'push', 'pull', '变量', '参数', '返回值', '接口', '抽象', '继承', '多态', '算法', '数据库', '缓存', '队列', '栈', '树', '引擎', '服务', '管理器', '处理器', '路由', '控制器', '中间件', '插件', '工作者', '任务', '作业', '配置', '状态', '错误', '结果', '工作流', '构建器', 'class', 'function', 'method', 'import', 'export', 'async', 'await', 'def', 'const', 'let', 'var', 'return', 'if', 'else', 'for', 'while', 'try', 'catch', 'throw', 'new', 'this', 'self', 'public', 'private', 'static', 'void', 'int', 'string', 'bool', 'true', 'false', 'null', 'None', 'True', 'False', 'engine', 'handler', 'service', 'manager', 'controller', 'router', 'middleware', 'plugin', 'worker', 'task', 'job', 'queue', 'cache', 'config', 'route', 'workflow', 'status', 'error', 'result', 'builder', 'factory', 'parser', 'validator', 'formatter', 'converter', 'client', 'server', 'database', 'util', 'helper', 'base', 'core', 'common', 'utils', 'check', 'checker', 'test', 'mock', 'spy', 'init', 'setup', 'teardown', 'run', 'execute', 'start', 'stop', 'pause', 'resume', 'reset', 'load', 'save', 'read', 'write', 'parse', 'format', 'encode', 'decode', 'validate', 'transform', 'convert', 'map', 'filter', 'reduce', 'merge', 'split', 'join', 'find', 'search', 'match', 'replace', 'update', 'delete', 'remove', 'create', 'destroy', 'add', 'remove', 'set', 'get', 'put', 'post', 'get', 'delete', 'patch'];
    this.docKeywords = ['文档', '说明', '帮助', '教程', '指南', 'README', '手册', '配置', '安装', '部署', '使用', '示例', 'demo', '原理', '架构', '设计', '规划', '方案', '报告', '总结'];
  }

  async connect() {
    try {
      this.neo4jDriver = neo4j.driver(
        this.config.neo4jUri,
        neo4j.auth.basic(this.config.neo4jAuth.user, this.config.neo4jAuth.password)
      );
      const session = this.neo4jDriver.session();
      await session.run('RETURN 1');
      await session.close();
      console.log('✅ Neo4j 连接成功');
      return true;
    } catch (error) {
      console.error('❌ Neo4j 连接失败:', error.message);
      return false;
    }
  }

  async query(userQuery, userId, sessionId, context = {}) {
    const startTime = Date.now();
    this.stats.totalQueries++;
    
    try {
      const route = this.routeQuery(userQuery, context);
      const cacheKey = `gq:${userId}:${Buffer.from(userQuery).toString('base64').substring(0, 50)}`;
      
      const cached = this.cache.get(cacheKey);
      if (cached) {
        this.stats.cacheHits++;
        return cached;
      }
      
      const results = route.includeGraphify 
        ? await this.queryGraphify(userQuery, userId, route)
        : [];
      
      const finalResults = this.annotateResults(results, route);
      this.cache.set(cacheKey, finalResults);
      
      return finalResults;
    } catch (error) {
      this.stats.failedQueries++;
      console.error('Graphify 查询失败:', error.message);
      return [];
    }
  }

  routeQuery(userQuery, context = {}) {
    const q = userQuery.toLowerCase();
    const hasCode = this.codeKeywords.some(k => q.includes(k));
    const hasDoc = this.docKeywords.some(k => q.includes(k));
    
    return {
      includeGraphify: hasCode || hasDoc || context.source === 'code',
      priority: hasCode ? 'code' : (hasDoc ? 'doc' : 'memory'),
      maxResults: hasCode ? 12 : 8,
      weight: hasCode ? 0.7 : (hasDoc ? 0.5 : 0.3)
    };
  }

  async queryGraphify(userQuery, userId, route) {
    this.stats.graphifyQueries++;
    const session = this.neo4jDriver.session();
    
    try {
      // 查询 GraphifyCode 和 GraphifyFile 节点
      const result = await session.run(`
        MATCH (g:GraphifyCode)
        WHERE toLower(g.name) CONTAINS toLower($query) 
           OR toLower(g.type) CONTAINS toLower($query)
           OR (g.tags IS NOT NULL AND toLower(g.tags) CONTAINS toLower($query))
        OPTIONAL MATCH (g)-[:BELONGS_TO]->(f:GraphifyFile)
        OPTIONAL MATCH (g)-[r]->(other:GraphifyCode)
        WHERE g <> other
        RETURN g, f, collect({type: type(r), target: other.name, weight: r.weight}) as relations
        ORDER BY g.name
        LIMIT $limit
      `, { query: userQuery.substring(0, 100), limit: neo4j.int(route.maxResults) });
      
      return result.records.map(record => {
        const g = record.get('g');
        const f = record.get('f');
        const relations = record.get('relations') || [];
        
        return {
          id: g.properties.id || g.properties.name,
          type: 'graphify',
          subtype: 'code',
          name: g.properties.name,
          codeType: g.properties.type,
          file: f ? f.properties.path : null,
          relations: relations.filter(r => r.type).slice(0, 5),
          confidence: 0.85,
          source: 'graphify',
          score: route.weight
        };
      });
    } finally {
      await session.close();
    }
  }

  annotateResults(results, route) {
    return results.map(item => ({
      ...item,
      displayName: item.name || item.content,
      displaySource: item.source === 'graphify' ? '💻 代码图谱' : '💭 对话记忆',
      icon: item.source === 'graphify' ? '💻' : '💭',
      priority: route.priority,
      formatted: this.formatResult(item)
    }));
  }

  formatResult(item) {
    if (item.source === 'graphify') {
      return `[${item.codeType || 'code'}] ${item.name}${item.file ? ` (${item.file.split('/').pop()})` : ''}`;
    }
    return item.content ? item.content.substring(0, 100) : item.name;
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
    if (this.neo4jDriver) {
      await this.neo4jDriver.close();
    }
    this.cache.flushAll();
  }
}

module.exports = QueryLayer;