#!/usr/bin/env node
/**
 * incremental-collect.js
 * 增量采集脚本 - 接收文件路径，提取代码结构，发布到 Redis Stream
 * 
 * 用法:
 *   node incremental-collect.js <file_path>          # 单文件
 *   node incremental-collect.js --batch <file_list>  # 批量文件
 *   node incremental-collect.js --dir <directory>    # 目录扫描
 * 
 * 示例:
 *   node incremental-collect.js /home/ai/.openclaw/workspace/projects/tiandao-system/services/karma-service/src/routes/karma.routes.ts
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');

// ============================================================
// 配置
// ============================================================
const CONFIG = {
  redisUrl: 'redis://localhost:6379',
  eventStream: 'graphify:collection:events',
  extractScript: '/home/ai/.openclaw/workspace/custom-skills/graphify-manager/extract_code.py',
};

// 排除的目录
const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', '__pycache__', '.pytest_cache',
  'dist', 'build', '.next', '.nuxt', 'coverage', '.cache',
  '.tmp', '.temp', 'chrome-extensions', '.vscode', '.idea',
  'types', 'definitely-typed',
]);

// 代码文件扩展名
const CODE_EXTS = new Set([
  '.py', '.js', '.ts', '.jsx', '.tsx', '.go', '.rs', '.java', '.cpp', '.c', '.h', '.hpp', '.cs', '.rb', '.php'
]);

// 文档文件扩展名
const DOC_EXTS = new Set([
  '.md', '.txt', '.rst', '.pdf', '.docx', '.xlsx', '.json', '.yaml', '.yml', '.toml', '.ini', '.conf', '.cfg', '.env'
]);

// 忽略的扩展名
const IGNORE_EXTS = new Set([
  '.log', '.tmp', '.swp', '.pyc', '.pyo', '.so', '.dll', '.exe', '.bin',
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp',
  '.mp3', '.mp4', '.wav', '.zip', '.tar', '.gz', '.rar', '.7z',
  '.lock', '.map',
]);

// ============================================================
// 辅助函数
// ============================================================
function shouldProcess(filePath) {
  const p = path.resolve(filePath);
  const parts = p.split(path.sep);
  
  // 排除目录检查
  for (const part of parts) {
    if (EXCLUDE_DIRS.has(part)) {
      return { process: false };
    }
  }
  
  // 隐藏文件检查
  const name = path.basename(filePath);
  if (name.startsWith('.') || name.startsWith('~') || name.endsWith('~')) {
    return { process: false };
  }
  
  const ext = path.extname(filePath).toLowerCase();
  
  // 忽略扩展名检查
  if (IGNORE_EXTS.has(ext)) {
    return { process: false };
  }
  
  // 文件类型判断
  let fileType, priority;
  if (CODE_EXTS.has(ext)) {
    fileType = 'code';
    priority = 'high';
  } else if (DOC_EXTS.has(ext)) {
    fileType = 'doc';
    priority = 'normal';
  } else {
    fileType = 'other';
    priority = 'low';
  }
  
  return { process: true, fileType, priority, ext };
}

function computeHash(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return require('crypto').createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

/**
 * 使用 Python 脚本提取代码结构
 */
function extractCode(filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [CONFIG.extractScript, filePath]);
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);
    
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`extract_code.py failed: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error(`Failed to parse extract output: ${stdout.slice(0, 200)}`));
      }
    });
  });
}

// ============================================================
// 增量采集：单文件
// ============================================================
async function collectFile(filePath, redis) {
  const resolved = path.resolve(filePath);
  
  if (!fs.existsSync(resolved)) {
    console.log(`[incremental] 文件不存在: ${resolved}`);
    return { success: false, reason: 'not_found' };
  }
  
  if (!fs.statSync(resolved).isFile()) {
    console.log(`[incremental] 不是文件: ${resolved}`);
    return { success: false, reason: 'not_file' };
  }
  
  const check = shouldProcess(resolved);
  if (!check.process) {
    console.log(`[incremental] 跳过（排除）: ${resolved}`);
    return { success: false, reason: 'excluded' };
  }
  
  const hash = computeHash(resolved);
  if (!hash) {
    return { success: false, reason: 'hash_failed' };
  }
  
  console.log(`[incremental] 采集: ${resolved} (${check.fileType}, ${check.priority})`);
  
  const eventData = {
    type: 'file_change',
    file_path: resolved,
    change_type: 'incremental',
    file_ext: check.ext,
    file_type: check.fileType,
    priority: check.priority,
    timestamp: new Date().toISOString(),
    content_hash: hash,
    source: 'incremental_collect',
  };
  
  if (redis) {
    // 发布到 Redis Stream
    const fields = {};
    for (const [k, v] of Object.entries(eventData)) {
      fields[String(k)] = String(v);
    }
    await redis.xadd(CONFIG.eventStream, '*', ...Object.entries(fields).flat());
    console.log(`[incremental] ✅ 已发布到 Redis Stream: ${path.basename(resolved)}`);
  }
  
  // 同时打印节点数量（用于验证）
  try {
    const structure = await extractCode(resolved);
    const nodeCount = structure.nodes ? structure.nodes.length : 0;
    console.log(`[incremental]   提取到 ${nodeCount} 个节点`);
    return { success: true, nodeCount, hash, fileType: check.fileType };
  } catch (e) {
    console.log(`[incremental]   提取失败: ${e.message}`);
    return { success: true, nodeCount: 0, hash, fileType: check.fileType };
  }
}

// ============================================================
// 批量采集：目录扫描
// ============================================================
async function collectDir(dirPath, redis) {
  const resolved = path.resolve(dirPath);
  
  if (!fs.existsSync(resolved)) {
    console.log(`[incremental] 目录不存在: ${resolved}`);
    return { success: false, reason: 'not_found' };
  }
  
  const files = [];
  
  function walk(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!EXCLUDE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
            walk(full);
          }
        } else if (entry.isFile()) {
          const check = shouldProcess(full);
          if (check.process) {
            files.push(full);
          }
        }
      }
    } catch (e) {
      console.log(`[incremental] 遍历失败: ${dir} - ${e.message}`);
    }
  }
  
  walk(resolved);
  console.log(`[incremental] 目录扫描完成，找到 ${files.length} 个待处理文件`);
  
  let success = 0;
  let failed = 0;
  let skipped = 0;
  
  // 分批处理，每批10个
  const batchSize = 10;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(f => collectFile(f, redis))
    );
    for (const r of results) {
      if (r.success) success++;
      else if (r.reason === 'excluded') skipped++;
      else failed++;
    }
  }
  
  console.log(`[incremental] 批量采集完成: ✅${success} ❌${failed} ⏭️${skipped}`);
  return { success, failed, skipped, total: files.length };
}

// ============================================================
// 主程序
// ============================================================
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('用法:');
    console.log('  node incremental-collect.js <file_path>      # 单文件');
    console.log('  node incremental-collect.js --dir <dir>     # 目录扫描');
    console.log('  node incremental-collect.js --dry-run <dir>  # 干跑（不写 Redis）');
    process.exit(1);
  }
  
  // 连接 Redis（可选，干跑模式不需要）
  let redis = null;
  const dryRun = args.includes('--dry-run');
  
  if (!dryRun) {
    try {
      redis = new Redis(CONFIG.redisUrl, { maxRetriesPerRequest: 3 });
      await redis.ping();
      console.log('[incremental] ✅ Redis 连接成功');
    } catch (e) {
      console.log(`[incremental] ⚠️  Redis 连接失败: ${e.message}，降级为干跑模式`);
    }
  } else {
    console.log('[incremental] 🔍 干跑模式（不写 Redis）');
  }
  
  try {
    if (args[0] === '--dir') {
      // 目录扫描模式
      const dirPath = args[1];
      if (!dirPath) {
        console.error('❌ 请指定目录路径');
        process.exit(1);
      }
      await collectDir(dirPath, redis);
      
    } else if (args[0] === '--dry-run') {
      // 干跑模式（指定目录）
      const dirPath = args[1];
      if (!dirPath) {
        console.error('❌ 请指定目录路径');
        process.exit(1);
      }
      await collectDir(dirPath, null);
      
    } else {
      // 单文件模式
      const filePath = args[0];
      const result = await collectFile(filePath, redis);
      console.log('[incremental] 结果:', JSON.stringify(result));
    }
  } finally {
    if (redis) {
      await redis.quit();
    }
  }
}

main().catch(e => {
  console.error('[incremental] 错误:', e.message);
  process.exit(1);
});
