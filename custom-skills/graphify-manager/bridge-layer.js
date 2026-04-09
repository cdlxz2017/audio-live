#!/usr/bin/env node
// bridge-layer.js - 批量处理 + 去重 + Neo4j批量写入 + 实体对齐 (memory_summaries版)
const neo4j = require('neo4j-driver');
const Redis = require('ioredis');
const { Client } = require('pg');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const { exec } = require('child_process');
const execAsync = promisify(exec);

class GraphifyBridge {
  constructor(config) {
    this.config = {
      neo4jUri: 'bolt://localhost:7687',
      neo4jAuth: { user: 'neo4j', password: 'openclaw_neo4j_2026' },
      redisUrl: 'redis://localhost:6379',
      pgUrl: 'postgresql://openclaw_ai:zyxrcy910128@localhost:5432/openclaw_memory',
      inputStream: 'graphify:collection:events',
      outputStream: 'graphify:bridge:processed',
      consumerGroup: 'bridge-layer',
      consumerName: `bridge-${process.pid}`,
      batchSize: 50,
      batchWindowMs: 2000,
      ...config
    };
    this.neo4jDriver = null;
    this.redisClient = null;
    this.pgClient = null;
    this.isProcessing = false;
    this.pendingEvents = new Map();
    this.batchTimer = null;
    this.metrics = { processed: 0, succeeded: 0, failed: 0, aligned: 0, deduplicated: 0 };
    this.extractScript = '/home/ai/.openclaw/workspace/custom-skills/graphify-manager/extract_code.py';
  }

  async connect() {
    console.log('[bridge] 连接数据库...');
    try {
      this.neo4jDriver = neo4j.driver(
        this.config.neo4jUri,
        neo4j.auth.basic(this.config.neo4jAuth.user, this.config.neo4jAuth.password)
      );
      const s = this.neo4jDriver.session();
      await s.run('RETURN 1');
      await s.close();
      console.log('[bridge] Neo4j OK');
    } catch (e) { console.error('[bridge] Neo4j 失败:', e.message); throw e; }

    try {
      this.redisClient = new Redis(this.config.redisUrl);
      await this.redisClient.ping();
      console.log('[bridge] Redis OK');
      try { await this.redisClient.xgroup('CREATE', this.config.inputStream, this.config.consumerGroup, '0', 'MKSTREAM'); }
      catch (e) { if (!e.message.includes('BUSYGROUP')) console.log('[bridge] 消费者组已存在'); }
    } catch (e) { console.error('[bridge] Redis 失败:', e.message); throw e; }

    // PostgreSQL for memory_summaries alignment
    try {
      this.pgClient = new Client({ connectionString: this.config.pgUrl });
      await this.pgClient.connect();
      await this.pgClient.query('SELECT 1');
      console.log('[bridge] PostgreSQL OK');
    } catch (e) { console.error('[bridge] PostgreSQL 失败:', e.message); }
  }

  parseEventData(data) {
    const event = {};
    for (let i = 0; i < data.length; i += 2) event[data[i]] = data[i + 1];
    return event;
  }

  addToBatch(eventId, eventData) {
    const event = this.parseEventData(eventData);
    const key = event.file_path || eventId;

    if (this.pendingEvents.has(key)) {
      this.metrics.deduplicated++;
      console.log('[bridge] 去重: ' + (event.file_path || key).split('/').pop());
    }
    this.pendingEvents.set(key, { eventId, event, key });
  }

  async flushBatch() {
    if (this.pendingEvents.size === 0) return;

    const events = [...this.pendingEvents.values()];
    this.pendingEvents.clear();

    console.log('[bridge] 批次处理 ' + events.length + ' 个文件...');
    const session = this.neo4jDriver.session();

    try {
      // 1. 批量提取所有文件
      const extractions = [];
      for (const { event } of events) {
        if (event.type === 'file_change' && (event.file_type === 'code' || event.file_type === 'config') && event.file_path) {
          const structure = await this.extractCode(event.file_path, event.file_ext);
          if (structure && structure.nodes && structure.nodes.length > 0) {
            extractions.push({ filePath: event.file_path, fileExt: event.file_ext, structure, eventId: event.event_id });
          }
        }
      }

      if (extractions.length === 0) {
        await session.close();
        for (const { eventId } of events) {
          await this.redisClient.xack(this.config.inputStream, this.config.consumerGroup, eventId);
        }
        return;
      }

      // 2. 批量写入 Neo4j（单事务）
      await session.writeTransaction(async tx => {
        // 批量写入文件节点
        for (const { filePath, fileExt, structure } of extractions) {
          await tx.run(
            `MERGE (f:GraphifyFile {path: $fp})
             SET f.name = $fn, f.extension = $fe, f.updated_at = datetime()`,
            { fp: filePath, fn: path.basename(filePath), fe: fileExt || '' }
          );
        }

        // 批量写入代码节点（UNWIND）
        const allNodes = [];
        for (const { filePath, structure } of extractions) {
          for (const node of structure.nodes) {
            const tags = node.tags ? node.tags.join(',') : '';
            allNodes.push({
              id: node.id,
              name: (node.name || '').substring(0, 100),
              type: node.type,
              filePath,
              startLine: node.start_line,
              tags
            });
          }
        }

        if (allNodes.length > 0) {
          await tx.run(
            `UNWIND $nodes as node
             MERGE (n:GraphifyCode {id: node.id})
             SET n.name = node.name, n.type = node.type, n.file_path = node.filePath,
                 n.start_line = node.startLine, n.tags = node.tags, n.updated_at = datetime()
             WITH n, node
             MATCH (f:GraphifyFile {path: node.filePath})
             MERGE (n)-[:BELONGS_TO]->(f)`,
            { nodes: allNodes }
          );
        }

        // 批量写入关系
        const allEdges = [];
        for (const { structure } of extractions) {
          for (const edge of structure.edges || []) {
            allEdges.push({ source: edge.source, target: edge.target });
          }
        }

        if (allEdges.length > 0) {
          await tx.run(
            `UNWIND $edges as edge
             MATCH (s:GraphifyCode {id: edge.source})
             MATCH (t:GraphifyCode {id: edge.target})
             MERGE (s)-[r:CONTAINS]->(t)`,
            { edges: allEdges }
          );
        }
      });

      console.log('[bridge] 批次写入: ' + extractions.length + ' 文件, ' + extractions.reduce((s, e) => s + e.structure.nodes.length, 0) + ' 节点');

      // 3. 实体对齐 (使用 memory_summaries)
      const aligned = await this.alignEntities(session, extractions);
      this.metrics.aligned += aligned;

      // 4. 确认所有事件
      for (const { eventId } of events) {
        await this.redisClient.xack(this.config.inputStream, this.config.consumerGroup, eventId);
      }

      this.metrics.succeeded += events.length;
      this.metrics.processed += events.length;

    } catch (e) {
      console.error('[bridge] 批次处理失败:', e.message);
      this.metrics.failed += events.length;
    } finally {
      await session.close();
    }
  }

  // 实体对齐：GraphifyCode ↔ memory_summaries (PostgreSQL)
  // 策略：文本重叠评分 + 文件名匹配
  async alignEntities(bridgeSession, extractions) {
    if (!this.pgClient) {
      console.log('[bridge] 实体对齐跳过: PostgreSQL 未连接');
      return 0;
    }

    let aligned = 0;
    try {
      // 获取 memory_summaries
      const summariesResult = await this.pgClient.query(
        `SELECT id, summary, summary_type FROM memory_summaries
         WHERE is_active = true AND summary IS NOT NULL
         LIMIT 200`
      );
      const summaries = summariesResult.rows;
      if (summaries.length === 0) return 0;

      const session = this.neo4jDriver.session();
      try {
        for (const { structure, filePath } of extractions) {
          for (const node of structure.nodes || []) {
            const nodeName = node.name || '';
            const nodeType = node.type || '';
            const tags = node.tags || [];
            const searchText = `${nodeName} ${nodeType} ${tags.join(' ')} ${path.basename(filePath || '')}`.toLowerCase();

            // 文本重叠评分
            const scored = [];
            for (const s of summaries) {
              const sText = `${s.summary_type} ${s.summary}`.toLowerCase();
              let score = 0;
              const nodeWords = searchText.split(/\s+/).filter(w => w.length > 2);
              for (const w of nodeWords) {
                if (sText.includes(w)) score += 1;
              }
              if (sText.includes(nodeName.toLowerCase())) score += 5;
              const fileBase = path.basename(filePath || '').replace(/\.[^.]+$/, '').toLowerCase();
              if (fileBase.length > 3 && sText.includes(fileBase)) score += 3;
              if (score >= 2) {
                scored.push({ sid: s.id, summary: s.summary, score: Math.min(score / 10, 0.95) });
              }
            }

            scored.sort((a, b) => b.score - a.score);
            const top = scored.slice(0, 3);

            for (const { sid, summary, score } of top) {
              await session.run(
                `MATCH (g:GraphifyCode {id: $gid})
                 MERGE (m:Memory_summary {id: $sid})
                 SET m.summary = $summary
                 MERGE (g)-[r:ALIGNED_TO]->(m)
                 SET r.confidence = $conf, r.align_type = 'text_match', r.aligned_at = datetime()`,
                { gid: node.id, sid: String(sid), summary, conf: score }
              );
              aligned++;
            }

            // GraphifyFile ↔ memory_summaries（文件名匹配）
            if (filePath) {
              const fileBase = path.basename(filePath).replace(/\.[^.]+$/, '').toLowerCase();
              if (fileBase.length > 3) {
                for (const s of summaries) {
                  const sText = s.summary.toLowerCase();
                  if (sText.includes(fileBase)) {
                    await session.run(
                      `MATCH (f:GraphifyFile {path: $fp})
                       MERGE (m:Memory_summary {id: $sid})
                       SET m.summary = $summary
                       MERGE (f)-[r:RELATED_TO]->(m)
                       SET r.confidence = 0.6, r.align_type = 'file_summary_match', r.aligned_at = datetime()`,
                      { fp: filePath, sid: String(s.id), summary: s.summary }
                    );
                    aligned++;
                  }
                }
              }
            }
          }
        }

        if (aligned > 0) {
          console.log('[bridge] 实体对齐: ' + aligned + ' 个关系 (memory_summaries)');
        }
      } finally {
        await session.close();
      }
    } catch (e) {
      console.log('[bridge] 实体对齐错误:', e.message.split('\n')[0]);
    }
    return aligned;
  }

  async extractCode(filePath, fileExt) {
    try {
      const { stdout } = await execAsync(
        'python3 ' + this.extractScript + ' "' + filePath + '"',
        { timeout: 20000 }
      );
      return JSON.parse(stdout.trim());
    } catch (e) {
      return null;
    }
  }

  async startProcessing() {
    console.log('[bridge] 开始批量处理事件...');
    this.isProcessing = true;

    try {
      await this.redisClient.xgroup('CREATE', this.config.inputStream, this.config.consumerGroup, '0', 'MKSTREAM');
      console.log('[bridge] 已创建消费者组:', this.config.consumerGroup);
    } catch (e) {
      if (e.message.includes('BUSYGROUP')) {
        console.log('[bridge] 消费者组已存在:', this.config.consumerGroup);
      } else {
        console.log('[bridge] 消费者组创建:', e.message.split('\n')[0]);
      }
    }

    while (this.isProcessing) {
      try {
        const events = await this.redisClient.xreadgroup(
          'GROUP', this.config.consumerGroup, this.config.consumerName,
          'COUNT', this.config.batchSize, 'BLOCK', 500,
          'STREAMS', this.config.inputStream, '>'
        );

        if (events) {
          for (const [s, msgs] of events) {
            for (const [id, data] of msgs) {
              this.addToBatch(id, data);
            }
          }
        }

        if (this.pendingEvents.size >= this.config.batchSize) {
          await this.flushBatch();
          continue;
        }

        if (this.pendingEvents.size > 0 && !this.batchTimer) {
          this.batchTimer = setTimeout(async () => {
            this.batchTimer = null;
            await this.flushBatch();
          }, this.config.batchWindowMs);
        }

      } catch (e) {
        console.error('[bridge] 处理错误:', e.message);
        await this.sleep(2000);
      }
    }
  }

  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async stop() {
    this.isProcessing = false;
    if (this.batchTimer) clearTimeout(this.batchTimer);
    await this.flushBatch();
    if (this.neo4jDriver) await this.neo4jDriver.close();
    if (this.redisClient) await this.redisClient.quit();
    if (this.pgClient) await this.pgClient.end();
    console.log('[bridge] 已停止. 处理:', this.metrics.processed, '| 成功:', this.metrics.succeeded, '| 失败:', this.metrics.failed, '| 对齐:', this.metrics.aligned, '| 去重:', this.metrics.deduplicated);
  }
}

async function main() {
  console.log('[bridge] 启动...');
  const b = new GraphifyBridge();
  try {
    await b.connect();
    await b.startProcessing();
  } catch (e) {
    console.error('[bridge] 启动失败:', e);
    process.exit(1);
  }
  process.on('SIGINT', async () => { console.log('[bridge] SIGINT'); await b.stop(); process.exit(0); });
  process.on('SIGTERM', async () => { console.log('[bridge] SIGTERM'); await b.stop(); process.exit(0); });
}

if (require.main === module) main().catch(console.error);
module.exports = GraphifyBridge;
