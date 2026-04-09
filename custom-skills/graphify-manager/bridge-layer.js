#!/usr/bin/env node
// bridge-layer.js - 批量处理 + 去重 + Neo4j批量写入 + 实体对齐
const neo4j = require('neo4j-driver');
const Redis = require('ioredis');
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
      inputStream: 'graphify:collection:events',
      outputStream: 'graphify:bridge:processed',
      consumerGroup: 'bridge-layer',
      consumerName: `bridge-${process.pid}`,
      batchSize: 50,        // 每批处理事件数
      batchWindowMs: 2000,   // 等待时间窗口（ms），满 batchSize 或 超时后处理
      ...config
    };
    this.neo4jDriver = null;
    this.redisClient = null;
    this.isProcessing = false;
    this.pendingEvents = new Map();  // file_path -> event (去重)
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
  }

  // 解析 Redis Stream 事件数据
  parseEventData(data) {
    const event = {};
    for (let i = 0; i < data.length; i += 2) event[data[i]] = data[i + 1];
    return event;
  }

  // 添加事件到批次（去重）
  addToBatch(eventId, eventData) {
    const event = this.parseEventData(eventData);
    const key = event.file_path || eventId;
    
    if (this.pendingEvents.has(key)) {
      this.metrics.deduplicated++;
      console.log('[bridge] 去重: ' + (event.file_path || key).split('/').pop());
    }
    this.pendingEvents.set(key, { eventId, event, key });
  }

  // 触发批次处理
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
        if (event.type === 'file_change' && event.file_type === 'code' && event.file_path) {
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
      
      // 3. 实体对齐
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

  // 实体对齐：GraphifyCode ↔ PersonalMemory/Memory_default
  async alignEntities(bridgeSession, extractions) {
    try {
      const session = this.neo4jDriver.session();
      let aligned = 0;
      try {
        // 对齐 GraphifyCode ↔ PersonalMemory（基于 entity/value 匹配）
        for (const { structure } of extractions) {
          for (const node of structure.nodes) {
            const nodeName = node.name;
            const tags = node.tags || [];
            
            // 查找 PersonalMemory（entity 字段或 value 字段包含代码名）
            const pmResult = await session.run(
              `MATCH (pm:PersonalMemory)
               WHERE toLower(pm.entity) CONTAINS toLower($name) 
                  OR toLower(pm.value) CONTAINS toLower($name)
               RETURN pm.id as id LIMIT 3`,
              { name: nodeName }
            );
            
            for (const rec of pmResult.records) {
              const pmId = rec.get('id');
              await session.run(
                `MATCH (g:GraphifyCode {id: $gid})
                 MATCH (pm:PersonalMemory {id: $pmId})
                 MERGE (g)-[r:ALIGNED_TO]->(pm)
                 SET r.confidence = 0.8, r.align_type = 'personal_memory', r.aligned_at = datetime()`,
                { gid: node.id, pmId: String(pmId) }
              );
              aligned++;
            }
            
            // 也匹配 semantic tags
            for (const tag of tags.slice(0, 5)) {
              if (tag.length < 3) continue;
              const tagResult = await session.run(
                `MATCH (pm:PersonalMemory)
                 WHERE toLower(pm.entity) CONTAINS toLower($tag) 
                    OR toLower(pm.value) CONTAINS toLower($tag)
                 RETURN pm.id as id LIMIT 1`,
                { tag }
              );
              for (const rec of tagResult.records) {
                const pmId = rec.get('id');
                await session.run(
                  `MATCH (g:GraphifyCode {id: $gid})
                   MATCH (pm:PersonalMemory {id: $pmId})
                   MERGE (g)-[r:ALIGNED_TO]->(pm)
                   SET r.confidence = 0.6, r.align_type = 'tag_match', r.aligned_at = datetime()`,
                  { gid: node.id, pmId: String(pmId) }
                );
                aligned++;
              }
            }
          }
        }
        
        // 对齐 GraphifyFile ↔ Memory_default（基于 summary 匹配）
        for (const { filePath } of extractions) {
          const projectName = path.basename(filePath).replace(/\.[^.]+$/, '');
          if (projectName.length < 3) continue;
          
          const mdResult = await session.run(
            `MATCH (md:Memory_default)
             WHERE toLower(md.summary) CONTAINS toLower($pname)
             RETURN md.memory_id as id LIMIT 2`,
            { pname: projectName }
          );
          
          for (const rec of mdResult.records) {
            const mdId = rec.get('id');
            await session.run(
              `MATCH (f:GraphifyFile {path: $fp})
               MATCH (md:Memory_default {memory_id: $mdId})
               MERGE (f)-[r:RELATED_TO]->(md)
               SET r.confidence = 0.5, r.aligned_at = datetime()`,
              { fp: filePath, mdId }
            );
            aligned++;
          }
        }
        
        if (aligned > 0) {
          console.log('[bridge] 实体对齐: ' + aligned + ' 个关系');
        }
      } finally {
        await session.close();
      }
      return aligned;
    } catch (e) {
      console.log('[bridge] 实体对齐跳过:', e.message.split('\n')[0]);
      return 0;
    }
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
    
    // 清理所有旧消费者组，重新开始
    try {
      await this.redisClient.xgroup('DESTROY', this.config.inputStream, this.config.consumerGroup);
      console.log('[bridge] 已销毁旧消费者组:', this.config.consumerGroup);
    } catch (e) { }
    try {
      await this.redisClient.xgroup('CREATE', this.config.inputStream, this.config.consumerGroup, '0', 'MKSTREAM');
      console.log('[bridge] 重建消费者组');
    } catch (e) {
      if (!e.message.includes('BUSYGROUP')) console.log('[bridge] 消费者组重建:', e.message.split('\n')[0]);
    }
    
    while (this.isProcessing) {
      try {
        // 非阻塞读取
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
        
        // 达到批量大小则立即处理
        if (this.pendingEvents.size >= this.config.batchSize) {
          await this.flushBatch();
          continue;
        }
        
        // 超时批次处理
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
