#!/usr/bin/env node
// custom-skills/graphify-manager/backfill-embeddings.js
// Phase 2: 历史 GraphifyCode 节点批量回填 embedding（可中断、可续传）
'use strict';

const neo4j = require('neo4j-driver');
const { Client } = require('pg');
const { buildEmbedText, embedBatch } = require('./embedder');

const CONFIG = {
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
  model: 'bge-m3:latest',
  batchSize: 16,          // Neo4j 每批导出
  embedConcurrency: 2,    // Ollama 并发
  pgBatchInsert: 50,      // PostgreSQL 批量 upsert 大小
  // 进度报告间隔
  reportEvery: 100,
};

// ── 运行ID ────────────────────────────────────────────────
const RUN_ID = 'backfill-' + Date.now();

let driver = null;
let pg = null;
let interrupted = false;

// ── 优雅退出 ────────────────────────────────────────────────
process.on('SIGINT', () => { console.log('\n[backfill] SIGINT - 等待当前批次完成后退出...'); interrupted = true; });
process.on('SIGTERM', () => { interrupted = true; });

async function connect() {
  driver = neo4j.driver(CONFIG.neo4jUri, neo4j.auth.basic(CONFIG.neo4jAuth.user, CONFIG.neo4jAuth.password));
  const s = driver.session();
  await s.run('RETURN 1');
  await s.close();
  console.log('[backfill] Neo4j OK');

  pg = new Client(CONFIG.pgConfig);
  await pg.connect();
  await pg.query('SELECT 1');
  console.log('[backfill] PostgreSQL OK');
}

async function getOrCreateRun() {
  // 检查是否有未完成的 run
  const res = await pg.query(
    "SELECT * FROM graphify_embedding_backfill_progress WHERE status='running' ORDER BY started_at DESC LIMIT 1"
  );
  if (res.rows.length > 0) {
    const r = res.rows[0];
    console.log(`[backfill] 续传已有运行: ${r.run_id} (processed: ${r.processed}/${r.total}, last: ${r.last_node_id || 'none'})`);
    return r;
  }

  // 计算总节点数
  const session = driver.session();
  let total = 0;
  try {
    const cnt = await session.run('MATCH (g:GraphifyCode) RETURN count(g) as c');
    total = cnt.records[0].get('c').toNumber();
  } finally {
    await session.close();
  }

  // 创建新 run
  const ins = await pg.query(
    "INSERT INTO graphify_embedding_backfill_progress (run_id, total, processed, succeeded, failed, status) VALUES ($1,$2,0,0,0,'running') RETURNING *",
    [RUN_ID, total]
  );
  console.log(`[backfill] 新运行: ${RUN_ID}, 总节点数: ${total}`);
  return ins.rows[0];
}

async function updateProgress(runId, delta) {
  await pg.query(
    `UPDATE graphify_embedding_backfill_progress
     SET processed = processed + $1,
         succeeded = succeeded + $2,
         failed    = failed    + $3,
         last_node_id = $4,
         updated_at = NOW()
     WHERE run_id = $5`,
    [delta.processed, delta.succeeded, delta.failed, delta.lastNodeId, runId]
  );
}

async function markDone(runId) {
  await pg.query(
    "UPDATE graphify_embedding_backfill_progress SET status='done', updated_at=NOW() WHERE run_id=$1",
    [runId]
  );
}

/**
 * 从 Neo4j 分页导出节点（按 node_id 字典序分页，支持续传）
 */
async function exportBatch(afterNodeId, batchSize) {
  const session = driver.session();
  try {
    const q = afterNodeId
      ? 'MATCH (g:GraphifyCode) WHERE g.id > $after RETURN g.id as id, g.name as name, g.type as type, g.tags as tags, g.file_path as file_path ORDER BY g.id ASC LIMIT $limit'
      : 'MATCH (g:GraphifyCode) RETURN g.id as id, g.name as name, g.type as type, g.tags as tags, g.file_path as file_path ORDER BY g.id ASC LIMIT $limit';
    const params = afterNodeId
      ? { after: afterNodeId, limit: neo4j.int(batchSize) }
      : { limit: neo4j.int(batchSize) };
    const result = await session.run(q, params);
    return result.records.map(r => ({
      node_id: r.get('id'),
      name: r.get('name') || '',
      type: r.get('type') || '',
      tags: r.get('tags') || '',
      file_path: r.get('file_path') || '',
    }));
  } finally {
    await session.close();
  }
}

/**
 * 批量 upsert 到 PostgreSQL
 */
async function upsertEmbeddings(rows) {
  if (rows.length === 0) return;
  // 构造 VALUES 占位符
  const values = [];
  const placeholders = rows.map((r, i) => {
    const base = i * 7;
    values.push(r.node_id, r.name, r.type, r.tags, r.file_path, r.embed_text, JSON.stringify(r.embedding));
    return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7}::vector)`;
  }).join(',');

  await pg.query(
    `INSERT INTO graphify_code_embeddings (node_id, node_name, node_type, tags, file_path, embed_text, embedding)
     VALUES ${placeholders}
     ON CONFLICT (node_id) DO UPDATE SET
       node_name  = EXCLUDED.node_name,
       node_type  = EXCLUDED.node_type,
       tags       = EXCLUDED.tags,
       file_path  = EXCLUDED.file_path,
       embed_text = EXCLUDED.embed_text,
       embedding  = EXCLUDED.embedding,
       updated_at = NOW()`,
    values
  );
}

async function main() {
  await connect();

  const run = await getOrCreateRun();
  const runId = run.run_id;
  let lastNodeId = run.last_node_id || null;
  let totalProcessed = Number(run.processed);
  let totalSucceeded = Number(run.succeeded);
  let totalFailed = Number(run.failed);
  const totalNodes = Number(run.total);

  const startTime = Date.now();
  console.log(`[backfill] 开始 run: ${runId}, 从: ${lastNodeId || '起点'}`);
  console.log(`[backfill] 总进度: ${totalProcessed}/${totalNodes}`);

  let accInsert = []; // 待写入 PostgreSQL 的行

  while (!interrupted) {
    const nodes = await exportBatch(lastNodeId, CONFIG.batchSize);
    if (nodes.length === 0) {
      console.log('[backfill] ✅ 所有节点处理完毕');
      await flushInsert(accInsert);
      accInsert = [];
      await markDone(runId);
      break;
    }

    // 构建 embed_text
    const items = nodes.map(n => ({
      ...n,
      embed_text: buildEmbedText(n)
    }));

    // 生成 embedding（并发控制）
    const embResults = await embedBatch(items, {
      model: CONFIG.model,
      ollamaUrl: CONFIG.ollamaUrl,
      concurrency: CONFIG.embedConcurrency,
    });

    // 归并结果
    let batchSucc = 0, batchFail = 0;
    for (let i = 0; i < embResults.length; i++) {
      const er = embResults[i];
      const node = items[i];
      if (er.embedding) {
        accInsert.push({
          node_id: node.node_id,
          name: node.name || '',
          type: node.type || '',
          tags: node.tags || '',
          file_path: node.file_path || '',
          embed_text: node.embed_text || '',
          embedding: er.embedding
        });
        batchSucc++;
      } else {
        batchFail++;
        // 空文本节点：跳过不计错误（只是无内容）
        if (er.error !== 'empty_text') {
          console.warn(`[backfill] 嵌入失败 ${er.node_id}: ${er.error}`);
        }
      }
    }

    // 批量写入（每达 pgBatchInsert 条就 flush）
    if (accInsert.length >= CONFIG.pgBatchInsert) {
      await flushInsert(accInsert);
      accInsert = [];
    }

    // 更新进度
    lastNodeId = nodes[nodes.length - 1].node_id;
    totalProcessed += nodes.length;
    totalSucceeded += batchSucc;
    totalFailed += batchFail;

    await updateProgress(runId, {
      processed: nodes.length,
      succeeded: batchSucc,
      failed: batchFail,
      lastNodeId
    });

    // 进度报告
    if (totalProcessed % CONFIG.reportEvery < CONFIG.batchSize) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const pct = ((totalProcessed / totalNodes) * 100).toFixed(1);
      const rate = (totalProcessed / Math.max(elapsed, 1)).toFixed(1);
      const eta = Math.ceil((totalNodes - totalProcessed) / Math.max(rate, 1));
      console.log(`[backfill] 进度: ${totalProcessed}/${totalNodes} (${pct}%) | 成功:${totalSucceeded} 失败:${totalFailed} | ${rate}节点/s | ETA: ~${eta}s`);
    }
  }

  // flush 剩余
  if (accInsert.length > 0) {
    await flushInsert(accInsert);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[backfill] 完成 | 处理:${totalProcessed} 成功:${totalSucceeded} 失败:${totalFailed} | 耗时:${elapsed}s`);

  if (interrupted) {
    console.log('[backfill] ⚠️ 任务被中断，下次运行将从断点续传');
  }

  await driver.close();
  await pg.end();
}

async function flushInsert(rows) {
  if (rows.length === 0) return;
  try {
    await upsertEmbeddings(rows);
    process.stdout.write(`[backfill] 写入 ${rows.length} 条 embedding\n`);
  } catch (e) {
    console.error('[backfill] PostgreSQL 写入失败:', e.message);
  }
}

main().catch(e => { console.error('[backfill] 致命错误:', e); process.exit(1); });
