#!/usr/bin/env node
/**
 * bge-m3 永久驻留进程
 * 利用 Ollama 原生 keep_alive: -1 参数，让模型永远不被卸载
 * 
 * 修复 (2026-04-18): 原来 loop() 只执行一次，进程立即退出导致 PM2 不断重启
 * 现在每 30 秒续一次锁，确保进程常驻且模型持续保留在内存
 * 
 * 使用方式: pm2 start keepalive-bge-m3.js --name bge-m3-keepalive
 */

const http = require('http');

const MODEL = 'bge-m3:latest';
const INTERVAL_MS = 30 * 1000; // 每 30 秒续一次

function lockModelInMemory() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      prompt: '.',      // 最短 prompt，只为触发 keep_alive
      keep_alive: -1    // -1 = 永久驻留，永不卸载
    });

    const req = http.request({
      hostname: 'localhost',
      port: 11434,
      path: '/api/embeddings',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 10000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.error) reject(new Error(result.error));
          else resolve(result);
        } catch (e) {
          reject(new Error('JSON parse error: ' + data.slice(0, 100)));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timeout')); });
    req.write(body);
    req.end();
  });
}

let locked = false;
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 5;

async function tryLock() {
  try {
    await lockModelInMemory();
    consecutiveErrors = 0;
    if (!locked) {
      locked = true;
      console.log(`[bge-m3] ✅ 模型 ${MODEL} 已锁定到内存（keep_alive=-1）`);
    }
  } catch (e) {
    consecutiveErrors++;
    if (locked) {
      console.error(`[bge-m3] ⚠️  锁定失败 (${consecutiveErrors}次连续):`, e.message);
      locked = false;
    }
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      console.error(`[bge-m3] 🔴 连续${consecutiveErrors}次失败，请检查 Ollama 服务`);
    }
  }
}

async function main() {
  console.log(`[bge-m3] 启动保活进程，每 ${INTERVAL_MS / 1000}s 续锁一次...`);
  
  // 立即执行一次
  await tryLock();
  
  // 定期续锁
  setInterval(tryLock, INTERVAL_MS);
}

main();

// 进程保持活跃
process.on('uncaughtException', (e) => {
  console.error('[bge-m3] uncaughtException:', e.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[bge-m3] unhandledRejection:', reason);
});
