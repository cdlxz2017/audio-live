#!/usr/bin/env node
// custom-skills/graphify-manager/start-opus-manager.js
// Opus 子程序管理器 - 启动三层桥接架构

const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');

const execAsync = promisify(exec);

class ThreeLayerGraphifyManager {
  constructor() {
    this.baseDir = '/home/ai/.openclaw/workspace/custom-skills/graphify-manager';
    this.layers = { collection: null, bridge: null, query: null };
    this.status = {
      overall: 'initializing',
      collection: { state: 'stopped', pid: null },
      bridge: { state: 'stopped', pid: null },
      query: { state: 'stopped', pid: null, port: 31234 }
    };
    this.checkInterval = null;
    this.heartbeatInterval = null;
  }

  async start() {
    console.log('🚀 启动 Graphify 三层桥接架构管理器...');
    console.log(`📂 工作目录: ${this.baseDir}`);
    
    // 1. 检查依赖
    await this.checkDependencies();
    
    // 2. 启动各层
    await this.startCollectionLayer();
    await this.sleep(2000);
    
    await this.startBridgeLayer();
    await this.sleep(2000);
    
    await this.startQueryLayer();
    await this.sleep(2000);
    
    // 3. 启动监控
    this.startMonitoring();
    this.startHeartbeat();
    
    // 4. 更新状态
    this.updateOverallStatus();
    
    console.log('✅ Graphify 三层架构已全部启动');
    console.log('📊 查询层 HTTP API: http://localhost:31234');
    console.log('🔍 健康检查: http://localhost:31234/health');
    
    return this.status;
  }

  async checkDependencies() {
    console.log('🔍 检查系统依赖...');
    
    const checks = [
      { cmd: 'python3 --version', name: 'Python 3' },
      { cmd: 'node --version', name: 'Node.js' },
      { cmd: 'which graphify || pip show graphifyy 2>/dev/null || echo "not_found"', name: 'Graphify' },
      { cmd: 'python3 -c "import watchdog; print(watchdog.__version__)" 2>/dev/null || echo "not_found"', name: 'watchdog' }
    ];
    
    for (const check of checks) {
      try {
        const { stdout } = await execAsync(check.cmd);
        const version = stdout.trim();
        if (version === 'not_found') {
          console.log(`⚠️  ${check.name}: 未安装`);
        } else {
          console.log(`✅ ${check.name}: ${version.split('\n')[0]}`);
        }
      } catch (error) {
        console.log(`⚠️  ${check.name}: 检查失败`);
      }
    }
  }

  async startCollectionLayer() {
    console.log('📁 启动采集层 (Python)...');
    
    const scriptPath = path.join(this.baseDir, 'collection_layer.py');
    
    if (!fs.existsSync(scriptPath)) {
      console.error(`❌ 采集层脚本不存在: ${scriptPath}`);
      return false;
    }
    
    this.layers.collection = spawn('python3', [scriptPath], {
      cwd: this.baseDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    });
    
    this.layers.collection.stdout.on('data', (data) => {
      process.stdout.write(`[采集层] ${data}`);
    });
    
    this.layers.collection.stderr.on('data', (data) => {
      process.stderr.write(`[采集层错误] ${data}`);
    });
    
    this.layers.collection.on('close', (code) => {
      console.log(`[采集层] 进程退出，代码: ${code}`);
      this.status.collection.state = 'stopped';
      // 5秒后自动重启
      setTimeout(() => this.startCollectionLayer(), 5000);
    });
    
    this.status.collection = { state: 'running', pid: this.layers.collection.pid };
    console.log(`✅ 采集层已启动 (PID: ${this.layers.collection.pid})`);
    return true;
  }

  async startBridgeLayer() {
    console.log('🌉 启动桥接层 (Node.js)...');
    
    const scriptPath = path.join(this.baseDir, 'bridge-layer.js');
    
    if (!fs.existsSync(scriptPath)) {
      console.error(`❌ 桥接层脚本不存在: ${scriptPath}`);
      return false;
    }
    
    this.layers.bridge = spawn('node', [scriptPath], {
      cwd: this.baseDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    });
    
    this.layers.bridge.stdout.on('data', (data) => {
      process.stdout.write(`[桥接层] ${data}`);
    });
    
    this.layers.bridge.stderr.on('data', (data) => {
      process.stderr.write(`[桥接层错误] ${data}`);
    });
    
    this.layers.bridge.on('close', (code) => {
      console.log(`[桥接层] 进程退出，代码: ${code}`);
      this.status.bridge.state = 'stopped';
      setTimeout(() => this.startBridgeLayer(), 5000);
    });
    
    this.status.bridge = { state: 'running', pid: this.layers.bridge.pid };
    console.log(`✅ 桥接层已启动 (PID: ${this.layers.bridge.pid})`);
    return true;
  }

  async startQueryLayer() {
    console.log('🔍 启动查询层 (Express API)...');
    
    const scriptPath = path.join(this.baseDir, 'query-server.js');
    
    // 创建 Express 查询服务器
    const serverCode = `
const express = require('express');
const QueryLayer = require('./query-layer.js');
const app = express();
app.use(express.json());

const queryLayer = new QueryLayer({ cacheTtl: 300, maxResults: 20 });

// 初始化连接
queryLayer.connect().then(connected => {
  if (!connected) {
    console.error('⚠️  Neo4j 连接失败，查询层降级运行');
  }
});

// 查询接口
app.post('/query', async (req, res) => {
  try {
    const { query, userId, sessionId, context } = req.body;
    if (!query) {
      return res.status(400).json({ success: false, error: 'query is required' });
    }
    const results = await queryLayer.query(query, userId || 'default', sessionId, context || {});
    res.json({ success: true, data: results, stats: queryLayer.getStats() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 健康检查
app.get('/health', async (req, res) => {
  const stats = queryLayer.getStats();
  res.json({
    status: 'healthy',
    layer: 'query',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    stats
  });
});

// 统计信息
app.get('/stats', (req, res) => {
  res.json(queryLayer.getStats());
});

// 清除缓存
app.post('/cache/flush', (req, res) => {
  queryLayer.cache.flushAll();
  res.json({ success: true, message: 'Cache flushed' });
});

const PORT = ${this.status.query.port};
app.listen(PORT, () => {
  console.log(\`✅ 查询层 HTTP API 运行在 http://localhost:\${PORT}\`);
});
`;
    
    fs.writeFileSync(scriptPath, serverCode);
    
    this.layers.query = spawn('node', [scriptPath], {
      cwd: this.baseDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    });
    
    this.layers.query.stdout.on('data', (data) => {
      process.stdout.write(`[查询层] ${data}`);
    });
    
    this.layers.query.stderr.on('data', (data) => {
      process.stderr.write(`[查询层错误] ${data}`);
    });
    
    this.layers.query.on('close', (code) => {
      console.log(`[查询层] 进程退出，代码: ${code}`);
      this.status.query.state = 'stopped';
      setTimeout(() => this.startQueryLayer(), 5000);
    });
    
    this.status.query = { state: 'running', pid: this.layers.query.pid, port: 31234 };
    console.log(`✅ 查询层已启动 (PID: ${this.layers.query.pid})`);
    return true;
  }

  startMonitoring() {
    console.log('🔄 启动监控循环 (每30秒)...');
    
    this.checkInterval = setInterval(async () => {
      // 检查各层进程状态
      for (const [name, layer] of Object.entries(this.layers)) {
        if (layer) {
          try {
            process.kill(layer.pid, 0); // 检查进程是否存在
          } catch {
            console.log(`⚠️  ${name} 层进程已退出`);
            this.status[name].state = 'crashed';
          }
        }
      }
      
      this.updateOverallStatus();
    }, 30000);
  }

  startHeartbeat() {
    console.log('💓 启动心跳报告 (每5分钟)...');
    
    this.heartbeatInterval = setInterval(() => {
      this.reportStatus();
    }, 5 * 60 * 1000);
  }

  updateOverallStatus() {
    const allRunning = Object.values(this.status).slice(0, 3).every(
      s => s.state === 'running'
    );
    this.status.overall = allRunning ? 'healthy' : 'degraded';
  }

  reportStatus() {
    const report = {
      timestamp: new Date().toISOString(),
      overall: this.status.overall,
      layers: {
        collection: this.status.collection,
        bridge: this.status.bridge,
        query: this.status.query
      },
      uptime: process.uptime()
    };
    
    console.log('📊 Graphify 三层架构状态:');
    console.log(JSON.stringify(report, null, 2));
    
    return report;
  }

  async stop() {
    console.log('🛑 停止 Graphify 三层架构...');
    
    if (this.checkInterval) clearInterval(this.checkInterval);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    
    for (const [name, layer] of Object.entries(this.layers)) {
      if (layer) {
        try {
          process.kill(layer.pid, 'SIGTERM');
          console.log(`✅ ${name} 层已停止`);
        } catch (error) {
          console.log(`⚠️  停止 ${name} 层失败:`, error.message);
        }
      }
    }
    
    this.status.overall = 'stopped';
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 主程序
async function main() {
  const manager = new ThreeLayerGraphifyManager();
  
  // 处理退出信号
  process.on('SIGINT', async () => {
    console.log('\\n🛑 收到 SIGINT');
    await manager.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('\\n🛑 收到 SIGTERM');
    await manager.stop();
    process.exit(0);
  });
  
  // 启动
  try {
    await manager.start();
    console.log('\\n✅ Graphify 三层架构部署完成！');
    console.log('\\n使用方式:');
    console.log('  curl -X POST http://localhost:31234/query -H "Content-Type: application/json" -d "{\\"query\\":\\"项目中的类\\",\\"userId\\":\\"default\\"}"');
    console.log('\\n查看状态:');
    console.log('  curl http://localhost:31234/health');
    console.log('  curl http://localhost:31234/stats');
  } catch (error) {
    console.error('❌ 启动失败:', error);
    process.exit(1);
  }
}

main();

module.exports = ThreeLayerGraphifyManager;