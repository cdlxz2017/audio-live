#!/usr/bin/env node
/**
 * audit-query.js — 审计日志查询CLI工具
 * v1.0 — 2026-04-20
 * 
 * 使用方式：
 *   node audit-query.js                              # 查询今日所有记录
 *   node audit-query.js --date 2026-04-20           # 查询指定日期
 *   node audit-query.js --category DATABASE         # 按类别过滤
 *   node audit-query.js --op db:insert              # 按操作过滤
 *   node audit-query.js --target conversation       # 按目标过滤
 *   node audit-query.js --since 2026-04-20T00:00   # 时间下限
 *   node audit-query.js --until 2026-04-20T23:59   # 时间上限
 *   node audit-query.js --limit 50                  # 返回条数
 *   node audit-query.js --stats                     # 显示统计
 *   node audit-query.js --json                      # 输出JSON格式
 */

'use strict';

const { queryAudit, getAuditStats, getDateStr } = require('./append-audit');

// 简单命令行解析
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') { args.json = true; continue; }
    if (arg === '--stats') { args.stats = true; continue; }
    if (arg === '--help' || arg === '-h') { args.help = true; continue; }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      args[key] = argv[i + 1] || true;
      i++;
    }
  }
  return args;
}

function printHelp() {
  console.log(`
audit-query.js — 审计日志查询CLI

用法:
  node audit-query.js [选项]

选项:
  --date YYYY-MM-DD     查询日期（默认今天）
  --category CATEGORY   按类别过滤（FILE|CONFIG|DATABASE|PROCESS|GIT|EXTERNAL_API|CRON）
  --op OP              按操作类型过滤（如 db:insert, file:create）
  --target TEXT         按目标名称过滤（子串匹配）
  --since ISO时间       ISO格式时间下限
  --until ISO时间       ISO格式时间上限
  --limit N            返回条数上限（默认100）
  --stats              显示统计摘要（不显示详细记录）
  --json               输出JSON格式（默认表格格式）
  --help, -h           显示帮助

示例:
  node audit-query.js --stats
  node audit-query.js --category DATABASE --date 2026-04-20
  node audit-query.js --op db:insert --limit 20
  node audit-query.js --target conversation_messages --since 2026-04-20T00:00:00Z
`);
}

// 表格格式化
function formatTable(records) {
  if (records.length === 0) {
    console.log('（无记录）');
    return;
  }
  
  // 计算列宽
  const colWidths = {
    ts: 19,
    category: 12,
    op: 20,
    target: 40,
    success: 8,
  };
  
  // 表头
  console.log('─'.repeat(colWidths.ts + colWidths.category + colWidths.op + colWidths.target + colWidths.success + 7));
  console.log(
    '时间'.padEnd(colWidths.ts) + ' ' +
    '类别'.padEnd(colWidths.category) + ' ' +
    '操作'.padEnd(colWidths.op) + ' ' +
    '目标'.padEnd(colWidths.target) + ' ' +
    '结果'
  );
  console.log('─'.repeat(colWidths.ts + colWidths.category + colWidths.op + colWidths.target + colWidths.success + 7));
  
  // 记录
  for (const r of records) {
    const ts = r.ts ? r.ts.replace('T', ' ').replace('Z', '') : '';
    const success = r.result?.success ? '✅' : '❌';
    const target = r.target ? r.target.slice(0, colWidths.target) : '';
    const afterPreview = r.after ? JSON.stringify(r.after).slice(0, 30) : '';
    
    console.log(
      ts.padEnd(colWidths.ts) + ' ' +
      r.category.padEnd(colWidths.category) + ' ' +
      r.op.padEnd(colWidths.op) + ' ' +
      target.padEnd(colWidths.target) + ' ' +
      success
    );
    
    // 如果有 error，显示
    if (r.result?.error) {
      console.log('  '.padEnd(colWidths.ts + 1) + `⚠️ ${r.result.error.slice(0, 80)}`);
    }
  }
  
  console.log('─'.repeat(colWidths.ts + colWidths.category + colWidths.op + colWidths.target + colWidths.success + 7));
  console.log(`共 ${records.length} 条记录`);
}

function formatStats(stats) {
  console.log(`
📊 审计统计 — ${stats.date}
─────────────────────────────────
总记录数: ${stats.total}

✅ 成功: ${stats.success}
❌ 失败: ${stats.failed}

📁 按类别:
`);
  for (const [cat, count] of Object.entries(stats.categories).sort((a, b) => b[1] - a[1])) {
    const bar = '█'.repeat(Math.ceil(count / stats.total * 20));
    console.log(`  ${cat.padEnd(15)} ${bar} ${count}`);
  }
  
  console.log(`
📝 按操作类型:
`);
  for (const [op, count] of Object.entries(stats.ops).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${op.padEnd(25)} ${count}`);
  }
}

// 主逻辑
async function main(argv) {
  const args = parseArgs(argv);
  
  if (args.help) {
    printHelp();
    return;
  }
  
  try {
    // 统计模式
    if (args.stats) {
      const stats = await getAuditStats(args.date || getDateStr());
      formatStats(stats);
      return;
    }
    
    // 查询模式
    const filters = {};
    if (args.date) filters.date = args.date;
    if (args.category) filters.category = args.category;
    if (args.op) filters.op = args.op;
    if (args.target) filters.target = args.target;
    if (args.since) filters.since = args.since;
    if (args.until) filters.until = args.until;
    if (args.limit) filters.limit = parseInt(args.limit);
    
    const records = await queryAudit(filters);
    
    if (args.json) {
      console.log(JSON.stringify(records, null, 2));
    } else {
      formatTable(records);
    }
  } catch (err) {
    console.error('❌ 查询失败:', err.message);
    process.exit(1);
  }
}

main(process.argv);
