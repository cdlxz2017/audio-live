#!/usr/bin/env node
/**
 * watch-files.js
 * 文件变更监控脚本 - 使用 Node.js 内置 fs.watch 监控代码文件变化
 * 变化时触发 incremental-collect.js
 * 
 * 使用 PM2 管理:
 *   pm2 start watch-files.js --name graphify-watcher
 *   pm2 stop graphify-watcher
 *   pm2 restart graphify-watcher
 *   pm2 logs graphify-watcher
 */

const { watch } = require('fs');
const { exec, spawn } = require('child_process');
const path = require('path');

// ============================================================
// 配置
// ============================================================
const CONFIG = {
  // 监控路径列表
  watchPaths: [
    '/home/ai/.openclaw/workspace/projects',
    '/home/ai/.openclaw/workspace/custom-skills',
    '/home/ai/.openclaw/workspace/scripts',
    '/home/ai/projects/tiandao-system',
  ],
  
  // 排除的目录
  excludeDirs: new Set([
    'node_modules', '.git', '__pycache__', '.pytest_cache',
    'dist', 'build', '.next', '.nuxt', 'coverage', '.cache',
    '.tmp', '.temp', 'chrome-extensions', '.vscode', '.idea',
    'types', 'definitely-typed', '.cache',
  ]),
  
  // 防抖时间（毫秒）- 同一文件变化后等待这么久再触发
  debounceMs: 3000,
  
  // 最大并发采集任务
  maxConcurrency: 3,
  
  // incremental-collect 脚本路径
  collectScript: '/home/ai/.openclaw/workspace/custom-skills/graphify-manager/incremental-collect.js',
};

// ============================================================
// 状态
// ============================================================
const pendingFiles = new Map();  // filename -> timer
const activeJobs = new Set();
const stats = { triggered: 0, collected: 0, errors: 0 };

// ============================================================
// 辅助函数
// ============================================================
function shouldProcess(filePath) {
  const parts = filePath.split(path.sep);
  
  // 排除目录检查
  for (const part of parts) {
    if (CONFIG.excludeDirs.has(part)) return false;
  }
  
  // 隐藏文件
  const basename = path.basename(filePath);
  if (basename.startsWith('.') || basename.startsWith('~')) return false;
  
  // 文件扩展名检查（必须是代码/文档文件）
  const ext = path.extname(filePath).toLowerCase();
  const validExts = new Set([
    '.py', '.js', '.ts', '.jsx', '.tsx', '.go', '.rs', '.java', '.cpp', '.c',
    '.h', '.hpp', '.cs', '.rb', '.php', '.md', '.txt', '.rst', '.json',
    '.yaml', '.yml', '.toml', '.ini', '.conf', '.cfg', '.env',
  ]);
  
  return validExts.has(ext);
}

function scheduleCollect(filePath) {
  // 如果已有待处理的计时器，清除它（防抖）
  if (pendingFiles.has(filePath)) {
    clearTimeout(pendingFiles.get(filePath));
  }
  
  console.log(`[watcher] 文件变化排队: ${path.basename(filePath)} (${pendingFiles.size + 1} 待处理)`);
  
  const timer = setTimeout(async () => {
    pendingFiles.delete(filePath);
    await runIncrementalCollect(filePath);
  }, CONFIG.debounceMs);
  
  pendingFiles.set(filePath, timer);
}

async function runIncrementalCollect(filePath) {
  // 并发控制
  while (activeJobs.size >= CONFIG.maxConcurrency) {
    await new Promise(r => setTimeout(r, 500));
  }
  
  activeJobs.add(filePath);
  stats.triggered++;
  
  try {
    console.log(`[watcher] 触发增量采集: ${path.relative(process.cwd(), filePath)}`);
    
    await new Promise((resolve, reject) => {
      const child = spawn('node', [CONFIG.collectScript, filePath], {
        cwd: path.dirname(CONFIG.collectScript),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', d => { stdout += d; process.stdout.write(`[incremental] ${d}`); });
      child.stderr.on('data', d => { stderr += d; process.stderr.write(`[incremental:err] ${d}`); });
      
      child.on('close', code => {
        if (code === 0) {
          stats.collected++;
          resolve();
        } else {
          stats.errors++;
          reject(new Error(`incremental-collect exited with code ${code}`));
        }
      });
      
      child.on('error', err => {
        stats.errors++;
        reject(err);
      });
    });
  } catch (e) {
    console.log(`[watcher] ❌ 采集失败: ${e.message}`);
    stats.errors++;
  } finally {
    activeJobs.delete(filePath);
  }
}

// ============================================================
// 文件监控
// ============================================================
function startWatching() {
  console.log('[watcher] 启动文件监控...');
  console.log(`[watcher] 监控路径 (${CONFIG.watchPaths.length} 个):`);
  CONFIG.watchPaths.forEach(p => console.log(`  - ${p}`));
  console.log(`[watcher] 防抖时间: ${CONFIG.debounceMs}ms`);
  console.log(`[watcher] 最大并发: ${CONFIG.maxConcurrency}`);
  
  let watchCount = 0;
  
  for (const watchPath of CONFIG.watchPaths) {
    try {
      // 检查路径是否存在
      const fs = require('fs');
      if (!fs.existsSync(watchPath)) {
        console.log(`[watcher] ⚠️  路径不存在: ${watchPath}`);
        continue;
      }
      
      // 使用 fs.watch 递归监控（Node.js 18+ 支持 recursive）
      const watcher = watch(watchPath, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        
        const fullPath = path.join(watchPath, filename);
        
        // 只处理文件
        try {
          const stat = require('fs').statSync(fullPath);
          if (!stat.isFile()) return;
        } catch {
          return;  // 文件可能不存在了
        }
        
        if (shouldProcess(fullPath)) {
          scheduleCollect(fullPath);
        }
      });
      
      watcher.on('error', err => {
        console.log(`[watcher] ⚠️  监控错误 (${watchPath}): ${err.message}`);
      });
      
      watchCount++;
      console.log(`[watcher] ✅ 开始监控: ${watchPath}`);
      
    } catch (e) {
      console.log(`[watcher] ❌ 启动监控失败 (${watchPath}): ${e.message}`);
    }
  }
  
  if (watchCount === 0) {
    console.log('[watcher] ❌ 没有成功启动任何监控');
    process.exit(1);
  }
  
  console.log(`[watcher] ✅ 成功启动 ${watchCount} 个监控器`);
}

// ============================================================
// 统计报告
// ============================================================
function startStatsReporter() {
  setInterval(() => {
    if (stats.triggered > 0 || pendingFiles.size > 0) {
      console.log(
        `[watcher] 📊 统计: 触发${stats.triggered} | 采集${stats.collected} | 错误${stats.errors} | ` +
        `待处理${pendingFiles.size} | 活跃${activeJobs.size}`
      );
    }
  }, 60000);  // 每分钟报告一次
}

// ============================================================
// 优雅退出
// ============================================================
function setupGracefulShutdown() {
  const shutdown = (signal) => {
    console.log(`\n[watcher] 🛑 收到 ${signal}，正在停止...`);
    
    // 清除所有待处理的计时器
    for (const [fp, timer] of pendingFiles) {
      clearTimeout(timer);
    }
    pendingFiles.clear();
    
    console.log('[watcher] 📊 最终统计:', JSON.stringify(stats));
    console.log('[watcher] ✅ 已停止');
    process.exit(0);
  };
  
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// ============================================================
// 主程序
// ============================================================
function main() {
  console.log('='.repeat(60));
  console.log('[watcher] Graphify 文件监控器启动');
  console.log('='.repeat(60));
  
  setupGracefulShutdown();
  startWatching();
  startStatsReporter();
  
  console.log('[watcher] ✅ 监控器已启动，等待文件变化...');
}

main();
