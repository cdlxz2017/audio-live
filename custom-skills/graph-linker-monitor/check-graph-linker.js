#!/usr/bin/env node
/**
 * graph-linker-monitor
 * 监控 graph-linker 实时状态、积压消化速度和健康状况
 */

const Redis = require('/home/ai/.openclaw/workspace/memory-system/node_modules/ioredis');
const r = new Redis();

async function fullCheck() {
  try {
    const len = await r.xlen('graph:sync:events');
    const groups = await r.call('XINFO', 'GROUPS', 'graph:sync:events');
    const g = groups[0];
    const lag = g[9];

    const consumers = await r.call('XINFO', 'CONSUMERS', 'graph:sync:events', 'graph-linkers');
    const consumerName = consumers[0][1];
    const consumerIdle = consumers[0][5];

    const pending = await r.call('XPENDING', 'graph:sync:events', 'graph-linkers');
    const pendingCount = pending[0];

    const first = await r.call('XRANGE', 'graph:sync:events', '-', '+', 'COUNT', 1);
    const last = await r.call('XREVRANGE', 'graph:sync:events', '+', '-', 'COUNT', 1);
    const firstId = first[0][0];
    const lastId = last[0][0];
    const firstTs = parseInt(firstId.split('-')[0]);
    const lastTs = parseInt(lastId.split('-')[0]);
    const ageHours = ((lastTs - firstTs) / 1000 / 3600).toFixed(1);

    const t1 = Date.now();
    const len1 = len;
    await new Promise(p => setTimeout(p, 20000));
    const len2 = await r.xlen('graph:sync:events');
    const t2 = Date.now();
    const producerRate = (len2 - len1) / ((t2 - t1) / 1000);

    const msgs = await r.call('XRANGE', 'graph:sync:events', '-', '+');
    const uniqueIds = new Set();
    msgs.forEach(m => {
      try {
        const d = {};
        for (let i = 0; i < m[1].length; i += 2) d[m[1][i]] = m[1][i+1];
        const p = JSON.parse(d.payload || '{}');
        if (p.memoryId) uniqueIds.add(p.memoryId);
      } catch(e) {}
    });

    const uniqueCount = uniqueIds.size;
    const duplicateCount = len - uniqueCount;
    const consumerRate = 0.5;
    const consumerRatePerHour = consumerRate * 3600;
    const clearTimeIfPaused = uniqueCount / consumerRate / 60;
    const timeToStable = uniqueCount > 0 && consumerRate > producerRate
      ? uniqueCount / (consumerRate - producerRate) / 60
      : 0;

    const consumerStatus = consumerIdle < 5000 ? '✅ 正常' : '⚠️ 空闲';

    const out = [
      '',
      '══════════════════════════════════════',
      '   GRAPH-LINKER  状态监控报告',
      '══════════════════════════════════════',
      '',
      '【Stream 概况】',
      '  消息总数   ' + String(len) + ' 条',
      '  时间跨度   ' + ageHours + ' 小时',
      '  最早消息   ' + new Date(firstTs).toISOString().replace('T', ' ').substring(0, 19) + ' UTC',
      '  最新消息   ' + new Date(lastTs).toISOString().replace('T', ' ').substring(0, 19) + ' UTC',
      '',
      '【Consumer 状态】',
      '  消费者     ' + consumerName,
      '  Idle       ' + consumerIdle + ' ms',
      '  Pending    ' + pendingCount + ' 条',
      '  状态       ' + consumerStatus,
      '',
      '【积压分析】',
      '  独立记忆数 ' + uniqueCount + ' 个 memoryId',
      '  重复投递   ' + duplicateCount + ' 条',
      '',
      '【速率对比】',
      '  Producer   ' + (producerRate * 3600).toFixed(0) + ' 条/小时',
      '  Consumer   ' + consumerRatePerHour.toFixed(0) + ' 条/小时',
      '',
      '【预估时间】',
      '  纯消费清空 ' + clearTimeIfPaused.toFixed(1) + ' 分钟',
      '  稳定所需   ' + (timeToStable > 0 ? timeToStable.toFixed(1) + ' 分钟' : '已达平衡'),
      '',
      '══════════════════════════════════════',
    ];

    out.forEach(line => console.log(line));

    // 综合判断状态
    const isIdleWaitingForBatch = consumerIdle > 1000 && producerRate < 1;
    const isNormalOperation = consumerIdle < 30000 && pendingCount === 0;
    
    if (pendingCount > 0) {
      console.log('  ⚠️  有 ' + pendingCount + ' 条消息未确认（处理中或失败）');
    } else if (isIdleWaitingForBatch && isNormalOperation) {
      console.log('  ✅ 正常（等待下一批消息，约每 ' + (3600 / Math.max(producerRate * 3600, 0.1)).toFixed(0) + ' 秒来一条）');
    } else if (consumerIdle < 5000) {
      console.log('  ✅ graph-linker 运行正常，无积压');
    } else {
      console.log('  ⚠️  Consumer 空闲超过 30 秒，请检查');
    }
    console.log('');

  } catch(e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    r.disconnect();
  }
}

fullCheck();
