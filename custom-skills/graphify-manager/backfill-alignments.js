#!/usr/bin/env node
// backfill-alignments.js - 一次性对齐所有现有 GraphifyCode 节点与 memory_summaries
// 策略：tags 文本 + 文件路径关键词 + summary 全文匹配
const neo4j = require('neo4j-driver');
const { Client } = require('pg');
const path = require('path');

async function main() {
  console.log('[backfill] 开始对齐现有 GraphifyCode 节点与 memory_summaries...');

  const driver = neo4j.driver(
    'bolt://localhost:7687',
    neo4j.auth.basic('neo4j', 'openclaw_neo4j_2026')
  );
  const pg = new Client({
    database: 'openclaw_memory',
    user: 'openclaw_ai',
    password: 'zyxrcy910128',
    host: 'localhost',
    port: 5432
  });
  await pg.connect();
  const sess = driver.session();

  // 获取所有 GraphifyCode 节点
  const nodesResult = await sess.run(
    'MATCH (g:GraphifyCode) RETURN g.id as id, g.name as name, g.type as type, g.file_path as filePath, g.tags as tags'
  );
  const nodes = nodesResult.records.map(r => ({
    id: r.get('id'),         // stable node id (e.g. js_class_10)
    displayName: r.get('name'), // display name (e.g. GraphifyBridge)
    type: r.get('type'),
    filePath: r.get('filePath'),
    tags: r.get('tags') || ''
  }));
  console.log('[backfill] 找到 ' + nodes.length + ' 个 GraphifyCode 节点');

  // 获取 memory_summaries（全量）
  const summariesResult = await pg.query(
    'SELECT id, summary, summary_type FROM memory_summaries WHERE is_active = true AND summary IS NOT NULL'
  );
  const summaries = summariesResult.rows;
  console.log('[backfill] 找到 ' + summaries.length + ' 条 memory_summaries');

  // ===== 路径关键词 → 摘要关键词映射 =====
  // 路径含 X + summary 含 Y → 交叉得分
  const PATH_SEMANTIC_MAP = [
    // [路径片段, summary正则关键词]
    ['graphify', 'graphify'],
    ['graph-linker', 'graph.link'],
    ['graphlinker', 'graph.link'],
    ['summary-extractor', 'summary.extractor'],
    ['summary_extractor', 'summary.extractor'],
    ['session-extractor', 'session.extractor'],
    ['session_file_extractor', 'session.extractor'],
    ['memory-system', 'memory.system'],
    ['memory_system', 'memory.system'],
    ['tech-knowledge', 'tech.knowledge'],
    ['techknowledge', 'tech.knowledge'],
    ['tiandao', 'tiandao'],
    ['openclaw', 'openclaw'],
    ['lingyi', 'lingyi'],
    ['karma', 'karma'],
    ['worldevent', 'world.event'],
    ['e2e', 'e2e'],
    ['workflow', 'workflow'],
    ['cache', 'cache'],
    ['api_handler', 'api'],
    ['auth', 'auth'],
    ['member', 'member'],
    ['admin', 'admin'],
    ['bridge-layer', 'bridge'],
    ['bridge_layer', 'bridge'],
    ['query-layer', 'query'],
    ['query_layer', 'query'],
    ['embed', 'embed'],
    ['neo4j', 'neo4j'],
    ['redis', 'redis'],
    ['pm2', 'pm2'],
    ['database', 'database'],
    ['gateway', 'gateway'],
    ['webhook', 'webhook'],
  ];

  let aligned = 0;

  for (const node of nodes) {
    // 构建搜索 token 集
    const tokens = new Set();
    tokens.add(node.displayName.toLowerCase());
    tokens.add(node.type || '');
    for (const t of node.tags.split(',')) {
      const clean = t.trim().toLowerCase();
      if (clean.length > 2) tokens.add(clean);
    }
    // 文件路径各部分
    const fp = (node.filePath || '').toLowerCase();
    for (const part of fp.split('/')) {
      const clean = part.replace(/\.[^.]+$/, '').replace(/[_\-]/g, ' ').trim();
      if (clean.length > 2) tokens.add(clean);
    }

    const scored = [];

    for (const s of summaries) {
      const sText = ((s.summary_type || '') + ' ' + (s.summary || '')).toLowerCase();
      let score = 0;
      const matched = [];

      // 1. token 文本重叠
      for (const token of tokens) {
        if (token.length < 3) continue;
        if (sText.includes(token)) {
          score += 2;
          matched.push(token);
        }
      }

      // 2. 路径×摘要 交叉匹配
      for (const [pathKw, sumKw] of PATH_SEMANTIC_MAP) {
        const pathHas = fp.includes(pathKw);
        const sumHas = sText.includes(sumKw);
        if (pathHas && sumHas) {
          score += 3;
          matched.push('path×' + pathKw);
        }
      }

      // 3. 节点 displayName 在 summary 中独立出现
      if (node.displayName.length >= 3 && sText.includes(node.displayName.toLowerCase())) {
        score += 5;
        matched.push('name match');
      }

      if (score >= 2) {
        scored.push({ sid: s.id, summary: s.summary, score: Math.min(score / 12, 0.95), matched });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 5);

    for (const { sid, summary, score } of top) {
      await sess.run(
        'MATCH (g:GraphifyCode {id: $gid}) ' +
        'MERGE (m:Memory_summary {id: $sid}) SET m.summary = $summary ' +
        'MERGE (g)-[r:ALIGNED_TO]->(m) ' +
        'SET r.confidence = $conf, r.align_type = $alignType, r.aligned_at = datetime()',
        { gid: node.id, sid: String(sid), summary, conf: score, alignType: 'backfill_v2' }
      );
      aligned++;
    }

    if (top.length > 0) {
      console.log('[backfill] ' + node.displayName + ' -> ' + top.length + ' 条, top=' + top[0].score.toFixed(2));
    }
  }

  console.log('\n[backfill] 完成! 对齐关系总数: ' + aligned);

  // 验证
  const cnt = await sess.run('MATCH ()-[r:ALIGNED_TO]->() RETURN count(r) as c');
  console.log('[backfill] 验证: ' + cnt.records[0].get('c') + ' 个 ALIGNED_TO 关系');

  // 按节点展示
  const perNode = await sess.run(
    'MATCH (g:GraphifyCode)-[r:ALIGNED_TO]->(m:Memory_summary) ' +
    'RETURN g.name as codeName, count(r) as cnt, collect(LEFT(m.summary,60)) as sums ' +
    'ORDER BY cnt DESC LIMIT 15'
  );
  console.log('\n各节点对齐情况:');
  perNode.records.forEach(rec => {
    const cname = rec.get('codeName');
    const cnt = rec.get('cnt').toNumber();
    const sums = rec.get('sums');
    console.log(' [' + cnt + '] ' + cname);
    sums.slice(0, 2).forEach(s => console.log('     → ' + s));
  });

  await sess.close();
  await pg.end();
  await driver.close();
}

main().catch(e => {
  console.error('[backfill] 失败:', e.message);
  process.exit(1);
});
